//! Pieces of custom effects and custom tone curves, which the engine joins into a host at run time.
//!
//! The engine has no shader compiler at run time, so the build gives each effect a piece for each
//! host and each build of it: the top-level items of the built shader that the effect adds to the
//! host's own build. A piece holds the effect's functions, structs and globals, under names that a
//! prefix of its own sets apart, the library functions it calls, and the host's helpers that it
//! calls, which the host's own build drops when nothing there calls them. The engine puts the
//! pieces of a group before the host's chain function, with each item that two pieces share once,
//! and writes a chain that calls each piece's run function in turn (see `effect_group.wgsl`).
//!
//! The items are the shader's own text as naga writes it, for WebGPU and for WebGL2, so a piece
//! joins a build of the same host and the same target as text, with no compiler.

use std::collections::HashSet;

use serde::Serialize;

use crate::output::{GlslTexture, GlslUniformBlock};
use crate::scan::{Kind, Token};
use crate::{VariantOutput, uniforms};

/// The host functions that a piece's build replaces and the engine writes again, which no piece
/// holds: the chain, the tone curve's hook, and the wrappers that a piece's build calls them with.
const HOOKS: [&str; 4] = [
    "effect_chain",
    "tone_curve_hook",
    "effect_piece_run",
    "effect_piece_curve",
];

/// The function of an effect's piece that the chain calls with the input and the effect's slot.
pub(crate) const EFFECT_RUN: &str = "effect_piece_main";

/// The private global that holds an effect's uniforms in its piece.
const UNIFORMS_GLOBAL: &str = "uniforms";

/// One build of a piece: the items it adds to the host's build of the same target, by target.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PieceOutput {
    /// The build's permutation bits, as the host's builds and the effect's own record them.
    pub permutation: u32,
    /// The items that the WGSL adds, for WebGPU.
    pub wgsl: Option<WgslPiece>,
    /// The items that the fragment shader adds, for WebGL2.
    pub glsl: Option<GlslPiece>,
}

/// A piece's WGSL items, and the name of its run function in them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WgslPiece {
    pub items: Vec<String>,
    pub run: String,
}

/// A piece's items of a GLSL fragment shader, the name of its run function in them, and the
/// uniform blocks and textures that the piece adds to the host's or reads differently: a texture
/// that the piece samples with a sampler that the host does not.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlslPiece {
    pub items: Vec<String>,
    pub run: String,
    pub uniform_blocks: Vec<GlslUniformBlock>,
    pub textures: Vec<GlslTexture>,
}

/// The prefix that sets a piece's names apart: `fx` and eight hexadecimal digits of a hash of its
/// source. Pieces of the same source share it, so the engine joins their items once.
pub(crate) fn prefix_of(source: &str) -> String {
    // FNV-1a, which needs no crate and is stable across builds.
    let mut hash: u32 = 0x811c_9dc5;
    for byte in source.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("fx{hash:08x}_")
}

/// The names that the WGSL declares at module scope: functions, structs, constants, globals,
/// aliases and overrides.
fn declared_names<'a>(tokens: &[Token<'a>]) -> HashSet<&'a str> {
    let mut names = HashSet::new();
    let mut depth = 0usize;
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        match token.text {
            "{" | "(" | "[" => depth += 1,
            "}" | ")" | "]" => depth = depth.saturating_sub(1),
            "fn" | "struct" | "const" | "alias" | "override" | "var" if depth == 0 => {
                let mut next = index + 1;
                // `var<private>` names its address space before its name.
                if tokens.get(next).is_some_and(|t| t.text == "<") {
                    while tokens.get(next).is_some_and(|t| t.text != ">") {
                        next += 1;
                    }
                    next += 1;
                }
                if let Some(name) = tokens.get(next).filter(|t| t.kind == Kind::Ident) {
                    names.insert(name.text);
                }
            }
            _ => {}
        }
        index += 1;
    }
    names
}

/// The WGSL with each name that it declares at module scope given `prefix`, in every place that
/// names it: not a field after `.`, a library path's part after `::`, or a field that a struct
/// declares.
pub(crate) fn prefixed(source: &str, prefix: &str) -> String {
    let tokens = crate::scan::tokenize(source);
    let names = declared_names(&tokens);
    let mut text = String::with_capacity(source.len() + names.len() * prefix.len() * 4);
    let mut copied = 0;
    // The depth of braces inside a struct's body, or 0 outside one.
    let mut struct_depth = 0usize;
    let mut depth = 0usize;
    for (index, token) in tokens.iter().enumerate() {
        match token.text {
            "{" => {
                depth += 1;
                if struct_depth > 0
                    || (index >= 2 && tokens[index - 2].text == "struct" && depth == 1)
                {
                    struct_depth += 1;
                }
            }
            "}" => {
                depth = depth.saturating_sub(1);
                struct_depth = struct_depth.saturating_sub(1);
            }
            _ => {}
        }
        if token.kind != Kind::Ident || !names.contains(token.text) {
            continue;
        }
        let before = index.checked_sub(1).map(|i| tokens[i].text);
        if matches!(before, Some("." | "::")) {
            continue;
        }
        if struct_depth > 0 && tokens.get(index + 1).is_some_and(|t| t.text == ":") {
            continue;
        }
        text.push_str(&source[copied..token.start]);
        text.push_str(prefix);
        text.push_str(token.text);
        copied = token.start + token.text.len();
    }
    text.push_str(&source[copied..]);
    text
}

