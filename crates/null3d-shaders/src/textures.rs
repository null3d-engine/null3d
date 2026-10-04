//! A custom material's textures: the module-scope `var name: texture_2d<f32>;` declarations in its
//! WGSL. The engine keeps every texture as a layer of a texture array, so the build turns each
//! declaration into a texture array in a map slot of the material's bind group, declares the
//! texture's sampler as `<name>Sampler`, and gives each texture function that reads the texture
//! the layer that the engine wrote for the material. The WGSL then samples a texture as it would
//! sample any 2D texture.
//!
//! Each texture's layer sits in the material's row of custom values, from the row's last float
//! down, so both stages can read it. The layer is -1 until the texture's image is on the GPU, and
//! a texture function then gives white, as a missing standard map leaves the color as it is.
//!
//! Declarations and calls keep their lines when the build rewrites them, so problems in the WGSL
//! still point at its own lines.

use serde::Serialize;

use crate::Problem;
use crate::position::locate;
use crate::scan::{Kind, Token, matching};
use crate::uniforms::ROW_FLOATS;

/// The most textures a custom material can declare: the map slots of the material's bind group.
pub(crate) const MAX_TEXTURES: usize = 6;

/// The type a texture of a custom material has, as the WGSL declares it.
const TEXTURE_TYPE: &str = "texture_2d<f32>";

/// The name of the private array that holds each texture's layer for the stage that runs.
const LAYERS: &str = "custom_texture_layers";

/// The name of the function that the build writes to load the layers.
pub(crate) const LOADER: &str = "load_custom_texture_layers";

/// The suffix of the name of the sampler that the build declares for each texture.
const SAMPLER_SUFFIX: &str = "Sampler";

/// A texture function, and where the texture and the coordinates sit among its arguments.
struct TextureFunction {
    name: &'static str,
    /// The argument after which the layer goes: the coordinates.
    coordinates: usize,
}

/// The texture functions that read texels, which get the texture's layer. In each, the array
/// index follows the coordinates.
const READS: [TextureFunction; 6] = [
    TextureFunction {
        name: "textureSample",
        coordinates: 2,
    },
    TextureFunction {
        name: "textureSampleBias",
        coordinates: 2,
    },
    TextureFunction {
        name: "textureSampleGrad",
        coordinates: 2,
    },
    TextureFunction {
        name: "textureSampleLevel",
        coordinates: 2,
    },
    TextureFunction {
        name: "textureLoad",
        coordinates: 1,
    },
    TextureFunction {
        name: "textureGather",
        coordinates: 3,
    },
];

/// Texture functions that read no texel, which take an array texture as they take a 2D one.
const QUERIES: [&str; 2] = ["textureDimensions", "textureNumLevels"];

/// One texture that a custom material declares.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Texture {
    /// The variable's name, which the `textures` option takes.
    pub name: String,
    /// The float of the row of custom values that holds the texture's layer.
    pub offset: u32,
}

/// The textures of a custom material, its WGSL with the declarations and calls rewritten, and the
/// WGSL that the build adds after it.
#[derive(Debug)]
pub(crate) struct Textures {
    pub fields: Vec<Texture>,
    pub source: String,
    pub declarations: String,
}

/// The float of the row of custom values that holds the layer of texture `k`.
pub(crate) const fn layer_offset(k: usize) -> u32 {
    ROW_FLOATS - 1 - k as u32
}

/// An edit of the WGSL: text that replaces a byte range, or goes in at a place.
struct Edit {
    start: usize,
    end: usize,
    text: String,
}

/// A module-scope `var` declaration: the token that starts it, its name's token, the tokens of its
/// type, and the token that ends it.
struct Declaration {
    first: usize,
    name: usize,
    ty: std::ops::Range<usize>,
    end: usize,
}

