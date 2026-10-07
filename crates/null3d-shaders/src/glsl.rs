//! GLSL ES 3.00 for WebGL2, with the reflection the WebGL2 backend needs. GLSL ES 3.00 has no
//! binding numbers, so the backend binds each uniform block and texture by the name it has in each
//! stage, and the reflection maps those names back to WGSL bindings.

use naga::back::glsl::{self as backend, Options, PipelineOptions, Version, WriterFlags};
use naga::compact::{KeepUnused, compact};
use naga::proc::BoundsCheckPolicies;
use naga::valid::{Capabilities, ModuleInfo, ValidationFlags, Validator};
use naga::{
    AddressSpace, ArraySize, Binding as IoBinding, BuiltIn, EntryPoint, Expression, Function,
    Handle, Module, ShaderStage, Type, TypeInner, VectorSize,
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
        if let Some(function) = copied_uniform_array(&stage_module, &info) {
            return Err(format!(
                "pipeline `{name}`: the function `{function}` copies a value that holds an array out of a uniform block. Adreno 830's WebGL2 driver leaves such a copy's arrays empty. Read the elements from the block where the function needs them, or hold the vectors in named fields."
            ));
        }
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
    source = lower_arrays(&source);
    source = drop_unused_constants(&source);
    source = highp_integers(&source);
    source = implicit_comparison_levels(&source);

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

/// The name of the first function that loads a value holding an array (an array, or a struct with
/// one at any depth) out of a uniform block, as a whole: a struct field read into a local or
/// passed by value. Reads of single elements, such as `block.list[i]`, load no array.
fn copied_uniform_array(module: &Module, info: &ModuleInfo) -> Option<String> {
    fn holds_array(module: &Module, inner: &TypeInner) -> bool {
        match inner {
            TypeInner::Array { .. } | TypeInner::BindingArray { .. } => true,
            TypeInner::Struct { members, .. } => members
                .iter()
                .any(|m| holds_array(module, &module.types[m.ty].inner)),
            _ => false,
        }
    }
    let in_uniform = |function: &Function, mut pointer: Handle<Expression>| loop {
        match function.expressions[pointer] {
            Expression::Access { base, .. } | Expression::AccessIndex { base, .. } => {
                pointer = base;
            }
            Expression::GlobalVariable(global) => {
                break module.global_variables[global].space == AddressSpace::Uniform;
            }
            _ => break false,
        }
    };
    let copies = |function: &Function, function_info: &naga::valid::FunctionInfo| {
        function.expressions.iter().any(|(handle, expression)| {
            matches!(*expression, Expression::Load { pointer } if in_uniform(function, pointer))
                && holds_array(module, function_info[handle].ty.inner_with(&module.types))
        })
    };
    let functions = module
        .functions
        .iter()
        .map(|(handle, f)| (f, &info[handle]));
    let entry_points = module
        .entry_points
        .iter()
        .enumerate()
        .map(|(i, ep)| (&ep.function, info.get_entry_point(i)));
    functions
        .chain(entry_points)
        .find(|(function, function_info)| copies(function, function_info))
        .map(|(function, _)| function.name.clone().unwrap_or_default())
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

/// The name of the parameter through which a function that returns an array gives its result.
const ARRAY_RESULT: &str = "_n3d_result";
/// The start of the names of the arrays that take array constructors' values. naga's namer never
/// gives a user's name a leading underscore, and naga's own names start with `_e`, `_group` and
/// the stage prefixes.
const ARRAY_TEMPORARY: &str = "_n3d_array";

/// Rewrites the GLSL of a stage so that no line inside a function names a sized array type, such
/// as `vec3[9]`. Arm's Mali compiler rejects a sized array constructor such as `vec3[9](a, b, ...)`
/// whose values are not constants, and an array type as a function's result: it finds no default
/// precision for the array type, although the shader declares one for `float`.
///
/// - A function that returns an array gives it through an `out` parameter instead. Each call
///   passes the array that naga declares for the result.
/// - Inside functions, each array constructor becomes an array that its values fill one element
///   at a time. A declaration whose whole value is a constructor fills the declared array itself.
///   naga writes each call on a line of its own, and the other expressions have no side effects,
///   so a constructor's values can move to the lines before the line that holds it.
///
/// Constructors at global scope hold constants only, and stay as they are.
pub(crate) fn lower_arrays(source: &str) -> String {
    lower_array_constructors(&lower_array_results(source))
}

/// The type, size, name and parameters of a function's first line `T[N] name(params) {`, which
/// returns an array.
fn array_result_definition(line: &str) -> Option<(&str, &str, &str, &str)> {
    let (ty, rest) = line.split_once('[')?;
    let (size, rest) = rest.split_once("] ")?;
    let (name, params) = rest.split_once('(')?;
    let params = params.strip_suffix(") {")?;
    (is_identifier(ty) && is_size(size) && is_identifier(name)).then_some((ty, size, name, params))
}

/// The result's type, name and size, the function and its arguments of a line that calls one of
/// `functions` in naga's form `T name[N] = function(args);`.
fn array_result_call<'a>(
    body: &'a str,
    functions: &[&str],
) -> Option<(&'a str, &'a str, &'a str, &'a str, &'a str)> {
    let (declaration, call) = body.split_once(" = ")?;
    let (ty, declarator) = declaration.split_once(' ')?;
    let (name, size) = declarator.strip_suffix(']')?.split_once('[')?;
    let (function, args) = call.strip_suffix(");")?.split_once('(')?;
    (is_identifier(ty) && is_identifier(name) && is_size(size) && functions.contains(&function))
        .then_some((ty, name, size, function, args))
}

/// Gives the result of each function that returns an array through an `out` parameter.
fn lower_array_results(source: &str) -> String {
    let functions: Vec<&str> = source
        .lines()
        .filter_map(|line| array_result_definition(line).map(|(_, _, name, _)| name))
        .collect();
    if functions.is_empty() {
        return source.to_owned();
    }
    let mut out = String::with_capacity(source.len() + source.len() / 16);
    // True inside the body of a function that returns an array. naga closes a function with a
    // brace at the start of a line.
    let mut inside = false;
    for line in source.split_inclusive('\n') {
        let text = line.trim_end_matches('\n');
        let body = text.trim_start();
        let indent = &text[..text.len() - body.len()];
        if let Some((ty, size, name, params)) = array_result_definition(text) {
            let separator = if params.is_empty() { "" } else { ", " };
            out.push_str(&format!(
                "void {name}({params}{separator}out {ty} {ARRAY_RESULT}[{size}]) {{\n"
            ));
            inside = true;
        } else if let Some(value) = body.strip_prefix("return ").filter(|_| inside) {
            let value = value.strip_suffix(';').unwrap_or(value);
            out.push_str(&format!(
                "{indent}{ARRAY_RESULT} = {value};\n{indent}return;\n"
            ));
        } else if let Some((ty, name, size, function, args)) = array_result_call(body, &functions) {
            let separator = if args.is_empty() { "" } else { ", " };
            out.push_str(&format!(
                "{indent}{ty} {name}[{size}];\n{indent}{function}({args}{separator}{name});\n"
            ));
        } else {
            inside &= text != "}";
            out.push_str(line);
        }
    }
    out
}

/// An array constructor `T[N](values)` in a line: where it starts and ends, and its type, size and
/// values.
struct Constructor<'a> {
    start: usize,
    end: usize,
    ty: &'a str,
    size: &'a str,
    values: Vec<&'a str>,
}

