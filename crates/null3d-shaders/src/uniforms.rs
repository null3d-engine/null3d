//! A custom material's uniforms: the fields of `struct Uniforms` in its WGSL. The build packs
//! them into the material's row of custom values, which holds eight `vec4f`s, and writes the
//! function that loads them, so the template can fill its `material` from the row. The engine
//! writes each uniform's value at the offset that the build gives it.

use serde::Serialize;

use crate::Problem;
use crate::position::locate;
use crate::scan::{Kind, Token, matching};

/// The name of the struct that declares a custom material's uniforms.
pub(crate) const STRUCT: &str = "Uniforms";

/// The floats in a material's row of custom values.
const ROW_FLOATS: u32 = 32;

/// The component names of a `vec4f`, in order.
const COMPONENTS: &str = "xyzw";

/// The name of the function that the build writes to load the uniforms.
pub(crate) const LOADER: &str = "load_material_uniforms";

/// One uniform, where the engine writes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Uniform {
    /// The field's name, which `material.set()` and the `uniforms` option take.
    pub name: String,
    /// Its type: `f32`, `i32`, `u32`, `vec2f`, `vec3f` or `vec4f`.
    #[serde(rename = "type")]
    pub ty: String,
    /// The float of the row of custom values where it starts.
    pub offset: u32,
}

/// The uniforms of a custom material, and the WGSL that loads them.
pub(crate) struct Uniforms {
    pub fields: Vec<Uniform>,
    pub loader: String,
}

/// A type that a uniform can have: its name as the output gives it, its floats, and how the
/// loader turns the floats into it.
struct UniformType {
    name: &'static str,
    floats: u32,
    /// The conversion of a float, for whole-number types.
    convert: Option<&'static str>,
}

/// The type that a field's type tokens spell, or `None` for one that uniforms cannot have.
fn uniform_type(spelled: &str) -> Option<UniformType> {
    let (name, floats, convert) = match spelled {
        "f32" => ("f32", 1, None),
        "i32" => ("i32", 1, Some("i32")),
        "u32" => ("u32", 1, Some("u32")),
        "vec2f" | "vec2<f32>" => ("vec2f", 2, None),
        "vec3f" | "vec3<f32>" => ("vec3f", 3, None),
        "vec4f" | "vec4<f32>" => ("vec4f", 4, None),
        _ => return None,
    };
    Some(UniformType {
        name,
        floats,
        convert,
    })
}

/// The index of the token that opens the body of the module-scope `struct Uniforms`, if any.
fn struct_body(tokens: &[Token]) -> Option<usize> {
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        match token.text {
            "{" => depth += 1,
            "}" => depth = depth.saturating_sub(1),
            "struct" if depth == 0 => {
                let name = tokens.get(index + 1)?;
                if name.text == STRUCT && tokens.get(index + 2)?.text == "{" {
                    return Some(index + 2);
                }
            }
            _ => {}
        }
    }
    None
}

/// Reads `struct Uniforms` from a custom material's WGSL, when it has one, and writes its loader.
/// Problems name the fields' places in `source`.
pub(crate) fn read(
    tokens: &[Token],
    source: &str,
    path: &str,
) -> Result<Option<Uniforms>, Vec<Problem>> {
    let Some(open) = struct_body(tokens) else {
        return Ok(None);
    };
    let place = |token: &Token| Some(locate(source, source, token.start));
    let Some(close) = matching(tokens, open) else {
        return Ok(None);
    };
    let mut problems = Vec::new();
    let mut fields = Vec::new();
    let mut cursor = 0u32;
    for field in tokens[open + 1..close].split(|token| token.text == ",") {
        let Some(first) = field.first() else {
            continue;
        };
        if first.text == "@" {
            problems.push(Problem::at(
                path,
                place(first),
                "the fields of `struct Uniforms` cannot have attributes: the build places each uniform itself. Remove the attribute.",
            ));
            continue;
        }
        let (Some(name), Some(colon)) = (field.first(), field.get(1)) else {
            continue;
        };
        if name.kind != Kind::Ident || colon.text != ":" {
            continue;
        }
        let spelled: String = field[2..].iter().map(|token| token.text).collect();
        let Some(ty) = uniform_type(&spelled) else {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the uniform `{}` has the type `{spelled}`. Uniforms take `f32`, `i32`, `u32`, `vec2f`, `vec3f` and `vec4f`.",
                    name.text
                ),
            ));
            continue;
        };
        // A vec3f or vec4f starts a vec4f of its own, and a vec2f starts at an even float.
        let align = match ty.floats {
            1 => 1,
            2 => 2,
            _ => 4,
        };
        let offset = cursor.div_ceil(align) * align;
        if offset + ty.floats > ROW_FLOATS {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the uniform `{}` does not fit: a custom material's uniforms hold {ROW_FLOATS} numbers at most, with each vec3f and vec4f starting a group of four. Pack small values into a vec4f, or remove some uniforms.",
                    name.text
                ),
            ));
            break;
        }
        cursor = offset + ty.floats;
        fields.push((name.text, ty, offset));
    }
    if !problems.is_empty() {
        return Err(problems);
    }
    Ok(Some(Uniforms {
        loader: loader(&fields),
        fields: fields
            .into_iter()
            .map(|(name, ty, offset)| Uniform {
                name: name.to_owned(),
                ty: ty.name.to_owned(),
                offset,
            })
            .collect(),
    }))
}

/// The function that loads the uniforms from a material's row of custom values, one `vec4f` at
/// a time, for each `vec4f` that holds a field.
fn loader(fields: &[(&str, UniformType, u32)]) -> String {
    let mut code = format!(
        "\n// The uniforms of material `id`, from its row of custom values, as the build packed them.\nfn {LOADER}(id: u32) -> {STRUCT} {{\n    var u: {STRUCT};\n"
    );
    let mut loaded = None;
    for (name, ty, offset) in fields {
        let part = offset / 4;
        if loaded != Some(part) {
            code.push_str(&format!("    let v{part} = custom_value(id, {part}u);\n"));
            loaded = Some(part);
        }
        let first = (offset % 4) as usize;
        let swizzle = &COMPONENTS[first..first + ty.floats as usize];
        let value = format!("v{part}.{swizzle}");
        let value = match ty.convert {
            Some(convert) => format!("{convert}({value})"),
            None => value,
        };
        code.push_str(&format!("    u.{name} = {value};\n"));
    }
    code.push_str("    return u;\n}\n");
    code
}
