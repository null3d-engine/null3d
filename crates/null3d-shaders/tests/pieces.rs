//! Pieces of custom effects and tone curves, joined into the engine's hosts as the engine joins
//! them at run time: each piece's items before the host's chain, each shared item once, and a chain
//! that calls each piece in turn. naga then reads and validates the joined WGSL.

mod subset;

use std::collections::BTreeMap;
use std::path::Path;

use null3d_shaders::{
    Compiler, EffectOutput, EffectSource, Inputs, PieceOutput, PostTemplates, VariantOutput,
};
use subset::repository_subset;

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

/// Light shafts from the sky toward a point: an effect that reads only its own pixel and the depth
/// in a loop. naga's GLSL keeps a flag for each loop under a name that is unique across the module,
/// so the loop of the host's entry point after this one's takes another name in the piece's build.
const RAYS: &str = "struct Uniforms { sun: vec2f, strength: f32, tint: vec3f }

fn effect(input: EffectInput) -> vec4f {
    let toward = uniforms.sun - input.uv;
    let step = toward / 28.0;
    var uv = input.uv;
    var lit = 0.0;
    var weight = 1.0;
    for (var i = 0; i < 28; i++) {
        lit += select(0.0, weight, effectDepth(uv) == 0.0);
        weight *= 0.95;
        uv += step;
    }
    let rays = lit / 28.0 * uniforms.strength;
    return vec4f(input.color.rgb + uniforms.tint * rays * input.color.a, input.color.a);
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

/// The engine's builds of a host shader, by build name, from a build of that shader alone.
fn host(name: &str) -> BTreeMap<String, VariantOutput> {
    let mut output =
        null3d_shaders::build(&repository_subset(&[name])).expect("the host shader builds");
    output.shaders.remove(name).expect("the host's builds")
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

/// Joins pieces into a host's GLSL fragment shader as the engine's joiner does: a curve's items and
/// its call in place of `tone_curve_hook`, then the effects' items, each once, and their chain in
/// place of `effect_chain`, with the effects' slots from 0.
///
/// The chain carries the input's members, not the structure: the WebGL2 build flattens a
/// structure parameter into one parameter for each member (`flatten.rs`), so a chain that named
/// `EffectInput` and passed it to a run function would not build on a driver. A GLSL call is
/// positional, so the names here are the chain's own. Keep this in step with the members in
/// `GLSL_INPUT` of `packages/engine/src/gpu/effect-joiner.ts`.
fn join_glsl(host: &str, effects: &[&PieceOutput], curve: Option<&PieceOutput>) -> String {
    let mut text = host.to_owned();
    if let Some(curve) = curve {
        let glsl = curve.glsl.as_ref().expect("a GLSL piece");
        let span = function_span(&text, "tone_curve_hook");
        let mut hook = glsl.items.join("\n");
        hook.push_str(&format!(
            "\nvec3 tone_curve_hook(vec3 color) {{\n    return clamp({}(color), vec3(0.0), vec3(1.0));\n}}\n",
            glsl.run
        ));
        text.replace_range(span, &hook);
    }
    let members: [(&str, &str); 6] = [
        ("vec4", "chain_color"),
        ("vec2", "chain_uv"),
        ("vec2", "chain_pixel"),
        ("vec2", "chain_size"),
        ("float", "chain_time"),
        ("uint", "chain_layer"),
    ];
    let parameters: Vec<String> = members.iter().map(|(t, n)| format!("{t} {n}")).collect();
    let unchanged: Vec<&str> = members[1..].iter().map(|(_, n)| *n).collect();
    let mut items: Vec<&String> = Vec::new();
    let mut chain = format!(
        "vec4 effect_chain({}) {{\n    vec4 link = {};\n",
        parameters.join(", "),
        members[0].1
    );
    for (slot, piece) in effects.iter().enumerate() {
        let glsl = piece.glsl.as_ref().expect("a GLSL piece");
        for item in &glsl.items {
            if !items.contains(&item) {
                items.push(item);
            }
        }
        chain.push_str(&format!(
            "    link = {}(link, {}, {slot}u);\n",
            glsl.run,
            unchanged.join(", ")
        ));
    }
    chain.push_str("    return link;\n}\n");
    let span = function_span(&text, "effect_chain");
    let joined: Vec<&str> = items.iter().map(|item| item.as_str()).collect();
    text.replace_range(span, &format!("{}\n{chain}", joined.join("\n")));
    text
}

/// The name of the function that a line of naga's GLSL starts to define: a line at the first
/// column that opens a body after a parameter list, and not a struct's or a uniform block's.
fn glsl_function(line: &str) -> Option<&str> {
    if line.starts_with(char::is_whitespace)
        || !line.trim_end().ends_with('{')
        || line.starts_with("struct ")
        || line.starts_with("layout(")
    {
        return None;
    }
    let before = line[..line.find('(')?].trim_end();
    let start = before
        .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .map_or(0, |at| at + 1);
    Some(&before[start..])
}

/// The names that `line` calls, with the place of each call's opening parenthesis.
fn glsl_calls(line: &str) -> impl Iterator<Item = (&str, usize)> {
    line.match_indices('(').filter_map(move |(at, _)| {
        let before = &line[..at];
        let start = before
            .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .map_or(0, |at| at + 1);
        (start < at).then(|| (&before[start..], at))
    })
}

/// The number of arguments of the call whose opening parenthesis is at `open`: its top-level
/// commas, one more than those when it holds anything.
fn glsl_arguments(text: &str, open: usize) -> usize {
    let mut depth = 0usize;
    let mut commas = 0usize;
    let mut empty = true;
    for byte in text.as_bytes()[open..].iter() {
        match byte {
            b'(' | b'[' => depth += 1,
            b')' | b']' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return if empty { 0 } else { commas + 1 };
                }
            }
            b',' if depth == 1 => commas += 1,
            b' ' | b'\t' | b'\n' | b'\r' => {}
            _ => empty = false,
        }
    }
    panic!("a call is not closed: {text}");
}

