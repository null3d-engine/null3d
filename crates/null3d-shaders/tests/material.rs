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
    // Each WebGL2 build has a twin that skins, for skinned meshes.
    let plain = [
        "webgl2",
        "webgl2_alpha_mask",
        "webgl2_alpha_mask_receive_shadows",
        "webgl2_draw_index",
        "webgl2_draw_index_alpha_mask",
        "webgl2_draw_index_alpha_mask_receive_shadows",
        "webgl2_draw_index_receive_shadows",
        "webgl2_draw_index_tone_map",
        "webgl2_draw_index_tone_map_alpha_mask",
        "webgl2_draw_index_tone_map_alpha_mask_receive_shadows",
        "webgl2_draw_index_tone_map_receive_shadows",
        "webgl2_draw_index_tone_map_vertex_color",
        "webgl2_draw_index_tone_map_vertex_color_alpha_mask",
        "webgl2_draw_index_tone_map_vertex_color_alpha_mask_receive_shadows",
        "webgl2_draw_index_tone_map_vertex_color_receive_shadows",
        "webgl2_draw_index_vertex_color",
        "webgl2_draw_index_vertex_color_alpha_mask",
        "webgl2_draw_index_vertex_color_alpha_mask_receive_shadows",
        "webgl2_draw_index_vertex_color_receive_shadows",
        "webgl2_receive_shadows",
        "webgl2_tone_map",
        "webgl2_tone_map_alpha_mask",
        "webgl2_tone_map_alpha_mask_receive_shadows",
        "webgl2_tone_map_receive_shadows",
        "webgl2_tone_map_vertex_color",
        "webgl2_tone_map_vertex_color_alpha_mask",
        "webgl2_tone_map_vertex_color_alpha_mask_receive_shadows",
        "webgl2_tone_map_vertex_color_receive_shadows",
        "webgl2_vertex_color",
        "webgl2_vertex_color_alpha_mask",
        "webgl2_vertex_color_alpha_mask_receive_shadows",
        "webgl2_vertex_color_receive_shadows",
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
    ];
    let skinned = plain
        .iter()
        .filter(|name| name.starts_with("webgl2"))
        .map(|name| format!("{name}_skin"));
    let mut expected: Vec<String> = plain
        .iter()
        .map(|&name| name.to_owned())
        .chain(skinned)
        .collect();
    expected.sort();
    let names: Vec<&String> = built.variants.keys().collect();
    assert_eq!(names, expected.iter().collect::<Vec<_>>());
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
    assert_eq!(problem.variants.len(), 80, "{problem}");
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

/// A surface function that reads uniforms of every kind.
const TINTED: &str = "struct Uniforms {
    strength: f32,
    tint: vec3f,
    scale: vec2<f32>,
    count: u32,
    offset: i32,
    extra: vec4f,
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = material.tint * material.strength * f32(material.count + u32(material.offset));
    s.roughness = material.scale.x + material.extra.w;
    return s;
}
";

#[test]
fn uniforms_are_packed_into_the_row_of_custom_values_and_loaded_from_it() {
    let built = compile(TINTED).expect("the surface function with uniforms builds");
    let places: Vec<(&str, &str, u32)> = built
        .uniforms
        .iter()
        .map(|u| (u.name.as_str(), u.ty.as_str(), u.offset))
        .collect();
    assert_eq!(
        places,
        [
            ("strength", "f32", 0),
            ("tint", "vec3f", 4),
            ("scale", "vec2f", 8),
            ("count", "u32", 10),
            ("offset", "i32", 11),
            ("extra", "vec4f", 12),
        ]
    );
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(wgsl.contains("fn load_material_uniforms("), "{wgsl}");
    let glsl = &built.variants["webgl2"].glsl.as_ref().expect("GLSL")["main"]
        .fragment
        .source;
    assert!(glsl.contains("texelFetch("), "{glsl}");
}

#[test]
fn a_surface_function_without_uniforms_has_none() {
    let built = compile(STRIPES).expect("the surface function builds");
    assert!(built.uniforms.is_empty());
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(!wgsl.contains("load_material_uniforms"), "{wgsl}");
}

#[test]
fn a_uniform_of_another_type_is_refused_at_its_name() {
    let source = TINTED.replace("count: u32", "count: mat2x2f");
    let problem = only_problem(&source);
    assert_eq!((problem.line, problem.column), (Some(5), Some(5)));
    assert_eq!(
        problem.message,
        "the uniform `count` has the type `mat2x2f`. Uniforms take `f32`, `i32`, `u32`, `vec2f`, `vec3f` and `vec4f`."
    );
}