/// The module-scope `var` declarations of resources, which have no address space: textures and
/// samplers.
fn resource_declarations(tokens: &[Token]) -> Vec<Declaration> {
    let mut found = Vec::new();
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        match token.text {
            "{" | "(" => depth += 1,
            "}" | ")" => depth = depth.saturating_sub(1),
            "var" if depth == 0 => {
                let name = index + 1;
                let (Some(named), Some(colon)) = (tokens.get(name), tokens.get(name + 1)) else {
                    continue;
                };
                if named.kind != Kind::Ident || colon.text != ":" {
                    continue;
                }
                let Some(end) = (name + 2..tokens.len()).find(|&i| tokens[i].text == ";") else {
                    continue;
                };
                let first_type = tokens[name + 2].text;
                if !(first_type.starts_with("texture") || first_type.starts_with("sampler")) {
                    continue;
                }
                // Attributes such as `@group(1)` come before `var`.
                let mut first = index;
                while first >= 2 && tokens[first - 1].text == ")" {
                    let open = (0..first - 1)
                        .rev()
                        .find(|&i| matching(tokens, i) == Some(first - 1));
                    match open {
                        Some(open) if open >= 2 && tokens[open - 2].text == "@" => first = open - 2,
                        _ => break,
                    }
                }
                found.push(Declaration {
                    first,
                    name,
                    ty: name + 2..end,
                    end,
                });
            }
            _ => {}
        }
    }
    found
}

/// The arguments of the call whose `(` is at `open`, as token ranges, with the index of its `)`.
fn arguments(tokens: &[Token], open: usize) -> Option<(Vec<std::ops::Range<usize>>, usize)> {
    let close = matching(tokens, open)?;
    let mut list = Vec::new();
    let mut depth = 0usize;
    let mut start = open + 1;
    for (index, token) in tokens.iter().enumerate().take(close).skip(open + 1) {
        match token.text {
            "(" | "[" => depth += 1,
            ")" | "]" => depth = depth.saturating_sub(1),
            "," if depth == 0 => {
                list.push(start..index);
                start = index + 1;
            }
            _ => {}
        }
    }
    if start < close {
        list.push(start..close);
    }
    Some((list, close))
}

