//! The WebGL2 frame builder, checked through the mock backend, which rejects what a real GPU
//! would, by decoding the lists it records, and by its culling output.

mod common;

use common::{BATCH_ROWS, LENS, World, count};
use null3d_core::clusters::{CLUSTER_ROWS, CLUSTER_SHIFT};
use null3d_core::handle::Handle;
use null3d_core::scene::Command;
use null3d_gpu::drawlist::{NO_TARGET, Op};
use null3d_gpu::mock::MockBackend;
use null3d_render::camera::Perspective;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, RecordError};
use null3d_render::graph::ALL_LAYERS;
use null3d_render::view::{View, ViewId};

/// The builder's data texture ids: resident, then the streamed ring, the cluster texture, and the
/// camera view's index list ring.
const RESIDENT: u32 = 1;
const STREAMED: u32 = 2;
const CLUSTERS: u32 = 5;
const VISIBLE: u32 = 6;
/// The buffers of the camera view's frame uniform ring and of its draw records.
const FRAME: u32 = 2;
const DRAWS: u32 = 3;
/// Scene slots up to the highest the world uses: slot 0 is never used, then the camera and four
/// objects.
const SCENE_ROWS: u32 = 6;

fn world(multi_draw: bool) -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }))
}

/// The texture writes of a frame, by texture id: x, y, width, height, and bytes.
fn texture_writes(commands: &[(Op, Vec<u32>)], texture: u32) -> Vec<[u32; 5]> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteTexture && o[0] == texture)
        .map(|(_, o)| [o[2], o[3], o[5], o[6], o[9]])
        .collect()
}

/// Each bucket's index list entries, from the camera view's culling output: its rows, then its
/// clusters.
fn bucket_counts(world: &World<CpuCulledRenderer>) -> Vec<(u32, u32)> {
    view_bucket_counts(world, ViewId::CAMERA)
}

/// Each bucket's index list entries in a view's culling output: its rows, then its clusters.
fn view_bucket_counts(world: &World<CpuCulledRenderer>, view: ViewId) -> Vec<(u32, u32)> {
    let starts = world.renderer.culled(world.frame, view).bucket_starts();
    let entries: Vec<u32> = starts.windows(2).map(|w| w[1] - w[0]).collect();
    entries.chunks(2).map(|pair| (pair[0], pair[1])).collect()
}

/// The operands of each render pass a frame begins.
fn render_passes(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::BeginRenderPass)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The index list textures of the second view: the ring after the camera view's.
const SIDE_VISIBLE: u32 = VISIBLE + 3;