/// Checks GLSL as a WebGL2 driver would refuse it where joins can go wrong: a function defined
/// twice, `main` among them, one called before its definition, which GLSL needs first, or a call
/// that does not fit the function it calls, which a driver refuses where the call's arguments do
/// not match its parameters. naga cannot read GLSL ES, so this stands in for a driver.
fn check_glsl(glsl: &str) {
    let lines: Vec<&str> = glsl.lines().collect();
    let functions: Vec<&str> = lines
        .iter()
        .filter_map(|line| glsl_function(line))
        .collect();
    // The parameters of each function the shader defines, by name.
    let mut parameters: BTreeMap<&str, usize> = BTreeMap::new();
    for line in &lines {
        if let Some(name) = glsl_function(line) {
            let open = line.find('(').expect("a definition has a parameter list");
            parameters.insert(name, glsl_arguments(line, open));
        }
    }
    let mut defined: Vec<&str> = Vec::new();
    let mut inside: Option<&str> = None;
    for (number, line) in lines.iter().enumerate() {
        if let Some(name) = glsl_function(line) {
            assert!(
                !defined.contains(&name),
                "line {}: `{name}` is defined twice\n{glsl}",
                number + 1
            );
            defined.push(name);
            inside = Some(name);
            continue;
        }
        if line.starts_with('}') {
            inside = None;
        }
        let Some(caller) = inside else { continue };
        for (name, open) in glsl_calls(line) {
            assert!(
                !functions.contains(&name) || (defined.contains(&name) && name != caller),
                "line {}: `{caller}` calls `{name}` before its definition\n{glsl}",
                number + 1
            );
            if let Some(&count) = parameters.get(name) {
                let arguments = glsl_arguments(line, open);
                assert_eq!(
                    arguments,
                    count,
                    "line {}: `{caller}` calls `{name}` with {arguments} arguments, which takes {count}\n{glsl}",
                    number + 1
                );
            }
        }
    }
    assert_eq!(
        defined.iter().filter(|name| **name == "main").count(),
        1,
        "{glsl}"
    );
}

/// A host's GLSL fragment shader of its build `build`.
fn host_glsl(hosts: &BTreeMap<String, VariantOutput>, build: &str) -> String {
    hosts[build].glsl.as_ref().expect("a GLSL build")["main"]
        .fragment
        .source
        .to_string()
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
    let glsl = host_glsl(&hosts, "webgl2");
    let joined = join_glsl(
        &glsl,
        &[
            &split.pieces.group["webgl2"],
            &gain.pieces.group["webgl2"],
            &fog.pieces.group["webgl2"],
            &gain.pieces.group["webgl2"],
        ],
        None,
    );
    check_glsl(&joined);
    assert_eq!(joined.matches(" effectColor(vec2 ").count(), 1);
}