/// The constructor in `line` that starts last, which therefore holds no other constructor.
fn last_constructor(line: &str) -> Option<Constructor<'_>> {
    line.rmatch_indices("](").find_map(|(close, _)| {
        let open = line[..close].rfind('[')?;
        let size = &line[open + 1..close];
        let start = line[..open]
            .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .map_or(0, |at| at + 1);
        let ty = &line[start..open];
        if !is_size(size) || !is_identifier(ty) {
            return None;
        }
        let first = close + 2;
        let length = closing_parenthesis(&line[first..])?;
        let values = split_arguments(&line[first..first + length])?;
        (values.len() == size.parse::<usize>().ok()?).then_some(Constructor {
            start,
            end: first + length + 1,
            ty,
            size,
            values,
        })
    })
}

/// Moves each array constructor inside a function into an array that its values fill one element
/// at a time, on the lines before the constructor's line.
fn lower_array_constructors(source: &str) -> String {
    let mut out = String::with_capacity(source.len() + source.len() / 16);
    let mut temporaries = 0;
    for line in source.split_inclusive('\n') {
        let mut text = line.trim_end_matches('\n').to_owned();
        let body_at = text.len() - text.trim_start().len();
        if body_at == 0 || last_constructor(&text).is_none() {
            out.push_str(line);
            continue;
        }
        let indent = text[..body_at].to_owned();
        while let Some(c) = last_constructor(&text) {
            let whole_value = c.end + 1 == text.len() && text.ends_with(';');
            let declared = whole_value
                .then(|| declared_array(&text[body_at..c.start], c.ty, c.size))
                .flatten()
                .map(str::to_owned);
            let array = declared.clone().unwrap_or_else(|| {
                temporaries += 1;
                format!("{ARRAY_TEMPORARY}{temporaries}")
            });
            out.push_str(&format!("{indent}{} {array}[{}];\n", c.ty, c.size));
            for (index, value) in c.values.iter().enumerate() {
                out.push_str(&format!("{indent}{array}[{index}] = {value};\n"));
            }
            if declared.is_some() {
                text.clear();
                break;
            }
            text.replace_range(c.start..c.end, &array);
        }
        if !text.is_empty() {
            out.push_str(&text);
            out.push('\n');
        }
    }
    out
}

