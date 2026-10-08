//! The shader build, tested on small shaders held in memory. With `NULL3D_SHADER_COMPILER` set,
//! each build also runs through the shader compiler's WebAssembly module (see `common`).

mod common;
mod precision;

use common::{
    SEE_RULES, SHADER, assert_feature, build, build_wgsl, column_of, only_problem, project, wgsl,
};
use null3d_shaders::{
    ALLOWED_LANGUAGE_FEATURES, Binding, Compiler, GlslTexture, GlslUniformBlock, Inputs,
    ShaderSource, literals_safari_refuses, typescript,
};
use precision::{newer_built_in_calls, precision_breaks};

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
    assert_feature(source, "swizzle_assignment", 1, "swizzle_assignment");
    let unknown = source.replace("swizzle_assignment", "buffer_view");
    assert_feature(&unknown, "buffer_view", 1, "buffer_view");
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
    assert_feature(source, "swizzle_assignment", 4, ".rgb");
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
    assert_feature(source, "texture_and_sampler_let", 6, "tex");
    let sampler = source
        .replace("let tex = base_color;", "let copy = base_sampler;")
        .replace(
            "textureSample(tex, base_sampler",
            "textureSample(base_color, copy",
        );
    assert_feature(&sampler, "texture_and_sampler_let", 6, "copy");
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
    assert_feature(source, "texture_and_sampler_let", 4, "copy");
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
    assert_feature(source, "unrestricted_pointer_parameters", 4, "dest");
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
    assert_feature(source, "unrestricted_pointer_parameters", 3, "dest");
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
    assert_feature(source, "unrestricted_pointer_parameters", 12, "set_one");
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
    assert_feature(source, "uniform_buffer_standard_layout", 4, "weights");
}

#[test]
fn the_immediate_address_space_is_rejected() {
    let source = "var<immediate> tint: vec4f;\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return tint;\n}\n";
    assert_feature(source, "immediate_address_space", 1, "var");
}

#[test]
fn linear_indexing_built_ins_are_rejected() {
    let source = "@compute @workgroup_size(64)\nfn cs_main(\n    @builtin(global_invocation_index) index: u32,\n) {\n}\n";
    assert_feature(source, "linear_indexing", 3, "@builtin");
}

#[test]
fn subgroup_id_built_ins_are_rejected() {
    let source = "@compute @workgroup_size(64)\nfn cs_main(@builtin(subgroup_id) id: u32) {\n}\n";
    assert_feature(source, "subgroup_id", 2, "@builtin");
}

#[test]
fn a_depth_mode_on_frag_depth_is_rejected() {
    let source =
        "@fragment\nfn fs_main() -> @builtin(frag_depth, less) f32 {\n    return 0.5;\n}\n";
    assert_feature(source, "fragment_depth", 2, "@builtin");
}

#[test]
fn buffer_views_are_rejected() {
    let source = "@group(0) @binding(0) var<storage, read_write> bytes: buffer<64>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n}\n";
    assert_feature(source, "buffer_view", 1, "buffer<");
}

#[test]
fn tier1_storage_texel_formats_are_rejected() {
    let source = "@group(0) @binding(0) var mask: texture_storage_2d<r8unorm, write>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n    textureStore(mask, vec2i(0), vec4f(1.0));\n}\n";
    assert_feature(source, "texture_formats_tier1", 1, "r8unorm");
}

/// Asserts that a shader with one WGSL variant fails once, at the first `at` in a line of the entry
/// shader, with a message that holds `needs` and ends with a link to the rules page.
fn assert_optional_feature(source: &str, line: u32, at: &str, needs: &str) {
    let problem = only_problem(build_wgsl(source));
    let shown = problem.to_string();
    assert_eq!(problem.feature, None, "{shown}");
    assert_eq!(problem.file.as_deref(), Some(SHADER), "{shown}");
    let column = column_of(source, line, at);
    assert_eq!(
        (problem.line, problem.column),
        (Some(line), Some(column)),
        "{shown}"
    );
    assert!(problem.message.contains(needs), "{shown}");
    assert!(problem.message.ends_with(SEE_RULES), "{shown}");
}

