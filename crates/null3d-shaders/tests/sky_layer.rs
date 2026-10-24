//! Sky layers built into the repository's sky-layer template, as the Vite plugin builds them
//! through the shader compiler.

use std::path::Path;

use null3d_shaders::{
    BuildError, Compiler, Inputs, Problem, SkyLayerOutput, SkyLayerSource, SkyLayerTemplates,
};

/// The display path of the WGSL in the tests.
const PATH: &str = "src/aurora.wgsl";

/// A layer that paints a green band over the sky and fades it by the core sky's clouds.
const AURORA: &str = "fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    let up = max(input.direction.y, 0.0);
    let band = smoothstep(0.0, 0.35, up) * (1.0 - smoothstep(0.35, 0.8, up));
    let glow = vec3f(0.05, 0.8, 0.4) * band * input.clouds.x;
    return SkyLayer(glow, band);
}
";

/// Builds WGSL into the repository's sky-layer template.
fn compile(source: &str) -> Result<SkyLayerOutput, BuildError> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let templates = SkyLayerTemplates::load(&inputs).expect("the sky-layer template");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    compiler.compile_sky_layer(
        &templates,
        &SkyLayerSource {
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
fn a_layer_builds_for_both_paths_with_its_own_function() {
    let built = compile(AURORA).expect("the layer builds");
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        ["webgl2", "webgl2_tone_map", "webgpu", "webgpu_tone_map"]
    );
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().unwrap().source;
    assert!(
        wgsl.contains("fn skyLayer(input: SkyLayerInput) -> SkyLayer {"),
        "{wgsl}"
    );
    assert!(
        wgsl.contains("smoothstep"),
        "the layer's own code is in the build"
    );
    assert!(
        !wgsl.contains("return SkyLayer(vec3f(0.0), 0.0);"),
        "the template's stub is left out of the build"
    );
    let glsl = built.variants["webgl2"].glsl.as_ref().unwrap();
    let fragment = &glsl["main"].fragment.source;
    assert!(fragment.contains("skyLayer"), "{fragment}");
}

#[test]
fn the_example_add_ons_layer_builds() {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/addons/aurora/aurora.wgsl");
    let source = std::fs::read_to_string(path).expect("the aurora example add-on's WGSL");
    let built = compile(&source).expect("the aurora example add-on builds");
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        ["webgl2", "webgl2_tone_map", "webgpu", "webgpu_tone_map"]
    );
}

#[test]
fn a_layer_takes_no_uniforms() {
    let problem = only_problem(
        "struct Uniforms { tint: vec3f }

fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(uniforms.tint, 1.0);
}
",
    );
    assert!(
        problem.message.contains("takes no `struct Uniforms`"),
        "{problem}"
    );
}

#[test]
fn a_layer_declares_no_bindings_of_its_own() {
    let problem = only_problem(
        "@group(2) @binding(0) var picture: texture_2d<f32>;

fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(vec3f(0.0), 0.0);
}
",
    );
    assert!(
        problem
            .message
            .contains("declares no textures, samplers or bindings"),
        "{problem}"
    );
}

#[test]
fn a_layer_holds_no_directives() {
    let problem = only_problem(
        "enable f16;

fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    return SkyLayer(vec3f(0.0), 0.0);
}
",
    );
    assert!(
        problem.message.contains("cannot hold directives"),
        "{problem}"
    );
}

#[test]
fn wgsl_without_the_function_names_what_it_needs() {
    let problem = only_problem(
        "fn band(up: f32) -> f32 {
    return smoothstep(0.0, 0.35, up);
}
",
    );
    assert!(
        problem.message.contains("declares no sky layer"),
        "{problem}"
    );
    assert!(
        problem
            .message
            .contains("fn skyLayer(input: SkyLayerInput) -> SkyLayer"),
        "{problem}"
    );
}

#[test]
fn a_function_of_another_signature_names_the_one_the_engine_calls() {
    let problem = only_problem(
        "fn skyLayer(input: vec3f) -> SkyLayer {
    return SkyLayer(input, 1.0);
}
",
    );
    assert!(
        problem.message.contains("does not have the signature"),
        "{problem}"
    );
}

#[test]
fn a_problem_in_the_layers_wgsl_names_its_own_line() {
    let problem = only_problem(
        "fn skyLayer(input: SkyLayerInput) -> SkyLayer {
    let coverage: f32 = input.direction;
    return SkyLayer(input.direction, coverage);
}
",
    );
    assert_eq!(problem.line, Some(2), "{problem}");
}
