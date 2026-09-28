//! The shader build, tested on small shaders held in memory.

mod common;

use common::{SHADER, assert_feature, build_wgsl, only_problem, project, wgsl};
use null3d_shaders::{
    ALLOWED_LANGUAGE_FEATURES, Binding, GlslTexture, GlslUniformBlock, Inputs, build, typescript,
};

/// A vertex and fragment pair with a flat varying, a uniform block per stage, a data texture read
/// in the vertex stage and a sampled texture in the fragment stage.
const MESH: &str = r"#import null3d::math

struct Camera { view_projection: mat4x4f, }
struct Material { tint: vec4f, }

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var instance_data: texture_2d<f32>;
@group(1) @binding(2) var base_color: texture_2d<f32>;
@group(1) @binding(3) var base_sampler: sampler;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat, either) id: u32,
}

@vertex
fn vs_main(@location(0) position: vec3f, @builtin(instance_index) instance: u32) -> VertexOut {
    let offset = textureLoad(instance_data, vec2u(0u, instance), 0).xyz;
    var out: VertexOut;
    out.position = camera.view_projection * vec4f(position + offset, 1.0);
    out.uv = position.xy;
    out.id = instance;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    let color = textureSample(base_color, base_sampler, in.uv);
    return color * material.tint * null3d::math::square(f32(in.id));
}
";

const BOTH_TARGETS: &str = "{ targets = [\"wgsl\", \"glsl\"] }";

#[test]
fn composition_through_the_math_import_works_with_and_without_a_shader_def() {
    let source = r"#import null3d::math

@fragment
fn fs_main() -> @location(0) vec4f {
#ifdef BRIGHT
    return vec4f(null3d::math::square(0.75));
#else
    return vec4f(0.25);
#endif
}
";
    let variants = [
        ("plain", "{ targets = [\"wgsl\"] }"),
        ("bright", "{ defs = [\"BRIGHT\"], targets = [\"wgsl\"] }"),
    ];
    let output = build(&project(source, &variants, &[])).unwrap();
    let plain = wgsl(&output, "plain");
    let bright = wgsl(&output, "bright");
    assert!(plain.contains("0.25f"), "{plain}");
    assert!(!plain.contains("fn square"), "{plain}");
    assert!(bright.contains("fn square(x: f32) -> f32"), "{bright}");
    assert!(bright.contains("square(0.75f)"), "{bright}");
    assert!(!bright.contains("naga_oil"), "{bright}");
}

#[test]
fn library_modules_can_import_each_other_and_shared_names_stay_apart() {
    let source = r"#import null3d::a
#import null3d::b

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(null3d::a::helper() + null3d::b::helper());
}
";
    let library = [
        (
            "a.wgsl",
            "#define_import_path null3d::a\n#import null3d::math\nfn helper() -> f32 { return null3d::math::square(2.0); }\n",
        ),
        (
            "b.wgsl",
            "#define_import_path null3d::b\nfn helper() -> f32 { return 3.0; }\n",
        ),
    ];
    let output = build(&project(
        source,
        &[("v", "{ targets = [\"wgsl\"] }")],
        &library,
    ))
    .unwrap();
    let text = wgsl(&output, "v");
    assert!(text.contains("fn helper_null3d_a() -> f32"), "{text}");
    assert!(text.contains("fn helper_null3d_b() -> f32"), "{text}");
    assert!(text.contains("fn square(x: f32) -> f32"), "{text}");
}

#[test]
fn a_requires_directive_for_any_other_feature_fails_naming_it() {
    let source = "requires pointer_composite_access, swizzle_assignment;\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return vec4f(1.0);\n}\n";
    assert_feature(build_wgsl(source), "swizzle_assignment", 1);
    let unknown = source.replace("swizzle_assignment", "buffer_view");
    assert_feature(build_wgsl(&unknown), "buffer_view", 1);
}

