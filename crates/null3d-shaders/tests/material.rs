//! Custom materials built into the repository's template, as the Vite plugin builds them through
//! the shader compiler.

use std::path::Path;

use null3d_shaders::{
    BuildError, Compiler, Inputs, MaterialOutput, MaterialSource, MaterialTemplate, Problem,
};

/// The display path of a custom material's WGSL in the tests.
const PATH: &str = "src/sketch.ts";

/// A surface function that imports a library item and reads the first texture coordinates.
const STRIPES: &str = "#import null3d::math::{square}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.roughness = square(fract(input.uv.x * 4.0));
    return s;
}
";

/// Builds a custom material into the repository's template.
fn compile(source: &str) -> Result<MaterialOutput, BuildError> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let template = MaterialTemplate::load(&inputs).expect("the template of custom materials");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    compiler.compile_material(
        &template,
        &MaterialSource {
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
fn a_surface_function_builds_into_every_variant_of_the_template() {
    let built = compile(STRIPES).expect("the surface function builds");
    assert_eq!(built.functions, ["surface"]);
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        [
            "webgl2",
            "webgl2_alpha_mask",
            "webgl2_draw_index",
            "webgl2_draw_index_alpha_mask",
            "webgl2_draw_index_tone_map",
            "webgl2_draw_index_tone_map_alpha_mask",
            "webgl2_draw_index_tone_map_vertex_color",
            "webgl2_draw_index_tone_map_vertex_color_alpha_mask",
            "webgl2_draw_index_vertex_color",
            "webgl2_draw_index_vertex_color_alpha_mask",
            "webgl2_tone_map",
            "webgl2_tone_map_alpha_mask",
            "webgl2_tone_map_vertex_color",
            "webgl2_tone_map_vertex_color_alpha_mask",
            "webgl2_vertex_color",
            "webgl2_vertex_color_alpha_mask",
            "webgpu",
            "webgpu_alpha_mask",
            "webgpu_alpha_mask_receive_shadows",
            "webgpu_receive_shadows",
            "webgpu_tone_map",
            "webgpu_tone_map_alpha_mask",
            "webgpu_tone_map_alpha_mask_receive_shadows",
            "webgpu_tone_map_receive_shadows",
            "webgpu_tone_map_vertex_color",
            "webgpu_tone_map_vertex_color_alpha_mask",
            "webgpu_tone_map_vertex_color_alpha_mask_receive_shadows",
            "webgpu_tone_map_vertex_color_receive_shadows",
            "webgpu_vertex_color",
            "webgpu_vertex_color_alpha_mask",
            "webgpu_vertex_color_alpha_mask_receive_shadows",
            "webgpu_vertex_color_receive_shadows",
        ]
    );
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(wgsl.contains("fn square(x: f32) -> f32"), "{wgsl}");
    assert!(wgsl.contains("@location(2) uv0"), "{wgsl}");
    assert!(!wgsl.contains("discard"), "{wgsl}");
    // A masked variant tests the alpha that the surface function returns.
    let masked = &built.variants["webgpu_alpha_mask"]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source;
    assert!(masked.contains("discard"), "{masked}");
    let program = &built.variants["webgl2_draw_index"]
        .glsl
        .as_ref()
        .expect("GLSL")["main"];
    assert!(
        program.fragment.source.contains("fract("),
        "{}",
        program.fragment.source
    );
}

#[test]
fn a_problem_in_the_wgsl_names_its_own_line_and_column() {
    let broken = STRIPES.replace("4.0));", "4.0)) 2.0;");
    let problem = only_problem(&broken);
    assert_eq!(problem.file.as_deref(), Some(PATH));
    let line = broken.lines().nth(4).expect("the broken line");
    let column = line.find("2.0;").expect("the extra value") as u32 + 1;
    assert_eq!((problem.line, problem.column), (Some(5), Some(column)));
    assert_eq!(problem.variants.len(), 32, "{problem}");
}

#[test]
fn a_surface_function_with_another_signature_is_refused_at_its_name() {
    let problem = only_problem(&STRIPES.replace("-> Surface", "-> vec4f"));
    assert_eq!((problem.line, problem.column), (Some(3), Some(4)));
    assert_eq!(
        problem.message,
        "`surface` does not have the signature that the engine calls. Declare it as `fn surface(input: SurfaceInput) -> Surface`."
    );
}

#[test]
fn wgsl_without_a_function_of_a_custom_material_is_refused() {
    let problem = only_problem("fn helper() -> f32 {\n    return 1.0;\n}\n");
    assert_eq!((problem.line, problem.column), (Some(1), Some(1)));
    assert!(
        problem.message.starts_with(
            "the WGSL declares no function of a custom material. Declare `fn surface(input: SurfaceInput) -> Surface`"
        ),
        "{problem}"
    );
}

#[test]
fn a_directive_is_refused_at_its_line() {
    let problem = only_problem(&format!("\nenable f16;\n{STRIPES}"));
    assert_eq!((problem.line, problem.column), (Some(2), Some(1)));
    assert!(
        problem.message.contains("cannot hold directives"),
        "{problem}"
    );
}

#[test]
fn a_name_that_the_template_declares_clashes_at_the_line_of_the_wgsl() {
    let problem = only_problem(&format!(
        "{STRIPES}\nfn shade(x: f32) -> f32 {{\n    return x;\n}}\n"
    ));
    assert_eq!(problem.line, Some(9));
    assert!(
        problem.message.contains("redefinition of `shade`"),
        "{problem}"
    );
}