#[test]
fn two_views_list_their_own_visible_objects_and_draw_them_in_passes_of_their_own() {
    for multi_draw in [true, false] {
        let mut world = world(multi_draw);
        // A second camera to the right of the first and nearer: it sees the objects at x = -1
        // and 1 and the batch at the origin, but not the one at x = -3.
        let side = world.add_view([5.0, 0.0, 6.0]);
        world.record(true);
        let mut mock = MockBackend::default();
        mock.replay(world.renderer.list(1).words()).unwrap();

        // Buckets: lit boxes (the object at x = -3), the batch, lit balls (x = 1), and unlit
        // boxes (x = -1). The hidden ball culls away in both.
        assert_eq!(
            view_bucket_counts(&world, ViewId::CAMERA),
            vec![(1, 0), (BATCH_ROWS, 0), (1, 0), (1, 0)]
        );
        assert_eq!(
            view_bucket_counts(&world, side),
            vec![(0, 0), (BATCH_ROWS, 0), (1, 0), (1, 0)]
        );
        let lit_boxes = |view| {
            let culled = world.renderer.culled(world.frame, view);
            let starts = culled.bucket_starts();
            culled.indices()[starts[0] as usize..starts[1] as usize].to_vec()
        };
        let slot = world.scene.resolve(world.objects[0]).unwrap();
        assert_eq!(lit_boxes(ViewId::CAMERA), [slot]);
        assert!(lit_boxes(side).is_empty());
        assert_eq!(
            world.renderer.visible_entries(world.frame),
            Some(2 * BATCH_ROWS + 5),
            "the entries of both views"
        );

        // Each view's list goes into its own ring of index list textures, and each view draws
        // in a render pass of its own: the camera's resolves into the canvas, and the side
        // view's draws into targets of its own. The render passes do not overlap, so the side
        // view's targets share the camera's textures.
        let commands = world.commands();
        let ring = world.frame % 3;
        let visible = BATCH_ROWS + 3;
        assert_eq!(
            texture_writes(&commands, VISIBLE + ring),
            vec![[0, 0, visible, 1, visible * 4]]
        );
        assert_eq!(
            texture_writes(&commands, SIDE_VISIBLE + ring),
            vec![[0, 0, visible - 1, 1, (visible - 1) * 4]]
        );
        let passes = render_passes(&commands);
        assert_eq!(passes.len(), 2);
        assert_eq!(
            passes[0][1], 0,
            "the camera's pass resolves into the canvas"
        );
        assert_eq!(
            passes[1][1], NO_TARGET,
            "nothing reads the side view's color"
        );
        assert_eq!(passes[0][0], passes[1][0]);
        assert_eq!(passes[0][2], passes[1][2]);
        assert_eq!(count(&commands, Op::CreateTexture), 10 + 3);
        // Each pass binds its view's frame uniform and index list textures.
        let bound = |group: u32| -> Vec<u32> {
            commands
                .iter()
                .filter(|(op, o)| *op == Op::SetBindGroup && o[0] == group)
                .map(|(_, o)| o[1])
                .collect()
        };
        assert_eq!(bound(0).len(), 2);
        assert_ne!(bound(0)[0], bound(0)[1]);
        assert_ne!(bound(2)[0], bound(2)[1]);
        assert_eq!(
            mock.draws,
            4 + 3,
            "four buckets drawn by the camera, three by the side view"
        );
    }
}

#[test]
fn a_view_added_later_draws_from_its_own_rings_without_a_rebuild() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    step(&mut world, &mut mock, false);
    // A second view from the first camera, whose object exists: no structure change.
    let camera = world.camera;
    let twin = world
        .renderer
        .settings_mut()
        .add_view(View::new(camera, LENS, ALL_LAYERS))
        .unwrap();
    step(&mut world, &mut mock, false);
    let commands = world.commands();
    assert_eq!(
        view_bucket_counts(&world, twin),
        view_bucket_counts(&world, ViewId::CAMERA),
        "one camera, one visible set"
    );
    assert_eq!(render_passes(&commands).len(), 2);
    // Its index list textures, draw records and frame uniforms are new. The data textures that
    // every view reads and the camera view's rings are not, and its targets share the camera's
    // textures, as their render passes do not overlap.
    assert_eq!(count(&commands, Op::CreateTexture), 3);
    assert_eq!(count(&commands, Op::CreateRenderPipeline), 0);
    assert!(texture_writes(&commands, RESIDENT).is_empty());
    // A new ring lists into the slot after slot 0, as the camera's did in the first frame.
    assert_eq!(texture_writes(&commands, SIDE_VISIBLE + 1).len(), 1);
    // The next frames change nothing: neither view writes its list or its uniform again.
    step(&mut world, &mut mock, false);
    step(&mut world, &mut mock, false);
    let commands = world.commands();
    assert_eq!(count(&commands, Op::CreateTexture), 0);
    for listed in 0..3 {
        assert!(texture_writes(&commands, VISIBLE + listed).is_empty());
        assert!(texture_writes(&commands, SIDE_VISIBLE + listed).is_empty());
    }
    assert_eq!(render_passes(&commands).len(), 2);
}

