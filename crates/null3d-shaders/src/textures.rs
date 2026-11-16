//! The textures of a custom material or a custom effect: the module-scope
//! `var name: texture_2d<f32>;` and `var name: texture_2d_array<f32>;` declarations in its WGSL.
//! The engine keeps every texture as a layer of a texture array, so the build turns each
//! declaration into a texture array in a map slot of a bind group of the maps' layout, declares
//! the texture's sampler as `<name>Sampler`, and gives each texture function that reads a 2D
//! texture the layer that the engine wrote. The WGSL then samples a texture as it would sample
//! any 2D texture.
//!
//! A declaration of a texture array is the array itself: the shader picks the layer, and a texture
//! function keeps it. Such a texture is a texture of several layers, which the engine gives an
//! array of its own, so the layer the shader names is the layer the texture holds.
//!
//! Each texture's layer sits in the last floats of the values the engine writes for the WGSL,
//! from the last float down: a material's row of custom values, which both stages read, or an
//! effect's uniforms. The layer is -1 until the texture's image is on the GPU, and a texture
//! function then gives white, as a missing standard map leaves the color as it is.
//!
//! Declarations and calls keep their lines when the build rewrites them, so problems in the WGSL
//! still point at its own lines.

use serde::Serialize;

use crate::Problem;
use crate::position::locate;
use crate::scan::{Kind, Token, matching};
use crate::uniforms::ROW_FLOATS;
use null3d_gpu::drawlist::sizes;

/// The most textures a custom material or effect can declare. They take the first map slots of
/// its maps' bind group, and their layers take the last floats of its values.
pub(crate) const MAX_TEXTURES: usize = 6;

/// The type a texture of a custom material has, as the WGSL declares it.
const TEXTURE_TYPE: &str = "texture_2d<f32>";

/// The type of a texture array of a custom material, whose shader picks the layer.
const ARRAY_TYPE: &str = "texture_2d_array<f32>";

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
const QUERIES: [&str; 3] = ["textureDimensions", "textureNumLevels", "textureNumLayers"];

/// What declares the textures, which decides where they bind and where their layers come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TextureOwner {
    /// A custom material's surface or vertex function: the maps' group is group 1 on WebGPU and
    /// group 3 on WebGL2, and the layers sit in the material's row of custom values.
    Material,
    /// A full shader of `materials.shader`, which takes no textures.
    FullShader,
    /// A custom effect, or a full-screen pass of the same WGSL: the maps' group is group 1 on
    /// both paths, after the effect's own, and the layers sit in its uniform block.
    Effect,
}

/// One texture that a custom material or effect declares.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Texture {
    /// The variable's name, which the `textures` option takes.
    pub name: String,
    /// The float of the row of custom values that holds the texture's layer.
    pub offset: u32,
    /// True for a declaration of a texture array, which the shader picks a layer of. Its texture
    /// is then a texture of several layers, and each layer the shader names is one of its own.
    pub array: bool,
}

/// The textures of a custom material or effect, its WGSL with the declarations and calls
/// rewritten, and the WGSL that the build adds after it.
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
pub(crate) struct Declaration {
    pub(crate) first: usize,
    pub(crate) name: usize,
    ty: std::ops::Range<usize>,
    end: usize,
}

