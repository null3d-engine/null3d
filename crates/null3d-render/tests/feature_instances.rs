//! Draws whose instance count the GPU writes, checked by decoding the frame's commands: the
//! buffers the frame makes, the page's count in the count word, the copy that reaches the
//! indirect draw after the compute step, the conversion of the world rows to camera-relative rows
//! before the draw, and the GPU's count in every shadow view.

mod common;

use common::World;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{
    Op, buffer_usage as usage_flags, layout as bind_layout, resource_kind, template,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::feature_instances::{INSTANCE_BYTES, INSTANCE_FLOATS};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{
    RendererConfig, feature_buffer_ids, feature_relative_buffer, view_indirect_buffer,
};
use null3d_render::view::ViewId;

/// A world whose first object draws a feature-instance draw of `capacity` instances, with `count`
/// as the page's count, as its first frame records. `bounds` are the object's bounds flags, as the
/// adapter sets them.
fn with_feature_draw(capacity: u32, count: u32, bounds: u32) -> (World, u32, u32) {
    feature_draw_on(World::new(), capacity, count, bounds)
}

/// The same draw on `world`, whose first frame records and whose commands it replays.
fn feature_draw_on(mut world: World, capacity: u32, count: u32, bounds: u32) -> (World, u32, u32) {
    let handle = world.objects[0];
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(&[Command::set_flags(handle, flags::BOUNDS, bounds)], 1)
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
    let (world, instances, counts) = with_feature_draw(128, 7, flags::CUSTOM_BOUNDS);
    let commands = world.commands();
    let created = |id: u32| {
        commands
            .iter()
            .find(|(op, o)| *op == Op::CreateBuffer && o[0] == id)
            .map(|(_, o)| (o[1], o[2]))
    };
    // The world buffer holds the add-on's capacity of engine-format rows, and a compute pass
    // writes it. The camera-relative buffer that the draw reads holds as many rows and is a vertex
    // buffer, and the count word is one word.
    let (bytes, usage) = created(instances).expect("the world rows exist");
    assert_eq!(bytes, 128 * INSTANCE_BYTES);
    assert_eq!(usage & usage_flags::STORAGE, usage_flags::STORAGE);
    let relative = feature_relative_buffer(1);
    let (bytes, usage) = created(relative).expect("the relative rows exist");
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
fn a_device_that_chose_the_direct_path_draws_a_feature_draw_indirectly() {
    // The direct path counts every draw on the CPU and creates no indirect buffer, so a draw whose
    // count the GPU writes takes the indirect path for the whole session. The frame then makes the
    // camera's indirect buffer and copies the count into it, and it replays without a missing
    // buffer.
    let direct = RendererConfig {
        direct_draws: true,
        ..RendererConfig::default()
    };
    let (world, _instances, counts) =
        feature_draw_on(World::with_config(direct), 16, 5, flags::UNCULLED);
    let commands = world.commands();
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::CreateBuffer && o[0] == view_indirect_buffer(ViewId::CAMERA)),
        "the camera's indirect buffer exists"
    );
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts),
        "the count reaches the indirect draw"
    );
}

#[test]
fn an_unculled_draw_reads_its_own_buffer_and_draws_its_count() {
    // The adapter marks its object unculled, and a mesh made from arrays carries no bounds of its
    // own. The bucket must still name the draw, so the pass reads the rows that the conversion
    // wrote for it, and the count that the frame copies into the indirect entry.
    let (world, _instances, counts) = with_feature_draw(16, 5, flags::UNCULLED);
    let commands = world.commands();
    let relative = feature_relative_buffer(1);
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::SetVertexBuffer && o[0] == 1 && o[1] == relative),
        "the draw reads the camera-relative rows, not the view's compacted instances"
    );
    let copy = commands
        .iter()
        .find(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts)
        .expect("the count reaches the indirect draw");
    let entry = copy.1[3] - 4;
    assert!(commands.iter().any(|(op, o)| *op == Op::DrawIndexedIndirect
        && o[0] == view_indirect_buffer(ViewId::CAMERA)
        && o[1] == entry));
}

