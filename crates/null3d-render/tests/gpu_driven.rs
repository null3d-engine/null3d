//! The WebGPU frame builder, checked through the mock backend, which rejects what a real GPU
//! would, and by decoding the lists it records.

mod common;

use common::{BATCH_ROWS, SCENE_CAPACITY, World, count};
use null3d_gpu::drawlist::Op;
use null3d_gpu::mock::MockBackend;

const MATRIX_BYTES: u32 = 48;

#[test]
fn the_first_frame_creates_everything_and_a_valid_frame_replays() {
    let mut world = World::new();
    world.record(true);
    let commands = world.commands();
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();

    assert_eq!(count(&commands, Op::CreateRenderPipeline), 2);
    assert_eq!(count(&commands, Op::CreateComputePipeline), 1);
    assert_eq!(count(&commands, Op::ResizeCanvas), 1);
    assert_eq!(count(&commands, Op::CreateTexture), 2);
    // Buckets: box lit (one object and the batch), box unlit, ball lit; the hidden ball draws
    // nowhere.
    assert_eq!(count(&commands, Op::DrawIndexedIndirect), 3);
    assert_eq!(count(&commands, Op::ExecuteBundles), 1);
    // The first frame uploads every matrix: the scene's slots, then the batch's rows.
    let sources = SCENE_CAPACITY + 1 + BATCH_ROWS;
    let dispatch = commands.iter().find(|(op, _)| *op == Op::Dispatch).unwrap();
    assert_eq!(dispatch.1, vec![sources.div_ceil(128), 1, 1]);
    let matrix_writes: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == 4)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(matrix_writes.len(), 2);
    assert_eq!(matrix_writes[0][3], (SCENE_CAPACITY + 1) * MATRIX_BYTES);
    assert_eq!(matrix_writes[1][1], (SCENE_CAPACITY + 1) * MATRIX_BYTES);
    assert_eq!(matrix_writes[1][3], BATCH_ROWS * MATRIX_BYTES);
}

#[test]
fn after_a_gpu_reset_the_next_frame_replays_on_a_new_device() {
    let mut world = World::new();
    let mut lost = MockBackend::default();
    world.record(true);
    lost.replay(world.renderer.list(1).words()).unwrap();
    let first = world.commands();
    world.frame = 2;
    world.record(false);
    lost.replay(world.renderer.list(2).words()).unwrap();

    world.renderer.reset_gpu();
    world.frame = 3;
    world.record(false);
    MockBackend::default()
        .replay(world.renderer.list(3).words())
        .unwrap();
    let again = world.commands();

    for op in [
        Op::CreateRenderPipeline,
        Op::CreateComputePipeline,
        Op::CreateBuffer,
        Op::CreateTexture,
        Op::ResizeCanvas,
        Op::ExecuteBundles,
    ] {
        assert_eq!(count(&again, op), count(&first, op), "{op:?}");
    }
    let writes = |commands: &[(Op, Vec<u32>)]| {
        commands
            .iter()
            .filter(|(op, _)| *op == Op::WriteBuffer)
            .map(|(_, o)| o[0])
            .collect::<std::collections::BTreeSet<u32>>()
    };
    assert_eq!(writes(&again), writes(&first));
}

#[test]
fn a_steady_frame_uploads_only_changed_rows_and_replays_the_same_bundle() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    world.frame = 2;
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();

    assert_eq!(count(&commands, Op::CreateBuffer), 0);
    assert_eq!(count(&commands, Op::BeginBundle), 0);
    assert_eq!(count(&commands, Op::CreateTexture), 0);
    // The dynamic batch changes every row; the static objects and the camera do not move.
    let matrix_writes: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == 4)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(matrix_writes.len(), 1);
    assert_eq!(matrix_writes[0][1], (SCENE_CAPACITY + 1) * MATRIX_BYTES);
    assert_eq!(matrix_writes[0][3], BATCH_ROWS * MATRIX_BYTES);
    assert_eq!(count(&commands, Op::ExecuteBundles), 1);
}

