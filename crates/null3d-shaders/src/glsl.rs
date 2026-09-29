//! GLSL ES 3.00 for WebGL2, with the reflection the WebGL2 backend needs. GLSL ES 3.00 has no
//! binding numbers, so the backend binds each uniform block and texture by the name it has in each
//! stage, and the reflection maps those names back to WGSL bindings.

use naga::back::glsl::{self as backend, Options, PipelineOptions, Version, WriterFlags};
use naga::proc::BoundsCheckPolicies;
use naga::valid::ModuleInfo;
use naga::{Binding as IoBinding, BuiltIn, EntryPoint, Handle, Module, ShaderStage, TypeInner};

use crate::{Binding, GlslProgram, GlslStage, GlslTexture, GlslUniformBlock, Pipeline};

/// The extension a vertex shader enables to read `gl_DrawID` under `WEBGL_multi_draw`.
pub(crate) const MULTI_DRAW_EXTENSION: &str = "#extension GL_ANGLE_multi_draw : require";

/// Writes the vertex and fragment shaders of one render pipeline.
pub(crate) fn write_program(
    module: &Module,
    info: &ModuleInfo,
    name: &str,
    pipeline: &Pipeline,
) -> Result<GlslProgram, String> {
    let [vertex, fragment] = pipeline.stages().map(|(stage, stage_name, entry_point)| {
        write_stage(module, info, name, stage, stage_name, entry_point)
    });
    Ok(GlslProgram {
        vertex: vertex?,
        fragment: fragment?,
    })
}

