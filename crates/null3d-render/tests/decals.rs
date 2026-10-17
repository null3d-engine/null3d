//! Decals, drawn by both frame builders: an object whose material is a decal's draws in the decal
//! pass after the camera's opaque pass, with the decal templates, which read the scene's depth
//! through a group of their own. It draws in no other pass. Without a decal, the frame records
//! none of it. Checked through the mock backend, which rejects what a real GPU would, and by
//! decoding the lists.

mod common;

use common::{World, grid};
use null3d_core::scene::Command;
use null3d_gpu::drawlist::{Op, format, layout, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{Shading, feature};

/// The operands of each pipeline that a frame's commands create with a decal template.
fn decal_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateRenderPipeline
                && (o[1] == template::DECAL || o[1] == template::DECAL_MAPS)
        })
        .map(|(_, o)| o.clone())
        .collect()
}

/// The groups of the scene's depth that a frame's commands create, by their layouts.
fn depth_groups(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateBindGroup
                && (o[1] == layout::DECAL_DEPTH || o[1] == layout::DECAL_DEPTH_MS)
        })
        .map(|(_, o)| o[1])
        .collect()
}

/// The place in a frame's commands of the first draw with the pipeline `id`, if any.
fn first_draw_with(commands: &[(Op, Vec<u32>)], id: u32) -> Option<usize> {
    let mut current = None;
    commands.iter().enumerate().find_map(|(k, (op, o))| {
        match op {
            Op::SetPipeline => current = Some(o[0]),
            Op::DrawIndexed | Op::MultiDrawIndexed if current == Some(id) => return Some(k),
            _ => {}
        }
        None
    })
}

/// Records three frames, and returns the commands of each.
fn frames<B: FrameBuilder>(
    world: &mut World<B>,
    mock: &mut MockBackend,
) -> Vec<Vec<(Op, Vec<u32>)>> {
    (0..3).map(|k| world.step(mock, k == 0)).collect()
}

fn check<B: FrameBuilder>(mut world: World<B>) {
    let plane = grid(1, 1);
    let mut mock = MockBackend::default();
    // A scene without decals records nothing of them.
    world.add_object(&plane, Shading::Lit);
    for commands in &frames(&mut world, &mut mock) {
        assert!(decal_pipelines(commands).is_empty());
        assert!(depth_groups(commands).is_empty());
    }

    // A decal: its object draws with the decal template alone.
    world.add_object_with(&plane, Shading::Lit, feature::DECAL);
    let decal = frames(&mut world, &mut mock);
    let made: Vec<Vec<u32>> = decal.iter().flat_map(|c| decal_pipelines(c)).collect();
    assert_eq!(made.len(), 1, "one decal pipeline: {made:?}");
    let pipeline = &made[0];
    assert_eq!(pipeline[1], template::DECAL);
    assert_eq!(
        pipeline[4],
        format::NONE,
        "the decal pass has no depth target"
    );
    let state = pipeline[6];
    let wanted = state_flags::CULL_FRONT | state_flags::NO_DEPTH_TEST | state_flags::BLEND_NORMAL;
    assert_eq!(state & wanted, wanted, "back faces, no depth test, blended");
    assert_eq!(
        decal.iter().map(|c| depth_groups(c).len()).sum::<usize>(),
        1,
        "the depth's group is made once"
    );
    // Each frame draws the decal with its pipeline, after the opaque objects.
    let last = decal.last().unwrap();
    let drawn = first_draw_with(last, pipeline[0]).expect("the decal draws");
    // The opaque pass draws first: from its bundle on WebGPU, or with draws on WebGL2.
    let opaque = last
        .iter()
        .position(|(op, _)| {
            matches!(
                op,
                Op::ExecuteBundles | Op::DrawIndexed | Op::MultiDrawIndexed
            )
        })
        .unwrap();
    assert!(opaque < drawn, "the opaque objects draw first");
}

/// The pipelines that a frame's commands create to draw objects again after the decals: they pass
/// where the depth equals or is nearer, and write none.
fn redraw_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    let redraw = state_flags::DEPTH_OR_EQUAL | state_flags::NO_DEPTH_WRITE;
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[6] & redraw == redraw)
        .map(|(_, o)| o.clone())
        .collect()
}