#[test]
fn enable_f16_is_rejected_once_with_a_fix() {
    let source = "enable f16;\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    let half: f16 = 0.5h;\n    return vec4f(f32(half));\n}\n";
    assert_optional_feature(source, 1, "f16", "`shader-f16`");
    let problem = only_problem(build_wgsl(source));
    assert!(
        problem.message.contains("Write the math in `f32`"),
        "{problem}"
    );
}

#[test]
fn half_floats_without_enable_are_rejected_at_the_first_one() {
    let typed = "@fragment\nfn fs_main() -> @location(0) vec4f {\n    let tint = vec3h(1.0, 0.5, 0.25);\n    let alpha: f16 = 1.0h;\n    return vec4f(vec3f(tint), f32(alpha));\n}\n";
    assert_optional_feature(typed, 3, "vec3h", "The type `vec3h` uses 16-bit floats");
    let valued =
        "@fragment\nfn fs_main() -> @location(0) vec4f {\n    return vec4f(f32(0.5h));\n}\n";
    assert_optional_feature(valued, 3, "0.5h", "The value `0.5h` uses 16-bit floats");
}

/// A library module that does its math in 16-bit floats, with a constant and a function.
const TINT_MODULE: &str = "enable f16;\n#define_import_path null3d::tint\n\nconst SCALE: f16 = 0.5h;\n\nfn tint(c: vec3f) -> vec3f {\n    return vec3f(vec3h(c) * SCALE);\n}\n";

/// A shader whose fragment stage calls the 16-bit module.
const TINTED: &str = "#import null3d::tint::{tint}\n\n@vertex\nfn vs_main() -> @builtin(position) vec4f {\n    return vec4f(0.0);\n}\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return vec4f(tint(vec3f(1.0)), 1.0);\n}\n";

#[test]
fn a_library_module_keeps_its_half_floats_only_in_webgpu_builds_of_the_half_bit() {
    let inputs = project(
        TINTED,
        &[
            (
                "webgpu",
                "{ permutations = [\"HALF\"], targets = [\"wgsl\"] }",
            ),
            (
                "webgl2",
                "{ permutations = [\"HALF\"], targets = [\"glsl\"] }",
            ),
        ],
        &[("tint.wgsl", TINT_MODULE)],
    );
    let output = build(&inputs).expect("the half precision module builds");
    let half = wgsl(&output, "webgpu_half");
    assert!(half.starts_with("enable f16;"), "{half}");
    assert!(half.contains("vec3<f16>"), "{half}");
    let full = wgsl(&output, "webgpu");
    assert!(!full.contains("f16") && full.contains("0.5f"), "{full}");
    for name in ["webgl2", "webgl2_half"] {
        let glsl = output.shaders["shader"][name].glsl.as_ref().expect("GLSL");
        let fragment = &glsl["main"].fragment.source;
        let mediump = |item: &str| format!("precision mediump float;\n{item}");
        assert!(
            fragment.contains(&mediump("const float SCALE = 0.5;\nprecision highp float;")),
            "{fragment}"
        );
        assert!(
            fragment.contains(&mediump("vec3 tint(vec3 c) {")),
            "{fragment}"
        );
        assert!(fragment.starts_with("#version 300 es\n\nprecision highp float;"));
    }
}

#[test]
fn a_half_precision_variant_has_one_target() {
    let inputs = project(
        TINTED,
        &[(
            "both",
            "{ permutations = [\"HALF\"], targets = [\"wgsl\", \"glsl\"] }",
        )],
        &[("tint.wgsl", TINT_MODULE)],
    );
    let problem = only_problem(build(&inputs));
    assert!(
        problem
            .message
            .contains("HALF permutation bit and more than one target"),
        "{problem}"
    );
}

#[test]
fn an_enable_line_for_an_optional_webgpu_feature_is_rejected() {
    let shader = |extension: &str| {
        format!(
            "enable {extension};\n\n@fragment\nfn fs_main() -> @location(0) vec4f {{\n    return vec4f(1.0);\n}}\n"
        )
    };
    assert_optional_feature(&shader("subgroups"), 1, "subgroups", "`subgroups`");
    assert_optional_feature(
        &shader("clip_distances"),
        1,
        "clip_distances",
        "`clip-distances`",
    );
    assert_optional_feature(
        &shader("chromium_experimental_framebuffer_fetch"),
        1,
        "chromium",
        "not every browser supports",
    );
}