/// Reads the textures that a custom material's WGSL declares, and rewrites the WGSL so that each
/// reads its layer of a texture array. `full_shader` is true for WGSL with entry points of its
/// own, which takes no textures. Problems name places in `source`.
pub(crate) fn read(
    tokens: &[Token],
    source: &str,
    path: &str,
    full_shader: bool,
) -> Result<Textures, Vec<Problem>> {
    let place = |token: &Token| Some(locate(source, source, token.start));
    let mut problems = Vec::new();
    let mut names: Vec<&str> = Vec::new();
    let mut edits = Vec::new();
    for declaration in resource_declarations(tokens) {
        let name = &tokens[declaration.name];
        if full_shader {
            problems.push(Problem::at(
                path,
                place(&tokens[declaration.first]),
                "a full shader takes no textures in `materials.shader`. Use a surface function, which can sample the textures that it declares, or a shader of your own for a pass.",
            ));
            continue;
        }
        if declaration.first != declaration.name - 1 {
            problems.push(Problem::at(
                path,
                place(&tokens[declaration.first]),
                format!(
                    "the texture `{}` has attributes. Declare it as `var {}: {TEXTURE_TYPE};`, without `@group` or `@binding`: the engine binds the textures of a custom material.",
                    name.text, name.text
                ),
            ));
            continue;
        }
        let spelled: String = tokens[declaration.ty.clone()]
            .iter()
            .map(|token| token.text)
            .collect();
        if spelled.starts_with("sampler") {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "a custom material declares no samplers. The engine declares the sampler of each texture as `<texture>{SAMPLER_SUFFIX}`, with the filter and wrap of the texture's options. Remove `{}`.",
                    name.text
                ),
            ));
            continue;
        }
        if spelled != TEXTURE_TYPE {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the texture `{}` has the type `{spelled}`. The textures of a custom material are `{TEXTURE_TYPE}`.",
                    name.text
                ),
            ));
            continue;
        }
        if names.len() == MAX_TEXTURES {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the texture `{}` is one too many: a custom material samples {MAX_TEXTURES} textures at most. Pack data textures into the channels of fewer textures.",
                    name.text
                ),
            ));
            continue;
        }
        names.push(name.text);
        let (start, end) = (
            tokens[declaration.first].start,
            tokens[declaration.end].start + 1,
        );
        let blank: String = source[start..end]
            .chars()
            .map(|c| if c == '\n' { '\n' } else { ' ' })
            .collect();
        edits.push(Edit {
            start,
            end,
            text: blank,
        });
    }
    // Every use of a texture's name goes straight to a texture function, which gets its layer.
    let declared: Vec<usize> = resource_declarations(tokens)
        .iter()
        .map(|d| d.name)
        .collect();
    let slot_of = |index: usize| -> Option<usize> {
        let token = tokens.get(index)?;
        (token.kind == Kind::Ident)
            .then(|| names.iter().position(|&n| n == token.text))
            .flatten()
    };
    let mut allowed = vec![false; tokens.len()];
    for index in 0..tokens.len() {
        let function = tokens[index].text;
        if tokens.get(index + 1).is_none_or(|t| t.text != "(") {
            continue;
        }
        let read = READS.iter().find(|f| f.name == function);
        if read.is_none() && !QUERIES.contains(&function) {
            if function == "textureSampleBaseClampToEdge" {
                let Some((args, _)) = arguments(tokens, index + 1) else {
                    continue;
                };
                if let Some(texture) = args
                    .first()
                    .and_then(single)
                    .filter(|&t| slot_of(t).is_some())
                {
                    allowed[texture] = true;
                    problems.push(Problem::at(
                        path,
                        place(&tokens[index]),
                        "`textureSampleBaseClampToEdge` does not read the textures of a custom material. Use `textureSampleLevel` with level 0, and clamp the coordinates yourself.",
                    ));
                }
            }
            continue;
        }
        let Some((args, close)) = arguments(tokens, index + 1) else {
            continue;
        };
        // textureGather of a color texture takes the component first.
        let shift = usize::from(
            function == "textureGather"
                && args.first().and_then(single).and_then(slot_of).is_none(),
        );
        let Some(texture) = args.get(shift).and_then(single) else {
            continue;
        };
        let Some(slot) = slot_of(texture) else {
            continue;
        };
        allowed[texture] = true;
        let Some(read) = read else {
            continue;
        };
        let coordinates = read.coordinates - usize::from(function == "textureGather") + shift;
        let Some(after) = args.get(coordinates) else {
            continue;
        };
        let last = &tokens[after.end - 1];
        edits.push(Edit {
            start: tokens[index].start,
            end: tokens[index].start,
            text: "select(vec4f(1.0), ".to_owned(),
        });
        edits.push(Edit {
            start: last.start + last.text.len(),
            end: last.start + last.text.len(),
            text: format!(", {LAYERS}[{slot}]"),
        });
        edits.push(Edit {
            start: tokens[close].start + 1,
            end: tokens[close].start + 1,
            text: format!(", {LAYERS}[{slot}] >= 0)"),
        });
    }
    for index in 0..tokens.len() {
        if allowed[index] || declared.contains(&index) || slot_of(index).is_none() {
            continue;
        }
        // A member, a field or a parameter of the same name is another value.
        if (index > 0 && tokens[index - 1].text == ".")
            || tokens.get(index + 1).is_some_and(|t| t.text == ":")
        {
            continue;
        }
        let name = tokens[index].text;
        problems.push(Problem::at(
            path,
            place(&tokens[index]),
            format!(
                "the texture `{name}` goes straight into a texture function, such as `textureSample({name}, {name}{SAMPLER_SUFFIX}, uv)`. The engine gives each such call the texture's layer, so a texture cannot be passed to a function of your own or stored. Sample it where you need it, or in a helper that takes the coordinates."
            ),
        ));
    }
    if !problems.is_empty() {
        return Err(problems);
    }
    edits.sort_by_key(|edit| std::cmp::Reverse((edit.start, edit.end)));
    let mut rewritten = source.to_owned();
    for edit in &edits {
        rewritten.replace_range(edit.start..edit.end, &edit.text);
    }
    Ok(Textures {
        fields: names
            .iter()
            .enumerate()
            .map(|(k, name)| Texture {
                name: (*name).to_owned(),
                offset: layer_offset(k),
            })
            .collect(),
        declarations: declarations(&names),
        source: rewritten,
    })
}