/// The WGSL that a piece's build adds after an effect's own: its loader, which reads the block at
/// a slot, the private global that holds its uniforms, and the run function that fills them and
/// calls the effect. The build gives all of it the effect's prefix.
pub(crate) fn effect_glue(piece_loader: Option<&str>) -> String {
    match piece_loader {
        Some(loader) => format!(
            "{loader}\nvar<private> {UNIFORMS_GLOBAL}: {struct_name};\n\nfn {EFFECT_RUN}(input: EffectInput, slot: u32) -> vec4f {{\n    {UNIFORMS_GLOBAL} = {load}(slot);\n    return effect(input);\n}}\n",
            struct_name = uniforms::STRUCT,
            load = uniforms::EFFECT_PIECE_LOADER,
        ),
        None => format!(
            "\nfn {EFFECT_RUN}(input: EffectInput, slot: u32) -> vec4f {{\n    return effect(input);\n}}\n"
        ),
    }
}

/// The WGSL that calls a piece from its host's hook, which a piece's build adds last, without the
/// prefix: `effect_piece_run` for an effect, `effect_piece_curve` for a tone curve.
pub(crate) fn hook_call(prefix: &str, curve: bool) -> String {
    if curve {
        format!(
            "\nfn effect_piece_curve(color: vec3f) -> vec3f {{\n    return {prefix}toneCurve(color);\n}}\n"
        )
    } else {
        format!(
            "\nfn effect_piece_run(input: EffectInput, slot: u32) -> vec4f {{\n    return {prefix}{EFFECT_RUN}(input, slot);\n}}\n"
        )
    }
}

/// Splits a shader that naga wrote into its top-level items: each preprocessor line, declaration
/// and function, with the attribute lines before it, as text without the blank lines between.
pub(crate) fn top_level_items(source: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut item = String::new();
    let mut depth = 0isize;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() && depth == 0 && item.is_empty() {
            continue;
        }
        if depth == 0 && item.is_empty() && trimmed.starts_with('#') {
            items.push(line.to_owned());
            continue;
        }
        item.push_str(line);
        item.push('\n');
        for byte in trimmed.bytes() {
            match byte {
                b'{' => depth += 1,
                b'}' => depth -= 1,
                _ => {}
            }
        }
        if depth == 0 && (trimmed.ends_with(';') || trimmed.ends_with('}')) {
            items.push(std::mem::take(&mut item));
        }
    }
    if !item.trim().is_empty() {
        items.push(item);
    }
    items
}

/// The name that an item declares: the name before its first parenthesis, for a function, or the
/// name after `struct` or `var`. `None` for an item that declares no name this way.
fn item_name(item: &str) -> Option<&str> {
    let head = item
        .lines()
        .find(|line| !line.trim_start().starts_with('@'))?;
    let ident = |text: &str| -> Option<usize> {
        let end = text.len();
        let start = text
            .char_indices()
            .rev()
            .take_while(|(_, c)| c.is_ascii_alphanumeric() || *c == '_')
            .last()
            .map(|(i, _)| i)?;
        (start < end).then_some(start)
    };
    let open = head.find('(')?;
    let before = head[..open].trim_end();
    ident(before).map(|start| &before[start..])
}

/// The items of `piece` that `host` lacks, without the hooks, in the order of `piece`.
fn added_items(host: &str, piece: &str) -> Vec<String> {
    let own: HashSet<String> = top_level_items(host).into_iter().collect();
    top_level_items(piece)
        .into_iter()
        .filter(|item| !own.contains(item))
        .filter(|item| !item_name(item).is_some_and(|name| HOOKS.contains(&name)))
        .collect()
}