#[test]
fn a_view_added_after_the_frame_culled_draws_from_the_next_frame() {
    use null3d_render::frame::FrameInput;

    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The engine culls a frame, then records it. A view that arrives in between has no culling
    // output yet: the frame records its pass, which only clears, and the next frame culls it.
    world.frame = 2;
    world.scene.begin_frame(2);
    world.scene.update_transforms(&world.jobs);
    world.batches.update(&world.jobs, 2);
    world.snapshot.record(2, &world.scene, &world.batches);
    let input = FrameInput {
        frame: 2,
        scene: &world.scene,
        batches: &world.batches,
        snapshot: &world.snapshot,
        canvas: world.canvas,
        structure_changed: false,
        jobs: &world.jobs,
    };
    world.renderer.cull(&input).unwrap();
    let late = world
        .renderer
        .settings_mut()
        .add_view(View::new(world.camera, LENS, ALL_LAYERS))
        .unwrap();
    world.renderer.record(&input).unwrap();
    let before = mock.draws;
    mock.replay(world.renderer.list(2).words()).unwrap();
    assert_eq!(mock.draws - before, 4, "only the camera's view draws");
    assert_eq!(render_passes(&world.commands()).len(), 2);
    assert!(world.renderer.view_frame(late).is_none());

    step(&mut world, &mut mock, false);
    assert_eq!(
        view_bucket_counts(&world, late),
        view_bucket_counts(&world, ViewId::CAMERA)
    );
}

#[test]
fn the_frame_draws_through_the_render_graph_and_compiles_it_only_when_its_passes_change() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let steps = |world: &World<CpuCulledRenderer>| -> Vec<Vec<String>> {
        let graph = world.renderer.render_graph();
        let plan = graph.plan().unwrap();
        plan.steps()
            .iter()
            .map(|step| {
                plan.passes(step)
                    .iter()
                    .map(|&pass| graph.pass_name(pass).to_owned())
                    .collect()
            })
            .collect()
    };
    // The job workers cull, so the graph has no culling pass. The scene's render pass resolves
    // into the canvas while the final pass, which has no work, stays off.
    assert_eq!(steps(&world), [vec!["Opaque", "Resolve"]]);
    let graph = world.renderer.render_graph();
    assert!(!graph.is_enabled(graph.find_pass("Final").unwrap()));
    for _ in 0..10 {
        step(&mut world, &mut mock, false);
    }
    assert_eq!(world.renderer.render_graph().compiles(), 1);

    world.frame += 1;
    world.scene.begin_frame(world.frame);
    world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    assert_eq!(steps(&world), [vec!["Opaque", "Resolve"], vec!["Opaque1"]]);
    assert_eq!(world.renderer.render_graph().compiles(), 2);
}

#[test]
fn the_first_frame_creates_everything_and_replays_on_both_draw_paths() {
    for multi_draw in [true, false] {
        let mut world = world(multi_draw);
        assert!(world.record(true), "the first frame builds the draw tables");
        let commands = world.commands();
        let mut mock = MockBackend::default();
        mock.replay(world.renderer.list(1).words()).unwrap();

        assert_eq!(count(&commands, Op::CreateRenderPipeline), 2);
        // The color and depth targets, the resident texture, the two rings of three and the
        // cluster texture.
        assert_eq!(count(&commands, Op::CreateTexture), 10);
        // Buckets: lit boxes (the object, and the batch in the streamed texture), lit balls, and
        // unlit boxes. The hidden ball culls away; everything else is in view. Nothing is static
        // but the scene, so no bucket has clusters.
        assert_eq!(
            bucket_counts(&world),
            vec![(1, 0), (BATCH_ROWS, 0), (1, 0), (1, 0)]
        );
        assert_eq!(mock.draws, 4);
        if multi_draw {
            // One call per run of pipeline and page: the lit buckets, then the unlit one.
            let draws: Vec<u32> = commands
                .iter()
                .filter(|(op, _)| *op == Op::MultiDrawIndexed)
                .map(|(_, o)| o[0])
                .collect();
            assert_eq!(draws, vec![3, 1]);
            assert_eq!(count(&commands, Op::DrawIndexed), 0);
        } else {
            assert_eq!(count(&commands, Op::DrawIndexed), 4);
            assert_eq!(count(&commands, Op::MultiDrawIndexed), 0);
        }
        // Every scene slot in use into the resident texture, the batch's rows into the streamed
        // texture of the frame's ring slot, and the visible sources into its index list.
        assert_eq!(
            texture_writes(&commands, RESIDENT),
            vec![[0, 0, SCENE_ROWS * 3, 1, SCENE_ROWS * 48]]
        );
        let ring = world.frame % 3;
        assert_eq!(
            texture_writes(&commands, STREAMED + ring),
            vec![
                [0, 0, 1536, 1, 512 * 48],
                [0, 1, (BATCH_ROWS - 512) * 3, 1, (BATCH_ROWS - 512) * 48]
            ]
        );
        let visible = BATCH_ROWS + 3;
        assert_eq!(
            texture_writes(&commands, VISIBLE + ring),
            vec![[0, 0, visible, 1, visible * 4]]
        );
    }
}

