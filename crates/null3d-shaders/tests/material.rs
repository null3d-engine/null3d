//! Custom materials built into the repository's template, as the Vite plugin builds them through
//! the shader compiler.

mod precision;

use std::path::Path;

use null3d_gpu::drawlist::{permutation, vertex};
use null3d_shaders::{
    BuildError, Compiler, Inputs, Manifest, MaterialOutput, MaterialSource, MaterialTemplate,
    Problem, Share,
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
    compile_share(source, None)
}

/// Builds the builds of a share of a custom material, or all of them without one.
fn compile_share(source: &str, share: Option<Share>) -> Result<MaterialOutput, BuildError> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let template = MaterialTemplate::load(&inputs).expect("the template of custom materials");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    compiler.compile_material(
        &template,
        &MaterialSource {
            path: PATH.to_owned(),
            source: source.to_owned(),
            share,
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
    let skinned = plain.iter().map(|name| format!("{name}_skin"));
    // Rows with row values never skin, so the builds that read them have no twin that skins.
    let rows = plain.iter().map(|name| format!("{name}_row_values"));
    // Every build that does not skin has a twin that fades its level of detail. A fading build
    // names its fade before the row values, in bit order.
    let fades = plain.iter().map(|name| format!("{name}_lod_fade"));
    let faded_rows = plain
        .iter()
        .map(|name| format!("{name}_lod_fade_row_values"));
    let mut expected: Vec<String> = plain
        .iter()
        .map(|&name| name.to_owned())
        .chain(skinned)
        .chain(rows)
        .chain(fades)
        .chain(faded_rows)
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
    assert_eq!(problem.variants.len(), 240, "{problem}");
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
    // 16 WebGPU builds and 32 WebGL2 builds, each with a twin that reads row values, one that
    // skins and, where it does not skin, one that fades its level of detail. Then the shadow
    // caster's builds: with and without the caster offset, each plain, with row values or skinned,
    // and on WebGL2 with and without the draw index. Then the motion builds, with and without row
    // values: one on WebGPU, and on WebGL2 with and without the draw index. Then the pick builds,
    // each plain, with row values or skinned, and on WebGL2 with and without the draw index.
    assert_eq!(built.variants.len(), 240 + 6 + 12 + 6 + 3 + 6);
    // A pick build moves each vertex by the offset, finds the instance's ids and writes them.
    let pick = &built.variants["webgpu_pick_pick"]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source;
    assert!(pick.contains("fn vertexOffset("), "{pick}");
    assert!(pick.contains("object_ranges"), "{pick}");
    assert!(pick.contains("-> @location(0) vec4<f32>"), "{pick}");
    let pick = &built.variants["webgl2_pick_draw_index_pick"]
        .glsl
        .as_ref()
        .expect("GLSL")["main"];
    // The id target stores the key's four bytes as a colour, so the fragment writes fractions.
    assert!(
        pick.fragment.source.contains("255"),
        "{}",
        pick.fragment.source
    );
    let caster = &built.variants["webgpu_shadow_caster_offset_row_values_caster"]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source;
    assert!(caster.contains("fn vertexOffset("), "{caster}");
    assert!(caster.contains("min("), "{caster}");
    let odd: Vec<&String> = built
        .variants
        .keys()
        .filter(|name| name.contains("_shadow_") && !name.ends_with("_caster"))
        .collect();
    assert!(odd.is_empty(), "{odd:?}");
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

/// A vertex offset that moves each vertex by its mesh's four-number record.
const RECORD: &str = "fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0, input.vertexRecord.y - input.position.y, 0.0);
}
";

#[test]
fn a_vertex_offset_that_reads_the_record_takes_the_record_attribute() {
    let built = compile(RECORD).expect("the record builds");
    assert_eq!(built.functions, ["vertexOffset"]);
    // The record is the vertex attribute at location 8, which a mesh with the record carries.
    assert_eq!(built.attributes & vertex::MORPH, vertex::MORPH);
    assert!(built.locations.contains(&8), "{:?}", built.locations);
    // A material that reads none of the record pays nothing for it.
    let plain = compile(WAVE).expect("the wave builds");
    assert_eq!(plain.attributes & vertex::MORPH, 0);
    assert!(!plain.locations.contains(&8), "{:?}", plain.locations);
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

/// A coverage function that the material's shadow caster tests, without a vertex offset.
const CARD: &str = "fn coverage(input: SurfaceInput) -> f32 {
    return 1.0 - input.uv.x;
}
";

#[test]
fn a_coverage_function_builds_its_shadow_casters_and_no_motion_or_pick_builds() {
    let built = compile(CARD).expect("the coverage function builds");
    assert_eq!(built.functions, ["coverage"]);
    // The caster draws a fragment stage that tests the coverage, in the twins that a masked
    // material picks and in the plain builds that another material does.
    let shadows: Vec<&String> = built
        .variants
        .keys()
        .filter(|name| name.contains("_shadow") && name.ends_with("_caster"))
        .collect();
    assert!(!shadows.is_empty(), "{:?}", built.variants.keys());
    assert!(
        shadows.iter().any(|name| name.contains("_alpha_mask")),
        "{shadows:?}"
    );
    assert!(
        !built
            .variants
            .keys()
            .any(|name| name.contains("_motion") || name.contains("_pick")),
        "a coverage function moves no vertex, so it has no motion or pick builds"
    );
    for name in &shadows {
        let variant = &built.variants[*name];
        // Only a masked material's caster tests its coverage, and only that build drops a pixel;
        // the other builds keep neither, so the appended function leaves their module.
        let tests = name.contains("_alpha_mask");
        if let Some(wgsl) = &variant.wgsl {
            assert_eq!(wgsl.source.contains("coverage("), tests, "{name}");
            assert_eq!(wgsl.source.contains("discard"), tests, "{name}");
        } else {
            // A WebGL2 build holds its programs, whose fragment stage carries the test.
            let programs = variant.glsl.as_ref().expect("a build of one path");
            for (pipeline, program) in programs {
                let fragment = &program.fragment.source;
                assert_eq!(fragment.contains("coverage("), tests, "{name} {pipeline}");
                assert_eq!(fragment.contains("discard"), tests, "{name} {pipeline}");
            }
        }
    }
    // The shading builds keep no test, so a card pays nothing for its shadow's shape where it
    // shades its surface.
    let shading = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(!shading.contains("if coverage("), "{shading}");
}

#[test]
fn a_coverage_function_with_the_wrong_signature_is_refused() {
    let source = "fn coverage(input: SurfaceInput) -> vec3f {\n    return vec3f(0.0);\n}\n";
    let problem = only_problem(source);
    assert_eq!(
        problem.message,
        "`coverage` does not have the signature that the engine calls. Declare it as `fn coverage(input: SurfaceInput) -> f32`."
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

/// A vertex offset and a surface function that read every input of custom materials.
const INPUTS: &str = "fn vertexOffset(input: VertexInput) -> vec3f {
    let lift = input.uv1.x + f32(input.instance) * 0.01 + f32(object.id % 7u) * 0.001;
    return input.normal * lift;
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let up = normalize(object.normalMatrix * vec3f(0.0, 1.0, 0.0));
    let origin = camera.projection * camera.view * object.worldMatrix * vec4f(0.0, 0.0, 0.0, 1.0);
    s.baseColor = vec3f(input.uv1, f32(input.instance & 1u)) * up.y;
    s.emissive = vec3f(input.fragCoord.xy / frame.resolution, origin.z) / (camera.far - camera.near);
    return s;
}
";

/// The highest location of a value that the vertex stage of a build passes to its fragment stage,
/// in the main builds' output or the motion builds'.
fn highest_location(wgsl: &str) -> u32 {
    let start = wgsl
        .find("struct VertexOut")
        .or_else(|| wgsl.find("struct MotionOut"))
        .expect("the template's VertexOut or MotionOut");
    let fields = &wgsl[start..start + wgsl[start..].find('}').expect("its end")];
    fields
        .split("@location(")
        .skip(1)
        .filter_map(|rest| rest.split(')').next()?.parse().ok())
        .max()
        .unwrap_or(0)
}

#[test]
fn inputs_that_cost_something_build_only_into_materials_that_read_them() {
    let built = compile(INPUTS).expect("the inputs build");
    assert!(built.object_ids);
    // The second texture coordinates come from location 3, which a mesh without them fills with
    // its first set, so a mesh needs no second set.
    assert_eq!(built.locations, [0, 1, 2, 3]);
    assert_eq!(built.attributes, null3d_gpu::drawlist::vertex::UV0);
    for (name, variant) in &built.variants {
        if let Some(wgsl) = &variant.wgsl {
            assert!(wgsl.source.contains("object_ranges"), "{name}");
            // Compatibility mode passes 15 values between the stages, and 14 into a fragment
            // shader that reads whether its face is the front one.
            // A pick build adds the key at the next location: its fragment reads the key and the
            // mask alone, so it passes fewer values than a shading build with the same defs.
            let limit = if name.contains("_pick") { 13 } else { 12 };
            assert!(highest_location(&wgsl.source) <= limit, "{name}");
        }
        for program in variant.glsl.iter().flat_map(|programs| programs.values()) {
            // The table is the vertex stage's uniform block at binding 8 of the frame's group.
            let blocks = &program.vertex.uniform_blocks;
            let found = blocks
                .iter()
                .any(|b| (b.binding.group, b.binding.binding) == (0, 8));
            assert!(found, "{name}: {blocks:?}");
        }
    }
    let shading = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(shading.contains("@group(0) @binding(17)"), "{shading}");
    assert!(shading.contains("@location(12)"), "{shading}");
    let caster = &built.variants["webgpu_shadow_caster"];
    let caster = &caster.wgsl.as_ref().expect("WGSL").source;
    assert!(caster.contains("object_ranges"), "{caster}");

    // A material that reads none of them builds none of their code.
    let plain = compile(STRIPES).expect("the surface function builds");
    assert!(!plain.object_ids);
    for variant in plain.variants.values() {
        let wgsl = variant.wgsl.as_ref().map_or("", |w| &*w.source);
        assert!(!wgsl.contains("object_ranges") && !wgsl.contains("world_x"));
    }
}

#[test]
fn reading_one_input_turns_on_only_its_own_code() {
    let reads = |body: &str| {
        let source = format!(
            "fn surface(input: SurfaceInput) -> Surface {{\n    var s = defaultSurface(input);\n    {body}\n    return s;\n}}\n"
        );
        let built = compile(&source).expect("the surface function builds");
        let wgsl = built.variants["webgpu"].wgsl.clone().expect("WGSL").source;
        (built.object_ids, built.locations, wgsl)
    };
    let (ids, locations, wgsl) = reads("s.roughness = input.uv1.y;");
    assert!(!ids && locations == [0, 1, 2, 3] && !wgsl.contains("world_x"));
    let (ids, locations, wgsl) = reads("s.roughness = f32(object.id & 1u);");
    assert!(ids && locations == [0, 1, 2] && !wgsl.contains("world_x"));
    let (ids, _, wgsl) = reads("s.roughness = object.worldMatrix[3].y;");
    assert!(!ids && wgsl.contains("world_x") && !wgsl.contains("object_ranges"));
    // The pixel's position and the camera's values cost nothing, so they need no code of their own.
    let (ids, locations, wgsl) = reads("s.roughness = input.fragCoord.z * camera.near;");
    assert!(!ids && locations == [0, 1, 2] && !wgsl.contains("object_ranges"));
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
        "@group(1) @binding(9)\nvar heightsSampler: sampler;",
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
    // WebGPU's skinned builds read the joint texture from the group after the maps'.
    let skin = &built.variants["webgpu_skin"]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source;
    assert!(skin.contains("@group(1) @binding(0)\nvar detail"), "{skin}");
    assert!(
        skin.contains("@group(2) @binding(0)\nvar joint_matrices"),
        "{skin}"
    );
}

#[test]
fn a_texture_array_builds_with_the_layer_that_the_shader_picks() {
    let source = "struct Uniforms { layer: i32 }

var facades: texture_2d_array<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor *= textureSampleLevel(facades, facadesSampler, input.uv, material.layer, 0.0).rgb;
    return s;
}
";
    let built = compile(source).expect("the texture array builds");
    let textures: Vec<(&str, bool)> = built
        .textures
        .iter()
        .map(|t| (t.name.as_str(), t.array))
        .collect();
    assert_eq!(textures, [("facades", true)]);
    let wgsl = &built.variants["webgpu"].wgsl.as_ref().expect("WGSL").source;
    assert!(
        wgsl.contains("@group(1) @binding(0)\nvar facades: texture_2d_array<f32>;"),
        "{wgsl}"
    );
    // The texture function keeps the layer that the shader names, and the engine's layer only
    // waits for the image: a call of a declared texture array gains no layer of its own.
    let call = wgsl
        .split("textureSampleLevel(facades, facadesSampler,")
        .nth(1)
        .expect("the shader's call survives the build");
    let arguments = &call[..call.find(')').expect("the call ends")];
    assert_eq!(
        arguments.matches(',').count(),
        2,
        "the call takes the coordinates and the shader's own layer, and no layer of the engine: {arguments}"
    );
    assert!(
        wgsl.contains("material.layer"),
        "the layer that the shader names comes from its uniform: {wgsl}"
    );
    assert!(wgsl.contains("custom_texture_layers[0]"), "{wgsl}");
    // WebGL2 samples the same array and layer through its own texture unit.
    let program = &built.variants["webgl2_draw_index"]
        .glsl
        .as_ref()
        .expect("GLSL")["main"];
    assert!(program.fragment.source.contains("sampler2DArray"));
    assert!(program.fragment.source.contains("textureLod("));
    assert!(program.fragment.source.contains("custom_texture_layers[0]"));
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

/// A material's uniforms and textures come from its source before any build, so every share of
/// its builds holds the same ones, and the test builds the smallest share: the first build and the
/// WebGPU builds without bits.
#[test]
fn the_row_of_custom_values_holds_the_measured_effects() {
    let mut most = 0;
    for (effect, declarations) in EFFECTS {
        let source = format!("{declarations}\n{STRIPES}");
        let smallest = Share {
            index: 0,
            count: u32::MAX,
        };
        let built = compile_share(&source, Some(smallest))
            .unwrap_or_else(|error| panic!("{effect}: {error}"));
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

/// A surface function that builds arrays from values that are not constants in each form that
/// WGSL allows: assigned, inside a struct, indexed in place, nested, and returned by a function.
const ARRAYS: &str = "struct Pair { colors: array<vec3f, 2>, weight: f32 }

fn pick(u: vec2f) -> array<vec3f, 2> {
    if u.x > 0.5 {
        return array<vec3f, 2>(u.xxx, u.yyy);
    }
    return array<vec3f, 2>(u.yyy, u.xxx);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    var a: array<vec3f, 3>;
    a = array<vec3f, 3>(input.uv.xxx, input.uv.yyy, vec3f(input.uv, 1.0));
    let pair = Pair(array<vec3f, 2>(input.uv.xxx, input.uv.yyy), 1.0);
    let picked = pick(input.uv);
    let i = u32(input.uv.x * 2.0);
    s.baseColor = a[i] + pair.colors[i] * pair.weight + picked[i];
    s.roughness = array<f32, 2>(input.uv.x, array<f32, 2>(input.uv.y, 0.5)[i])[i];
    return s;
}
";

#[test]
fn custom_materials_build_arrays_without_sized_array_types_in_glsl() {
    let built = compile(ARRAYS).expect("the surface function builds");
    let mut checked = 0;
    for (name, variant) in &built.variants {
        for program in variant.glsl.iter().flat_map(|programs| programs.values()) {
            checked += 1;
            for (stage, fragment) in [(&program.vertex, false), (&program.fragment, true)] {
                let mut breaks = precision::precision_breaks(&stage.source, fragment);
                breaks.extend(precision::newer_built_in_calls(&stage.source));
                assert!(breaks.is_empty(), "{name}: {breaks:#?}\n{}", stage.source);
            }
        }
    }
    assert!(checked > 30, "only {checked} GLSL programs were built");
}

/// A surface function with an array of arrays, which WGSL allows and GLSL ES 3.00 does not.
const NESTED_ARRAYS: &str = "fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let row = array<f32, 2>(input.uv.x, 0.5);
    let grid = array<array<f32, 2>, 2>(row, row);
    s.roughness = grid[u32(input.uv.x * 2.0)][u32(input.uv.y * 2.0)];
    return s;
}
";

#[test]
fn a_glsl_refusal_of_the_materials_own_form_is_not_blamed_on_the_template() {
    let error = compile(NESTED_ARRAYS).expect_err("GLSL ES 3.00 has no arrays of arrays");
    assert!(!error.problems.is_empty());
    for problem in &error.problems {
        assert!(
            !problem.message.contains("engine's standard material"),
            "{}",
            problem.message
        );
    }
}

#[test]
fn shares_of_a_material_hold_every_build_once_and_the_vertex_inputs_each() {
    for source in [STRIPES, FULL] {
        let whole = compile(source).expect("the material builds");
        let count = 3;
        let mut joined = std::collections::BTreeMap::new();
        for index in 0..count {
            let share =
                compile_share(source, Some(Share { index, count })).expect("the share builds");
            assert!(share.variants.len() < whole.variants.len());
            assert_eq!(share.locations, whole.locations);
            assert_eq!(share.attributes, whole.attributes);
            assert_eq!(share.uniforms, whole.uniforms);
            for (name, variant) in share.variants {
                let first = joined.insert(name.clone(), variant.clone());
                // Only the WebGPU builds without bits, which give the vertex inputs, repeat.
                assert!(first.is_none() || variant.permutation == 0, "{name}");
            }
        }
        assert_eq!(joined, whole.variants);
    }
}

#[test]
fn a_share_past_its_count_is_refused() {
    let error = compile_share(STRIPES, Some(Share { index: 2, count: 2 }))
        .expect_err("share 2 of 2 does not exist");
    assert!(error.problems[0].message.contains("share 2 of 2"));
}

/// A surface function that reads the copy of the scene's depth, with a vertex offset, so the
/// build also makes its caster, motion and pick variants.
const DEPTH: &str = "fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.fragCoord.xy / frame.resolution;
    s.roughness = clamp(sceneDistance(uv) * 0.1, 0.0, 1.0);
    return s;
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0);
}
";

#[test]
fn a_surface_function_that_reads_the_depth_binds_its_copy_alone_in_the_shading_builds() {
    let built = compile(DEPTH).expect("the surface function builds");
    assert!(built.scene_depth);
    let mut shaded = 0;
    for (name, variant) in &built.variants {
        // A vertex offset's caster, motion and pick builds name their kind right after the shading
        // variant's name, and their permutations follow it.
        let kind = name
            .strip_prefix("webgpu_")
            .or_else(|| name.strip_prefix("webgl2_"))
            .unwrap_or_default();
        let culled = ["shadow", "motion", "pick"]
            .iter()
            .any(|culled| kind.starts_with(culled));
        // The shading builds that write WGSL hold the binding, and the builds that shade no surface
        // lose it on both paths.
        if let Some(wgsl) = &variant.wgsl {
            if culled {
                assert!(!wgsl.source.contains("scene_depth_copy"), "{name}");
            } else {
                assert!(wgsl.source.contains("scene_depth_copy"), "{name}");
                shaded += 1;
            }
        }
        if let Some(programs) = &variant.glsl {
            for program in programs.values() {
                if culled {
                    assert!(
                        !program.fragment.source.contains("scene_depth_copy"),
                        "{name}"
                    );
                }
            }
        }
    }
    assert!(shaded > 0);
    assert!(!compile(STRIPES).expect("the material builds").scene_depth);
}

/// A material whose own lobe adds part of the base specular for the main light, from the four
/// values that its surface function passes.
const SPARKLE: &str = "fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.lobe = vec4f(0.5, 0.25, 2.0, 0.75);
    return s;
}