#[test]
fn the_count_reaches_the_draw_after_the_compute_step() {
    let (world, _instances, counts) = with_feature_draw(64, 3, flags::CUSTOM_BOUNDS);
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
fn a_shadow_view_draws_the_count_that_the_gpu_writes() {
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
    // Every shadow view takes the add-on's count word, as the camera's view does: the count that
    // the GPU writes is the one that casts the shadow, whatever the page set.
    let last_dispatch = commands
        .iter()
        .rposition(|(op, _)| *op == Op::Dispatch)
        .expect("the frame culls with compute");
    let first_render = commands
        .iter()
        .position(|(op, _)| *op == Op::BeginRenderPass)
        .expect("the frame draws");
    for cascade in 0..2 {
        let buffer = view_indirect_buffer(ViewId::cascade(cascade));
        // The view resets its indirect draws from the template before the copy reaches them.
        assert!(
            commands
                .iter()
                .any(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer),
            "cascade {cascade} resets its indirect draws"
        );
        let copy = commands
            .iter()
            .position(|(op, o)| {
                *op == Op::CopyBufferToBuffer
                    && o[0] == counts
                    && o[1] == 0
                    && o[2] == buffer
                    && o[4] == 4
            })
            .unwrap_or_else(|| panic!("cascade {cascade} takes the add-on's count"));
        assert!(
            copy > last_dispatch,
            "cascade {cascade} takes the count after every compute step"
        );
        assert!(
            copy < first_render,
            "cascade {cascade} takes the count before the first render pass"
        );
    }
    // The camera's view takes the same word.
    assert!(commands.iter().any(|(op, o)| *op == Op::CopyBufferToBuffer
        && o[0] == counts
        && o[2] == view_indirect_buffer(ViewId::CAMERA)));
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

#[test]
fn a_frame_records_the_draw_only_once_the_feature_is_ready() {
    // The design note asks that the engine record no draw for a feature that is not ready. The page
    // makes the draw ready between two frames: the frame before holds no feature draw, so it
    // records no count copy and none of its draws, and the frame after records the draw that reads
    // the reserved indirect entry.
    let mut world = World::new();
    let handle = world.objects[0];
    world.scene.set_local_radius(handle, 1.0).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::set_flags(
                handle,
                flags::BOUNDS,
                flags::CUSTOM_BOUNDS,
            )],
            1,
        )
        .unwrap();
    let slot = world.scene.resolve(handle).unwrap();
    let counts = feature_buffer_ids(1).1;

    let mock = &mut MockBackend::default();
    let pending = world.step(mock, true);
    assert!(
        !pending
            .iter()
            .any(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts),
        "a frame without a ready feature draw copies no count word"
    );

    // The page makes the draw ready.
    let table = world.renderer.settings_mut().feature_instances_mut();
    let id = table.create(slot, 16).unwrap();
    assert!(table.set_count(id, 5));
    let ready = world.step(mock, true);
    // The frame copies the count word into the draw's reserved indirect entry, which the view then
    // draws: the command names the view's buffer and the reserved place in it.
    let camera = view_indirect_buffer(ViewId::CAMERA);
    let word = ready
        .iter()
        .find(|(op, o)| *op == Op::CopyBufferToBuffer && o[0] == counts && o[2] == camera)
        .map(|(_, o)| o[3])
        .expect("the ready frame copies the count");
    assert!(
        ready
            .iter()
            .any(|(op, o)| *op == Op::DrawIndexedIndirect && o[0] == camera && o[1] == word - 4),
        "the ready frame draws the reserved indirect entry"
    );
}

/// The index of the dispatch that follows the first group of `layout` that the frame binds, or
/// `None` when the frame binds no such group.
fn dispatch_after_group(commands: &[(Op, Vec<u32>)], layout: u32) -> Option<usize> {
    let group = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout)?
        .1[0];
    let set = commands
        .iter()
        .position(|(op, o)| *op == Op::SetBindGroup && o[1] == group)?;
    commands
        .iter()
        .enumerate()
        .skip(set)
        .find(|(_, (op, _))| *op == Op::Dispatch)
        .map(|(index, _)| index)
}

#[test]
fn the_conversion_follows_the_compute_steps_and_precedes_the_opaque_pass() {
    let (world, _instances, _counts) = with_feature_draw(64, 5, flags::CUSTOM_BOUNDS);
    let commands = world.commands();
    let conversion = dispatch_after_group(&commands, bind_layout::FEATURE_ROWS)
        .expect("the frame converts the rows");
    let first_render = commands
        .iter()
        .position(|(op, _)| *op == Op::BeginRenderPass)
        .expect("the frame draws");
    // The engine culls in compute passes, and the conversion's own pass comes after every step of
    // them and before the first render pass: a compute write is final at that one point.
    let last_compute_end = commands
        .iter()
        .enumerate()
        .take(conversion)
        .filter(|(_, (op, _))| *op == Op::EndComputePass)
        .map(|(index, _)| index)
        .next_back()
        .expect("the engine culls in compute passes");
    assert!(
        last_compute_end < conversion,
        "the conversion runs after the engine's compute steps"
    );
    assert!(
        conversion < first_render,
        "the conversion runs before the first render pass"
    );
    // The count copy follows the conversion, outside its compute pass.
    let count_copy = commands
        .iter()
        .enumerate()
        .skip(conversion)
        .find(|(_, (op, o))| *op == Op::CopyBufferToBuffer && o[0] == feature_buffer_ids(1).1)
        .map(|(index, _)| index)
        .expect("the count reaches the indirect draw after the conversion");
    assert!(count_copy > conversion);
}

#[test]
fn a_frame_without_a_feature_draw_converts_nothing() {
    let mut world = World::new();
    world.record(true);
    let commands = world.commands();
    assert!(
        !commands
            .iter()
            .any(|(op, o)| *op == Op::CreateComputePipeline && o[1] == template::FEATURE_ROWS),
        "the frame makes no conversion pipeline"
    );
    assert!(
        !commands
            .iter()
            .any(|(op, o)| *op == Op::CreateBindGroup && o[1] == bind_layout::FEATURE_ROWS),
        "the frame makes no conversion group"
    );
    assert_eq!(
        dispatch_after_group(&commands, bind_layout::FEATURE_ROWS),
        None
    );
}

#[test]
fn the_conversion_binds_the_world_rows_its_rows_and_the_count() {
    let (world, instances, counts) = with_feature_draw(32, 5, flags::CUSTOM_BOUNDS);
    let commands = world.commands();
    let group = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBindGroup && o[1] == bind_layout::FEATURE_ROWS)
        .map(|(_, o)| o.clone())
        .expect("the frame makes the conversion's group");
    // A group lists each binding's index, kind and buffer, in binding order, after its own id,
    // layout and binding count.
    assert_eq!(group[2], 4, "the group binds four resources");
    assert_eq!(
        (group[3], group[4]),
        (0, resource_kind::BUFFER),
        "binding 0 is the camera's block"
    );
    assert_eq!(
        (group[8], group[10]),
        (1, counts),
        "binding 1 reads the count word"
    );
    assert_eq!(
        (group[13], group[15]),
        (2, instances),
        "binding 2 reads the world rows"
    );
    let relative = feature_relative_buffer(1);
    assert_eq!(
        (group[18], group[20]),
        (3, relative),
        "binding 3 writes the camera-relative rows"
    );
}