#[test]
fn the_three_allowed_features_pass() {
    assert_eq!(
        ALLOWED_LANGUAGE_FEATURES,
        [
            "packed_4x8_integer_dot_product",
            "pointer_composite_access",
            "readonly_and_readwrite_storage_textures",
        ]
    );
    let source = r"requires packed_4x8_integer_dot_product, pointer_composite_access, readonly_and_readwrite_storage_textures;

struct Counts { total: u32, }

@group(0) @binding(0) var image: texture_storage_2d<r32float, read_write>;
@group(0) @binding(1) var input: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(2) var<storage, read_write> counts: Counts;

fn add(p: ptr<function, Counts>, value: u32) {
    p.total += value;
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    let texel = textureLoad(input, id.xy);
    textureStore(image, id.xy, textureLoad(image, id.xy) + texel);
    var local = Counts(0u);
    add(&local, dot4U8Packed(pack4xU8(vec4u(1u, 2u, 3u, 4u)), 0x01010101u));
    counts.total = local.total;
}
";
    let output = build_wgsl(source).unwrap();
    let text = wgsl(&output, "v");
    assert!(text.contains("dot4U8Packed"), "{text}");
    assert!(
        text.contains("r32float") && text.contains("read_write"),
        "{text}"
    );
}

#[test]
fn swizzle_assignment_is_rejected() {
    let source = "@fragment\nfn fs_main() -> @location(0) vec4f {\n    var color = vec4f(0.0);\n    color.rgb *= 2.0;\n    return color;\n}\n";
    assert_feature(build_wgsl(source), "swizzle_assignment", 4);
}

#[test]
fn a_struct_member_named_like_a_swizzle_can_be_assigned() {
    let source = "struct Pair { xy: f32, }\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    var pair: Pair;\n    pair.xy = 2.0;\n    return vec4f(pair.xy);\n}\n";
    assert!(build_wgsl(source).is_ok());
}

#[test]
fn a_let_holding_a_texture_or_a_sampler_is_rejected() {
    let source = r"@group(0) @binding(0) var base_color: texture_2d<f32>;
@group(0) @binding(1) var base_sampler: sampler;

@fragment
fn fs_main() -> @location(0) vec4f {
    let tex = base_color;
    return textureSample(tex, base_sampler, vec2f(0.5));
}
";
    assert_feature(build_wgsl(source), "texture_and_sampler_let", 6);
    let sampler = source
        .replace("let tex = base_color;", "let copy = base_sampler;")
        .replace(
            "textureSample(tex, base_sampler",
            "textureSample(base_color, copy",
        );
    assert_feature(build_wgsl(&sampler), "texture_and_sampler_let", 6);
}

#[test]
fn a_let_holding_a_texture_parameter_is_rejected_in_a_helper() {
    let source = r"@group(0) @binding(0) var data: texture_2d<f32>;

fn first(t: texture_2d<f32>) -> vec4f {
    let copy = t;
    return textureLoad(copy, vec2i(0), 0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return first(data);
}
";
    assert_feature(build_wgsl(source), "texture_and_sampler_let", 4);
}

#[test]
fn a_pointer_parameter_into_storage_memory_is_rejected() {
    let source = r"@group(0) @binding(0) var<storage, read_write> values: array<f32>;

fn clear(
    dest: ptr<storage, array<f32>, read_write>,
) {
    dest[0] = 0.0;
}

@compute @workgroup_size(1)
fn cs_main() {
    clear(&values);
}
";
    assert_feature(build_wgsl(source), "unrestricted_pointer_parameters", 4);
}

#[test]
fn a_pointer_parameter_into_workgroup_memory_is_rejected() {
    let source = r"var<workgroup> shared_values: array<f32, 64>;

fn clear(dest: ptr<workgroup, array<f32, 64>>) {
    dest[0] = 0.0;
}

@compute @workgroup_size(64)
fn cs_main() {
    clear(&shared_values);
}
";
    assert_feature(build_wgsl(source), "unrestricted_pointer_parameters", 3);
}

#[test]
fn a_pointer_to_part_of_a_variable_as_an_argument_is_rejected() {
    let source = r"struct Pair { a: f32, b: f32, }

fn set_one(p: ptr<function, f32>) {
    *p = 1.0;
}

@fragment
fn fs_main() -> @location(0) vec4f {
    var pair: Pair;
    var whole = 0.0;
    set_one(&whole);
    set_one(&pair.b);
    return vec4f(pair.b + whole);
}
";
    assert_feature(build_wgsl(source), "unrestricted_pointer_parameters", 12);
}

#[test]
fn a_uniform_buffer_with_the_storage_layout_is_rejected() {
    let source = r"struct Weights { values: array<f32, 4>, }

@group(0) @binding(0)
var<uniform> weights: Weights;

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(weights.values[0]);
}
";
    assert_feature(build_wgsl(source), "uniform_buffer_standard_layout", 4);
}