#[test]
fn the_index_list_holds_each_buckets_sources_in_order() {
    let mut world = world(true);
    world.record(true);
    let culled = world.renderer.culled(world.frame, ViewId::CAMERA);
    let starts = culled.bucket_starts();
    let slot = |object: usize| world.scene.resolve(world.objects[object]).unwrap();
    // The lit box object, then the batch's rows at the start of the streamed texture, then the
    // shown ball, then the unlit box. Each key's bucket of rows comes before its bucket of
    // clusters, which is empty here.
    assert_eq!(culled.indices()[starts[0] as usize], slot(0));
    let rows = &culled.indices()[starts[2] as usize..starts[3] as usize];
    assert!(rows.iter().copied().eq(0..BATCH_ROWS));
    assert_eq!(culled.indices()[starts[4] as usize], slot(2));
    assert_eq!(culled.indices()[starts[6] as usize], slot(1));
}

/// The id of the bind group of the streamed texture of ring slot `streamed` and the index list
/// of ring slot `listed`.
fn instances_group(streamed: u32, listed: u32) -> u32 {
    3 + streamed * 3 + listed
}

/// The instances bind group a frame's list binds.
fn bound_instances(commands: &[(Op, Vec<u32>)]) -> u32 {
    commands
        .iter()
        .find(|(op, o)| *op == Op::SetBindGroup && o[0] == 2)
        .unwrap()
        .1[1]
}

/// The frame uniform's offset that a frame's list binds.
fn bound_uniform_offset(commands: &[(Op, Vec<u32>)]) -> u32 {
    commands
        .iter()
        .find(|(op, o)| *op == Op::SetBindGroup && o[0] == 0)
        .unwrap()
        .1[3]
}

/// Buffer writes of a frame into one buffer.
fn buffer_writes(commands: &[(Op, Vec<u32>)], buffer: u32) -> usize {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer)
        .count()
}

#[test]
fn steady_frames_upload_the_moving_rows_into_the_ring_and_keep_an_unchanged_index_list() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The first frame lists into the ring slot after slot 0.
    assert_eq!(texture_writes(&world.commands(), VISIBLE + 1).len(), 1);
    for frame in 2..=5 {
        world.frame = frame;
        assert!(!world.record(false), "a steady frame keeps the draw tables");
        mock.replay(world.renderer.list(frame).words()).unwrap();
        let commands = world.commands();
        for op in [
            Op::CreateBuffer,
            Op::CreateTexture,
            Op::CreateBindGroup,
            Op::CreateRenderPipeline,
        ] {
            assert_eq!(count(&commands, op), 0, "frame {frame}: {op:?}");
        }
        // The static scene uploads nothing, and the dynamic batch goes into the next ring slot.
        // Nothing moves into or out of view, so the index list and the draw records stay in the
        // slot the first frame wrote.
        let ring = frame % 3;
        assert!(texture_writes(&commands, RESIDENT).is_empty());
        assert_eq!(texture_writes(&commands, STREAMED + ring).len(), 2);
        for other in (0..3).filter(|&k| k != ring) {
            assert!(texture_writes(&commands, STREAMED + other).is_empty());
        }
        for listed in 0..3 {
            assert!(texture_writes(&commands, VISIBLE + listed).is_empty());
        }
        assert_eq!(buffer_writes(&commands, DRAWS), 0, "frame {frame}");
        assert_eq!(bound_instances(&commands), instances_group(ring, 1));
        // The camera did not move, so the frame uniform stays in the slot the first frame wrote.
        assert_eq!(buffer_writes(&commands, FRAME), 0, "frame {frame}");
        assert_eq!(bound_uniform_offset(&commands), 256);
    }
    // A hidden object changes the list: it goes into the next slot, with its draw records.
    world.frame = 6;
    world.scene.begin_frame(6);
    world
        .scene
        .apply_commands(&[Command::set_visible(world.objects[0], false)], 6)
        .unwrap();
    world.record(false);
    mock.replay(world.renderer.list(6).words()).unwrap();
    let commands = world.commands();
    assert_eq!(texture_writes(&commands, VISIBLE + 2).len(), 1);
    assert_eq!(buffer_writes(&commands, DRAWS), 1);
    assert_eq!(bound_instances(&commands), instances_group(0, 2));

    // A moved camera writes the frame uniform into its next slot, and no matrix: the camera draws
    // nothing.
    world.frame = 7;
    world.scene.begin_frame(7);
    world
        .scene
        .set_position(world.camera, [0.0, 0.5, 20.0])
        .unwrap();
    world.record(false);
    mock.replay(world.renderer.list(7).words()).unwrap();
    let commands = world.commands();
    assert_eq!(buffer_writes(&commands, FRAME), 1);
    assert_eq!(bound_uniform_offset(&commands), 512);
    assert!(texture_writes(&commands, RESIDENT).is_empty());

    // With no active moving rows, the streamed ring keeps its slot.
    let streamed = (bound_instances(&commands) - 3) / 3;
    world
        .batches
        .get_mut(world.batch)
        .unwrap()
        .set_active_count(0)
        .unwrap();
    world.frame = 8;
    world.record(false);
    mock.replay(world.renderer.list(8).words()).unwrap();
    let commands = world.commands();
    for slot in 0..3 {
        assert!(texture_writes(&commands, STREAMED + slot).is_empty());
    }
    assert_eq!((bound_instances(&commands) - 3) / 3, streamed);
}