#[test]
fn vec2u_atomic_store_min_and_max_are_rejected() {
    let source = "@group(0) @binding(0) var<storage, read_write> depth: atomic<vec2<u32>>;\n\n@compute @workgroup_size(1)\nfn cs_main() {\n    atomicStoreMin(&depth, vec2u(1u, 2u));\n}\n";
    assert_feature(source, "atomic_vec2u_min_max", 5, "atomicStoreMin");
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
    assert_eq!(
        (problem.line, problem.column),
        (Some(5), Some(column_of(library[0].1, 5, ".xy")))
    );
    assert_eq!(problem.variants, ["shader.v"]);
}

#[test]
fn composer_errors_point_at_their_place_after_a_library_call_on_the_line() {
    // The composer reads `null3d::math::square` under a longer name, so its own report of this
    // line counts columns in the wrong place.
    let source = "#import null3d::math\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    let y = null3d::math::square(2.0) 3.0;\n    return vec4f(y);\n}\n";
    let problem = only_problem(build_wgsl(source));
    assert_eq!(problem.file.as_deref(), Some(SHADER));
    assert_eq!(
        (problem.line, problem.column),
        (Some(5), Some(column_of(source, 5, "3.0")))
    );
    assert!(
        problem.message.starts_with("expected `;`, found"),
        "{problem}"
    );

    let wrong_type = source.replace("square(2.0) 3.0", "square(2u)");
    let problem = only_problem(build_wgsl(&wrong_type));
    assert_eq!(
        (problem.line, problem.column),
        (Some(5), Some(column_of(&wrong_type, 5, "2u")))
    );
    assert!(
        problem
            .message
            .contains("Argument 0 value [0] doesn't match the type"),
        "{problem}"
    );
}

#[test]
fn a_composer_error_in_a_library_module_points_into_it_with_plain_names() {
    let library = [(
        "broken.wgsl",
        "#define_import_path null3d::broken\n\nfn add(a: f32) -> f32 {\n    return a + 1u;\n}\n",
    )];
    let source = "#import null3d::broken\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    return vec4f(null3d::broken::add(1.0));\n}\n";
    let problem = only_problem(build(&project(
        source,
        &[("v", "{ targets = [\"wgsl\"] }")],
        &library,
    )));
    assert_eq!(
        problem.file.as_deref(),
        Some("crates/null3d-shaders/wgsl/lib/broken.wgsl")
    );
    assert_eq!(
        (problem.line, problem.column),
        (Some(4), Some(column_of(library[0].1, 4, "a + 1u")))
    );
    assert!(
        problem.message.contains("'null3d::broken::add' is invalid"),
        "{problem}"
    );
    assert!(!problem.message.contains("naga_oil"), "{problem}");
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
    assert_eq!(
        (problem.line, problem.column),
        (Some(5), Some(column_of(source, 5, ".xy")))
    );
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
            .contains("flat out highp uint _vs2fs_location1;")
    );
    assert!(
        program
            .fragment
            .source
            .contains("flat in highp uint _vs2fs_location1;")
    );
}

#[test]
fn flat_interpolation_without_either_is_rejected() {
    for attribute in ["@interpolate(flat)", "@interpolate(flat, first)"] {
        let source = MESH.replace("@interpolate(flat, either)", attribute);
        let problem = only_problem(build(&project(&source, &[("v", BOTH_TARGETS)], &[])));
        assert_eq!(problem.file.as_deref(), Some(SHADER));
        assert_eq!(
            (problem.line, problem.column),
            (Some(15), Some(column_of(&source, 15, "@interpolate")))
        );
        assert!(
            problem.message.contains("`@interpolate(flat, either)`"),
            "{problem}"
        );
        assert!(problem.message.ends_with(SEE_RULES), "{problem}");
    }
}

/// A compute shader that claims a slot with an atomic compare-exchange.
const COMPARE_EXCHANGE: &str = r"var<workgroup> slots: array<atomic<u32>, 64>;

@compute @workgroup_size(64)
fn cs_main(@builtin(local_invocation_index) lane: u32) {
    let claim = atomicCompareExchangeWeak(&slots[lane], 0u, 1u);
}
";