#[test]
fn the_immediate_address_space_is_rejected() {
    let source = "var<immediate> tint: vec4f;\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return tint;\n}\n";
    assert_feature(build_wgsl(source), "immediate_address_space", 1);
}

#[test]
fn linear_indexing_built_ins_are_rejected() {
    let source = "@compute @workgroup_size(64)\nfn cs_main(\n    @builtin(global_invocation_index) index: u32,\n) {\n}\n";
    assert_feature(build_wgsl(source), "linear_indexing", 3);
}

#[test]
fn subgroup_id_built_ins_are_rejected() {
    let source = "@compute @workgroup_size(64)\nfn cs_main(@builtin(subgroup_id) id: u32) {\n}\n";
    assert_feature(build_wgsl(source), "subgroup_id", 2);
}

#[test]
fn a_depth_mode_on_frag_depth_is_rejected() {
    let source =
        "@fragment\nfn fs_main() -> @builtin(frag_depth, less) f32 {\n    return 0.5;\n}\n";
    assert_feature(build_wgsl(source), "fragment_depth", 2);
}

#[test]
fn buffer_views_are_rejected() {
    let source = "@group(0) @binding(0) var<storage, read_write> bytes: buffer<64>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n}\n";
    assert_feature(build_wgsl(source), "buffer_view", 1);
}

#[test]
fn tier1_storage_texel_formats_are_rejected() {
    let source = "@group(0) @binding(0) var mask: texture_storage_2d<r8unorm, write>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n    textureStore(mask, vec2i(0), vec4f(1.0));\n}\n";
    assert_feature(build_wgsl(source), "texture_formats_tier1", 1);
}

#[test]
fn vec2u_atomic_store_min_and_max_are_rejected() {
    let source = "@group(0) @binding(0) var<storage, read_write> depth: atomic<vec2<u32>>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n    atomicStoreMin(&depth, vec2u(1u, 2u));\n}\n";
    assert_feature(build_wgsl(source), "atomic_vec2u_min_max", 5);
}

#[test]
fn features_in_a_library_module_name_the_module_file() {
    let library = [(
        "swizzle.wgsl",
        "#define_import_path null3d::swizzle\n\nfn widen(v: vec4f) -> vec4f {\n    var out = v;\n    out.xy = vec2f(1.0);\n    return out;\n}\n",
    )];
    let source = "#import null3d::swizzle\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return null3d::swizzle::widen(vec4f(0.0));\n}\n";
    let result = build(&project(
        source,
        &[("v", "{ targets = [\"wgsl\"] }")],
        &library,
    ));
    let problem = only_problem(result);
    assert_eq!(problem.feature.as_deref(), Some("swizzle_assignment"));
    assert_eq!(
        problem.file.as_deref(),
        Some("crates/null3d-shaders/wgsl/lib/swizzle.wgsl")
    );
    assert_eq!(problem.line, Some(5));
    assert_eq!(problem.variants, ["shader.v"]);
}