#[test]
fn uniforms_past_the_row_are_refused_at_the_first_that_does_not_fit() {
    let fields: String = (0..9).map(|k| format!("    v{k}: vec4f,\n")).collect();
    let source = STRIPES.replace(
        "fn surface",
        &format!("struct Uniforms {{\n{fields}}}\n\nfn surface"),
    );
    let problem = only_problem(&source);
    assert_eq!(problem.line, Some(12));
    assert!(
        problem.message.starts_with("the uniform `v8` does not fit"),
        "{problem}"
    );
}

/// A vertex offset that waves the mesh by a uniform.
const WAVE: &str = "struct Uniforms { height: f32 }

fn vertexOffset(input: VertexInput) -> vec3f {
    return input.normal * sin(input.uv.x * 6.0) * material.height;
}
";

#[test]
fn a_vertex_offset_moves_the_vertex_in_every_variant_and_reads_the_uniforms() {
    let built = compile(WAVE).expect("the vertex offset builds");
    assert_eq!(built.functions, ["vertexOffset"]);
    // 16 WebGPU builds, and 32 WebGL2 builds, each with a twin that skins.
    assert_eq!(built.variants.len(), 80);
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(wgsl.contains("fn vertexOffset("), "{wgsl}");
    assert!(!wgsl.contains("fn surface("), "{wgsl}");
    let glsl = &built.variants["webgl2_draw_index"]
        .glsl
        .as_ref()
        .expect("GLSL")["main"];
    assert!(
        glsl.vertex.source.contains("texelFetch("),
        "{}",
        glsl.vertex.source
    );
    // The twin that skins reads the joint texture and the first joints in its vertex shader.
    let skin = &built.variants["webgl2_draw_index_skin"]
        .glsl
        .as_ref()
        .expect("GLSL")["main"];
    let read = |binding: u32| {
        let textures = &skin.vertex.textures;
        textures
            .iter()
            .any(|t| t.binding.group == 2 && t.binding.binding == binding)
    };
    assert!(read(4) && read(5));
    assert!(!glsl.vertex.textures.iter().any(|t| t.binding.binding == 4));
    let both = compile(&format!("{STRIPES}\n{WAVE}"))
        .expect("a vertex offset and a surface function build together");
    assert_eq!(both.functions, ["surface", "vertexOffset"]);
}

#[test]
fn a_vertex_offset_with_another_signature_is_refused_at_its_name() {
    let problem = only_problem(&WAVE.replace("-> vec3f", "-> vec4f"));
    assert_eq!((problem.line, problem.column), (Some(3), Some(4)));
    assert_eq!(
        problem.message,
        "`vertexOffset` does not have the signature that the engine calls. Declare it as `fn vertexOffset(input: VertexInput) -> vec3f`."
    );
}

/// A full shader: the mesh's position, normal and color, each instance's transform, and the
/// built-in values.
const FULL: &str = "#import null3d::builtins::{fill_builtins, frame}
#import null3d::mesh::{InstanceIn, clip_position, find_instance, finish, relative_position}
#import null3d::mesh::{world_normal}

struct Varyings {
    @builtin(position) clip: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec4f,
}

@vertex
fn vs(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(5) color: vec4f,
    i: InstanceIn,
) -> Varyings {
    let found = find_instance(i);
    var out: Varyings;
    out.clip = clip_position(found, position);
    out.normal = world_normal(found, normal);
    out.color = color;
    return out;
}

@fragment
fn fs(in: Varyings) -> @location(0) vec4f {
    fill_builtins(vec3f(0.0));
    let pulse = 0.5 + 0.5 * sin(frame.time);
    return finish(abs(normalize(in.normal)) * in.color.rgb * pulse, in.clip.xy);
}
";