fn lobe(input: LobeInput) -> vec3f {
    return input.specular * input.values.z;
}
";

/// A leaf card: a vertex offset that reads the mesh's vertex color as wind data, and a surface that
/// cuts a leaf from the card's middle.
const LEAF: &str = "fn vertexOffset(input: VertexInput) -> vec3f {
    let sway = sin(frame.time * 2.0 + input.colors.g * 6.2831853) * input.colors.r;
    return vec3f(sway * 0.2, 0.0, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = step(length(input.uv - vec2f(0.5)), 0.5);
    return s;
}
";

#[test]
fn a_lobe_function_builds_into_every_variant_with_the_surface_values() {
    let built = compile(SPARKLE).expect("the material with a lobe builds");
    assert_eq!(built.functions, ["surface", "lobe"]);
    let mut builds = 0;
    for (name, variant) in &built.variants {
        // The custom WGSL joins the template before its variants are built, so the lobe's body is
        // in the caster, motion and pick builds too, and each must compile with it.
        if let Some(wgsl) = &variant.wgsl {
            assert!(wgsl.source.contains("fn lobe("), "{name}");
            builds += 1;
        }
    }
    assert!(builds > 0);
}

/// The number of times a WebGPU build calls the material's lobe. Every call builds the lobe's
/// input record, and the declaration names the record's type without a construction.
fn lobe_calls(source: &str) -> usize {
    source.matches("lobe(LobeInput(").count()
}

