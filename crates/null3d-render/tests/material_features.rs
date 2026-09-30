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
use null3d_render::materials::{Shading, feature};
use null3d_render::pipelines::DepthBias;

/// One triangle, with a color at each vertex when `colored`.
fn triangle(colored: bool) -> Geometry {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let colors = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let arrays = MeshArrays {
        positions: &positions,
        colors: colored.then_some(&colors[..]),
        color_floats: 3,
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

/// Masked materials of each shading that reads alpha, materials without depth writes or the depth
/// test, and one with a depth bias, each on a triangle of its own.
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
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    let (lit, unlit) = (template::INSTANCED_LIT, template::INSTANCED_UNLIT);
    let mask = permutation::ALPHA_MASK;
    // The world's own objects draw with the lit and unlit shading, unmasked.
    let mut expected = vec![
        (lit, 0, 0, 0, 0),
        (lit, mask, 0, 0, 0),
        (unlit, 0, 0, 0, 0),
        (unlit, 0, 0, decal.constant as u32, decal.slope_bits),
        (unlit, 0, state_flags::NO_DEPTH_WRITE, 0, 0),
        (unlit, 0, state_flags::NO_DEPTH_TEST, 0, 0),
        (unlit, mask, 0, 0, 0),
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
