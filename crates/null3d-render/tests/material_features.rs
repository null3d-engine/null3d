//! Material features that choose a pipeline, drawn by both frame builders: double-sided materials
//! cull no faces, vertex colors pick their shader variant on meshes that have colors, masked
//! materials pick the variant that discards fragments, and the depth options and the depth bias
//! set the pipeline's depth state. Checked through the mock backend, which rejects what a real GPU
//! would, and by decoding the lists.

mod common;

use common::World;
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, permutation, state_flags, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::{CustomShading, MATERIAL_TEXELS, Shading, feature};
use null3d_render::pipelines::DepthBias;

/// One triangle, with a color at each vertex when `colored`.
fn triangle(colored: bool) -> Geometry {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let colors = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let arrays = MeshArrays {
        positions: (&positions).into(),
        colors: colored.then_some((&colors).into()),
        color_components: 3,
        compute_normals: true,
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

/// Adds an object that draws `mesh` with a new material of `shading` and `features`.
fn add<B: FrameBuilder>(world: &mut World<B>, mesh: &Geometry, shading: Shading, features: u32) {
    add_biased(world, mesh, shading, features, DepthBias::NONE);
}

/// Adds an object that draws `mesh` with a new material of `shading`, `features` and `bias`.
fn add_biased<B: FrameBuilder>(
    world: &mut World<B>,
    mesh: &Geometry,
    shading: Shading,
    features: u32,
    bias: DepthBias,
) {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
    let table = settings.materials_mut();
    let material = table.create(shading, features, [1.0; 4]).unwrap();
    table.set_depth_bias(material, bias).unwrap();
    let material = material + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
}

/// Each render pipeline that a list creates for the triangles: its template, permutation bits
/// without the pass's own, which the device fixes, and state flags, sorted.
fn triangle_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    let mut made: Vec<(u32, u32, u32)> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[7] & vertex::COLOR != 0)
        .map(|(_, o)| (o[1], o[2] & !permutation::DEVICE, o[6]))
        .collect();
    made.sort_unstable();
    made
}

/// The triangles: colored ones with vertex colors on the standard and the unlit material, one
/// that is double-sided too, one without the feature, and an uncolored one that asks for vertex
/// colors it cannot have.
fn feature_world<B: FrameBuilder>(world: &mut World<B>) {
    let colored = triangle(true);
    add(world, &colored, Shading::Lit, feature::VERTEX_COLORS);
    add(world, &colored, Shading::Unlit, feature::VERTEX_COLORS);
    let both = feature::VERTEX_COLORS | feature::DOUBLE_SIDED;
    add(world, &colored, Shading::Lit, both);
    add(world, &colored, Shading::Lit, 0);
    add(world, &triangle(false), Shading::Lit, both);
}

fn check<B: FrameBuilder>(mut world: World<B>) {
    feature_world(&mut world);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let (lit, unlit) = (template::INSTANCED_LIT, template::INSTANCED_UNLIT);
    let colors = permutation::VERTEX_COLOR;
    let none = state_flags::CULL_NONE;
    assert_eq!(
        triangle_pipelines(&world.commands()),
        vec![
            (lit, 0, 0),
            (lit, colors, 0),
            (lit, colors, none),
            (unlit, colors, 0),
        ]
    );
    let plain: Vec<(u32, u32)> = world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[7] & vertex::COLOR == 0)
        .map(|(_, o)| (o[1], o[6]))
        .filter(|&(template, state)| template == lit && state == none)
        .collect();
    assert_eq!(
        plain.len(),
        1,
        "the uncolored triangle is double-sided, without vertex colors"
    );
}

#[test]
fn features_choose_the_pipeline_on_webgpu() {
    check(World::new());
}

#[test]
fn features_choose_the_pipeline_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check(World::build(CpuCulledRenderer::new(config)));
    }
}