/// The number of times a WebGL2 build calls the material's lobe. That path passes the record as one
/// parameter for each of its fields, so a call reads as an assignment to the lobe's function, where
/// the declaration reads its return type before the name.
fn glsl_lobe_calls(source: &str) -> usize {
    source.matches("= lobe(").count()
}

/// What a source says about the lobe, for a failed count: each line that names it.
fn summary(source: &str) -> String {
    let lines: Vec<&str> = source
        .lines()
        .filter(|line| line.contains("lobe"))
        .map(str::trim)
        .collect();
    format!("{} lobe lines: {}", lines.len(), lines.join(" | "))
}

#[test]
fn a_material_with_a_lobe_answers_the_sun_and_every_point_and_spot_light_on_both_paths() {
    let built = compile(SPARKLE).expect("the material with a lobe builds");
    for name in ["webgpu", "webgl2"] {
        let variant = &built.variants[name];
        // The shading build calls the lobe once for the sun and once for the lights of the
        // surface's cluster.
        let mut shading = 0;
        if let Some(wgsl) = &variant.wgsl {
            assert_eq!(
                lobe_calls(&wgsl.source),
                2,
                "{name}: {}",
                summary(&wgsl.source)
            );
            shading += 1;
        }
        if let Some(programs) = &variant.glsl {
            for (program, build) in programs {
                assert_eq!(
                    glsl_lobe_calls(&build.fragment.source),
                    2,
                    "{name} {program}: {}",
                    summary(&build.fragment.source)
                );
                shading += 1;
            }
        }
        assert!(shading > 0, "{name}");
    }
    // A material that declares no lobe keeps the library's clustered loop, so it pays nothing.
    let plain = compile(STRIPES).expect("the material without a lobe builds");
    for variant in plain.variants.values() {
        if let Some(wgsl) = &variant.wgsl {
            assert!(!wgsl.source.contains("clustered_lobed_light"));
        }
    }
}

