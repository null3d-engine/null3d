//! GLSL ES 3.00 for WebGL2, with the reflection the WebGL2 backend needs. GLSL ES 3.00 has no
//! binding numbers, so the backend binds each uniform block and texture by the name it has in each
//! stage, and the reflection maps those names back to WGSL bindings.

use naga::back::glsl::{self as backend, Options, PipelineOptions, Version, WriterFlags};
use naga::compact::{KeepUnused, compact};
use naga::proc::BoundsCheckPolicies;
use naga::valid::{Capabilities, ModuleInfo, ValidationFlags, Validator};
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
    capabilities: Capabilities,
    name: &str,
    pipeline: &Pipeline,
    mediump: &[String],
) -> Result<GlslProgram, String> {
    let [vertex, fragment] = pipeline.stages().map(|(stage, stage_name, entry_point)| {
        let (stage_module, info) = stage_module(module, capabilities, stage, entry_point)?;
        write_stage(
            &stage_module,
            &info,
            name,
            stage,
            stage_name,
            entry_point,
            mediump,
        )
    });
    Ok(GlslProgram {
        vertex: vertex?,
        fragment: fragment?,
    })
}

/// The module with only the entry point of one stage, and only what that entry point uses. Each
/// stage's text then depends only on its own code: a bit that changes only the vertex shader
/// leaves the fragment shader's text as it is, so the builds that differ in that bit share it.
fn stage_module(
    module: &Module,
    capabilities: Capabilities,
    stage: ShaderStage,
    entry_point: &str,
) -> Result<(Module, ModuleInfo), String> {
    let mut stage_module = module.clone();
    stage_module
        .entry_points
        .retain(|ep| ep.stage == stage && ep.name == entry_point);
    compact(&mut stage_module, KeepUnused::No);
    let info = Validator::new(ValidationFlags::all(), capabilities)
        .validate(&stage_module)
        .map_err(|e| {
            format!(
                "the module of the entry point `{entry_point}` alone failed validation, which is a bug in the shader build: {e}"
            )
        })?;
    Ok((stage_module, info))
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
    source = unroll_array_constructors(&source);
    source = drop_unused_constants(&source);

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

/// Drops each constant that the text declares at its top level and names nowhere else. naga writes
/// every named constant of the module, also those that only another stage reads, and a blank line
/// after them, which goes too when no constant is left above it.
pub(crate) fn drop_unused_constants(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let mut dropped = false;
    let mut kept_constant = false;
    for line in source.split_inclusive('\n') {
        let constant = constant_name(line);
        let unused = constant.is_some_and(|name| {
            source
                .match_indices(name)
                .filter(|&(at, _)| is_whole_word(source, at, name.len()))
                .nth(1)
                .is_none()
        });
        if unused {
            dropped = true;
            continue;
        }
        if dropped && !kept_constant && line.trim().is_empty() {
            dropped = false;
            continue;
        }
        dropped = false;
        kept_constant = constant.is_some();
        out.push_str(line);
    }
    out
}

/// The name that a top-level `const <type> <name> = <value>;` line declares.
fn constant_name(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("const ")?;
    let (_, rest) = rest.split_once(' ')?;
    let (name, _) = rest.split_once(" = ")?;
    is_identifier(name).then_some(name)
}

/// Whether the text at `at`, `len` bytes long, is a whole identifier.
fn is_whole_word(source: &str, at: usize, len: usize) -> bool {
    let word_char = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let before = source[..at]
        .chars()
        .next_back()
        .is_none_or(|c| !word_char(c));
    let after = source[at + len..]
        .chars()
        .next()
        .is_none_or(|c| !word_char(c));
    before && after
}

/// Fills each local array that naga declares with a sized array constructor one element at a
/// time, so the GLSL holds no array constructor. Arm's Mali compiler rejects a sized constructor
/// such as `vec3[9](a, b, ...)` whose values are not constants: it finds no default precision for
/// the array type, although the shader declares one for `float`. naga writes such a declaration
/// on one line, indented inside a function, in the form `T name[N] = T[N](values);`. Other lines,
/// and globals, stay as they are.
pub(crate) fn unroll_array_constructors(source: &str) -> String {
    let mut out = String::with_capacity(source.len() + source.len() / 16);
    for line in source.split_inclusive('\n') {
        match unrolled_declaration(line) {
            Some(lines) => out.push_str(&lines),
            None => out.push_str(line),
        }
    }
    out
}

/// The declaration and element assignments that replace one line of the form
/// `T name[N] = T[N](values);`, or `None` for any other line.
fn unrolled_declaration(line: &str) -> Option<String> {
    let body = line.trim_start();
    let indent = &line[..line.len() - body.len()];
    let body = body.trim_end();
    if indent.is_empty() {
        return None;
    }
    let (declaration, value) = body.split_once(" = ")?;
    let (ty, declarator) = declaration.split_once(' ')?;
    let (name, size) = declarator.strip_suffix(']')?.split_once('[')?;
    if !is_identifier(ty) || !is_identifier(name) || !size.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let values = value
        .strip_prefix(ty)?
        .strip_prefix('[')?
        .strip_prefix(size)?
        .strip_prefix("](")?
        .strip_suffix(");")?;
    let values = split_arguments(values)?;
    if values.len() != size.parse::<usize>().ok()? {
        return None;
    }
    let mut out = format!("{indent}{declaration};\n");
    for (index, value) in values.iter().enumerate() {
        out.push_str(&format!("{indent}{name}[{index}] = {value};\n"));
    }
    Some(out)
}

/// True for a GLSL identifier.
fn is_identifier(word: &str) -> bool {
    word.bytes()
        .next()
        .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && word.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Splits a constructor's arguments at the commas outside parentheses and brackets, or `None`
/// when the brackets do not pair up.
fn split_arguments(list: &str) -> Option<Vec<&str>> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0usize, 0);
    for (at, c) in list.char_indices() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.checked_sub(1)?,
            ',' if depth == 0 => {
                parts.push(list[start..at].trim());
                start = at + 1;
            }
            _ => {}
        }
    }
    if depth != 0 {
        return None;
    }
    parts.push(list[start..].trim());
    Some(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_array_constructors_become_element_assignments() {
        let source = "vec2 corners[2] = vec2[2](vec2(0.0), vec2(1.0));\nvoid main() {\n    vec3 sh_1[3] = vec3[3](f[1].xyz, vec3(f[1].w, f[2].xy), min(a, b));\n        uvec4 u[2] = uvec4[2](uvec4(0u), uvec4(0u));\n    vec3 x = vec3[3](a, b, c)[i];\n    vec2 w[3] = vec2[3](a, b);\n}\n";
        let expected = "vec2 corners[2] = vec2[2](vec2(0.0), vec2(1.0));\nvoid main() {\n    vec3 sh_1[3];\n    sh_1[0] = f[1].xyz;\n    sh_1[1] = vec3(f[1].w, f[2].xy);\n    sh_1[2] = min(a, b);\n        uvec4 u[2];\n        u[0] = uvec4(0u);\n        u[1] = uvec4(0u);\n    vec3 x = vec3[3](a, b, c)[i];\n    vec2 w[3] = vec2[3](a, b);\n}\n";
        assert_eq!(unroll_array_constructors(source), expected);
    }

    #[test]
    fn constants_that_no_other_line_names_are_dropped() {
        let source = "const float A = 1.0;\nconst float AB = A * 2.0;\nconst uint UNUSED = 3u;\nconst float B_1 = 2.0;\nfloat f() { return AB + B_1; }\n";
        assert_eq!(
            drop_unused_constants(source),
            "const float A = 1.0;\nconst float AB = A * 2.0;\nconst float B_1 = 2.0;\nfloat f() { return AB + B_1; }\n"
        );
        let only_unused = "struct S {\n    float x;\n};\nconst uint UNUSED = 3u;\n\nin float v;\n\nvoid main() {}\n";
        assert_eq!(
            drop_unused_constants(only_unused),
            "struct S {\n    float x;\n};\nin float v;\n\nvoid main() {}\n"
        );
    }

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