/// One triangle with texture coordinates, which custom materials read.
fn mapped_triangle() -> Geometry {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let uvs = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let arrays = MeshArrays {
        positions: (&positions).into(),
        uvs: Some((&uvs).into()),
        compute_normals: true,
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

/// Custom materials draw with their own template, which materials of one template share, and
/// only meshes with the vertex attributes that their shaders read draw with them. A full shader
/// reads vertex colors itself and takes no mask, so neither feature changes its build.
fn check_custom<B: FrameBuilder>(mut world: World<B>) {
    let first = template::CUSTOM_FIRST;
    let mapped = mapped_triangle();
    add(&mut world, &mapped, CustomShading::standard(first), 0);
    add(&mut world, &mapped, CustomShading::standard(first), 0);
    add(
        &mut world,
        &mapped,
        CustomShading::standard(first + 1),
        feature::DOUBLE_SIDED,
    );
    add(
        &mut world,
        &triangle(false),
        CustomShading::standard(first + 2),
        0,
    );
    let full = Shading::Custom(CustomShading {
        template: first + 3,
        attributes: vertex::COLOR,
        base_color: false,
        textures: 0,
        transmission: false,
    });
    let colors_and_mask = feature::VERTEX_COLORS | feature::ALPHA_MASK;
    add(&mut world, &triangle(true), full, colors_and_mask);
    let masked = CustomShading::standard(first + 4);
    add(&mut world, &mapped, masked, feature::ALPHA_MASK);
    // A custom material has no builds that fade or hash its alpha, so it tests the cutoff.
    let mask_ways = feature::ALPHA_TO_COVERAGE | feature::ALPHA_HASH;
    add(
        &mut world,
        &mapped,
        masked,
        feature::ALPHA_MASK | feature::ALPHA_TO_COVERAGE,
    );
    add(&mut world, &mapped, masked, feature::ALPHA_MASK | mask_ways);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let mut made: Vec<(u32, u32, u32)> = world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] >= first)
        .map(|(_, o)| (o[1], o[2] & !permutation::DRAW_INDEX, o[6]))
        .collect();
    made.sort_unstable();
    made.dedup();
    // The canvas takes 8-bit color, so every pipeline tone maps.
    let tone_map = permutation::TONE_MAP;
    assert_eq!(
        made,
        vec![
            (first, tone_map, 0),
            (first + 1, tone_map, state_flags::CULL_NONE),
            (first + 3, tone_map, 0),
            (first + 4, tone_map | permutation::ALPHA_MASK, 0),
        ]
    );
}

#[test]
fn custom_materials_draw_with_their_own_templates_on_webgpu() {
    check_custom(World::new());
}

#[test]
fn custom_materials_draw_with_their_own_templates_on_webgl2() {
    check_custom(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// Each render pipeline that a list creates for meshes without vertex colors: its template,
/// permutation bits without the pass's own, which the device fixes, state flags and depth bias,
/// sorted, once each. The final pass draws no mesh, so its pipeline is left out.
fn plain_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32, u32, u32)> {
    let mut made: Vec<_> = commands
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateRenderPipeline && o[1] != template::FINAL && o[7] & vertex::COLOR == 0
        })
        .map(|(_, o)| (o[1], o[2] & !permutation::DEVICE, o[6], o[8], o[9]))
        .collect();
    made.sort_unstable();
    made.dedup();
    made
}