#[test]
fn a_lobe_with_another_signature_is_refused_at_its_name() {
    let problem = only_problem("fn lobe(input: SurfaceInput) -> vec3f { return vec3f(0.0); }");
    assert!(
        problem
            .message
            .contains("`lobe` does not have the signature that the engine calls"),
        "{problem}"
    );
    assert!(
        problem
            .message
            .contains("Declare it as `fn lobe(input: LobeInput) -> vec3f`."),
        "{problem}"
    );
}

/// The car-paint add-on's WGSL, as the repository ships it.
const CAR_PAINT: &str = include_str!("../../../examples/addons/car-paint/paint.wgsl");

#[test]
fn the_car_paints_glint_model_builds_on_both_paths() {
    let built = compile(CAR_PAINT).expect("the car paint builds");
    assert_eq!(built.functions, ["surface", "lobe"]);
    assert!(built.variants["webgpu"].wgsl.is_some());
    assert!(built.variants["webgl2"].glsl.is_some());
}

/// A surface function that samples a texture and reads the copy of the scene's depth, with a
/// vertex offset, so the build also makes its caster, motion and pick variants.
const DEEP_TEXTURED: &str = "var foam: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.fragCoord.xy / frame.resolution;
    s.baseColor *= textureSample(foam, foamSampler, input.uv).rgb;
    s.alpha = clamp(sceneDistance(uv) * 0.1, 0.0, 1.0);
    return s;
}
";

