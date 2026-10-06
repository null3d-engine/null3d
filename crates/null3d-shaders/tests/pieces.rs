//! Pieces of custom effects and tone curves, joined into the engine's hosts as the engine joins
//! them at run time: each piece's items before the host's chain, each shared item once, and a chain
//! that calls each piece in turn. naga then reads and validates the joined WGSL.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;

use null3d_shaders::{
    Compiler, EffectOutput, EffectSource, Inputs, Output, PieceOutput, PostTemplates, VariantOutput,
};

/// Brightens each pixel by a uniform: an effect that reads only its own pixel.
const GAIN: &str = "struct Uniforms { gain: f32 }

fn effect(input: EffectInput) -> vec4f {
    return vec4f(input.color.rgb * uniforms.gain, input.color.a);
}
";

/// Fades to gray with the distance: an effect that reads only its own pixel and the depth.
const FOG: &str = "fn effect(input: EffectInput) -> vec4f {
    let fade = 1.0 - exp(-effectDistance(input.uv) * 0.1);
    return vec4f(mix(input.color.rgb, vec3f(0.5), fade), input.color.a);
}
";

/// Splits the colors across: an effect that reads its neighbors, through a helper of its own.
const SPLIT: &str = "struct Uniforms { amount: f32 }

fn shifted(uv: vec2f, by: f32) -> vec4f {
    return effectColor(uv + vec2f(by, 0.0));
}

fn effect(input: EffectInput) -> vec4f {
    let step = uniforms.amount / input.size.x;
    return vec4f(shifted(input.uv, step).r, input.color.g, shifted(input.uv, -step).b, input.color.a);
}
";

/// Reads one neighbor through `effectPixel`.
const EDGE: &str = "fn effect(input: EffectInput) -> vec4f {
    let left = effectPixel(vec2i(input.pixel) - vec2i(1, 0));
    return abs(input.color - left);
}
";

/// Reinhard's tone curve.
const REINHARD: &str = "fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
";

fn root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn compile(source: &str) -> EffectOutput {
    let inputs = Inputs::read(&root()).expect("the repository's shaders");
    let templates = PostTemplates::load(&inputs).expect("the templates of effects and curves");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    compiler
        .compile_effect(
            &templates,
            &EffectSource {
                path: "src/sketch.ts".to_owned(),
                source: source.to_owned(),
            },
        )
        .expect("the WGSL builds")
}

/// The engine's builds of a host shader, by build name, from one build of the engine's shaders.
fn host(name: &str) -> BTreeMap<String, VariantOutput> {
    static OUTPUT: OnceLock<Output> = OnceLock::new();
    let output = OUTPUT.get_or_init(|| {
        let inputs = Inputs::read(&root()).expect("the repository's shaders");
        null3d_shaders::build(&inputs).expect("the engine's shaders build")
    });
    output.shaders[name].clone()
}

/// The byte range of the top-level function `name` in a shader that naga wrote: from the start of
/// its line to its closing brace's line end. A call sits indented, so only the definition starts
/// its line with a type or `fn`.
fn function_span(source: &str, name: &str) -> std::ops::Range<usize> {
    let mut at = 0;
    for line in source.split_inclusive('\n') {
        let first = line.chars().next().unwrap_or(' ');
        if !first.is_whitespace() && line.contains(&format!(" {name}(")) {
            let open = at + line.find('{').expect("a function's line opens its body");
            let mut depth = 0;
            for (offset, byte) in source[open..].bytes().enumerate() {
                match byte {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            let end = open + offset + 1;
                            let end = source[end..]
                                .find('\n')
                                .map_or(source.len(), |n| end + n + 1);
                            return at..end;
                        }
                    }
                    _ => {}
                }
            }
        }
        at += line.len();
    }
    panic!("no function {name}");
}

/// Joins pieces into a host's WGSL: the effects' items and their chain in place of `effect_chain`,
/// with the effects' slots from 0, and a curve's in place of `tone_curve_hook`.
fn join_wgsl(host: &str, effects: &[&PieceOutput], curve: Option<&PieceOutput>) -> String {
    let mut text = host.to_owned();
    if let Some(curve) = curve {
        let wgsl = curve.wgsl.as_ref().expect("a WGSL piece");
        let span = function_span(&text, "tone_curve_hook");
        let mut hook = wgsl.items.join("\n");
        hook.push_str(&format!(
            "\nfn tone_curve_hook(c: vec3<f32>) -> vec3<f32> {{\n    return saturate({}(c));\n}}\n",
            wgsl.run
        ));
        text.replace_range(span, &hook);
    }
    let mut items: Vec<&String> = Vec::new();
    let mut chain =
        String::from("fn effect_chain(start: EffectInput) -> vec4<f32> {\n    var link = start;\n");
    for (slot, piece) in effects.iter().enumerate() {
        let wgsl = piece.wgsl.as_ref().expect("a WGSL piece");
        for item in &wgsl.items {
            if !items.contains(&item) {
                items.push(item);
            }
        }
        chain.push_str(&format!("    link.color = {}(link, {slot}u);\n", wgsl.run));
    }
    chain.push_str("    return link.color;\n}\n");
    let span = function_span(&text, "effect_chain");
    let joined: Vec<&str> = items.iter().map(|item| item.as_str()).collect();
    text.replace_range(span, &format!("{}\n{chain}", joined.join("\n")));
    text
}

/// Reads and validates WGSL with naga, as a browser would refuse it.
fn validate(wgsl: &str) {
    let module = naga::front::wgsl::parse_str(wgsl).unwrap_or_else(|e| {
        panic!("{}\n{wgsl}", e.emit_to_string(wgsl));
    });
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::MULTISAMPLED_SHADING,
    )
    .validate(&module)
    .unwrap_or_else(|e| panic!("{e:?}\n{wgsl}"));
}