/// The token of an argument that is one token, such as a variable's name.
fn single(range: &std::ops::Range<usize>) -> Option<usize> {
    (range.len() == 1).then_some(range.start)
}

/// The WGSL that binds the textures in the slots of the material's maps, declares their samplers,
/// and loads their layers, or nothing for a material without textures. The maps' bind group is
/// group 1 on WebGPU and group 3 on WebGL2, after the groups of the draw records and data textures.
fn declarations(names: &[&str]) -> String {
    if names.is_empty() {
        return String::new();
    }
    let bind = |group: u32| {
        names
            .iter()
            .enumerate()
            .map(|(k, name)| {
                format!(
                    "@group({group}) @binding({k}) var {name}: texture_2d_array<f32>;\n@group({group}) @binding({}) var {name}{SAMPLER_SUFFIX}: sampler;\n",
                    k + MAX_TEXTURES
                )
            })
            .collect::<String>()
    };
    let count = names.len();
    let mut code = format!(
        "\n// The material's textures, as layers of texture arrays in the slots of its maps.\n#ifdef WEBGL2\n{}#else\n{}#endif\n\n// The layer of each texture, or -1 while its image is not on the GPU.\nvar<private> {LAYERS}: array<i32, {count}>;\n\n// The layers of material `id`'s textures, from the end of its row of custom values.\nfn {LOADER}(id: u32) {{\n",
        bind(3),
        bind(1)
    );
    let mut loaded = None;
    for k in 0..count {
        let offset = layer_offset(k);
        let part = offset / 4;
        if loaded != Some(part) {
            code.push_str(&format!("    let t{part} = custom_value(id, {part}u);\n"));
            loaded = Some(part);
        }
        let component = &"xyzw"[(offset % 4) as usize..][..1];
        code.push_str(&format!("    {LAYERS}[{k}] = i32(t{part}.{component});\n"));
    }
    code.push_str("}\n");
    code
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::tokenize;

    fn rewrite(source: &str) -> Result<Textures, Vec<String>> {
        let tokens = tokenize(source);
        read(&tokens, source, "m.wgsl", false)
            .map_err(|problems| problems.into_iter().map(|p| p.message).collect())
    }

    #[test]
    fn declarations_become_array_layers_and_calls_read_the_layer() {
        let source = "var base: texture_2d<f32>;\nvar noise: texture_2d<f32>;\nfn surface(input: SurfaceInput) -> Surface {\n    let a = textureSample(base, baseSampler, input.uv * vec2f(2.0, 1.0));\n    let b = textureSampleLevel(noise, baseSampler, f(input.uv), 0.0);\n    let c = textureLoad(noise, vec2i(textureDimensions(noise) / 2u), 0);\n    let d = textureGather(1, base, noiseSampler, input.uv);\n}\n";
        let found = rewrite(source).unwrap();
        assert_eq!(
            found.fields,
            [
                Texture {
                    name: "base".into(),
                    offset: 31
                },
                Texture {
                    name: "noise".into(),
                    offset: 30
                },
            ]
        );
        let lines: Vec<&str> = found.source.lines().collect();
        assert_eq!(
            lines.len(),
            source.lines().count(),
            "lines stay where they were"
        );
        assert!(lines[0].trim().is_empty() && lines[1].trim().is_empty());
        assert_eq!(
            lines[3].trim(),
            "let a = select(vec4f(1.0), textureSample(base, baseSampler, input.uv * vec2f(2.0, 1.0), custom_texture_layers[0]), custom_texture_layers[0] >= 0);"
        );
        assert_eq!(
            lines[4].trim(),
            "let b = select(vec4f(1.0), textureSampleLevel(noise, baseSampler, f(input.uv), custom_texture_layers[1], 0.0), custom_texture_layers[1] >= 0);"
        );
        assert_eq!(
            lines[5].trim(),
            "let c = select(vec4f(1.0), textureLoad(noise, vec2i(textureDimensions(noise) / 2u), custom_texture_layers[1], 0), custom_texture_layers[1] >= 0);"
        );
        assert_eq!(
            lines[6].trim(),
            "let d = select(vec4f(1.0), textureGather(1, base, noiseSampler, input.uv, custom_texture_layers[0]), custom_texture_layers[0] >= 0);"
        );
        let tail = &found.declarations;
        assert!(tail.contains("@group(3) @binding(1) var noise: texture_2d_array<f32>;"));
        assert!(tail.contains("@group(1) @binding(6) var baseSampler: sampler;"));
        assert!(tail.contains("var<private> custom_texture_layers: array<i32, 2>;"));
        assert!(tail.contains("let t7 = custom_value(id, 7u);"));
        assert!(tail.contains("custom_texture_layers[0] = i32(t7.w);"));
        assert!(tail.contains("custom_texture_layers[1] = i32(t7.z);"));
    }

    #[test]
    fn wgsl_without_textures_is_left_alone() {
        let source = "fn surface(input: SurfaceInput) -> Surface { return defaultSurface(input); }";
        let found = rewrite(source).unwrap();
        assert_eq!(found.source, source);
        assert!(found.fields.is_empty() && found.declarations.is_empty());
    }

    #[test]
    fn layers_count_down_from_the_end_of_the_row() {
        assert_eq!(
            (0..MAX_TEXTURES).map(layer_offset).collect::<Vec<_>>(),
            [31, 30, 29, 28, 27, 26]
        );
        let source: String = (0..MAX_TEXTURES)
            .map(|k| format!("var t{k}: texture_2d<f32>;\n"))
            .collect();
        let tail = rewrite(&source).unwrap().declarations;
        assert!(tail.contains("let t6 = custom_value(id, 6u);"));
        assert!(tail.contains("custom_texture_layers[5] = i32(t6.z);"));
    }

    #[test]
    fn wrong_declarations_and_uses_say_how_to_fix_them() {
        let cases = [
            (
                "@group(1) @binding(0) var t: texture_2d<f32>;",
                "without `@group` or `@binding`",
            ),
            ("var s: sampler;", "declares no samplers"),
            ("var t: texture_2d<u32>;", "has the type `texture_2d<u32>`"),
            (
                "var t: texture_cube<f32>;",
                "has the type `texture_cube<f32>`",
            ),
            (
                "var t: texture_2d<f32>;\nfn f(x: texture_2d<f32>) {}\nfn g() { f(t); }",
                "cannot be passed to a function of your own",
            ),
            (
                "var t: texture_2d<f32>;\nfn g() { let c = textureSampleBaseClampToEdge(t, tSampler, uv); }",
                "Use `textureSampleLevel`",
            ),
        ];
        for (source, expected) in cases {
            let problems = rewrite(source).unwrap_err();
            assert!(
                problems.iter().any(|p| p.contains(expected)),
                "{source}: {problems:?}"
            );
        }
        let seven: String = (0..7)
            .map(|k| format!("var t{k}: texture_2d<f32>;\n"))
            .collect();
        let problems = rewrite(&seven).unwrap_err();
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("`t6` is one too many"));
    }

    #[test]
    fn a_full_shader_takes_no_textures() {
        let source = "var t: texture_2d<f32>;";
        let tokens = tokenize(source);
        let problems = read(&tokens, source, "m.wgsl", true).unwrap_err();
        assert!(
            problems[0]
                .message
                .contains("a full shader takes no textures")
        );
    }
}