fn check_layers<B: FrameBuilder>(mut world: World<B>) {
    let plane = grid(1, 1);
    let mut mock = MockBackend::default();
    world.add_object_with(&plane, Shading::Lit, feature::DECAL);
    // While decals mark every layer, nothing draws again.
    for commands in &frames(&mut world, &mut mock) {
        assert!(redraw_pipelines(commands).is_empty());
    }
    // An object on layer 1 too, which decals skip, draws again after them with the redraw's
    // pipelines.
    let walker = world.objects[0];
    world
        .scene
        .apply_commands(&[Command::set_layers(walker, 0b11)], world.frame)
        .unwrap();
    world.renderer.settings_mut().set_decal_layers(!0b10);
    let skipped = frames(&mut world, &mut mock);
    let made: Vec<Vec<u32>> = skipped.iter().flat_map(|c| redraw_pipelines(c)).collect();
    assert!(!made.is_empty(), "the skipped object's pipeline is made");
    let last = skipped.last().unwrap();
    assert!(
        made.iter().any(|p| first_draw_with(last, p[0]).is_some()),
        "the skipped object draws again"
    );
    // Back to every layer: the frame draws nothing again.
    world.renderer.settings_mut().set_decal_layers(!0);
    let last = frames(&mut world, &mut mock).pop().unwrap();
    assert!(made.iter().all(|p| first_draw_with(&last, p[0]).is_none()));
}

#[test]
fn objects_on_layers_that_decals_skip_draw_again_on_webgpu() {
    check_layers(World::new());
}

#[test]
fn objects_on_layers_that_decals_skip_draw_again_on_webgl2() {
    check_layers(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// The operands of each group of `layout` that a frame's commands create.
fn groups_of(commands: &[(Op, Vec<u32>)], layout: u32) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The entries of a group that a command creates: each one's binding, kind and object.
fn entries(group: &[u32]) -> Vec<&[u32]> {
    group[3..].chunks(5).collect()
}

/// The frame group's bindings of the light probe grids' texture and of the copy of the opaque
/// color, which no decal build reads.
const UNREAD_BY_DECALS: [u32; 2] = [10, 15];

#[test]
fn decals_bind_the_frame_group_without_the_textures_they_never_read_on_webgpu() {
    let plane = grid(1, 1);
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.add_object(&plane, Shading::Lit);
    let plain = frames(&mut world, &mut mock);
    for commands in &plain {
        assert!(groups_of(commands, layout::DECAL_FRAME).is_empty());
    }
    let camera = groups_of(&plain[0], layout::FRAME).swap_remove(0);

    // The decal pass's frame group binds the camera's, without the grid and the copy, so a decal
    // with maps reads 15 sampled textures in its fragment stage, within WebGPU's 16.
    world.add_object_with(&plane, Shading::Lit, feature::DECAL);
    let decal = frames(&mut world, &mut mock);
    let made: Vec<Vec<u32>> = decal
        .iter()
        .flat_map(|c| groups_of(c, layout::DECAL_FRAME))
        .collect();
    assert_eq!(made.len(), 1, "the decal frame group is made once");
    let kept: Vec<&[u32]> = entries(&camera)
        .into_iter()
        .filter(|e| !UNREAD_BY_DECALS.contains(&e[0]))
        .collect();
    assert_eq!(entries(&made[0]), kept);
    assert_eq!(made[0][2] as usize, kept.len());

    // The decal pass binds it at group 0 before it draws.
    let last = decal.last().unwrap();
    let pipeline = decal
        .iter()
        .flat_map(|c| decal_pipelines(c))
        .next()
        .unwrap();
    let drawn = first_draw_with(last, pipeline[0]).expect("the decal draws");
    let bound = last[..drawn]
        .iter()
        .rev()
        .find(|(op, o)| *op == Op::SetBindGroup && o[0] == 0)
        .map(|(_, o)| o[1]);
    assert_eq!(bound, Some(made[0][0]));

    // New render targets make the camera's frame group again, and the decals' with it.
    world.canvas = (800, 450);
    let resized = world.step(&mut mock, false);
    assert_eq!(groups_of(&resized, layout::DECAL_FRAME).len(), 1);
}

#[test]
fn decals_draw_after_the_opaque_objects_only_while_one_exists_on_webgpu() {
    check(World::new());
}

#[test]
fn decals_draw_after_the_opaque_objects_only_while_one_exists_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check(World::build(CpuCulledRenderer::new(config)));
    }
}
