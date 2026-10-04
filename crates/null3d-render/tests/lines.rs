//! Line batches on both frame builders: their segments draw with the line templates, blended ones
//! in the transparent pass, culling keeps a segment that reaches into the view and drops one that
//! does not, and lines stay out of the depth prepass. Checked through the mock backend, which
//! rejects what a real GPU would.

mod common;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::lines::{LineLook, LineMode};
use null3d_gpu::drawlist::{Op, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{Shading, feature};

/// Adds a dynamic batch of one segment from `start` to `end`, `width` world units wide, with a
/// material of `shading` and `features`, and returns it.
fn add_line<B: FrameBuilder>(
    world: &mut World<B>,
    shading: Shading,
    features: u32,
    [start, end]: [[f32; 3]; 2],
    width: f32,
) -> Handle {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(shading, features | feature::DOUBLE_SIDED, [1.0; 4])
        .unwrap()
        + 1;
    let look = LineLook::new(LineMode::Segments, width, true, false);
    let batch = world
        .batches
        .create_lines(2, true, mesh, material, 1.0, look)
        .unwrap();
    let points = world.batches.get_mut(batch).unwrap().line_points_mut().0;
    points[..3].copy_from_slice(&start);
    points[3..].copy_from_slice(&end);
    batch
}

/// The template and state flags of each render pipeline that a list creates.
fn pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| (o[1], o[6]))
        .collect()
}

#[test]
fn lines_draw_with_the_line_templates_and_blended_ones_blend_on_both_paths() {
    let gpu = World::new();
    let cpu = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    fn check<B: FrameBuilder>(mut world: World<B>) {
        let mut mock = MockBackend::default();
        let up = [[0.0, 2.0, 0.0], [1.0, 2.0, 0.0]];
        let down = [[0.0, -2.0, 0.0], [1.0, -2.0, 0.0]];
        add_line(&mut world, Shading::Line, 0, up, 0.1);
        add_line(&mut world, Shading::Line, feature::BLEND, down, 0.1);
        add_line(&mut world, Shading::LineLit, 0, up, 0.1);
        let commands = world.step(&mut mock, true);
        let made = pipelines(&commands);
        let lines: Vec<_> = made.iter().filter(|&&(t, _)| t == template::LINE).collect();
        assert_eq!(lines.len(), 2, "{made:?}");
        assert!(lines.iter().all(|&&(_, s)| s & state_flags::CULL_NONE != 0));
        let blended = lines.iter().filter(|&&&(_, s)| s & state_flags::BLEND != 0);
        assert_eq!(blended.count(), 1);
        let lit = made.iter().filter(|&&(t, _)| t == template::LINE_LIT);
        assert_eq!(lit.count(), 1, "{made:?}");
    }
    check(gpu);
    check(cpu);
}

#[test]
fn a_segment_culls_by_its_whole_length_and_its_width() {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let visible =
        |world: &World<CpuCulledRenderer>| world.renderer.visible_entries(world.frame - 1).unwrap();
    let before = visible(&world);
    // A short segment far to the side of the camera's view.
    add_line(
        &mut world,
        Shading::Line,
        0,
        [[500.0, 0.0, 0.0], [501.0, 0.0, 0.0]],
        0.1,
    );
    world.step(&mut mock, true);
    assert_eq!(visible(&world), before);
    // A long segment whose middle lies far to the side, and whose start lies in the view.
    add_line(
        &mut world,
        Shading::Line,
        0,
        [[0.0, 0.0, 0.0], [1000.0, 0.0, 0.0]],
        0.1,
    );
    world.step(&mut mock, true);
    assert_eq!(visible(&world), before + 1);
    // A short segment beside the view whose width in the world reaches into it.
    add_line(
        &mut world,
        Shading::Line,
        0,
        [[0.0, 60.0, 0.0], [0.1, 60.0, 0.0]],
        200.0,
    );
    world.step(&mut mock, true);
    assert_eq!(visible(&world), before + 2);
}

#[test]
fn lines_stay_out_of_the_depth_prepass() {
    let mut world = World::new();
    for shading in [Shading::Line, Shading::LineLit] {
        let line = add_line(&mut world, shading, 0, [[0.0; 3], [1.0, 0.0, 0.0]], 0.1);
        let batch = world.batches.get(line).unwrap();
        let key = world
            .renderer
            .settings()
            .pipeline_of(batch.mesh(), batch.material())
            .unwrap();
        assert_eq!(key.template, shading.template());
        assert_eq!(key.prepass(), None);
    }
}