/// The name that `head`, the start of a declaration `T name[N] = ` before its value, declares when
/// its type and size are `ty` and `size`.
fn declared_array<'a>(head: &'a str, ty: &str, size: &str) -> Option<&'a str> {
    let name = head
        .strip_prefix(ty)?
        .strip_prefix(' ')?
        .strip_suffix(" = ")?
        .strip_suffix(']')?
        .strip_suffix(size)?
        .strip_suffix('[')?;
    is_identifier(name).then_some(name)
}

/// True for an array size: decimal digits.
fn is_size(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit())
}

/// The length of the text before the parenthesis that closes the one opened just before `text`.
fn closing_parenthesis(text: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (at, c) in text.char_indices() {
        match c {
            '(' => depth += 1,
            ')' if depth == 0 => return Some(at),
            ')' => depth -= 1,
            _ => {}
        }
    }
    None
}

/// GLSL's whole-number types.
const INTEGER_TYPES: [&str; 8] = [
    "int", "uint", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4",
];

/// GLSL's precision qualifiers.
const PRECISIONS: [&str; 3] = ["highp", "mediump", "lowp"];

/// Writes `highp` on each declaration of a whole number that names no precision: globals, inputs
/// and outputs, uniform block and struct members, constants, function results and parameters, and
/// locals. The default `precision highp int;` should cover them, but a fragment shader's built-in
/// default for whole numbers is `mediump`, and the Adreno 619 driver of a Galaxy Tab A9 Plus kept
/// only the low 16 bits of whole numbers declared without a precision. A declaration is a type
/// followed by a name; a type followed by `(` is a constructor or a conversion, and stays.
pub(crate) fn highp_integers(source: &str) -> String {
    let tokens = crate::scan::tokenize(source);
    let mut out = String::with_capacity(source.len() + source.len() / 32);
    let mut copied = 0;
    for (index, token) in tokens.iter().enumerate() {
        let declares = INTEGER_TYPES.contains(&token.text)
            && tokens
                .get(index + 1)
                .is_some_and(|next| next.kind == crate::scan::Kind::Ident)
            && !index
                .checked_sub(1)
                .is_some_and(|previous| PRECISIONS.contains(&tokens[previous].text));
        if declares {
            out.push_str(&source[copied..token.start]);
            out.push_str("highp ");
            copied = token.start;
        }
    }
    out.push_str(&source[copied..]);
    out
}

/// The call that naga writes for a comparison read at level 0 of an array or cube comparison
/// sampler, for which GLSL ES 3.00 has no `textureLod`.
const GRADIENT_READ: &str = "textureGrad";