/// The hosts' chains take the input's members, in the order the structure declares them, because
/// the WebGL2 build flattens the structure away (`flatten.rs`). The engine's joiner writes the
/// same members in the same order (`GLSL_INPUT` in `packages/engine/src/gpu/effect-joiner.ts`),
/// and a chain that takes other members, or takes them in another order, leaves the calls it
/// writes for the pieces fitting no function at all: a driver refuses the whole shader then, and
/// the engine draws the joined effects in a pass each instead.
#[test]
fn the_host_chains_take_the_input_members_in_the_structure_order() {
    // The qualifiers that may stand before a parameter's type, which is the last word after them.
    const QUALIFIERS: [&str; 9] = [
        "const", "in", "out", "inout", "lowp", "mediump", "highp", "flat", "smooth",
    ];
    for name in ["effect_group", "final_effects"] {
        let hosts = host(name);
        let glsl = host_glsl(&hosts, "webgl2");
        let line = glsl
            .lines()
            .find(|line| glsl_function(line) == Some("effect_chain"))
            .unwrap_or_else(|| panic!("{name} defines effect_chain in its WebGL2 build:\n{glsl}"));
        let list = &line[line.find('(').unwrap() + 1..line.rfind(')').unwrap()];
        let types: Vec<&str> = list
            .split(',')
            .map(|parameter| {
                // GLSL writes a parameter's qualifiers, then its type, then its name, which naga
                // leaves out where a parameter is unused.
                parameter
                    .split_whitespace()
                    .find(|word| !QUALIFIERS.contains(word))
                    .unwrap_or_else(|| panic!("a parameter of {name}'s chain has a type: {line}"))
            })
            .collect();
        assert_eq!(
            types,
            ["vec4", "vec2", "vec2", "vec2", "float", "uint"],
            "{name}'s chain: {line}"
        );
    }
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
    let glsl = host_glsl(&hosts, "webgl2");
    check_glsl(&join_glsl(
        &glsl,
        &[&edge.pieces.fold["webgl2"], &gain.pieces.fold["webgl2"]],
        Some(&curve.pieces.fold["webgl2"]),
    ));
    check_glsl(&join_glsl(&glsl, &[&gain.pieces.fold["webgl2"]], None));
}

#[test]
fn an_effect_with_a_loop_joins_and_folds_without_the_hosts_functions() {
    let rays = compile(RAYS);
    let gain = compile(GAIN);
    let curve = compile(REINHARD);
    assert!(
        rays.joins,
        "the rays read only their own pixel and the depth"
    );
    for (name, pieces) in [
        ("effect_group", &rays.pieces.group),
        ("final_effects", &rays.pieces.fold),
    ] {
        let hosts = host(name);
        for (build, piece) in pieces {
            let own = &hosts[build.trim_end_matches("_depth_multisampled")];
            // No item of the piece defines a function that the host's build defines already: a
            // function whose names naga changed in the piece's build stays the host's.
            let (items, source) = match (&piece.wgsl, &piece.glsl) {
                (Some(wgsl), _) => (&wgsl.items, own.wgsl.as_ref().unwrap().source.to_string()),
                (_, Some(glsl)) => (&glsl.items, host_glsl(&hosts, build)),
                _ => panic!("{name} {build}: a piece without a build"),
            };
            for item in items {
                let head = item.lines().find(|l| !l.starts_with('@')).unwrap_or("");
                assert!(
                    !source
                        .lines()
                        .any(|line| line == head && line.contains('(') && line.ends_with('{')),
                    "{name} {build}: the piece holds the host's {head}"
                );
            }
        }
    }
    let group = host("effect_group");
    validate(&join_wgsl(
        &group["webgpu"].wgsl.as_ref().unwrap().source,
        &[&rays.pieces.group["webgpu"], &gain.pieces.group["webgpu"]],
        None,
    ));
    check_glsl(&join_glsl(
        &host_glsl(&group, "webgl2"),
        &[&rays.pieces.group["webgl2"], &gain.pieces.group["webgl2"]],
        None,
    ));
    let fold = host("final_effects");
    for effects in [
        vec![&rays.pieces.fold["webgpu"]],
        vec![&gain.pieces.fold["webgpu"], &rays.pieces.fold["webgpu"]],
    ] {
        validate(&join_wgsl(
            &fold["webgpu"].wgsl.as_ref().unwrap().source,
            &effects,
            Some(&curve.pieces.fold["webgpu"]),
        ));
    }
    let glsl = host_glsl(&fold, "webgl2");
    check_glsl(&glsl);
    check_glsl(&join_glsl(&glsl, &[&rays.pieces.fold["webgl2"]], None));
    check_glsl(&join_glsl(
        &glsl,
        &[&gain.pieces.fold["webgl2"], &rays.pieces.fold["webgl2"]],
        Some(&curve.pieces.fold["webgl2"]),
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