#[test]
fn atomic_compare_exchange_fails_the_engines_shader_build() {
    let source = COMPARE_EXCHANGE;
    let problem = only_problem(build_wgsl(source));
    assert_eq!(problem.file.as_deref(), Some(SHADER));
    assert_eq!(
        (problem.line, problem.column),
        (
            Some(5),
            Some(column_of(source, 5, "atomicCompareExchangeWeak"))
        )
    );
    assert!(problem.message.contains("Safari 27.0"), "{problem}");
    assert!(problem.message.ends_with(SEE_RULES), "{problem}");
}

#[test]
fn atomic_compare_exchange_in_a_users_shader_builds_with_a_warning() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let inputs = Inputs::read(&root).expect("the repository's shaders");
    let mut compiler = Compiler::new(&inputs.files).expect("the shader library");
    let shader: ShaderSource = serde_json::from_value(serde_json::json!({
        "path": SHADER,
        "source": COMPARE_EXCHANGE,
        "variants": { "webgpu": { "targets": ["wgsl"] } },
    }))
    .expect("a shader source");
    let built = compiler.compile(&shader).expect("the user's shader builds");
    assert!(built["webgpu"].wgsl.is_some());
    let warnings = compiler.take_warnings();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    let warning = &warnings[0];
    assert_eq!(
        (warning.line, warning.column),
        (
            Some(5),
            Some(column_of(COMPARE_EXCHANGE, 5, "atomicCompareExchangeWeak"))
        )
    );
    assert_eq!(warning.variants, ["webgpu"]);
    assert!(warning.message.contains("Safari 27.0"), "{warning}");
    assert!(warning.message.contains("321006@main"), "{warning}");
    assert!(compiler.take_warnings().is_empty());
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

/// A shader whose SKIN builds change only the vertex shader, with a helper function and a
/// constant that only the vertex shader of those builds reads.
const VERTEX_ONLY_BIT: &str = r"#import null3d::math

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) shade: f32,
}

#ifdef SKIN
const BEND: f32 = 0.25;

fn bent(position: vec3f) -> vec3f {
    var moved = position;
    for (var k = 0u; k < 2u; k++) {
        moved.y += BEND * moved.x;
    }
    return moved;
}
#endif

fn lit(shade: f32) -> f32 {
    var total = 0.0;
    for (var k = 0u; k < 2u; k++) {
        total += shade * null3d::math::square(0.5);
    }
    return total;
}

@vertex
fn vs_main(@location(0) position: vec3f) -> VertexOut {
#ifdef SKIN
    let placed = bent(position);
#else
    let placed = position;
#endif
    return VertexOut(vec4f(placed, 1.0), placed.z);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    return vec4f(lit(in.shade));
}
";

#[test]
fn a_bit_that_changes_only_the_vertex_shader_leaves_the_fragment_shader_as_it_is() {
    let variants = [("v", "{ permutations = [\"SKIN\"], targets = [\"glsl\"] }")];
    let output = build(&project(VERTEX_ONLY_BIT, &variants, &[])).unwrap();
    let program =
        |build: &str| output.shaders["shader"][build].glsl.as_ref().unwrap()["main"].clone();
    let (plain, skinned) = (program("v"), program("v_skin"));
    assert_eq!(plain.fragment.source, skinned.fragment.source);
    assert_ne!(plain.vertex.source, skinned.vertex.source);
    assert!(
        skinned.vertex.source.contains("BEND"),
        "{}",
        skinned.vertex.source
    );
    for text in [&plain.fragment.source, &plain.vertex.source] {
        assert!(!text.contains("BEND") && !text.contains("bent"), "{text}");
    }
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
    assert_eq!((problem.line, problem.column), (Some(2), Some(1)));
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

/// A fragment shader that compares layers of a depth array with reference depths, as shadow
/// cascades do: once at mip level 0, which works in any stage, and once with implicit
/// derivatives.
const DEPTH_ARRAY: &str = r"
@group(0) @binding(0) var shadow_maps: texture_depth_2d_array;
@group(0) @binding(1) var shadow_sampler: sampler_comparison;

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    return vec4f(f32(index), 0.0, 0.5, 1.0);
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy / 64.0;
    let lit = textureSampleCompareLevel(shadow_maps, shadow_sampler, uv, 1, 0.5)
        + textureSampleCompare(shadow_maps, shadow_sampler, uv, 2, 0.25);
    return vec4f(lit);
}
";