#[test]
fn effects_that_read_only_their_own_pixel_join_and_neighbor_readers_do_not() {
    assert!(compile(GAIN).joins);
    assert!(
        compile(FOG).joins,
        "a depth read joins: the depth is the scene's own"
    );
    assert!(!compile(SPLIT).joins, "effectColor, through a helper");
    assert!(!compile(EDGE).joins, "effectPixel");
    assert!(
        !compile(REINHARD).joins,
        "a tone curve folds, it does not join"
    );
}

#[test]
fn each_effect_has_pieces_for_both_hosts_and_a_curve_for_the_final_pass() {
    let fog = compile(FOG);
    let mut group: Vec<&str> = fog.pieces.group.keys().map(String::as_str).collect();
    group.sort_unstable();
    assert_eq!(group, ["webgl2", "webgpu", "webgpu_depth_multisampled"]);
    assert_eq!(fog.pieces.fold.len(), 3);
    let piece = &fog.pieces.group["webgl2"];
    let glsl = piece.glsl.as_ref().expect("a GLSL piece");
    // The depth texture is the piece's own: the host binds none until a piece reads it.
    assert_eq!(glsl.textures.len(), 1, "{:?}", glsl.textures);
    assert!(glsl.run.ends_with("effect_piece_main"));
    let curve = compile(REINHARD);
    assert!(curve.pieces.group.is_empty());
    let mut fold: Vec<&str> = curve.pieces.fold.keys().map(String::as_str).collect();
    fold.sort_unstable();
    assert_eq!(fold, ["webgl2", "webgpu"]);
    assert!(
        curve.pieces.fold["webgpu"]
            .wgsl
            .as_ref()
            .unwrap()
            .run
            .ends_with("toneCurve")
    );
}

#[test]
fn a_shared_helper_reads_the_same_in_every_piece() {
    // The split and a second effect that reads its neighbors both hold `effectColor`: the joined
    // shader holds it once only if both pieces write it alike.
    let split = compile(SPLIT);
    let blur = compile(
        "fn effect(input: EffectInput) -> vec4f {
    return 0.5 * (effectColor(input.uv) + effectColor(input.uv + vec2f(0.01, 0.0)));
}
",
    );
    for build in ["webgpu", "webgl2"] {
        let find = |output: &EffectOutput| -> String {
            let piece = &output.pieces.group[build];
            let items = match &piece.wgsl {
                Some(wgsl) => wgsl.items.clone(),
                None => piece.glsl.as_ref().unwrap().items.clone(),
            };
            items
                .into_iter()
                .find(|item| item.contains(" effectColor("))
                .expect("the piece holds effectColor")
        };
        assert_eq!(find(&split), find(&blur), "{build}");
    }
}

#[test]
fn joined_effects_make_a_valid_group_shader() {
    let hosts = host("effect_group");
    let split = compile(SPLIT);
    let gain = compile(GAIN);
    let fog = compile(FOG);
    let host = hosts["webgpu"].wgsl.as_ref().unwrap();
    // The neighbor reader first, then two effects that join it, one of them twice.
    let joined = join_wgsl(
        &host.source,
        &[
            &split.pieces.group["webgpu"],
            &gain.pieces.group["webgpu"],
            &fog.pieces.group["webgpu"],
            &gain.pieces.group["webgpu"],
        ],
        None,
    );
    validate(&joined);
    assert_eq!(joined.matches("fn effectColor(").count(), 1);
    // Each instance of the same effect reads the block at its own slot.
    assert!(joined.contains("(link, 1u)") && joined.contains("(link, 3u)"));
    let multisampled = join_wgsl(
        &host.source,
        &[
            &gain.pieces.group["webgpu"],
            &fog.pieces.group["webgpu_depth_multisampled"],
        ],
        None,
    );
    validate(&multisampled);
    assert!(multisampled.contains("texture_multisampled_2d"));
}

#[test]
fn effects_and_a_curve_fold_into_a_valid_final_pass() {
    let hosts = host("final_effects");
    let host = hosts["webgpu"].wgsl.as_ref().unwrap();
    let gain = compile(GAIN);
    let edge = compile(EDGE);
    let curve = compile(REINHARD);
    let joined = join_wgsl(
        &host.source,
        &[&edge.pieces.fold["webgpu"], &gain.pieces.fold["webgpu"]],
        Some(&curve.pieces.fold["webgpu"]),
    );
    validate(&joined);
    assert!(joined.contains("toneCurve(c)"));
    // Without a curve the hook keeps the built-in curves.
    validate(&join_wgsl(
        &host.source,
        &[&gain.pieces.fold["webgpu"]],
        None,
    ));
}

#[test]
fn the_hosts_build_for_both_paths_without_pieces() {
    for name in ["effect_group", "final_effects"] {
        let builds = host(name);
        let mut names: Vec<&str> = builds.keys().map(String::as_str).collect();
        names.sort_unstable();
        assert_eq!(names, ["webgl2", "webgpu"], "{name}");
        let wgsl = &builds["webgpu"].wgsl.as_ref().unwrap().source;
        // Each host has the chain the engine replaces; the final pass also has the curve's hook.
        assert!(wgsl.contains("fn effect_chain("), "{name}");
        let glsl = &builds["webgl2"].glsl.as_ref().unwrap()["main"]
            .fragment
            .source;
        assert!(glsl.contains(" effect_chain("), "{name}");
        if name == "final_effects" {
            assert!(wgsl.contains("fn tone_curve_hook("));
            assert!(glsl.contains(" tone_curve_hook("));
        }
    }
}
