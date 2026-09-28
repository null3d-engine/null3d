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
    // Showing the hidden ball adds it to the ball bucket; the bucket count stays three.
    world.frame = 2;
    world.scene.begin_frame(2);
    let hidden = world.objects[3];
    world
        .scene
        .apply_commands(&[null3d_core::scene::Command::set_visible(hidden, true)], 2)
        .unwrap();
    world.scene.update_transforms(&world.jobs);
    world.batches.update(&world.jobs, 2);
    world.snapshot.record(2, &world.scene, &world.batches);
    world
        .renderer
        .record(&null3d_render::gpu_driven::FrameInput {
            frame: 2,
            scene: &world.scene,
            batches: &world.batches,
            snapshot: &world.snapshot,
            canvas: world.canvas,
            structure_changed: true,
        })
        .unwrap();
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::BeginBundle), 1);
    assert_eq!(count(&commands, Op::DrawIndexedIndirect), 3);
    // The ball bucket's slice grows from one instance to two.
    let slices: Vec<u32> = commands
        .iter()
        .filter(|(op, o)| *op == Op::SetVertexBuffer && o[0] == 1)
        .map(|(_, o)| o[3] / 64)
        .collect();
    assert_eq!(slices, vec![1 + BATCH_ROWS, 2, 1]);
}
