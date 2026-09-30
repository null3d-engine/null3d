//! Material features that choose a pipeline, drawn by both frame builders: double-sided materials
//! cull no faces, and vertex colors pick their shader variant on meshes that have colors. Checked
//! through the mock backend, which rejects what a real GPU would, and by decoding the lists.

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
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(shading, features, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
}

/// Each render pipeline that a list creates for the triangles: its template, permutation bits
/// without the pass's own, and state flags, sorted.
fn triangle_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    let mut made: Vec<(u32, u32, u32)> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[7] & vertex::COLOR != 0)
        .map(|(_, o)| (o[1], o[2] & !permutation::DRAW_INDEX, o[6]))
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
        positions: &positions,
        uvs: Some(&uvs),
        compute_normals: true,
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

/// Custom materials draw with their own template, which materials of one template share, and
/// only meshes with texture coordinates draw with them.
fn check_custom<B: FrameBuilder>(mut world: World<B>) {
    let first = template::CUSTOM_FIRST;
    let mapped = mapped_triangle();
    add(&mut world, &mapped, Shading::Custom(first), 0);
    add(&mut world, &mapped, Shading::Custom(first), 0);
    add(
        &mut world,
        &mapped,
        Shading::Custom(first + 1),
        feature::DOUBLE_SIDED,
    );
    add(&mut world, &triangle(false), Shading::Custom(first + 2), 0);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let mut made: Vec<(u32, u32)> = world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] >= first)
        .map(|(_, o)| (o[1], o[6]))
        .collect();
    made.sort_unstable();
    made.dedup();
    assert_eq!(made, vec![(first, 0), (first + 1, state_flags::CULL_NONE)]);
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

/// A change of custom values uploads their row alone, after every material's row: `row_of` finds
/// the first row that a command writes, or `None` for another command.
fn check_custom_values<B: FrameBuilder>(
    mut world: World<B>,
    row_of: impl Fn(&(Op, Vec<u32>)) -> Option<u32>,
) {
    add(
        &mut world,
        &mapped_triangle(),
        Shading::Custom(template::CUSTOM_FIRST),
        0,
    );
    add(
        &mut world,
        &mapped_triangle(),
        Shading::Custom(template::CUSTOM_FIRST),
        0,
    );
    world.record(true);
    let capacity = world.renderer.settings().materials().capacity();
    let materials = world.renderer.settings_mut().materials_mut();
    materials.set_values(1, 4, &[0.5, 0.25, 0.125]).unwrap();
    world.record(false);
    MockBackend::default()
        .replay(world.renderer.list(0).words())
        .unwrap();
    let rows: Vec<u32> = world.commands().iter().filter_map(row_of).collect();
    assert_eq!(rows, vec![capacity + 1]);
}

#[test]
fn custom_values_upload_after_the_rows_on_webgpu() {
    check_custom_values(World::new(), |(op, o)| {
        (*op == Op::WriteBuffer && o[0] == 1).then(|| o[1] / 128)
    });
}

#[test]
fn custom_values_upload_after_the_rows_on_webgl2() {
    let world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    check_custom_values(world, |(op, o)| {
        (*op == Op::WriteTexture && o[5] == 8).then(|| o[3])
    });
}
