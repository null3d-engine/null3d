//! GLSL ES 3.00 for WebGL2, with the reflection the WebGL2 backend needs. GLSL ES 3.00 has no
//! binding numbers, so the backend binds each uniform block and texture by the name it has in each
//! stage, and the reflection maps those names back to WGSL bindings.

use naga::back::glsl::{self as backend, Options, PipelineOptions, Version, WriterFlags};
use naga::proc::BoundsCheckPolicies;
use naga::valid::ModuleInfo;
use naga::{
    ArraySize, Binding as IoBinding, BuiltIn, EntryPoint, Handle, Module, ShaderStage, Type,
    TypeInner, VectorSize,
};

use crate::{Binding, GlslProgram, GlslStage, GlslTexture, GlslUniformBlock, Pipeline};

/// The extension a vertex shader enables to read `gl_DrawID` under `WEBGL_multi_draw`.
pub(crate) const MULTI_DRAW_EXTENSION: &str = "#extension GL_ANGLE_multi_draw : require";

/// The uniform through which a vertex shader maps WebGPU's clip depth into the WebGL2 backend's
/// depth mode: it writes `z * mapping.x + w * mapping.y` as the clip depth. One program then
/// serves every depth mode, and the backend sets the uniform once per program.
pub(crate) const DEPTH_MAPPING_UNIFORM: &str = "null3d_depth_mapping";