fn write_stage(
    module: &Module,
    info: &ModuleInfo,
    pipeline: &str,
    stage: ShaderStage,
    stage_name: &str,
    entry_point: &str,
) -> Result<GlslStage, String> {
    let options = Options {
        version: Version::Embedded {
            version: 300,
            is_webgl: true,
        },
        // Moves depth into GL's clip range. The flag also flips Y, which the writer undoes below.
        writer_flags: WriterFlags::ADJUST_COORDINATE_SPACE,
        ..Options::default()
    };
    let pipeline_options = PipelineOptions {
        shader_stage: stage,
        entry_point: entry_point.to_owned(),
        multiview: None,
    };
    let mut source = String::new();
    // WebGL clamps out-of-range accesses itself, so the shaders carry no bounds checks of their own.
    let reflection = backend::Writer::new(
        &mut source,
        module,
        info,
        &options,
        &pipeline_options,
        BoundsCheckPolicies::default(),
    )
    .and_then(|mut writer| writer.write())
    .map_err(|e| {
        format!(
            "GLSL ES 3.00 for WebGL2 cannot express the {stage_name} shader `{entry_point}` of pipeline `{pipeline}`: {e}. Keep such code out of variants that target \"glsl\", for example behind a shader def."
        )
    })?;

    let entry = module
        .entry_points
        .iter()
        .find(|ep| ep.stage == stage && ep.name == entry_point);
    if stage == ShaderStage::Vertex {
        source = keep_gl_row_order(&source).map_err(|e| {
            format!("the vertex shader `{entry_point}` of pipeline `{pipeline}`: {e}")
        })?;
        if entry.is_some_and(|ep| reads_draw_index(module, ep)) {
            source = enable_multi_draw(&source);
        }
    }

    let binding = |handle: Handle<naga::GlobalVariable>| -> Result<Binding, String> {
        let global = &module.global_variables[handle];
        global
            .binding
            .as_ref()
            .map(|b| Binding {
                group: b.group,
                binding: b.binding,
            })
            .ok_or_else(|| {
                format!(
                    "the resource `{}` has no @group and @binding attributes.",
                    global.name.as_deref().unwrap_or_default()
                )
            })
    };
    let mut uniform_blocks = reflection
        .uniforms
        .iter()
        .map(|(&handle, name)| {
            Ok(GlslUniformBlock {
                name: name.clone(),
                binding: binding(handle)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    uniform_blocks.sort_by(|a, b| (a.binding, &a.name).cmp(&(b.binding, &b.name)));
    let mut textures = reflection
        .texture_mapping
        .iter()
        .map(|(name, mapping)| {
            Ok(GlslTexture {
                name: name.clone(),
                binding: binding(mapping.texture)?,
                sampler: mapping.sampler.map(binding).transpose()?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    textures.sort_by(|a, b| (a.binding, &a.name).cmp(&(b.binding, &b.name)));

    Ok(GlslStage {
        source: crate::finish_source(&source),
        uniform_blocks,
        textures,
    })
}

/// True when the entry point reads `@builtin(draw_index)`, directly or in a struct argument.
fn reads_draw_index(module: &Module, entry: &EntryPoint) -> bool {
    let is_draw_index = |binding: Option<&IoBinding>| {
        matches!(binding, Some(IoBinding::BuiltIn(BuiltIn::DrawIndex)))
    };
    entry.function.arguments.iter().any(|argument| {
        is_draw_index(argument.binding.as_ref())
            || match &module.types[argument.ty].inner {
                TypeInner::Struct { members, .. } => {
                    members.iter().any(|m| is_draw_index(m.binding.as_ref()))
                }
                _ => false,
            }
    })
}

/// What naga's coordinate adjustment writes before each return of a vertex shader: Y flipped and
/// depth moved into GL's clip range.
const NAGA_ADJUSTMENT: &str =
    "gl_Position.yz = vec2(-gl_Position.y, gl_Position.z * 2.0 - gl_Position.w);";
/// The depth move alone.
const DEPTH_ONLY: &str = "gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;";

/// Keeps GL's row order: replaces naga's coordinate adjustment with the depth move alone. The
/// canvas then shows the image the right way up, and front faces wind counter-clockwise as they
/// do on WebGPU. The flip would turn the image upside down in the canvas, and a multisampled
/// resolve into the canvas cannot flip it back, so each frame would need a second copy. Fails
/// when naga writes the adjustment differently, so a naga update cannot flip images unnoticed.
pub(crate) fn keep_gl_row_order(source: &str) -> Result<String, String> {
    if !source.contains(NAGA_ADJUSTMENT) {
        return Err(format!(
            "naga no longer writes `{NAGA_ADJUSTMENT}`, which the build replaces to keep GL's row order. Update `keep_gl_row_order` in crates/null3d-shaders/src/glsl.rs."
        ));
    }
    Ok(source.replace(NAGA_ADJUSTMENT, DEPTH_ONLY))
}

/// Enables `WEBGL_multi_draw` in a vertex shader. The extension goes right after the `#version`
/// line. naga reads the draw index as `gl_DrawID`, a signed integer, into WGSL's unsigned value,
/// and GLSL ES 3.00 has no implicit conversions, so each read converts it.
pub(crate) fn enable_multi_draw(source: &str) -> String {
    let (version, rest) = source.split_once('\n').unwrap_or((source, ""));
    let rest = rest
        .replace("uint(gl_DrawID)", "gl_DrawID")
        .replace("gl_DrawID", "uint(gl_DrawID)");
    format!("{version}\n{MULTI_DRAW_EXTENSION}\n{rest}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_row_order_step_keeps_the_depth_move_and_drops_the_flip() {
        let source = format!("void main() {{\n    {NAGA_ADJUSTMENT}\n    return;\n}}\n");
        let kept = keep_gl_row_order(&source).unwrap();
        assert!(kept.contains(DEPTH_ONLY));
        assert!(!kept.contains("-gl_Position.y"));
        assert!(keep_gl_row_order("void main() {}\n").is_err());
    }

    #[test]
    fn multi_draw_adds_the_extension_and_converts_each_read_once() {
        let source = "#version 300 es\n\nvoid main() {\n    uint a = gl_DrawID;\n    uint b = uint(gl_DrawID);\n}\n";
        let converted = enable_multi_draw(source);
        let lines: Vec<_> = converted.lines().collect();
        assert_eq!(lines[0], "#version 300 es");
        assert_eq!(lines[1], MULTI_DRAW_EXTENSION);
        assert_eq!(converted.matches("uint(gl_DrawID)").count(), 2);
        assert!(!converted.contains("uint(uint("));
    }
}