#[test]
fn a_depth_array_with_a_comparison_sampler_becomes_a_glsl_array_shadow_sampler() {
    let output = build(&project(DEPTH_ARRAY, &[("v", BOTH_TARGETS)], &[])).unwrap();
    let fragment = &output.shaders["shader"]["v"].glsl.as_ref().unwrap()["main"].fragment;
    let at = |group, binding| Binding { group, binding };
    assert_eq!(
        fragment.textures,
        [GlslTexture {
            name: "_group_0_binding_0_fs".to_owned(),
            binding: at(0, 0),
            sampler: Some(at(0, 1)),
        }]
    );
    let source = &fragment.source;
    assert!(
        source.contains("uniform highp sampler2DArrayShadow _group_0_binding_0_fs;"),
        "{source}"
    );
    // GLSL ES 3.00 has no textureLod for array shadow samplers. The comparison at level 0 reads
    // at the texture's own level instead of with zero gradients, as the map has one level.
    assert!(!source.contains("textureGrad("), "{source}");
    assert_eq!(
        source
            .matches("texture(_group_0_binding_0_fs, vec4(")
            .count(),
        2,
        "{source}"
    );
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

/// The library modules that shaders import.
const LIBRARY_MODULES: [&str; 8] = [
    "math", "noise", "color", "lighting", "fog", "vertex", "depth", "sdf",
];

/// Splits a parameter list at the commas outside angle brackets and parentheses.
fn split_parameters(list: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0, 0);
    for (at, c) in list.char_indices() {
        match c {
            '<' | '(' => depth += 1,
            '>' | ')' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(list[start..at].trim());
                start = at + 1;
            }
            _ => {}
        }
    }
    parts.push(list[start..].trim());
    parts.into_iter().filter(|part| !part.is_empty()).collect()
}

/// A fragment shader that imports one library module whole and calls each of its functions with
/// zero values, and the names of those functions.
fn calls_every_function(module: &str, text: &str) -> (String, Vec<String>) {
    let structs: Vec<&str> = text
        .lines()
        .filter_map(|line| line.strip_prefix("struct "))
        .filter_map(|rest| rest.split_whitespace().next())
        .collect();
    let lines: Vec<&str> = text.lines().collect();
    let mut names = Vec::new();
    let mut calls = String::new();
    for (at, line) in lines.iter().enumerate() {
        if !line.starts_with("fn ") {
            continue;
        }
        let end = at
            + lines[at..]
                .iter()
                .position(|l| l.trim_end().ends_with('{'))
                .unwrap();
        let signature = lines[at..=end].join(" ");
        let name = signature["fn ".len()..].split('(').next().unwrap().trim();
        let open = signature.find('(').unwrap();
        let close = signature.rfind(')').unwrap();
        let arguments: Vec<String> = split_parameters(&signature[open + 1..close])
            .into_iter()
            .map(|parameter| {
                let ty = parameter.split_once(':').unwrap().1.trim();
                if structs.contains(&ty) {
                    format!("null3d::{module}::{ty}()")
                } else {
                    format!("{ty}()")
                }
            })
            .collect();
        calls.push_str(&format!(
            "    _ = null3d::{module}::{name}({});\n",
            arguments.join(", ")
        ));
        names.push(name.to_owned());
    }
    let source = format!(
        "#import null3d::{module}\n\n@vertex\nfn vs_main() -> @builtin(position) vec4f {{\n    return vec4f(0.0);\n}}\n\n@fragment\nfn fs_main() -> @location(0) vec4f {{\n{calls}    return vec4f(1.0);\n}}\n"
    );
    (source, names)
}

#[test]
fn each_library_module_builds_every_function_for_webgpu_and_webgl2() {
    let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let library = Inputs::read(root).unwrap().files;
    for module in LIBRARY_MODULES {
        let text = &library[&format!("lib/{module}.wgsl")];
        let (source, names) = calls_every_function(module, text);
        assert!(!names.is_empty(), "null3d::{module} has no functions");
        let mut inputs = project(&source, &[("v", BOTH_TARGETS)], &[]);
        inputs.files.extend(
            library
                .iter()
                .filter(|(file, _)| file.starts_with("lib/"))
                .map(|(file, text)| (file.clone(), text.clone())),
        );
        let output = build(&inputs)
            .unwrap_or_else(|e| panic!("null3d::{module} does not build:\n{e}\n{source}"));
        let variant = &output.shaders["shader"]["v"];
        let wgsl = &variant.wgsl.as_ref().unwrap().source;
        let glsl = &variant.glsl.as_ref().unwrap()["main"].fragment.source;
        for name in &names {
            // The output writer adds `_` to a name that ends in a digit.
            let called = |text: &str| {
                text.contains(&format!("{name}(")) || text.contains(&format!("{name}_("))
            };
            assert!(
                called(wgsl),
                "null3d::{module}::{name} is missing from the WGSL"
            );
            assert!(
                called(glsl),
                "null3d::{module}::{name} is missing from the GLSL"
            );
        }
    }
}