/// Writes the vertex and fragment shaders of one render pipeline. The functions and constants
/// that `mediump` names run at that precision.
pub(crate) fn write_program(
    module: &Module,
    info: &ModuleInfo,
    name: &str,
    pipeline: &Pipeline,
    mediump: &[String],
) -> Result<GlslProgram, String> {
    let [vertex, fragment] = pipeline.stages().map(|(stage, stage_name, entry_point)| {
        write_stage(module, info, name, stage, stage_name, entry_point, mediump)
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
    mediump: &[String],
) -> Result<GlslStage, String> {
    let options = Options {
        version: Version::Embedded {
            version: 300,
            is_webgl: true,
        },
        // Moves depth into GL's clip range and flips Y. The writer below keeps a depth step alone,
        // which maps depth through the depth mapping uniform.
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

    source = crate::half::mediump_items(&source, mediump);

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
            let global = &module.global_variables[handle];
            let block = global.name.as_deref().unwrap_or(name);
            metal_layout(module, global.ty, block).map_err(|e| {
                format!(
                    "the uniform block `{block}` of pipeline `{pipeline}` lays out differently in WebGL2 on Metal, as Safari runs it: {e}. Safari then converts the block on the CPU at each draw, after it waits for the GPU. Fill each vec3f with a scalar into a vec4f."
                )
            })?;
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

/// The size and alignment in bytes of a uniform type in ANGLE's Metal layout, which WebGL2 has in
/// Safari and in Chrome on macOS, or where that layout parts from WGSL's, which the engine writes.
/// The two agree on scalars, `vec2f`, `vec4f`, matrices, arrays and structs of them, but ANGLE gives
/// a `vec3f` 16 bytes where WGSL lets a scalar follow at byte 12. `path` names the type in the
/// error.
fn metal_layout(module: &Module, ty: Handle<Type>, path: &str) -> Result<(u32, u32), String> {
    let vector = |size: VectorSize, width: u8| -> (u32, u32) {
        let width = u32::from(width);
        let bytes = if size == VectorSize::Bi {
            2 * width
        } else {
            4 * width
        };
        (bytes, bytes)
    };
    Ok(match &module.types[ty].inner {
        TypeInner::Scalar(scalar) | TypeInner::Atomic(scalar) => {
            (u32::from(scalar.width), u32::from(scalar.width))
        }
        &TypeInner::Vector { size, scalar } => vector(size, scalar.width),
        &TypeInner::Matrix {
            columns,
            rows,
            scalar,
        } => {
            let (column, align) = vector(rows, scalar.width);
            (columns as u32 * column, align)
        }
        &TypeInner::Array { base, size, stride } => {
            let (bytes, align) = metal_layout(module, base, &format!("{path}[]"))?;
            let metal_stride = bytes.next_multiple_of(align);
            if metal_stride != stride {
                return Err(format!(
                    "`{path}` steps {metal_stride} bytes from element to element there, and {stride} in WGSL"
                ));
            }
            let count = match size {
                ArraySize::Constant(count) => count.get(),
                _ => 1,
            };
            (count * stride, align)
        }
        TypeInner::Struct { members, span } => {
            let (mut end, mut align) = (0u32, 1u32);
            for member in members {
                let name = member.name.as_deref().unwrap_or("?");
                let field = format!("{path}.{name}");
                let (bytes, member_align) = metal_layout(module, member.ty, &field)?;
                let offset = end.next_multiple_of(member_align);
                if offset != member.offset {
                    return Err(format!(
                        "`{field}` starts at byte {offset} there, and at byte {} in WGSL",
                        member.offset
                    ));
                }
                end = offset + bytes;
                align = align.max(member_align);
            }
            let size = end.next_multiple_of(align);
            if size != *span {
                return Err(format!(
                    "`{path}` takes {size} bytes there, and {span} in WGSL"
                ));
            }
            (size, align)
        }
        _ => return Err(format!("`{path}` is no type that a uniform block holds")),
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

/// The depth step alone, through the depth mapping uniform.
fn depth_step() -> String {
    format!(
        "gl_Position.z = gl_Position.z * {DEPTH_MAPPING_UNIFORM}.x + gl_Position.w * {DEPTH_MAPPING_UNIFORM}.y;"
    )
}

/// Inserts a line right after the `#version` line, where declarations and extensions may go.
fn after_version(source: &str, line: &str) -> String {
    let (version, rest) = source.split_once('\n').unwrap_or((source, ""));
    format!("{version}\n{line}\n{rest}")
}

/// Keeps GL's row order: replaces naga's coordinate adjustment with a depth step alone, which
/// maps WebGPU's clip depth through the depth mapping uniform. The canvas then shows the image
/// the right way up, and front faces wind counter-clockwise as they do on WebGPU. The flip would
/// turn the image upside down in the canvas, and a multisampled resolve into the canvas cannot
/// flip it back, so each frame would need a second copy. Fails when naga writes the adjustment
/// differently, so a naga update cannot flip images unnoticed.
pub(crate) fn keep_gl_row_order(source: &str) -> Result<String, String> {
    if !source.contains(NAGA_ADJUSTMENT) {
        return Err(format!(
            "naga no longer writes `{NAGA_ADJUSTMENT}`, which the build replaces to keep GL's row order. Update `keep_gl_row_order` in crates/null3d-shaders/src/glsl.rs."
        ));
    }
    let stepped = source.replace(NAGA_ADJUSTMENT, &depth_step());
    Ok(after_version(
        &stepped,
        &format!("uniform vec2 {DEPTH_MAPPING_UNIFORM};"),
    ))
}

/// Enables `WEBGL_multi_draw` in a vertex shader. The extension goes right after the `#version`
/// line. naga reads the draw index as `gl_DrawID`, a signed integer, into WGSL's unsigned value,
/// and GLSL ES 3.00 has no implicit conversions, so each read converts it.
pub(crate) fn enable_multi_draw(source: &str) -> String {
    let converted = source
        .replace("uint(gl_DrawID)", "gl_DrawID")
        .replace("gl_DrawID", "uint(gl_DrawID)");
    after_version(&converted, MULTI_DRAW_EXTENSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_row_order_step_maps_depth_through_the_uniform_and_drops_the_flip() {
        let source = format!(
            "#version 300 es\n\nvoid main() {{\n    {NAGA_ADJUSTMENT}\n    return;\n    {NAGA_ADJUSTMENT}\n}}\n"
        );
        let kept = keep_gl_row_order(&source).unwrap();
        let lines: Vec<_> = kept.lines().collect();
        assert_eq!(
            lines[..2],
            ["#version 300 es", "uniform vec2 null3d_depth_mapping;"]
        );
        assert_eq!(kept.matches(&depth_step()).count(), 2, "{kept}");
        assert!(!kept.contains("-gl_Position.y"));
        assert!(!kept.contains("* 2.0"));
        assert!(keep_gl_row_order("void main() {}\n").is_err());
    }

    /// The Metal layout of the type of the uniform `u` in `source`.
    fn uniform_layout(source: &str) -> Result<(u32, u32), String> {
        let module = naga::front::wgsl::parse_str(source).unwrap();
        let (_, global) = module
            .global_variables
            .iter()
            .find(|(_, g)| g.name.as_deref() == Some("u"))
            .unwrap();
        metal_layout(&module, global.ty, "U")
    }

    #[test]
    fn uniform_blocks_must_lay_out_as_webgl2_on_metal_does() {
        let fits = "struct Inner { a: vec4f, b: f32, c: u32 }\nstruct U { m: mat4x4f, inner: Inner, list: array<vec4f, 4>, d: vec2f, e: f32 }\n@group(0) @binding(0) var<uniform> u: U;\n";
        assert_eq!(uniform_layout(fits), Ok((176, 16)));
        let vec3_then_scalar =
            "struct U { color: vec3f, kind: u32 }\n@group(0) @binding(0) var<uniform> u: U;\n";
        let error = uniform_layout(vec3_then_scalar).unwrap_err();
        assert!(
            error.contains("`U.kind` starts at byte 16 there"),
            "{error}"
        );
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
