//! Draws whose instance count the GPU writes, checked by decoding the frame's commands: the
//! buffers the frame makes, the page's count in the count word, the copy that reaches the
//! indirect draw after the compute step, and the page's count in a shadow view.

mod common;

use common::World;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, buffer_usage as usage_flags};
use null3d_gpu::mock::MockBackend;
use null3d_render::feature_instances::{INSTANCE_BYTES, INSTANCE_FLOATS};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{feature_buffer_ids, view_indirect_buffer};
use null3d_render::view::ViewId;

/// A world whose first object draws a feature-instance draw of `capacity` instances, with `count`
/// as the page's count, as its first frame records.
fn with_feature_draw(capacity: u32, count: u32) -> (World, u32, u32) {
    let mut world = World::new();
    let handle = world.objects[0];
    // Bounds of its own give the object a bucket of its own, as the adapter's bounds do.
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::set_flags(
                handle,
                flags::CUSTOM_BOUNDS,
                flags::CUSTOM_BOUNDS,
            )],
            1,
        )
        .unwrap();
    let slot = world.scene.resolve(handle).unwrap();
    let table = world.renderer.settings_mut().feature_instances_mut();
    let id = table.create(slot, capacity).unwrap();
    assert!(table.set_count(id, count));
    let (instances, counts) = feature_buffer_ids(id);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    (world, instances, counts)
}

#[test]
fn the_frame_makes_the_add_ons_buffers_and_copies_the_page_count_into_the_draw() {
    let (world, instances, counts) = with_feature_draw(128, 7);
    let commands = world.commands();
    let created = |id: u32| {
        commands
            .iter()
            .find(|(op, o)| *op == Op::CreateBuffer && o[0] == id)
            .map(|(_, o)| (o[1], o[2]))
    };
    // The instance buffer holds the add-on's capacity of engine-format rows, and the count word is
    // one word. Both take a compute pass's writes, and the instances are a vertex buffer too.
    let (bytes, usage) = created(instances).expect("the instance buffer exists");
    assert_eq!(bytes, 128 * INSTANCE_BYTES);
    assert_eq!(usage & usage_flags::STORAGE, usage_flags::STORAGE);
    assert_eq!(usage & usage_flags::VERTEX, usage_flags::VERTEX);
    let (bytes, usage) = created(counts).expect("the count word exists");
    assert_eq!(bytes, 4);
    assert_eq!(usage & usage_flags::STORAGE, usage_flags::STORAGE);
    assert_eq!(usage & usage_flags::COPY_SRC, usage_flags::COPY_SRC);
    // The page's count reaches the count word before any compute pass runs.
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::WriteBuffer && o[0] == counts && o[1] == 0)
    );

    // The count word is copied into one of the camera view's indirect draws, and the pass draws
    // that entry with its count.
    let copy = commands
        .iter()
        .find(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts)
        .expect("the count reaches the indirect draw");
    assert_eq!(copy.1[1], 0);
    assert_eq!(copy.1[2], view_indirect_buffer(ViewId::CAMERA));
    assert_eq!(copy.1[4], 4);
    let entry = copy.1[3] - 4;
    assert!(commands.iter().any(|(op, o)| *op == Op::DrawIndexedIndirect
        && o[0] == view_indirect_buffer(ViewId::CAMERA)
        && o[1] == entry));
}

#[test]
fn the_count_reaches_the_draw_after_the_compute_step() {
    let (world, _instances, counts) = with_feature_draw(64, 3);
    let commands = world.commands();
    let at = |op: Op| -> Vec<usize> {
        commands
            .iter()
            .enumerate()
            .filter(|(_, (o, _))| *o == op)
            .map(|(index, _)| index)
            .collect()
    };
    let dispatch = at(Op::Dispatch)
        .into_iter()
        .next_back()
        .expect("the frame culls with compute");
    let last_copy = at(Op::CopyBufferToBuffer)
        .into_iter()
        .rfind(|&index| commands[index].1[0] == counts)
        .expect("the count reaches the indirect draw");
    // The last copy follows the last compute dispatch: a count that a compute pass writes is
    // final before the pass that reads it.
    assert!(last_copy > dispatch);
}

#[test]
fn the_page_rows_reach_the_add_ons_buffer() {
    let mut world = World::new();
    let handle = world.objects[0];
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::set_flags(
                handle,
                flags::CUSTOM_BOUNDS,
                flags::CUSTOM_BOUNDS,
            )],
            1,
        )
        .unwrap();
    let slot = world.scene.resolve(handle).unwrap();
    let table = world.renderer.settings_mut().feature_instances_mut();
    let id = table.create(slot, 8).unwrap();
    let values = vec![0.5f32; 2 * INSTANCE_FLOATS as usize];
    assert!(table.set_rows(id, &values, 0, 2));
    let (instances, _) = feature_buffer_ids(id);
    world.record(true);
    let commands = world.commands();
    // The rows that the page wrote reach the add-on's instance buffer at its start.
    assert!(commands.iter().any(|(op, o)| *op == Op::WriteBuffer
        && o[0] == instances
        && o[1] == 0
        && o[3] == 2 * INSTANCE_BYTES));
}

#[test]
fn a_shadow_view_draws_the_count_that_the_page_set() {
    let mut world = World::new();
    world.cast_sun_shadows(2);
    let handle = world.objects[0];
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::set_flags(
                handle,
                flags::CUSTOM_BOUNDS | flags::CAST_SHADOWS,
                flags::CUSTOM_BOUNDS | flags::CAST_SHADOWS,
            )],
            1,
        )
        .unwrap();
    let slot = world.scene.resolve(handle).unwrap();
    let table = world.renderer.settings_mut().feature_instances_mut();
    let id = table.create(slot, 32).unwrap();
    assert!(table.set_count(id, 5));
    let (_, counts) = feature_buffer_ids(id);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    let commands = world.commands();
    // Each shadow view draws the page's count, because the add-on's compute writes the main
    // view's count alone.
    assert_eq!(world.renderer.feature_shadow_count(id), Some(5));
    for cascade in 0..2 {
        let buffer = view_indirect_buffer(ViewId::cascade(cascade));
        assert!(
            commands
                .iter()
                .any(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer),
            "cascade {cascade} resets its indirect draws"
        );
    }
    // The main view's count still comes from the add-on's count word.
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts)
    );
}

#[test]
fn a_hidden_draw_keeps_the_reset_and_draws_nothing() {
    let mut world = World::new();
    let handle = world.objects[0];
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(
            &[
                Command::set_flags(handle, flags::CUSTOM_BOUNDS, flags::CUSTOM_BOUNDS),
                Command::set_visible(handle, false),
            ],
            1,
        )
        .unwrap();
    let slot = world.scene.resolve(handle).unwrap();
    let table = world.renderer.settings_mut().feature_instances_mut();
    let id = table.create(slot, 16).unwrap();
    assert!(table.set_count(id, 9));
    let (_, counts) = feature_buffer_ids(id);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    let commands = world.commands();
    // The draw counts nothing while its object is hidden: the frame leaves the reset's 0 in the
    // indirect entry instead of copying the page's count.
    assert!(
        !commands
            .iter()
            .any(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts)
    );
}