#[test]
fn a_new_canvas_size_resizes_the_canvas_and_its_targets_in_the_same_frame() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    world.frame = 2;
    world.canvas = (800, 600);
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    let resize = commands
        .iter()
        .position(|(op, _)| *op == Op::ResizeCanvas)
        .unwrap();
    assert_eq!(commands[resize].1, vec![800, 600]);
    let pass = commands
        .iter()
        .position(|(op, _)| *op == Op::BeginRenderPass)
        .unwrap();
    assert!(resize < pass);
    assert_eq!(count(&commands, Op::CreateTexture), 2);
}

#[test]
fn a_structure_change_rebuilds_the_buckets() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The shown ball takes the box mesh: it moves from the ball bucket to the lit box bucket, and
    // the bucket count stays three.
    world.frame = 2;
    world.scene.begin_frame(2);
    let ball = world.objects[2];
    world
        .scene
        .apply_commands(&[null3d_core::scene::Command::set_mesh(ball, 1)], 2)
        .unwrap();
    assert!(world.scene.take_structure_changed());
    world.record(true);
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::BeginBundle), 1);
    assert_eq!(count(&commands, Op::DrawIndexedIndirect), 3);
    // Slices, in key order: lit boxes (two objects and the batch), lit balls (the hidden one),
    // unlit boxes.
    let slices: Vec<u32> = commands
        .iter()
        .filter(|(op, o)| *op == Op::SetVertexBuffer && o[0] == 1)
        .map(|(_, o)| o[3] / 64)
        .collect();
    assert_eq!(slices, vec![2 + BATCH_ROWS, 1, 1]);
}

/// Writes to the bucket table in a frame's commands: offset and byte count.
fn bucket_table_writes(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == 5)
        .map(|(_, o)| (o[1], o[3]))
        .collect()
}

#[test]
fn showing_or_hiding_an_object_rewrites_its_entry_without_a_rebuild() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The first frame's creation was a structure change, which the engine consumes each frame.
    assert!(world.scene.take_structure_changed());
    for (frame, object, visible) in [(2, 3, true), (3, 0, false)] {
        world.frame = frame;
        world.scene.begin_frame(frame);
        let handle = world.objects[object];
        world
            .scene
            .apply_commands(
                &[null3d_core::scene::Command::set_visible(handle, visible)],
                frame,
            )
            .unwrap();
        assert!(!world.scene.take_structure_changed());
        world.record(false);
        mock.replay(world.renderer.list(frame).words()).unwrap();
        let commands = world.commands();
        assert_eq!(count(&commands, Op::BeginBundle), 0);
        assert_eq!(count(&commands, Op::CreateBuffer), 0);
        let slot = world.scene.resolve(handle).unwrap();
        assert_eq!(bucket_table_writes(&commands), vec![(slot * 4, 4)]);
    }
}

#[test]
fn a_new_active_count_rewrites_the_rows_without_a_rebuild() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    world.frame = 2;
    let half = BATCH_ROWS / 2;
    world
        .batches
        .get_mut(world.batch)
        .unwrap()
        .set_active_count(half)
        .unwrap();
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::BeginBundle), 0);
    assert_eq!(count(&commands, Op::CreateBuffer), 0);
    // The batch's rows follow the scene's slots; the rows past the new count are hidden.
    let base = SCENE_CAPACITY + 1;
    assert_eq!(
        bucket_table_writes(&commands),
        vec![((base + half) * 4, half * 4)]
    );
}

#[test]
fn the_source_limit_keeps_every_storage_buffer_within_the_default_binding() {
    use null3d_gpu::drawlist::sizes;
    use null3d_render::gpu_driven::{MAX_SOURCES, grown_size};

    assert_eq!(MAX_SOURCES, 2_097_152);
    assert!(
        u64::from(MAX_SOURCES) * u64::from(sizes::INSTANCE_STRIDE)
            <= u64::from(sizes::MAX_STORAGE_BINDING_BYTES)
    );
    assert!(MAX_SOURCES.div_ceil(sizes::CULL_WORKGROUP_SIZE) <= u32::from(u16::MAX));
    // Room to grow, but never past the largest binding, and never below what is needed.
    assert_eq!(grown_size(1000), 1536);
    let full = MAX_SOURCES * sizes::INSTANCE_STRIDE;
    assert_eq!(grown_size(full), sizes::MAX_STORAGE_BINDING_BYTES);
    assert_eq!(grown_size(full - 1000), sizes::MAX_STORAGE_BINDING_BYTES);
}