/// A material with both its own textures and the scene's depth binds three groups of its own, so
/// the joint texture of its SKIN builds sits after them. Its caster, motion and pick builds shade
/// no surface and drop the depth's group, so the joint texture follows the maps' group alone.
#[test]
fn textures_beside_the_scene_depth_push_the_joint_texture_after_both_groups() {
    let built = compile(DEEP_TEXTURED).expect("the textured material that reads the depth builds");
    assert!(built.scene_depth);
    let mut seen = 0;
    for (name, variant) in &built.variants {
        if !name.starts_with("webgpu_") {
            continue;
        }
        let Some(wgsl) = &variant.wgsl else { continue };
        if !wgsl.source.contains("joint_matrices") {
            continue;
        }
        seen += 1;
        let kind = name.strip_prefix("webgpu_").unwrap_or_default();
        let culled = ["shadow", "motion", "pick"]
            .iter()
            .any(|culled| kind.starts_with(culled));
        if culled {
            assert!(
                wgsl.source
                    .contains("@group(2) @binding(0)\nvar joint_matrices"),
                "{name}"
            );
        } else {
            assert!(
                wgsl.source
                    .contains("@group(3) @binding(0)\nvar joint_matrices"),
                "{name}"
            );
            assert!(
                wgsl.source
                    .contains("@group(2) @binding(0)\nvar scene_depth_copy"),
                "{name}"
            );
            assert!(
                wgsl.source.contains("@group(1) @binding(0)\nvar foam"),
                "{name}"
            );
        }
    }
    assert!(seen > 0, "some build skins the mesh");
}