#[test]
fn a_moved_static_object_uploads_only_its_row() {
    let mut world = world(false);
    world.record(true);
    world.frame = 2;
    world.scene.begin_frame(2);
    let object = world.objects[1];
    world.scene.set_position(object, [0.0, 1.0, 0.0]).unwrap();
    world.record(false);
    let slot = world.scene.resolve(object).unwrap();
    assert_eq!(
        texture_writes(&world.commands(), RESIDENT),
        vec![[slot * 3, 0, 3, 1, 48]]
    );
}

#[test]
fn showing_hiding_and_active_counts_change_the_draws_without_a_rebuild() {
    let mut world = world(true);
    world.record(true);
    // The first frame's creation was a structure change, which the engine consumes each frame.
    assert!(world.scene.take_structure_changed());
    world.frame = 2;
    world.scene.begin_frame(2);
    let (shown, hidden) = (world.objects[0], world.objects[3]);
    world
        .scene
        .apply_commands(
            &[
                Command::set_visible(shown, false),
                Command::set_visible(hidden, true),
            ],
            2,
        )
        .unwrap();
    assert!(!world.scene.take_structure_changed());
    world
        .batches
        .get_mut(world.batch)
        .unwrap()
        .set_active_count(BATCH_ROWS / 4)
        .unwrap();
    assert!(!world.record(false));
    let commands = world.commands();
    assert_eq!(count(&commands, Op::CreateTexture), 0);
    assert_eq!(count(&commands, Op::CreateBindGroup), 0);
    // The lit box object is gone, a quarter of the batch draws, and both balls draw.
    assert_eq!(
        bucket_counts(&world),
        vec![(0, 0), (BATCH_ROWS / 4, 0), (2, 0), (1, 0)]
    );
}

#[test]
fn a_structure_change_rebuilds_the_buckets_and_uploads_every_resident_row() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The shown ball takes the box mesh: it joins the lit box bucket of the resident texture.
    world.frame = 2;
    world.scene.begin_frame(2);
    let ball = world.objects[2];
    world
        .scene
        .apply_commands(&[Command::set_mesh(ball, 1)], 2)
        .unwrap();
    assert!(world.scene.take_structure_changed());
    assert!(world.record(true));
    mock.replay(world.renderer.list(2).words()).unwrap();
    assert_eq!(
        bucket_counts(&world),
        vec![(2, 0), (BATCH_ROWS, 0), (0, 0), (1, 0)]
    );
    // The textures already fit, so nothing is made again, but every resident row goes out.
    let commands = world.commands();
    assert_eq!(count(&commands, Op::CreateTexture), 0);
    assert_eq!(texture_writes(&commands, RESIDENT).len(), 1);
}