/// The module-scope `var` declarations of resources, which have no address space: textures and
/// samplers.
pub(crate) fn resource_declarations(tokens: &[Token]) -> Vec<Declaration> {
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

/// Reads the textures that the WGSL of `owner` declares, and rewrites the WGSL so that each 2D
/// texture reads its layer of a texture array, and each texture array keeps the layer that the
/// shader picks. Problems name places in `source`.
pub(crate) fn read(
    tokens: &[Token],
    source: &str,
    path: &str,
    owner: TextureOwner,
) -> Result<Textures, Vec<Problem>> {
    let place = |token: &Token| Some(locate(source, source, token.start));
    let mut problems = Vec::new();
    let mut names: Vec<&str> = Vec::new();
    let mut arrays: Vec<bool> = Vec::new();
    let mut edits = Vec::new();
    for declaration in resource_declarations(tokens) {
        let name = &tokens[declaration.name];
        if owner == TextureOwner::FullShader {
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
                    "the texture `{}` has attributes. Declare it as `var {}: {TEXTURE_TYPE};` or `var {}: {ARRAY_TYPE};`, without `@group` or `@binding`: the engine binds the textures that it declares.",
                    name.text, name.text, name.text
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
                    "custom WGSL declares no samplers. The engine declares the sampler of each texture as `<texture>{SAMPLER_SUFFIX}`, with the filter and wrap of the texture's options. Remove `{}`.",
                    name.text
                ),
            ));
            continue;
        }
        let array = spelled == ARRAY_TYPE;
        if !array && spelled != TEXTURE_TYPE {
            problems.push(Problem::at(
                path,
                place(name),
                format!(
                    "the texture `{}` has the type `{spelled}`. The textures of custom WGSL are `{TEXTURE_TYPE}`, or `{ARRAY_TYPE}` for a texture array whose layers the shader picks.",
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
                    "the texture `{}` is one too many: custom WGSL samples {MAX_TEXTURES} textures at most. Pack data textures into the channels of fewer textures.",
                    name.text
                ),
            ));
            continue;
        }
        names.push(name.text);
        arrays.push(array);
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
                        "`textureSampleBaseClampToEdge` does not read the textures of custom WGSL. Use `textureSampleLevel` with level 0, and clamp the coordinates yourself.",
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
        if function == "textureNumLayers" && !arrays[slot] {
            problems.push(Problem::at(
                path,
                place(&tokens[index]),
                format!(
                    "`textureNumLayers` reads the layer count of a texture array. Declare `var {name}: {ARRAY_TYPE};`, and give the material a texture of several layers.",
                    name = tokens[texture].text
                ),
            ));
            continue;
        }
        let Some(read) = read else {
            continue;
        };
        let coordinates = read.coordinates - usize::from(function == "textureGather") + shift;
        let Some(after) = args.get(coordinates) else {
            continue;
        };
        edits.push(Edit {
            start: tokens[index].start,
            end: tokens[index].start,
            text: "select(vec4f(1.0), ".to_owned(),
        });
        // A texture array's function already takes the layer that the shader picks.
        if !arrays[slot] {
            let last = &tokens[after.end - 1];
            edits.push(Edit {
                start: last.start + last.text.len(),
                end: last.start + last.text.len(),
                text: format!(", {LAYERS}[{slot}]"),
            });
        }
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
                array: arrays[k],
            })
            .collect(),
        declarations: declarations(&names, owner),
        source: rewritten,
    })
}

/// The token of an argument that is one token, such as a variable's name.
fn single(range: &std::ops::Range<usize>) -> Option<usize> {
    (range.len() == 1).then_some(range.start)
}