/// A custom material reads its instances from the copies that the culling shader writes, so its
/// builds leave out the instance-index permutation that the template offers. That build would bind
/// a group of its own, which is the fifth that WebGPU's default of four does not allow (D-23).
#[test]
fn a_custom_material_leaves_out_the_instance_index_build() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let manifest = Manifest::parse(&inputs.manifest).expect("the shader manifest");
    let template = manifest
        .shaders
        .values()
        .find(|shader| shader.custom_materials)
        .expect("the template that custom materials build with");
    assert!(
        template.variants.values().any(|variant| variant
            .permutations
            .iter()
            .any(|name| name == "INSTANCE_INDEX")),
        "the template offers the instance-index build, so this test has one to see dropped"
    );

    let built = compile(DEEP_TEXTURED).expect("the material builds");
    assert!(
        built
            .variants
            .values()
            .any(|variant| variant.permutation & permutation::SKIN != 0),
        "the builds keep their other permutation bits"
    );
    for (name, variant) in &built.variants {
        assert_eq!(
            variant.permutation & permutation::INSTANCE_INDEX,
            0,
            "{name}: a custom material reads its instances from the culling shader's copies, so it \
             takes no build that reads them by index"
        );
    }
}

#[test]
fn a_material_that_sets_the_surface_alpha_cuts_its_shape_its_shadow_and_its_motion() {
    let built = compile(LEAF).expect("the masked leaf builds");
    assert!(built.alpha);
    // The vertex offset reads the mesh's vertex color, so the material needs that attribute.
    assert!(built.locations.contains(&5), "{:?}", built.locations);
    let names: Vec<&String> = built.variants.keys().collect();
    let has = |needle: &str| names.iter().any(|name| name.contains(needle));
    // The builds that cut the material's own shape, which load with the material.
    assert!(has("alpha_coverage"), "{names:?}");
    assert!(has("sample_mask"), "{names:?}");
    assert!(has("alpha_hash"), "{names:?}");
    assert!(has("lod_fade"), "{names:?}");
    // Its shadow caster and its motion build test that alpha in a fragment stage.
    let caster = names
        .iter()
        .find(|name| {
            name.starts_with("webgpu_shadow")
                && name.contains("alpha_mask")
                && name.ends_with("caster")
        })
        .copied()
        .unwrap_or_else(|| panic!("no masked caster among {names:?}"));
    let caster = built.variants[caster]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source
        .clone();
    assert!(caster.contains("fn surface("), "{caster}");
    assert!(caster.contains("discard"), "{caster}");
    let motion = names
        .iter()
        .find(|name| name.starts_with("webgpu_motion") && name.contains("alpha_mask"))
        .copied()
        .unwrap_or_else(|| panic!("no masked motion among {names:?}"));
    let motion = built.variants[motion]
        .wgsl
        .as_ref()
        .expect("WGSL")
        .source
        .clone();
    assert!(motion.contains("fn surface("), "{motion}");
    assert!(motion.contains("discard"), "{motion}");
    // WGSL that never names the alpha keeps its builds as few as before: no coverage and no hash,
    // and a caster that writes its whole shape.
    let plain = compile(STRIPES).expect("the plain surface builds");
    assert!(!plain.alpha);
    let names: Vec<&String> = plain.variants.keys().collect();
    assert!(
        !names.iter().any(|name| name.contains("alpha_coverage")),
        "{names:?}"
    );
    assert!(
        !names.iter().any(|name| name.contains("alpha_hash")),
        "{names:?}"
    );
    assert!(
        names.iter().any(|name| name.contains("lod_fade")),
        "{names:?}"
    );
}