#[test]
fn code_behind_an_unset_shader_def_is_not_checked() {
    let source = "@fragment\nfn fs_main() -> @location(0) vec4f {\n    var color = vec4f(0.0);\n#ifdef SWIZZLE\n    color.xy = vec2f(1.0);\n#endif\n    return color;\n}\n";
    let variants = [
        ("plain", "{ targets = [\"wgsl\"] }"),
        ("swizzle", "{ defs = [\"SWIZZLE\"], targets = [\"wgsl\"] }"),
    ];
    let problem = only_problem(build(&project(source, &variants, &[])));
    assert_eq!(problem.feature.as_deref(), Some("swizzle_assignment"));
    assert_eq!(problem.line, Some(5));
    assert_eq!(problem.variants, ["shader.swizzle"]);
}

#[test]
fn flat_either_interpolation_passes_validation_and_reaches_both_outputs() {
    let output = build(&project(MESH, &[("v", BOTH_TARGETS)], &[])).unwrap();
    let variant = &output.shaders["shader"]["v"];
    let wgsl = &variant.wgsl.as_ref().unwrap().source;
    assert!(
        wgsl.contains("@location(1) @interpolate(flat, either) id: u32"),
        "{wgsl}"
    );
    let program = &variant.glsl.as_ref().unwrap()["main"];
    assert!(
        program
            .vertex
            .source
            .contains("flat out uint _vs2fs_location1;")
    );
    assert!(
        program
            .fragment
            .source
            .contains("flat in uint _vs2fs_location1;")
    );
}

#[test]
fn flat_interpolation_without_either_is_rejected() {
    for attribute in ["@interpolate(flat)", "@interpolate(flat, first)"] {
        let source = MESH.replace("@interpolate(flat, either)", attribute);
        let problem = only_problem(build(&project(&source, &[("v", BOTH_TARGETS)], &[])));
        assert_eq!(problem.file.as_deref(), Some(SHADER));
        assert_eq!(problem.line, Some(15));
        assert!(
            problem.message.contains("`@interpolate(flat, either)`"),
            "{problem}"
        );
    }
}

/// A vertex shader that reads the draw index in its variant for WebGL2 alone.
const DRAW_INDEX: &str = r"enable draw_index;
#import null3d::math

struct Offsets { values: array<vec4f, 8>, }
@group(0) @binding(0) var<uniform> offsets: Offsets;

