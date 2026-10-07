//! The uniforms of a custom material or a custom effect: the fields of `struct Uniforms` in its
//! WGSL. The build packs them into eight `vec4f`s and writes the function that loads them. A
//! material's uniforms live in its row of custom values, from which the template fills its
//! `material`. The layers of the material's textures take the row's last floats, one each, so
//! the uniforms fit in the rest. An effect's uniforms live in its uniform block, from which the
//! effect template fills its `uniforms`. The engine writes each uniform's value at the offset that
//! the build gives it.

use serde::Serialize;

use crate::Problem;
use crate::position::locate;
use crate::scan::{Kind, Token, matching};

/// The name of the struct that declares a custom material's uniforms.
pub(crate) const STRUCT: &str = "Uniforms";

/// The floats in a material's row of custom values.
pub(crate) const ROW_FLOATS: u32 = 32;

/// The component names of a `vec4f`, in order.
const COMPONENTS: &str = "xyzw";

/// The name of the function that the build writes to load a material's uniforms.
pub(crate) const MATERIAL_LOADER: &str = "load_material_uniforms";

/// The name of the function that the build writes to load an effect's uniforms.
pub(crate) const EFFECT_LOADER: &str = "load_effect_uniforms";

/// What owns the uniforms, which decides where the loader reads them and how messages name it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner {
    /// A custom material: the loader reads the material's row of custom values.
    Material,
    /// A custom effect: the loader reads the vectors of the effect's uniform block.
    Effect,
}

impl Owner {
    /// The owner as a message names it, with its article.
    fn noun(self) -> &'static str {
        match self {
            Self::Material => "a custom material",
            Self::Effect => "a custom effect",
        }
    }
}

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

/// Reads `struct Uniforms` from the WGSL of `owner`, when it has one, and writes its loader. A
/// material's `textures` take the row's last floats. Problems name the fields' places in `source`.
pub(crate) fn read(
    tokens: &[Token],
    source: &str,
    path: &str,
    textures: u32,
    owner: Owner,
) -> Result<Option<Uniforms>, Vec<Problem>> {
    let room = ROW_FLOATS - textures;
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
        if offset + ty.floats > room {
            let textures = match textures {
                0 => String::new(),
                1 => ", less one for the texture".to_owned(),
                n => format!(", less one for each of the {n} textures"),
            };
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the uniform `{}` does not fit: the uniforms of {} hold {ROW_FLOATS} numbers at most{textures}, with each vec3f and vec4f starting a group of four. Pack small values into a vec4f, or remove some uniforms.",
                    name.text,
                    owner.noun()
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
        loader: loader(&fields, owner),
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

/// The function that loads the uniforms of `owner`, one `vec4f` at a time, for each `vec4f` that
/// holds a field: from a material's row of custom values, or from an effect's uniform block.
fn loader(fields: &[(&str, UniformType, u32)], owner: Owner) -> String {
    let mut code = match owner {
        Owner::Material => format!(
            "\n// The uniforms of material `id`, from its row of custom values, as the build packed them.\nfn {MATERIAL_LOADER}(id: u32) -> {STRUCT} {{\n    var u: {STRUCT};\n"
        ),
        Owner::Effect => format!(
            "\n// The effect's uniforms, from its uniform block, as the build packed them.\nfn {EFFECT_LOADER}() -> {STRUCT} {{\n    var u: {STRUCT};\n"
        ),
    };
    let mut loaded = None;
    for (name, ty, offset) in fields {
        let part = offset / 4;
        if loaded != Some(part) {
            let fetch = match owner {
                Owner::Material => format!("custom_value(id, {part}u)"),
                Owner::Effect => format!("effect_value({part}u)"),
            };
            code.push_str(&format!("    let v{part} = {fetch};\n"));
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