/// The WGSL that binds the textures in the slots of the maps' group, declares their samplers, and
/// loads their layers, or nothing without textures. A material's maps are group 1 on WebGPU and
/// group 3 on WebGL2, after the groups of the draw records and data textures; it loads the layers
/// of material `id` from its row of custom values. An effect's maps are group 1 on both paths,
/// after its own group; it loads the layers from its uniform block.
fn declarations(names: &[&str], owner: TextureOwner) -> String {
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
                    k + sizes::MAP_SLOTS as usize
                )
            })
            .collect::<String>()
    };
    let count = names.len();
    let effect = owner == TextureOwner::Effect;
    let (webgl2_group, signature, value) = if effect {
        (1, "", "effect_value({part}u)")
    } else {
        (3, "id: u32", "custom_value(id, {part}u)")
    };
    let mut code = format!(
        "\n// The textures, as layers of texture arrays in the slots of the maps' group.\n#ifdef WEBGL2\n{}#else\n{}#endif\n\n// The layer of each texture, or -1 while its image is not on the GPU.\nvar<private> {LAYERS}: array<i32, {count}>;\n\n// The layers of the textures, from the end of the values that the engine writes.\nfn {LOADER}({signature}) {{\n",
        bind(webgl2_group),
        bind(1)
    );
    let mut loaded = None;
    for k in 0..count {
        let offset = layer_offset(k);
        let part = offset / 4;
        if loaded != Some(part) {
            let value = value.replace("{part}", &part.to_string());
            code.push_str(&format!("    let t{part} = {value};\n"));
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
        read(&tokens, source, "m.wgsl", TextureOwner::Material)
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
                    offset: 31,
                    array: false
                },
                Texture {
                    name: "noise".into(),
                    offset: 30,
                    array: false
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
        assert!(tail.contains("@group(1) @binding(8) var baseSampler: sampler;"));
        assert!(tail.contains("var<private> custom_texture_layers: array<i32, 2>;"));
        assert!(tail.contains("let t7 = custom_value(id, 7u);"));
        assert!(tail.contains("custom_texture_layers[0] = i32(t7.w);"));
        assert!(tail.contains("custom_texture_layers[1] = i32(t7.z);"));
    }

    #[test]
    fn an_array_texture_keeps_the_layer_the_shader_picks() {
        let source = "var facades: texture_2d_array<f32>;\nvar detail: texture_2d<f32>;\nfn surface(input: SurfaceInput) -> Surface {\n    let a = textureSampleLevel(facades, facadesSampler, input.uv, 3, 0.0);\n    let b = textureLoad(facades, vec2i(0), input.layer, 0);\n    let n = textureNumLayers(facades);\n    let c = textureSample(detail, detailSampler, input.uv);\n    let g = textureGather(0, facades, facadesSampler, input.uv, input.layer);\n}\n";
        let found = rewrite(source).unwrap();
        assert_eq!(
            found.fields,
            [
                Texture {
                    name: "facades".into(),
                    offset: 31,
                    array: true
                },
                Texture {
                    name: "detail".into(),
                    offset: 30,
                    array: false
                },
            ]
        );
        let lines: Vec<&str> = found.source.lines().collect();
        assert_eq!(
            lines.len(),
            source.lines().count(),
            "lines stay where they were"
        );
        // The shader's own layer stays, and the call waits for the texture's image.
        assert_eq!(
            lines[3].trim(),
            "let a = select(vec4f(1.0), textureSampleLevel(facades, facadesSampler, input.uv, 3, 0.0), custom_texture_layers[0] >= 0);"
        );
        assert_eq!(
            lines[4].trim(),
            "let b = select(vec4f(1.0), textureLoad(facades, vec2i(0), input.layer, 0), custom_texture_layers[0] >= 0);"
        );
        assert_eq!(lines[5].trim(), "let n = textureNumLayers(facades);");
        assert_eq!(
            lines[6].trim(),
            "let c = select(vec4f(1.0), textureSample(detail, detailSampler, input.uv, custom_texture_layers[1]), custom_texture_layers[1] >= 0);"
        );
        assert_eq!(
            lines[7].trim(),
            "let g = select(vec4f(1.0), textureGather(0, facades, facadesSampler, input.uv, input.layer), custom_texture_layers[0] >= 0);"
        );
        assert!(
            found
                .declarations
                .contains("@group(3) @binding(0) var facades: texture_2d_array<f32>;")
        );
        assert!(
            found
                .declarations
                .contains("@group(3) @binding(8) var facadesSampler: sampler;")
        );
    }

    #[test]
    fn a_plain_texture_has_no_layer_count() {
        let source = "var detail: texture_2d<f32>;\nfn f() { let n = textureNumLayers(detail); }";
        let problems = rewrite(source).unwrap_err();
        assert!(
            problems[0].contains("`textureNumLayers` reads the layer count of a texture array")
        );
        assert!(problems[0].contains("var detail: texture_2d_array<f32>;"));
    }

    #[test]
    fn an_effect_binds_its_textures_in_group_1_and_loads_their_layers_from_its_block() {
        let source = "var glow: texture_2d<f32>;\nfn effect(input: EffectInput) -> vec4f {\n    return textureSampleLevel(glow, glowSampler, input.uv, 0.0);\n}\n";
        let tokens = tokenize(source);
        let found = read(&tokens, source, "e.wgsl", TextureOwner::Effect).unwrap();
        let tail = &found.declarations;
        assert!(!tail.contains("@group(3)"));
        assert!(tail.contains("@group(1) @binding(0) var glow: texture_2d_array<f32>;"));
        assert!(tail.contains("@group(1) @binding(8) var glowSampler: sampler;"));
        assert!(tail.contains("fn load_custom_texture_layers() {"));
        assert!(tail.contains("let t7 = effect_value(7u);"));
        assert!(tail.contains("custom_texture_layers[0] = i32(t7.w);"));
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
        let problems = read(&tokens, source, "m.wgsl", TextureOwner::FullShader).unwrap_err();
        assert!(
            problems[0]
                .message
                .contains("a full shader takes no textures")
        );
    }
}