@vertex
fn vs_main(
    @location(0) position: vec3f,
#ifdef DRAW_INDEX
    @builtin(draw_index) draw: u32,
#endif
) -> @builtin(position) vec4f {
    var moved = position;
#ifdef DRAW_INDEX
    moved += offsets.values[draw].xyz;
#endif
    return vec4f(moved * null3d::math::square(1.0), 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
    return vec4f(1.0);
}
";

#[test]
fn a_draw_index_variant_writes_the_multi_draw_extension_and_gl_draw_id() {
    let variants = [
        ("plain", BOTH_TARGETS),
        (
            "multi_draw",
            "{ defs = [\"DRAW_INDEX\"], targets = [\"glsl\"] }",
        ),
    ];
    let output = build(&project(DRAW_INDEX, &variants, &[])).unwrap();
    let variants = &output.shaders["shader"];
    let vertex = &variants["multi_draw"].glsl.as_ref().unwrap()["main"]
        .vertex
        .source;
    let lines: Vec<_> = vertex.lines().collect();
    assert_eq!(
        lines[..2],
        [
            "#version 300 es",
            "#extension GL_ANGLE_multi_draw : require"
        ]
    );
    assert!(vertex.contains("uint draw = uint(gl_DrawID);"), "{vertex}");
    let plain = &variants["plain"].glsl.as_ref().unwrap()["main"]
        .vertex
        .source;
    assert!(
        !plain.contains("GL_ANGLE_multi_draw") && !plain.contains("gl_DrawID"),
        "{plain}"
    );
    let plain_wgsl = &variants["plain"].wgsl.as_ref().unwrap().source;
    assert!(!plain_wgsl.contains("draw_index"), "{plain_wgsl}");
}

#[test]
fn the_enable_line_reaches_naga_through_the_composer() {
    let variants = [(
        "multi_draw",
        "{ defs = [\"DRAW_INDEX\"], targets = [\"glsl\"] }",
    )];
    let without = DRAW_INDEX.replacen("enable draw_index;\n", "\n", 1);
    let problem = only_problem(build(&project(&without, &variants, &[])));
    assert!(problem.message.contains("draw_index"), "{problem}");
    assert!(problem.message.contains("enable"), "{problem}");
}

#[test]
fn an_enable_line_below_an_import_is_rejected_with_a_fix() {
    let moved = DRAW_INDEX.replacen(
        "enable draw_index;\n#import null3d::math\n",
        "#import null3d::math\nenable draw_index;\n",
        1,
    );
    let variants = [(
        "multi_draw",
        "{ defs = [\"DRAW_INDEX\"], targets = [\"glsl\"] }",
    )];
    let problem = only_problem(build(&project(&moved, &variants, &[])));
    assert_eq!(problem.file.as_deref(), Some(SHADER));
    assert_eq!(problem.line, Some(2));
    assert!(
        problem
            .message
            .contains("move it above the first `#import`"),
        "{problem}"
    );
}

#[test]
fn the_draw_index_is_rejected_in_a_variant_for_webgpu() {
    let variants = [(
        "both",
        "{ defs = [\"DRAW_INDEX\"], targets = [\"wgsl\", \"glsl\"] }",
    )];
    let problem = only_problem(build(&project(DRAW_INDEX, &variants, &[])));
    assert!(problem.message.contains("DRAW_INDEX"), "{problem}");
    assert!(
        problem.message.contains("targets are just [\"glsl\"]"),
        "{problem}"
    );
}

#[test]
fn the_glsl_reflection_lists_uniform_blocks_and_textures_per_stage() {
    let output = build(&project(MESH, &[("v", BOTH_TARGETS)], &[])).unwrap();
    let program = &output.shaders["shader"]["v"].glsl.as_ref().unwrap()["main"];
    let at = |group, binding| Binding { group, binding };
    assert_eq!(
        program.vertex.uniform_blocks,
        [GlslUniformBlock {
            name: "Camera_block_0Vertex".to_owned(),
            binding: at(0, 0),
        }]
    );
    assert_eq!(
        program.vertex.textures,
        [GlslTexture {
            name: "_group_1_binding_1_vs".to_owned(),
            binding: at(1, 1),
            sampler: None,
        }]
    );
    assert_eq!(
        program.fragment.uniform_blocks,
        [GlslUniformBlock {
            name: "Material_block_0Fragment".to_owned(),
            binding: at(1, 0),
        }]
    );
    assert_eq!(
        program.fragment.textures,
        [GlslTexture {
            name: "_group_1_binding_2_fs".to_owned(),
            binding: at(1, 2),
            sampler: Some(at(1, 3)),
        }]
    );
    for stage in [&program.vertex, &program.fragment] {
        for block in &stage.uniform_blocks {
            assert!(stage.source.contains(&format!("uniform {} {{", block.name)));
        }
        for texture in &stage.textures {
            assert!(
                stage
                    .source
                    .contains(&format!("sampler2D {};", texture.name))
            );
        }
    }
}

#[test]
fn glsl_that_webgl2_cannot_express_fails_with_the_pipeline_and_stage() {
    let source = MESH.replace(
        "@group(1) @binding(0) var<uniform> material: Material;",
        "@group(1) @binding(0) var<storage> material: Material;",
    );
    let problem = only_problem(build(&project(&source, &[("v", BOTH_TARGETS)], &[])));
    assert!(
        problem
            .message
            .contains("cannot express the fragment shader `fs_main` of pipeline `main`"),
        "{problem}"
    );
}

#[test]
fn a_pipeline_needs_its_entry_points() {
    let mut inputs = project(MESH, &[("v", BOTH_TARGETS)], &[]);
    inputs.manifest = inputs
        .manifest
        .replace("fragment = \"fs_main\"", "fragment = \"fs_missing\"");
    let problem = only_problem(build(&inputs));
    assert!(
        problem
            .message
            .contains("names the fragment entry point `fs_missing`, which this variant"),
        "{problem}"
    );
}

#[test]
fn every_entry_shader_must_be_in_the_manifest_and_every_listed_file_must_exist() {
    let mut inputs = project(MESH, &[("v", BOTH_TARGETS)], &[]);
    inputs
        .files
        .insert("forgotten.wgsl".to_owned(), MESH.to_owned());
    let problem = only_problem(build(&inputs));
    assert_eq!(
        problem.file.as_deref(),
        Some("crates/null3d-shaders/wgsl/forgotten.wgsl")
    );
    assert!(
        problem
            .message
            .contains("not in crates/null3d-shaders/shaders.toml")
    );

    let mut inputs = project(MESH, &[("v", BOTH_TARGETS)], &[]);
    inputs.files.remove("shader.wgsl");
    let problem = only_problem(build(&inputs));
    assert!(
        problem
            .message
            .contains("names \"shader.wgsl\", which does not exist")
    );
}

#[test]
fn a_library_module_must_declare_the_import_path_of_its_file_name() {
    let inputs = project(
        MESH,
        &[("v", BOTH_TARGETS)],
        &[(
            "color.wgsl",
            "#define_import_path null3d::colour\nfn f() {}\n",
        )],
    );
    let problem = only_problem(build(&inputs));
    assert_eq!(
        problem.file.as_deref(),
        Some("crates/null3d-shaders/wgsl/lib/color.wgsl")
    );
    assert!(
        problem
            .message
            .contains("`#define_import_path null3d::color`")
    );
}

#[test]
fn library_modules_that_import_each_other_in_a_cycle_are_rejected() {
    let library = [
        (
            "a.wgsl",
            "#define_import_path null3d::a\n#import null3d::b\nfn fa() -> f32 { return null3d::b::fb(); }\n",
        ),
        (
            "b.wgsl",
            "#define_import_path null3d::b\n#import null3d::a\nfn fb() -> f32 { return null3d::a::fa(); }\n",
        ),
    ];
    let problem = only_problem(build(&project(MESH, &[("v", BOTH_TARGETS)], &library)));
    assert!(
        problem.message.contains("null3d::a, null3d::b"),
        "{problem}"
    );
}

#[test]
fn the_same_problem_in_several_variants_is_listed_once() {
    let source = "@fragment\nfn fs_main() -> @location(0) vec4f {\n    var c = vec4f(0.0);\n    c.xy = vec2f(1.0);\n    return c;\n}\n";
    let variants = [
        ("a", "{ targets = [\"wgsl\"] }"),
        ("b", "{ defs = [\"B\"], targets = [\"wgsl\"] }"),
    ];
    let problem = only_problem(build(&project(source, &variants, &[])));
    assert_eq!(problem.variants, ["shader.a", "shader.b"]);
    assert!(
        problem
            .to_string()
            .ends_with("(shader variants shader.a, shader.b)")
    );
}

#[test]
fn the_output_is_the_same_on_every_build() {
    let inputs = Inputs::read(std::path::Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../.."
    )))
    .unwrap();
    let first = typescript(&build(&inputs).unwrap());
    let second = typescript(&build(&inputs).unwrap());
    assert_eq!(first, second);
}