#[test]
fn a_name_that_an_imported_module_takes_fails_with_a_fix() {
    let source = "#import null3d::math\n\n@fragment\nfn fs_main() -> @location(0) vec4f {\n    let math = 2.0;\n    return vec4f(math);\n}\n";
    let problem = only_problem(build_wgsl(source));
    let shown = problem.to_string();
    assert_eq!(problem.file.as_deref(), Some(SHADER), "{shown}");
    assert_eq!(
        (problem.line, problem.column),
        (Some(5), Some(9)),
        "{shown}"
    );
    assert!(
        problem
            .message
            .starts_with("`math` is the name of the module null3d::math"),
        "{shown}"
    );
    assert!(
        problem.message.contains("`#import null3d::math::{item}`"),
        "{shown}"
    );

    // Importing items by name leaves the module's name free.
    let named = source.replace("#import null3d::math", "#import null3d::math::{square}");
    build_wgsl(&named).unwrap();
}

#[test]
fn every_glsl_shader_keeps_the_rules_of_strict_drivers_and_webgl2() {
    let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let output = build(&Inputs::read(root).unwrap()).unwrap();
    let mut breaks = Vec::new();
    let mut stages = 0;
    for (shader, variants) in &output.shaders {
        for (variant, built) in variants {
            for (pipeline, program) in built.glsl.iter().flatten() {
                for (stage, fragment) in [(&program.vertex, false), (&program.fragment, true)] {
                    stages += 1;
                    let kind = if fragment { "fragment" } else { "vertex" };
                    let mut found = precision_breaks(&stage.source, fragment);
                    found.extend(newer_built_in_calls(&stage.source));
                    breaks.extend(
                        found.into_iter().map(|b| {
                            format!("{shader}.{variant} ({pipeline}, {kind} shader), {b}")
                        }),
                    );
                }
            }
        }
    }
    assert!(stages > 100, "only {stages} GLSL shaders were built");
    assert!(
        breaks.is_empty(),
        "GLSL that Mali GPUs or WebGL2 reject:\n{}",
        breaks.join("\n")
    );
}

#[test]
fn the_precision_check_finds_each_break() {
    let good = "#version 300 es\n\nprecision highp float;\nprecision highp int;\n\nuniform highp sampler2D t;\nlayout(location = 0) out highp uvec4 color;\nprecision mediump float;\nvec3 f(vec3 c, highp int k) {\n    vec3 a[2];\n    a[0] = c * float(uint(k));\n    return a[0];\n}\nprecision highp float;\n";
    assert_eq!(precision_breaks(good, true), Vec::<String>::new());
    let bad = "#version 300 es\n\nuniform sampler2D t;\nprecision highp float;\nvoid main() {\n    vec3 a[2] = vec3[2](b, c);\n    vec3[2] d = a;\n    uvec4 u = uvec4(0u);\n}\nprecision mediump float;\n";
    let found = precision_breaks(bad, true);
    assert_eq!(found.len(), 7, "{found:#?}");
    assert!(found[0].contains("`precision highp float;` is missing"));
    assert!(found[1].contains("`precision highp int;` is missing"));
    assert!(found[2].starts_with("line 3: a sampler uniform"));
    assert!(found[3].starts_with("line 6: an array type with its size"));
    assert!(found[4].starts_with("line 7: an array type with its size"));
    assert!(found[5].starts_with("line 8: a whole number declared without a precision"));
    assert!(found[6].contains("ends at `mediump`"));
}

#[test]
fn the_built_in_check_finds_calls_that_webgl2_lacks() {
    let source = "uint s = (1u + uint(bitCount((word & 7u))));
float x = myldexp(a);
int b = findMSB(c);
";
    let found = newer_built_in_calls(source);
    assert_eq!(found.len(), 2, "{found:#?}");
    assert!(found[0].starts_with("line 1: `bitCount`"));
    assert!(found[1].starts_with("line 3: `findMSB`"));
}