#[test]
fn after_a_gpu_reset_the_next_frame_replays_on_a_new_device() {
    let mut world = world(true);
    let mut lost = MockBackend::default();
    world.record(true);
    lost.replay(world.renderer.list(1).words()).unwrap();
    let first = world.commands();
    world.frame = 2;
    world.record(false);
    lost.replay(world.renderer.list(2).words()).unwrap();

    world.renderer.reset_gpu();
    world.frame = 3;
    assert!(world.record(false), "a new device needs new draw tables");
    MockBackend::default()
        .replay(world.renderer.list(3).words())
        .unwrap();
    let again = world.commands();
    for op in [
        Op::CreateRenderPipeline,
        Op::CreateBuffer,
        Op::CreateTexture,
        Op::CreateBindGroup,
        Op::ResizeCanvas,
        Op::MultiDrawIndexed,
    ] {
        assert_eq!(count(&again, op), count(&first, op), "{op:?}");
    }
}

#[test]
fn a_new_canvas_size_resizes_the_canvas_and_its_targets_in_the_same_frame() {
    let mut world = world(false);
    world.record(true);
    world.frame = 2;
    world.canvas = (800, 600);
    world.record(false);
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
fn a_scene_past_the_device_limit_is_refused_with_that_limit() {
    // Textures two rows high hold 1,024 sources: the world has its scene slots and 1,000 rows.
    let mut tight = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        max_texture_size: 2,
        ..CpuCulledConfig::default()
    }));
    assert_eq!(tight.renderer.max_sources(), 1024);
    assert_eq!(
        tight.try_record(true),
        Err(RecordError::TooManySources { limit: 1024 })
    );
    let mut roomy = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        max_texture_size: 3,
        ..CpuCulledConfig::default()
    }));
    roomy.try_record(true).unwrap();
}

/// Adds a static batch of `rows` boxes on a grid across the view and past its edges, with the box
/// mesh and the lit material: the key of the lit box object, whose buckets come first.
fn add_static_batch(world: &mut World<CpuCulledRenderer>, rows: u32) -> Handle {
    let batch = world.batches.create(rows, false, false, 1, 1, 0.9).unwrap();
    let still = world.batches.get_mut(batch).unwrap();
    for (row, position) in still
        .positions_mut()
        .as_chunks_mut::<3>()
        .0
        .iter_mut()
        .enumerate()
    {
        let (column, line) = ((row % 50) as f32, (row / 50) as f32);
        position.copy_from_slice(&[column * 2.5 - 60.0, line * 2.5 - 50.0, -10.0]);
    }
    batch
}

/// Records the next frame and replays it.
fn step(world: &mut World<CpuCulledRenderer>, mock: &mut MockBackend, structure_changed: bool) {
    world.frame += 1;
    world.record(structure_changed);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
}