/// Reads each comparison sampler at its texture's own level where naga reads it at level 0 through
/// `textureGrad` with zero gradients. ANGLE on Metal, which runs WebGL2 in Safari and in Chrome on
/// macOS, turns such a read into a comparison with explicit gradients. Apple's GPUs run those far
/// slower than a comparison at the texture's own level: on an iPad, the 5 x 5 shadow filter's reads
/// took most of a 57 ms frame. The engine's comparison samplers read shadow maps of one level, so
/// both reads give the same result.
pub(crate) fn implicit_comparison_levels(source: &str) -> String {
    let samplers: Vec<&str> = source
        .lines()
        .filter_map(|line| {
            let declaration = line.trim().strip_prefix("uniform ")?.strip_suffix(';')?;
            let mut words = declaration.split_whitespace().rev();
            let name = words.next()?;
            words
                .next()
                .is_some_and(|ty| ty.starts_with("sampler") && ty.ends_with("Shadow"))
                .then_some(name)
        })
        .collect();
    if samplers.is_empty() {
        return source.to_owned();
    }
    let zero = |gradient: &str| matches!(gradient, "vec2(0.0)" | "vec3(0.0)");
    let mut out = String::with_capacity(source.len());
    let mut copied = 0;
    let mut from = 0;
    while let Some(found) = source[from..].find(GRADIENT_READ) {
        let at = from + found;
        from = at + GRADIENT_READ.len();
        if !source[from..].starts_with('(') || !is_whole_word(source, at, GRADIENT_READ.len()) {
            continue;
        }
        let open = from + 1;
        let Some(length) = closing_parenthesis(&source[open..]) else {
            continue;
        };
        let read = split_arguments(&source[open..open + length]).filter(|args| {
            args.len() == 4 && samplers.contains(&args[0]) && zero(args[2]) && zero(args[3])
        });
        if let Some(args) = read {
            out.push_str(&source[copied..at]);
            out.push_str(&format!("texture({}, {})", args[0], args[1]));
            copied = open + length + 1;
            from = copied;
        }
    }
    out.push_str(&source[copied..]);
    out
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
        let expected = "vec2 corners[2] = vec2[2](vec2(0.0), vec2(1.0));\nvoid main() {\n    vec3 sh_1[3];\n    sh_1[0] = f[1].xyz;\n    sh_1[1] = vec3(f[1].w, f[2].xy);\n    sh_1[2] = min(a, b);\n        uvec4 u[2];\n        u[0] = uvec4(0u);\n        u[1] = uvec4(0u);\n    vec3 _n3d_array1[3];\n    _n3d_array1[0] = a;\n    _n3d_array1[1] = b;\n    _n3d_array1[2] = c;\n    vec3 x = _n3d_array1[i];\n    vec2 w[3] = vec2[3](a, b);\n}\n";
        assert_eq!(lower_arrays(source), expected);
    }

    #[test]
    fn assigned_nested_and_passed_array_constructors_move_to_temporaries() {
        let source = "void main() {\n    a = vec3[2](a[1], a[0]);\n    P p = P(float[2](x, float[2](y, z)[i]), 1.0);\n}\n";
        let expected = "void main() {\n    vec3 _n3d_array1[2];\n    _n3d_array1[0] = a[1];\n    _n3d_array1[1] = a[0];\n    a = _n3d_array1;\n    float _n3d_array2[2];\n    _n3d_array2[0] = y;\n    _n3d_array2[1] = z;\n    float _n3d_array3[2];\n    _n3d_array3[0] = x;\n    _n3d_array3[1] = _n3d_array2[i];\n    P p = P(_n3d_array3, 1.0);\n}\n";
        assert_eq!(lower_arrays(source), expected);
    }

    #[test]
    fn functions_that_return_arrays_give_them_through_a_parameter() {
        let source = "vec3[2] pick(vec2 u) {\n    if (u.x > 0.5) {\n        return vec3[2](u.xxx, u.yyy);\n    }\n    return _e4;\n}\n\nfloat[2] none() {\n    return w;\n}\n\nvoid main() {\n    vec3 _e20[2] = pick(uv);\n    float _e21[2] = none();\n    return;\n}\n";
        let expected = "void pick(vec2 u, out vec3 _n3d_result[2]) {\n    if (u.x > 0.5) {\n        vec3 _n3d_array1[2];\n        _n3d_array1[0] = u.xxx;\n        _n3d_array1[1] = u.yyy;\n        _n3d_result = _n3d_array1;\n        return;\n    }\n    _n3d_result = _e4;\n    return;\n}\n\nvoid none(out float _n3d_result[2]) {\n    _n3d_result = w;\n    return;\n}\n\nvoid main() {\n    vec3 _e20[2];\n    pick(uv, _e20);\n    float _e21[2];\n    none(_e21);\n    return;\n}\n";
        assert_eq!(lower_arrays(source), expected);
    }

    #[test]
    fn each_whole_number_declaration_names_highp() {
        let source = "#version 300 es\n\nprecision highp float;\nprecision highp int;\n\nstruct Results {\n    uvec4 a;\n    ivec2 b;\n};\nconst int INPUTS = 8;\nuniform highp usampler2D cases;\nflat in uint _vs2fs_location2;\nlayout(location = 0) out uvec4 color;\nuint hash(uint v, inout int n) {\n    return uint(n) ^ v;\n}\nvoid main() {\n    uvec4 u[2];\n    mediump int low = 1;\n    for (int i = 0; i < INPUTS; i++) {\n        u[i] = uvec4(texelFetch(cases, ivec2(i, 0), 0));\n    }\n    color = u[0];\n}\n";
        let expected = "#version 300 es\n\nprecision highp float;\nprecision highp int;\n\nstruct Results {\n    highp uvec4 a;\n    highp ivec2 b;\n};\nconst highp int INPUTS = 8;\nuniform highp usampler2D cases;\nflat in highp uint _vs2fs_location2;\nlayout(location = 0) out highp uvec4 color;\nhighp uint hash(highp uint v, inout highp int n) {\n    return uint(n) ^ v;\n}\nvoid main() {\n    highp uvec4 u[2];\n    mediump int low = 1;\n    for (highp int i = 0; i < INPUTS; i++) {\n        u[i] = uvec4(texelFetch(cases, ivec2(i, 0), 0));\n    }\n    color = u[0];\n}\n";
        assert_eq!(highp_integers(source), expected);
        assert_eq!(highp_integers(expected), expected);
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

    /// The function that `copied_uniform_array` names in `source`.
    fn uniform_array_copy(source: &str) -> Option<String> {
        let module = naga::front::wgsl::parse_str(source).unwrap();
        let info = naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::all(),
        )
        .validate(&module)
        .unwrap();
        copied_uniform_array(&module, &info)
    }

    #[test]
    fn a_copy_of_an_array_out_of_a_uniform_block_is_refused() {
        let block = "struct Light { sh: array<vec4f, 2>, params: vec4f }\nstruct Flat { a: vec4f, b: vec4f }\nstruct U { light: Light, flat: Flat, list: array<vec4f, 4> }\n@group(0) @binding(0) var<uniform> u: U;\n";
        let copy = |body: &str| {
            uniform_array_copy(&format!("{block}fn f(i: u32) -> vec4f {{ {body} }}\n"))
        };
        assert_eq!(
            copy("let l = u.light; return l.params;"),
            Some("f".to_owned())
        );
        assert_eq!(copy("let l = u.list; return l[i];"), Some("f".to_owned()));
        assert_eq!(
            copy("return u.light.sh[i] + u.list[i] + u.light.params;"),
            None
        );
        assert_eq!(copy("let l = u.flat; return l.a;"), None);
        let passed = format!(
            "{block}fn g(l: Light) -> vec4f {{ return l.params; }}\n@fragment fn main() -> @location(0) vec4f {{ return g(u.light); }}\n"
        );
        assert_eq!(uniform_array_copy(&passed), Some("main".to_owned()));
    }

    #[test]
    fn comparison_reads_at_level_zero_read_at_the_texture_level() {
        let source = "uniform highp sampler2DArrayShadow _map;\nuniform highp samplerCubeShadow _cube;\nuniform highp sampler2DArray _colors;\nvoid main() {\n    float a = textureGrad(_map, vec4((c + n), l, r.x), vec2(0.0), vec2(0.0));\n    float b = textureGrad(_cube, vec4(d, r.y), vec3(0.0), vec3(0.0));\n    float c = textureGrad(_map, vec4(c, l, r.z), dx, dy);\n    vec4 d = textureGrad(_colors, vec3(uv, l), vec2(0.0), vec2(0.0));\n    float e = mytextureGrad(_map, vec4(c, l, r.w), vec2(0.0), vec2(0.0));\n}\n";
        let expected = "uniform highp sampler2DArrayShadow _map;\nuniform highp samplerCubeShadow _cube;\nuniform highp sampler2DArray _colors;\nvoid main() {\n    float a = texture(_map, vec4((c + n), l, r.x));\n    float b = texture(_cube, vec4(d, r.y));\n    float c = textureGrad(_map, vec4(c, l, r.z), dx, dy);\n    vec4 d = textureGrad(_colors, vec3(uv, l), vec2(0.0), vec2(0.0));\n    float e = mytextureGrad(_map, vec4(c, l, r.w), vec2(0.0), vec2(0.0));\n}\n";
        assert_eq!(implicit_comparison_levels(source), expected);
        let plain = "uniform highp sampler2D _t;\nvoid main() {}\n";
        assert_eq!(implicit_comparison_levels(plain), plain);
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
