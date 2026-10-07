//! Custom effects and tone curves built into the repository's templates, as the Vite plugin builds
//! them through the shader compiler.

use std::path::Path;

use null3d_shaders::{
    BuildError, Compiler, EffectOutput, EffectSource, Inputs, PostTemplates, Problem,
};

/// The display path of the WGSL in the tests.
const PATH: &str = "src/sketch.ts";

/// An effect with uniforms that reads its neighbors: a tinted blur across.
const TINT: &str = "struct Uniforms { tint: vec3f, amount: f32, spread: vec2f }

fn effect(input: EffectInput) -> vec4f {
    let step = vec2f(uniforms.spread.x / input.size.x, 0.0);
    let blurred = 0.5 * (effectColor(input.uv - step) + effectColor(input.uv + step));
    let tinted = mix(blurred.rgb, blurred.rgb * uniforms.tint, uniforms.amount);
    return vec4f(tinted, input.color.a);
}
";

/// An effect that reads the scene's depth: fog by distance.
const FOG: &str = "fn effect(input: EffectInput) -> vec4f {
    let fade = 1.0 - exp(-effectDistance(input.uv) * 0.1);
    return vec4f(mix(input.color.rgb, vec3f(0.5), fade), input.color.a);
}
";

/// Reinhard's tone curve, as three.js's ReinhardToneMapping writes it.
const REINHARD: &str = "fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
";

/// Builds WGSL into the repository's templates.
fn compile(source: &str) -> Result<EffectOutput, BuildError> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let templates = PostTemplates::load(&inputs).expect("the templates of effects and curves");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    compiler.compile_effect(
        &templates,
        &EffectSource {
            path: PATH.to_owned(),
            source: source.to_owned(),
        },
    )
}

/// The one problem of a build that should fail.
fn only_problem(source: &str) -> Problem {
    let error = compile(source).expect_err("the build should fail");
    assert_eq!(error.problems.len(), 1, "{error}");
    error.problems[0].clone()
}

#[test]
fn an_effect_builds_for_both_paths_with_its_uniforms_packed() {
    let built = compile(TINT).expect("the effect builds");
    assert_eq!(built.function, "effect");
    assert!(!built.depth);
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(names, ["webgl2", "webgpu"]);
    let uniforms: Vec<(&str, &str, u32)> = built
        .uniforms
        .iter()
        .map(|u| (u.name.as_str(), u.ty.as_str(), u.offset))
        .collect();
    assert_eq!(
        uniforms,
        [
            ("tint", "vec3f", 0),
            ("amount", "f32", 3),
            ("spread", "vec2f", 4)
        ]
    );
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().unwrap().source;
    assert!(wgsl.contains("load_effect_uniforms"), "{wgsl}");
    assert!(built.variants["webgl2"].glsl.is_some());
}

#[test]
fn an_effect_that_reads_depth_has_a_multisampled_webgpu_build() {
    let built = compile(FOG).expect("the effect builds");
    assert!(built.depth);
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(names, ["webgl2", "webgpu", "webgpu_depth_multisampled"]);
    let multisampled = &built.variants["webgpu_depth_multisampled"];
    assert_eq!(multisampled.permutation, 262_144);
    let wgsl = &multisampled.wgsl.as_ref().unwrap().source;
    assert!(wgsl.contains("texture_multisampled_2d"), "{wgsl}");
}

#[test]
fn a_tone_curve_builds_into_every_variant_of_the_final_pass_but_half() {
    let built = compile(REINHARD).expect("the curve builds");
    assert_eq!(built.function, "toneCurve");
    assert!(built.uniforms.is_empty());
    assert_eq!(built.variants.len(), 8, "{:?}", built.variants.keys());
    assert!(built.variants.keys().all(|name| !name.contains("half")));
    assert!(built.variants.contains_key("webgl2_fxaa_bloom"));
    let wgsl = &built.variants["webgpu_bloom"].wgsl.as_ref().unwrap().source;
    assert!(wgsl.contains("toneCurve"), "{wgsl}");
}

#[test]
fn a_problem_in_the_effect_names_its_own_line() {
    let problem = only_problem(
        "fn effect(input: EffectInput) -> vec4f {
    let x = 1.0;
    return input.color * missing;
}
",
    );
    assert_eq!(problem.file.as_deref(), Some(PATH));
    assert_eq!(problem.line, Some(3), "{problem:?}");
}

#[test]
fn a_wrong_signature_says_which_one_the_engine_calls() {
    let problem = only_problem(
        "fn effect(color: vec4f) -> vec4f {
    return color;
}
",
    );
    assert_eq!(problem.line, Some(1));
    assert!(
        problem
            .message
            .contains("fn effect(input: EffectInput) -> vec4f"),
        "{}",
        problem.message
    );
}

#[test]
fn wgsl_without_an_effect_or_a_curve_or_with_both_is_refused() {
    let neither = only_problem("fn helper() -> f32 { return 1.0; }\n");
    assert!(neither.message.contains("no effect and no tone curve"));
    let both = only_problem(&format!("{TINT}{REINHARD}"));
    assert!(both.message.contains("both"), "{}", both.message);
}

#[test]
fn effects_take_no_textures_and_curves_no_uniforms() {
    let texture = only_problem(
        "var noise: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    return input.color;
}
",
    );
    assert_eq!(texture.line, Some(1));
    assert!(
        texture.message.contains("no textures"),
        "{}",
        texture.message
    );
    let uniforms = only_problem(
        "struct Uniforms { white: f32 }

fn toneCurve(color: vec3f) -> vec3f {
    return color;
}
",
    );
    assert!(
        uniforms.message.contains("no uniforms"),
        "{}",
        uniforms.message
    );
}

#[test]
fn a_name_that_clashes_with_the_template_names_the_effects_line() {
    let problem = only_problem(
        "var<private> effect_block: f32;

fn effect(input: EffectInput) -> vec4f {
    return input.color;
}
",
    );
    assert_eq!(problem.line, Some(1), "{problem:?}");
    assert!(
        problem.message.contains("effect_block"),
        "{}",
        problem.message
    );
}

#[test]
fn effects_and_curves_import_from_the_shader_library() {
    let grain = "#import null3d::noise::{random2}
#import null3d::color::{luminance}

fn effect(input: EffectInput) -> vec4f {
    let noise = random2(input.pixel + vec2f(input.time)) - 0.5;
    let grain = 1.0 + noise * 0.1 / max(luminance(input.color.rgb), 0.1);
    return vec4f(input.color.rgb * grain, input.color.a);
}
";
    compile(grain).expect("the effect builds with library imports");
    let curve = "#import null3d::color::{tone_map_agx}

fn toneCurve(color: vec3f) -> vec3f {
    return tone_map_agx(color * 1.2);
}
";
    compile(curve).expect("the curve builds with library imports");
}