#[test]
fn a_full_shader_builds_for_both_paths_and_reports_the_attributes_it_reads() {
    let built = compile(FULL).expect("the full shader builds");
    assert!(built.functions.is_empty());
    assert!(!built.base_color);
    let names: Vec<&str> = built.variants.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        [
            "webgl2",
            "webgl2_draw_index",
            "webgl2_draw_index_tone_map",
            "webgl2_tone_map",
            "webgpu",
            "webgpu_receive_shadows",
            "webgpu_tone_map",
            "webgpu_tone_map_receive_shadows",
        ]
    );
    assert_eq!(built.locations, [0, 1, 5]);
    assert_eq!(built.attributes, null3d_gpu::drawlist::vertex::COLOR);
    let wgsl = built.variants["webgpu"].wgsl.as_ref().expect("WGSL");
    assert_eq!(wgsl.pipelines["main"].vertex, "vs");
    assert_eq!(wgsl.pipelines["main"].fragment, "fs");
}

#[test]
fn a_surface_function_reads_the_first_texture_coordinates() {
    let built = compile(STRIPES).expect("the surface function builds");
    assert_eq!(built.locations, [0, 1, 2]);
    assert_eq!(built.attributes, null3d_gpu::drawlist::vertex::UV0);
    assert!(built.base_color);
}

#[test]
fn a_full_shader_names_its_own_lines_and_needs_one_pipeline() {
    let broken = FULL.replace("out.color = color;", "out.color = color 2.0;");
    let problem = only_problem(&broken);
    let line = broken
        .lines()
        .position(|line| line.contains("color 2.0"))
        .unwrap() as u32
        + 1;
    assert_eq!(problem.line, Some(line));
    let two = format!(
        "{FULL}\n@fragment\nfn fs_other(in: Varyings) -> @location(0) vec4f {{\n    return vec4f(1.0);\n}}\n"
    );
    let problem = only_problem(&two);
    assert!(
        problem
            .message
            .starts_with("a full shader for `materials.shader` has one `@vertex`"),
        "{problem}"
    );
}

#[test]
fn a_custom_material_that_breaks_a_portable_rule_fails_at_its_line_with_a_fix() {
    let half = STRIPES.replace(
        "    return s;",
        "    let h: f16 = 1.0h;\n    s.metalness = f32(h);\n    return s;",
    );
    let problem = only_problem(&half);
    assert_eq!(problem.file.as_deref(), Some(PATH));
    assert_eq!(problem.line, Some(6));
    assert!(problem.message.contains("`shader-f16`"), "{problem}");
    assert!(
        problem.message.contains("Write the math in `f32`"),
        "{problem}"
    );
    let swizzle = STRIPES.replace(
        "    return s;",
        "    s.baseColor.xy = vec2f(1.0);\n    return s;",
    );
    let problem = only_problem(&swizzle);
    assert_eq!(problem.line, Some(6));
    assert!(problem.feature.is_some(), "{problem}");
}

/// A surface function that samples two textures, and a vertex offset that reads one of them.
const TEXTURED: &str = "struct Uniforms { tiles: f32, height: f32 }

var detail: texture_2d<f32>;
var heights: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    let h = textureSampleLevel(heights, heightsSampler, input.uv, 0.0).r;
    return input.normal * h * material.height;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= textureSample(detail, detailSampler, input.uv * material.tiles).rgb;
    s.roughness *= textureSample(heights, heightsSampler, input.uv).g;
    return s;
}
";

#[test]
fn textures_build_into_every_variant_and_read_their_layers_in_both_stages() {
    let built = compile(TEXTURED).expect("the textured material builds");
    let textures: Vec<(&str, u32)> = built
        .textures
        .iter()
        .map(|t| (t.name.as_str(), t.offset))
        .collect();
    assert_eq!(textures, [("detail", 31), ("heights", 30)]);
    assert_eq!(built.uniforms.len(), 2);
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    for line in [
        "@group(1) @binding(0)\nvar detail: texture_2d_array<f32>;",
        "@group(1) @binding(7)\nvar heightsSampler: sampler;",
        "load_custom_texture_layers(",
    ] {
        assert!(wgsl.contains(line), "{line}\n{wgsl}");
    }
    // WebGL2 binds them in the group after the data textures, in skinned builds too.
    for name in ["webgl2_draw_index", "webgl2_draw_index_skin"] {
        let program = &built.variants[name].glsl.as_ref().expect("GLSL")["main"];
        let maps = |stage: &null3d_shaders::GlslStage| {
            stage
                .textures
                .iter()
                .filter(|t| t.binding.group == 3)
                .count()
        };
        assert_eq!(
            maps(&program.vertex),
            1,
            "{name}: the heights in the vertex stage"
        );
        assert_eq!(maps(&program.fragment), 2, "{name}");
        assert!(program.fragment.source.contains("sampler2DArray"));
    }
}