/// A material that sets its diffuse transmission and reads the instance's index: a fading level
/// then carries the diffuse transmission, the object ids and the level fade in one build, which
/// used to write the object's scale and the fade value at the same vertex location.
const TRANSLUCENT_INSTANCES: &str = "fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.diffuseTransmission = 0.5;
    s.baseColor.r += f32(input.instance) * 0.0;
    return s;
}
";

#[test]
fn a_translucent_material_that_reads_its_instance_builds_its_fading_levels() {
    let built = compile(TRANSLUCENT_INSTANCES).expect("the translucent material builds");
    let fades = built
        .variants
        .iter()
        .filter(|(_, variant)| variant.permutation & permutation::LOD_FADE != 0)
        .count();
    assert!(fades > 0, "a custom material's builds fade their levels");
    // The one build that holds the diffuse transmission, the object ids and the fade.
    let both: Vec<&String> = built
        .variants
        .iter()
        .filter(|(_, variant)| {
            let bits = variant.permutation;
            bits & permutation::TRANSLUCENCY != 0 && bits & permutation::LOD_FADE != 0
        })
        .map(|(name, _)| name)
        .collect();
    assert!(!both.is_empty(), "the translucent fading build is made");
}

/// A material that declares both shadow hooks: the coverage function that the caster tests, and the
/// surface alpha that the motion build tests.
const BOTH_HOOKS: &str = "fn coverage(input: SurfaceInput) -> f32 {
    return 1.0;
}

fn vertexOffset(input: VertexInput) -> vec3f {
    return vec3f(0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.alpha = 0.5;
    return s;
}
";

#[test]
fn a_material_with_both_hooks_cuts_its_shadow_by_coverage_and_its_motion_by_alpha() {
    let built = compile(BOTH_HOOKS).expect("the material with both hooks builds");
    let masked = |prefix: &str| {
        built
            .variants
            .iter()
            .find(|(name, variant)| {
                name.starts_with(prefix)
                    && name.contains("alpha_mask")
                    && variant.permutation & permutation::ALPHA_MASK != 0
            })
            .map(|(name, _)| name.clone())
            .unwrap_or_else(|| panic!("no masked {prefix} build among {:?}", built.variants.keys()))
    };
    let source = |name: &str| {
        built.variants[name]
            .wgsl
            .as_ref()
            .expect("WGSL")
            .source
            .clone()
    };
    // The caster cuts by the coverage function, which reads the light's view, and not by the
    // surface's alpha. A call reads `= coverage(args)` in the compiled module; the definition alone
    // is `fn coverage(`.
    let caster = source(&masked("webgpu_shadow"));
    assert!(caster.contains("= coverage("), "{caster}");
    assert!(!caster.contains("surface("), "{caster}");
    // The motion build cuts by the surface's alpha, since the motion pass has no light to give a
    // coverage function.
    let motion = source(&masked("webgpu_motion"));
    assert!(motion.contains("surface("), "{motion}");
    assert!(!motion.contains("coverage("), "{motion}");
}

/// A material that declares every hook and every input, so the compiler makes every permutation of
/// the custom template that its filters keep, including the ones that carry object matrices, ids and
/// the level fade together.
const EVERY_HOOK: &str = "fn vertexOffset(input: VertexInput) -> vec3f {
    let n = f32(input.instance) + input.colors.r + input.uv1.x + input.vertexRecord.x;
    return vec3f(0.0, n * 0.0, 0.0);
}

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor += object.worldMatrix[3].xyz * 0.0;
    s.baseColor.r += f32(object.id) * 0.0 + f32(input.instance) * 0.0;
    s.alpha = 1.0;
    s.transmission = 0.0;
    s.thickness = 0.0;
    s.diffuseTransmission = 0.0;
    s.diffuseTransmissionColor = vec3f(0.0);
    s.clearcoat = 0.0;
    s.sheenColor = vec3f(0.0);
    return s;
}
";