/// Masked materials of each shading that reads alpha, with alpha to coverage and the alpha hash,
/// materials without depth writes or the depth test, and one with a depth bias, each on a triangle
/// of its own.
fn check_mask_and_depth<B: FrameBuilder>(mut world: World<B>) {
    let plain = triangle(false);
    add(&mut world, &plain, Shading::Lit, feature::ALPHA_MASK);
    add(&mut world, &plain, Shading::Unlit, feature::ALPHA_MASK);
    add(&mut world, &plain, Shading::Unlit, feature::NO_DEPTH_WRITE);
    add(&mut world, &plain, Shading::Unlit, feature::NO_DEPTH_TEST);
    let decal = DepthBias::from_polygon_offset(-4.0, -1.0);
    add_biased(&mut world, &plain, Shading::Unlit, 0, decal);
    let masked_colors = feature::ALPHA_MASK | feature::VERTEX_COLORS;
    add(&mut world, &triangle(true), Shading::Unlit, masked_colors);
    // Alpha to coverage fades the alpha and turns on in the pipeline, as the canvas's target has
    // alpha and MSAA. The alpha hash wins over alpha to coverage.
    let covers = feature::ALPHA_MASK | feature::ALPHA_TO_COVERAGE;
    add(&mut world, &plain, Shading::Lit, covers);
    add(
        &mut world,
        &plain,
        Shading::Unlit,
        feature::ALPHA_MASK | feature::ALPHA_HASH,
    );
    add(
        &mut world,
        &plain,
        Shading::Lit,
        covers | feature::ALPHA_HASH,
    );
    // A material that blends tests no alpha, so it never covers by alpha.
    add(&mut world, &plain, Shading::Unlit, covers | feature::BLEND);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    let (lit, unlit) = (template::INSTANCED_LIT, template::INSTANCED_UNLIT);
    let mask = permutation::ALPHA_MASK;
    let (fade, hash) = (permutation::ALPHA_COVERAGE, permutation::ALPHA_HASH);
    // The world's own objects draw with the lit and unlit shading, unmasked.
    let mut expected = vec![
        (lit, 0, 0, 0, 0),
        (lit, mask, 0, 0, 0),
        (unlit, 0, 0, 0, 0),
        (unlit, 0, 0, decal.constant as u32, decal.slope_bits),
        (unlit, 0, state_flags::NO_DEPTH_WRITE, 0, 0),
        (unlit, 0, state_flags::NO_DEPTH_TEST, 0, 0),
        (unlit, mask, 0, 0, 0),
        (lit, mask | fade, state_flags::ALPHA_TO_COVERAGE, 0, 0),
        (unlit, mask | hash, 0, 0, 0),
        (lit, mask | hash, 0, 0, 0),
        (unlit, 0, state_flags::BLEND_NORMAL, 0, 0),
    ];
    expected.sort_unstable();
    assert_eq!(plain_pipelines(&commands), expected);
    assert_eq!(
        (decal.constant, f32::from_bits(decal.slope_bits)),
        (4, 1.0),
        "three.js's negative offset pulls toward the camera: a positive bias in reversed depth"
    );
    assert_eq!(
        triangle_pipelines(&commands),
        vec![(unlit, permutation::VERTEX_COLOR | mask, 0)],
        "the masked variant with vertex colors reads their alpha"
    );
}

#[test]
fn masks_and_depth_options_choose_the_pipeline_on_webgpu() {
    check_mask_and_depth(World::new());
}

#[test]
fn masks_and_depth_options_choose_the_pipeline_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check_mask_and_depth(World::build(CpuCulledRenderer::new(config)));
    }
}

/// A change of custom values uploads their row of texels alone: `row_of` finds the row that a
/// command writes into the texture that holds them, or `None` for another command, and `row`
/// gives the row that material 1's values have, from the table's capacity.
fn check_custom_values<B: FrameBuilder>(
    mut world: World<B>,
    row_of: impl Fn(&(Op, Vec<u32>)) -> Option<u32>,
    row: impl Fn(u32) -> u32,
) {
    for _ in 0..2 {
        let custom = CustomShading::standard(template::CUSTOM_FIRST);
        add(&mut world, &mapped_triangle(), custom, 0);
    }
    world.record(true);
    let capacity = world.renderer.settings().materials().capacity();
    let materials = world.renderer.settings_mut().materials_mut();
    materials.set_values(1, 4, &[0.5, 0.25, 0.125]).unwrap();
    world.record(false);
    let rows: Vec<u32> = world.commands().iter().filter_map(row_of).collect();
    assert_eq!(rows, vec![row(capacity)]);
}

#[test]
fn custom_values_upload_to_a_texture_of_their_own_on_webgpu() {
    // The custom values' texture is the builder's texture 2, after three.js's table of terms.
    check_custom_values(
        World::new(),
        |(op, o)| (*op == Op::WriteTexture && o[0] == 2).then(|| o[3]),
        |_| 1,
    );
}

#[test]
fn custom_values_upload_after_the_rows_on_webgl2() {
    let world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    check_custom_values(
        world,
        |(op, o)| (*op == Op::WriteTexture && o[5] == MATERIAL_TEXELS).then(|| o[3]),
        |capacity| capacity + 1,
    );
}