#[test]
fn texture_layers_take_room_from_the_uniforms() {
    // Eight vec4f fill the row without textures; one texture takes its last float.
    let fields: String = (0..8).map(|k| format!("    v{k}: vec4f,\n")).collect();
    let uniforms = format!("struct Uniforms {{\n{fields}}}\n");
    compile(&format!("{uniforms}{STRIPES}")).expect("eight vec4f fit");
    let sampled = STRIPES.replace(
        "var s = defaultSurface(input);",
        "var s = defaultSurface(input);\n    s.alpha = textureSample(t, tSampler, input.uv).a;",
    );
    let problem = only_problem(&format!("{uniforms}var t: texture_2d<f32>;\n{sampled}"));
    assert!(
        problem
            .message
            .contains("hold 32 numbers at most, less one for the texture"),
        "{problem}"
    );
}

#[test]
fn a_texture_problem_names_its_own_line() {
    let source = TEXTURED.replace("heights: texture_2d<f32>;", "heights: texture_3d<f32>;");
    let problem = only_problem(&source);
    assert_eq!((problem.line, problem.column), (Some(4), Some(5)));
    assert!(
        problem.message.contains("has the type `texture_3d<f32>`"),
        "{problem}"
    );
}

/// The uniforms and textures of custom effects that sketches port from three.js, or that the
/// showcase scenes would draw, to measure how much of a material's row of custom values each
/// needs. The built-in values, such as the time and the camera, are left out.
const EFFECTS: [(&str, &str); 10] = [
    (
        "toon bands",
        "struct Uniforms { bands: f32, shadowColor: vec3f, lightDirection: vec3f }",
    ),
    ("clipping plane", "struct Uniforms { plane: vec4f }"),
    ("matcap", "var matcap: texture_2d<f32>;"),
    (
        "dissolve",
        "struct Uniforms { amount: f32, edgeWidth: f32, scale: f32, edgeColor: vec3f }\nvar noise: texture_2d<f32>;",
    ),
    (
        "hologram",
        "struct Uniforms { color: vec3f, fresnelPower: f32, lineDensity: f32, lineSpeed: f32, opacity: f32 }",
    ),
    (
        "foliage wind",
        "struct Uniforms { direction: vec3f, strength: f32, frequency: f32, gust: f32 }\nvar gusts: texture_2d<f32>;",
    ),
    (
        "lit windows",
        "struct Uniforms { litColor: vec3f, intensity: f32, density: f32, seed: f32, rows: vec2f }",
    ),
    (
        "terrain splat",
        "struct Uniforms { tiling: vec4f, heights: vec4f }\nvar control: texture_2d<f32>;\nvar grass: texture_2d<f32>;\nvar rock: texture_2d<f32>;\nvar sand: texture_2d<f32>;\nvar snow: texture_2d<f32>;",
    ),
    (
        "three.js Sky",
        "struct Uniforms { turbidity: f32, rayleigh: f32, mieCoefficient: f32, mieDirectionalG: f32, sunPosition: vec3f, up: vec3f }",
    ),
    (
        "three.js Water without its mirror",
        "struct Uniforms { alpha: f32, size: f32, distortionScale: f32, sunColor: vec3f, sunDirection: vec3f, waterColor: vec3f }\nvar normals: texture_2d<f32>;",
    ),
];

#[test]
fn the_row_of_custom_values_holds_the_measured_effects() {
    let mut most = 0;
    for (effect, declarations) in EFFECTS {
        let source = format!("{declarations}\n{STRIPES}");
        let built = compile(&source).unwrap_or_else(|error| panic!("{effect}: {error}"));
        let floats = |ty: &str| match ty {
            "vec2f" => 2,
            "vec3f" => 3,
            "vec4f" => 4,
            _ => 1,
        };
        let uniforms = built
            .uniforms
            .iter()
            .map(|u| u.offset + floats(&u.ty))
            .max()
            .unwrap_or(0);
        // Uniforms take whole vec4f groups, and the textures' layers fill the row from its end.
        let used = uniforms.div_ceil(4) * 4 + built.textures.len() as u32;
        println!("{effect}: {used} of 32 floats");
        most = most.max(used);
    }
    assert!(most <= 20, "the largest effect takes {most} of 32 floats");
}