#[test]
fn every_buildable_permutation_of_a_full_custom_material_builds() {
    use std::collections::BTreeSet;

    // A full material compiles every build that the template offers and the compiler keeps. A
    // collision of two vertex outputs fails this, whichever features cause it.
    let built = compile(EVERY_HOOK).expect("the full custom material builds every variant");
    let words: BTreeSet<u32> = built.variants.values().map(|v| v.permutation).collect();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let manifest = Manifest::parse(&inputs.manifest).expect("the shader manifest");
    let template = manifest
        .shaders
        .values()
        .find(|shader| shader.custom_materials)
        .expect("the template that custom materials build with");
    let bit = |name: &str| {
        permutation::NAMES
            .iter()
            .find(|(known, _)| *known == name)
            .map(|(_, bit)| *bit)
            .unwrap_or_else(|| panic!("the manifest names {name}, which is no permutation bit"))
    };
    // The bits the compiler leaves out of every custom material's builds.
    let left_out: u32 = ["HALF", "MORPH", "INSTANCE_INDEX", "WEIGHTED", "AREA_LIGHTS"]
        .iter()
        .fold(0, |word, name| word | bit(name));
    let mut expected = 0usize;
    let mut not_builds = 0usize;
    for (name, variant) in &template.variants {
        // The compiler keeps out the variants that a pass's own bit marks as the engine's: no
        // custom material's word sets that bit.
        if !variant.required.is_empty() {
            continue;
        }
        // The compiler drops the left-out bits from the variant's list before it expands the rest,
        // so the free bits are the list without them.
        let free: Vec<u32> = variant
            .permutations
            .iter()
            .map(|name| bit(name))
            .filter(|bit| left_out & bit == 0)
            .collect();
        let required: u32 = variant
            .required
            .iter()
            .fold(0, |word, name| word | bit(name));
        for combination in 0..(1u32 << free.len()) {
            let mut word = required;
            for (k, bit) in free.iter().enumerate() {
                if combination & (1 << k) != 0 {
                    word |= bit;
                }
            }
            if !permutation::buildable(word) {
                not_builds += 1;
                continue;
            }
            expected += 1;
            assert!(
                words.contains(&word),
                "{name}: the buildable permutation {word:#x} is not built. The built permutations are {words:#x?}"
            );
        }
    }
    assert!(expected > 0, "the template offers no buildable permutation");
    assert!(
        not_builds > 0,
        "the template expands no combination that is no build"
    );
    // Each bit the compiler leaves out is proven absent from every build. The message says whether
    // the template offered it: an offered bit tests the compiler's filter, and one the template does
    // not offer tests the template's own exclusion. A bit the compiler starts to keep would appear
    // in a build and fail here.
    for name in ["HALF", "MORPH", "INSTANCE_INDEX", "WEIGHTED", "AREA_LIGHTS"] {
        let value = bit(name);
        let offered = template
            .variants
            .values()
            .any(|variant| variant.permutations.iter().any(|known| known == name));
        assert!(
            words.iter().all(|word| word & value == 0),
            "{name} is carried by a build, and the compiler leaves it out of every custom material"
        );
        eprintln!("{name}: offered by the template {offered}, carried by a build false");
    }
    // The custom template's definitions carry no vertex tangent and no displacement: both come with
    // MAPS, which a custom material has not. So no custom build writes a tangent at 5 or 6 where
    // the object matrix's rows sit, and none writes a displacement height at 12 where the instance
    // ids sit. The map's two other unguarded pairs are therefore unreachable for a custom material,
    // and this test says so rather than leaving them out.
    for name in ["VERTEX_TANGENT", "DISPLACEMENT"] {
        let value = bit(name);
        let offered = template
            .variants
            .values()
            .any(|variant| variant.permutations.iter().any(|known| known == name));
        assert!(
            !offered,
            "the custom template offers {name}, so a custom build could meet the object matrix rows or the instance ids"
        );
        assert!(
            words.iter().all(|word| word & value == 0),
            "a custom build carries {name}"
        );
    }
}

/// The vegetation add-on's plant shaders build into every variant of the standard template: the
/// leaf and bark material's surface and wind offset, and the leaf card's, which adds the level
/// morph. The repository's own content depends on them, so a change to the template or the library
/// that breaks one fails here before a page builds.
#[test]
fn the_vegetation_plant_shaders_build() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for name in ["plant.wgsl", "plant-cards.wgsl"] {
        let source = std::fs::read_to_string(root.join("packages/vegetation/src").join(name))
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let built = compile(&source).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert!(built.functions.iter().any(|f| f == "surface"), "{name}");
        assert!(
            built.functions.iter().any(|f| f == "vertexOffset"),
            "{name}"
        );
        assert!(
            built
                .variants
                .values()
                .any(|variant| variant.permutation & permutation::TRANSLUCENCY != 0),
            "{name} names the light through a leaf, so its builds let light through"
        );
    }
}

/// A surface that names its own normal for the diffuse light, as a crown of leaves does.
const CROWN_LIT: &str = "fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.diffuseNormal = normalize(input.normal + vec3f(0.0, 0.1, 0.0));
    return s;
}
";

#[test]
fn the_diffuse_normal_reaches_only_the_builds_that_name_it() {
    // A material that names the field lights its diffuse and ambient by it. The template's split
    // appears in every one of its builds, and a material that never names the field keeps the
    // template's single-normal path unchanged.
    let named = compile(CROWN_LIT).expect("the surface with a normal of its own builds");
    let mut wgsl = named
        .variants
        .values()
        .filter_map(|variant| variant.wgsl.as_ref());
    assert!(wgsl.all(|build| build.source.contains("dot(diffuse_normal, to_sun)")));
    let plain = compile(STRIPES).expect("the plain surface builds");
    let mut wgsl = plain
        .variants
        .values()
        .filter_map(|variant| variant.wgsl.as_ref());
    assert!(wgsl.all(
        |build| !build.source.contains("dot(diffuse_normal, to_sun)")
            && !build.source.contains("ambient_light(diffuse_normal)")
    ));
}