#[test]
fn every_wgsl_shader_has_only_number_literals_that_safari_reads() {
    let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let output = build(&Inputs::read(root).unwrap()).unwrap();
    let mut refused = Vec::new();
    let mut modules = 0;
    for (shader, variants) in &output.shaders {
        for (variant, built) in variants {
            let Some(wgsl) = &built.wgsl else { continue };
            modules += 1;
            refused.extend(
                literals_safari_refuses(&wgsl.source)
                    .into_iter()
                    .map(|literal| format!("{shader}.{variant}: {literal}")),
            );
        }
    }
    assert!(modules > 100, "only {modules} WGSL modules were built");
    assert!(
        refused.is_empty(),
        "number literals that Safari 26 refuses:\n{}",
        refused.join("\n")
    );
}

/// The text of the repository's library module `null3d::<name>`.
fn library_module(name: &str) -> String {
    let path = format!("{}/wgsl/lib/{name}.wgsl", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The lines of function `name` in a module, from its first line to the brace that closes it.
fn function_text<'a>(module: &'a str, name: &str) -> &'a str {
    let start = module
        .find(&format!("\nfn {name}("))
        .unwrap_or_else(|| panic!("no fn {name}"));
    let end = module[start..].find("\n}\n").expect("the function's end") + start;
    &module[start..end]
}

/// The value of a number constant `name` that a module declares.
fn number_constant(module: &str, name: &str) -> f32 {
    let line = module
        .lines()
        .find(|line| line.starts_with(&format!("const {name}: ")))
        .unwrap_or_else(|| panic!("no const {name}"));
    let value = line.split(" = ").nth(1).expect("a value");
    value
        .trim_end_matches(';')
        .trim_end_matches(['f', 'h', 'u'])
        .parse()
        .unwrap_or_else(|e| panic!("{line}: {e}"))
}

#[test]
fn the_half_builds_keep_roughness_to_the_fourth_power_a_normal_16_bit_float() {
    // GGX takes roughness to the fourth power. Below the smallest normal 16-bit float, 2^-14, a
    // GPU may flush it to zero, and the highlight's peak then divides by zero.
    let half = library_module("half");
    let floor = number_constant(&half, "ROUGHNESS_FLOOR");
    assert!(floor.powi(4) >= 2f32.powi(-14), "{floor} to the fourth");
    let direct = function_text(&half, "direct_light");
    assert!(
        direct.contains("max(m.roughness, ROUGHNESS_FLOOR)"),
        "{direct}"
    );
}

#[test]
fn the_sun_shadow_loops_run_the_same_passes_at_every_pixel() {
    // Adreno 830 ran a loop the wrong number of times when its pass count differed between pixels.
    // The cascade count comes from the uniforms, so it is the same at every pixel of a draw. A
    // fixed MAX_CASCADES passes slowed S4's scene pass at Low on Apple's GPUs.
    let shadows = library_module("shadows");
    let sun = function_text(&shadows, "sun_shadow");
    let loops: Vec<&str> = sun
        .lines()
        .map(str::trim)
        .filter(|line| {
            ["for ", "while ", "loop "]
                .iter()
                .any(|k| line.starts_with(k))
        })
        .collect();
    assert_eq!(loops.len(), 2, "{sun}");
    for header in loops {
        assert_eq!(header, "for (var k = 0u; k < count; k++) {");
    }
    assert!(
        sun.contains("let count = u32(cascades.forward.w);"),
        "{sun}"
    );
    assert_eq!(number_constant(&shadows, "MAX_CASCADES"), 4.0);
}

#[test]
fn hdr_color_stops_one_step_below_the_largest_16_bit_float() {
    // Some GPUs store a value past the largest 16-bit float, 65,504, as infinity. The limit keeps
    // one step of margin below it, as Unity's URP limits bloom's input.
    let color = library_module("color");
    let step = 2f32.powi(15 - 10);
    assert_eq!(number_constant(&color, "HDR_LIMIT"), 65_504.0 - step);
    let tonemap = library_module("tonemap");
    let finish = function_text(&tonemap, "finish");
    assert!(finish.contains("limit_hdr(c)"), "{finish}");
}