/// The piece that a build of the host with an effect or a curve adds to the host's own build of
/// the same target, for the render pipeline `pipeline`. `run` is the name of the piece's function
/// that the chain or the hook calls, which must be among its items.
pub(crate) fn extract(
    host: &VariantOutput,
    piece: &VariantOutput,
    pipeline: &str,
    run: &str,
) -> Result<PieceOutput, String> {
    let has_run = |items: &[String]| items.iter().any(|item| item_name(item) == Some(run));
    let wgsl = match (&host.wgsl, &piece.wgsl) {
        (Some(host), Some(piece)) => {
            let items = added_items(&host.source, &piece.source);
            if !has_run(&items) {
                return Err(format!(
                    "the piece's WGSL lost its function `{run}`, which is a bug in the shader build"
                ));
            }
            Some(WgslPiece {
                items,
                run: run.to_owned(),
            })
        }
        _ => None,
    };
    let glsl = match (&host.glsl, &piece.glsl) {
        (Some(host), Some(piece)) => {
            let (Some(host), Some(piece)) = (host.get(pipeline), piece.get(pipeline)) else {
                return Err(format!("a host build has no GLSL program `{pipeline}`"));
            };
            let (host, piece) = (&host.fragment, &piece.fragment);
            let items = added_items(&host.source, &piece.source);
            if !has_run(&items) {
                return Err(format!(
                    "the piece's GLSL lost its function `{run}`, which is a bug in the shader build"
                ));
            }
            Some(GlslPiece {
                items,
                run: run.to_owned(),
                uniform_blocks: piece
                    .uniform_blocks
                    .iter()
                    .filter(|block| !host.uniform_blocks.contains(block))
                    .cloned()
                    .collect(),
                textures: piece
                    .textures
                    .iter()
                    .filter(|texture| !host.textures.contains(texture))
                    .cloned()
                    .collect(),
            })
        }
        _ => None,
    };
    Ok(PieceOutput {
        permutation: piece.permutation,
        wgsl,
        glsl,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_scope_names_take_the_prefix_and_fields_and_paths_do_not() {
        let source = "struct Uniforms { gain: f32, tint: vec3f }
const gain: f32 = 2.0;
fn tint(c: vec3f) -> vec3f { return c * gain; }
fn effect(input: EffectInput) -> vec4f {
    let t = null3d::color::tint(input.color.rgb);
    return vec4f(tint(input.color.rgb) * uniforms.gain, input.color.a);
}
";
        let renamed = prefixed(source, "fx1_");
        assert!(renamed.contains("struct fx1_Uniforms { gain: f32, tint: vec3f }"));
        assert!(renamed.contains("const fx1_gain: f32"));
        assert!(renamed.contains("fn fx1_tint(c: vec3f)"));
        assert!(renamed.contains("return c * fx1_gain;"));
        assert!(renamed.contains("fn fx1_effect(input: EffectInput)"));
        // A library path and a field keep their names; `uniforms` is the template's, until the
        // piece's glue declares it.
        assert!(renamed.contains("null3d::color::tint(input.color.rgb)"));
        assert!(renamed.contains("uniforms.gain"));
        assert!(renamed.contains("fx1_tint(input.color.rgb)"));
    }

    #[test]
    fn the_glue_and_the_effect_share_one_prefix() {
        let glue = effect_glue(Some(
            "fn load_effect_piece_uniforms(slot: u32) -> Uniforms {\n    var u: Uniforms;\n    return u;\n}\n",
        ));
        let source = format!(
            "struct Uniforms {{ gain: f32 }}\nfn effect(input: EffectInput) -> vec4f {{ return input.color * uniforms.gain; }}\n{glue}"
        );
        let renamed = prefixed(&source, "fx2_");
        assert!(renamed.contains("var<private> fx2_uniforms: fx2_Uniforms;"));
        assert!(renamed.contains("fx2_uniforms = fx2_load_effect_piece_uniforms(slot);"));
        assert!(renamed.contains("return fx2_effect(input);"));
        assert!(renamed.contains("input.color * fx2_uniforms.gain"));
        assert!(renamed.contains("fn fx2_effect_piece_main(input: EffectInput, slot: u32)"));
    }

    #[test]
    fn items_split_at_the_top_level_with_their_attributes() {
        let wgsl = "struct A {\n    x: f32,\n}\n\n@group(0) @binding(0)\nvar<uniform> a: A;\n\nfn f(x: f32) -> f32 {\n    if x > 0.0 {\n        return x;\n    }\n    return 0.0;\n}\n\n@fragment\nfn main() -> @location(0) vec4<f32> {\n    return vec4(f(a.x));\n}\n";
        let items = top_level_items(wgsl);
        assert_eq!(items.len(), 4, "{items:#?}");
        assert!(items[1].starts_with("@group(0) @binding(0)\nvar<uniform> a: A;"));
        assert_eq!(item_name(&items[2]), Some("f"));
        assert_eq!(item_name(&items[3]), Some("main"));
        let glsl = "#version 300 es\n\nprecision highp float;\nstruct A {\n    float x;\n};\nlayout(std140) uniform A_block { A a; };\n\nfloat f(float x) {\n    return x;\n}\n\nvoid main() {\n    return;\n}\n";
        let items = top_level_items(glsl);
        assert_eq!(items.len(), 6, "{items:#?}");
        assert_eq!(item_name(&items[4]), Some("f"));
        assert_eq!(item_name(&items[5]), Some("main"));
    }

    #[test]
    fn a_prefix_follows_the_source() {
        assert_eq!(prefix_of("a"), prefix_of("a"));
        assert_ne!(prefix_of("a"), prefix_of("b"));
        assert!(prefix_of("a").starts_with("fx") && prefix_of("a").ends_with('_'));
    }
}