#[test]
fn a_static_batch_at_rest_is_culled_and_drawn_by_cluster() {
    const ROWS: u32 = 2000;
    let clusters_in_all = ROWS.div_ceil(CLUSTER_ROWS);
    for multi_draw in [true, false] {
        let mut world = world(multi_draw);
        let mut mock = MockBackend::default();
        world.record(true);
        mock.replay(world.renderer.list(1).words()).unwrap();
        add_static_batch(&mut world, ROWS);
        // Frame 2 computes every row of the new batch, and culls it row by row next to the lit
        // box object.
        step(&mut world, &mut mock, true);
        let (rows, clusters) = bucket_counts(&world)[0];
        assert!(rows > 1 && rows < ROWS, "{rows} rows in view");
        assert_eq!(clusters, 0);
        assert!(texture_writes(&world.commands(), CLUSTERS).is_empty());
        // Frame 3 copies the rows into the other world buffer and changes nothing, so the batch
        // is at rest: clusters take the place of its rows, some of them out of view, and their
        // order goes into the cluster texture.
        step(&mut world, &mut mock, false);
        let (rows, clusters) = bucket_counts(&world)[0];
        assert_eq!(rows, 1, "only the lit box object is listed by row");
        assert!(
            clusters > 0 && clusters < clusters_in_all,
            "{clusters} clusters in view"
        );
        let written: u32 = texture_writes(&world.commands(), CLUSTERS)
            .iter()
            .map(|write| write[4])
            .sum();
        assert_eq!(written, clusters_in_all * CLUSTER_ROWS * 4);
        let culled = world.renderer.culled(world.frame, ViewId::CAMERA);
        let starts = culled.bucket_starts();
        let entries = &culled.indices()[starts[1] as usize..starts[2] as usize];
        assert!(entries.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(entries.iter().all(|&cluster| cluster < clusters_in_all));
        if !multi_draw {
            // A cluster entry draws a whole cluster's instances.
            let instances: Vec<u32> = world
                .commands()
                .iter()
                .filter(|(op, _)| *op == Op::DrawIndexed)
                .map(|(_, operands)| operands[1])
                .collect();
            assert_eq!(instances[..2], [1, clusters << CLUSTER_SHIFT]);
        }
        // The next frame draws the same clusters and uploads nothing new for them, nor the same
        // index list, draw records and frame uniform again.
        step(&mut world, &mut mock, false);
        assert_eq!(bucket_counts(&world)[0], (1, clusters));
        assert!(texture_writes(&world.commands(), CLUSTERS).is_empty());
        assert_eq!(count(&world.commands(), Op::WriteBuffer), 0);
        for listed in 0..3 {
            assert!(texture_writes(&world.commands(), VISIBLE + listed).is_empty());
        }
    }
}

#[test]
fn a_changed_static_batch_is_culled_by_row_until_it_is_at_rest_again() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let batch = add_static_batch(&mut world, 2000);
    step(&mut world, &mut mock, true);
    step(&mut world, &mut mock, false);
    let clusters = bucket_counts(&world)[0].1;
    assert!(clusters > 0);

    // A moved row sends the whole batch back to rows for the frame that moves it; the next
    // frame copies the row into the other world buffer, builds the clusters again and uploads
    // their order.
    let still = world.batches.get_mut(batch).unwrap();
    still.positions_mut()[0] += 1.0;
    still.mark_dirty(0, 1).unwrap();
    step(&mut world, &mut mock, false);
    let (rows, in_clusters) = bucket_counts(&world)[0];
    assert!(rows > 1);
    assert_eq!(in_clusters, 0);
    step(&mut world, &mut mock, false);
    assert_eq!(bucket_counts(&world)[0], (1, clusters));
    assert!(!texture_writes(&world.commands(), CLUSTERS).is_empty());

    // Fewer active rows: rows while the two buffers' counts differ, then clusters over the rows
    // left, which all sit in the grid's lowest lines.
    world
        .batches
        .get_mut(batch)
        .unwrap()
        .set_active_count(100)
        .unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(bucket_counts(&world)[0].1, 0);
    step(&mut world, &mut mock, false);
    let (rows, in_clusters) = bucket_counts(&world)[0];
    assert_eq!(rows, 1);
    assert!((1..=2).contains(&in_clusters), "{in_clusters} clusters");
}

#[test]
fn a_frame_counts_the_index_list_entries_it_draws() {
    let mut world = world(true);
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // Three shown objects and every row of the dynamic batch; the hidden ball is not listed.
    assert_eq!(
        world.renderer.visible_entries(world.frame),
        Some(BATCH_ROWS + 3)
    );

    // A static batch at rest adds one entry per cluster in view, not one per row.
    add_static_batch(&mut world, 2000);
    step(&mut world, &mut mock, true);
    step(&mut world, &mut mock, false);
    let (_, clusters) = bucket_counts(&world)[0];
    assert!(clusters > 0);
    assert_eq!(
        world.renderer.visible_entries(world.frame),
        Some(BATCH_ROWS + 3 + clusters)
    );

    // Without a camera the frame draws nothing, whatever an older frame culled.
    world.renderer.settings_mut().set_camera(
        Handle::NONE,
        Perspective {
            fov_degrees: 60.0,
            near: 0.1,
            far: 100.0,
        },
    );
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.visible_entries(world.frame), Some(0));
}
