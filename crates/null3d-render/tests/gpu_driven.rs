//! The WebGPU frame builder, checked through the mock backend, which rejects what a real GPU
//! would, and by decoding the lists it records.

mod common;

use std::collections::HashMap;

use common::{BATCH_ROWS, SCENE_CAPACITY, World, count};
use null3d_gpu::drawlist::{NO_TARGET, Op, layout};
use null3d_gpu::mock::MockBackend;
use null3d_render::frame::FrameBuilder;
use null3d_render::view::ViewId;

const MATRIX_BYTES: u32 = 48;
/// The builder's buffers of world matrices and of the bucket of every source.
const MATRICES: u32 = 2;
const INSTANCE_BUCKETS: u32 = 3;

/// A view's part of a frame's list, found by following what its commands name.
#[derive(Debug)]
struct ViewCommands {
    /// The buffers its culling group binds, by binding: its parameters, the matrices, the bucket
    /// table, the bucket records, its compacted instances and its indirect draws.
    culling: [u32; 6],
    /// The operands of the render pass that executes its bundle.
    pass: Vec<u32>,
    /// The buffers its bundle draws from: compacted instances and indirect draws.
    instances: Vec<u32>,
    indirect: Vec<u32>,
}

/// Each view's commands in a frame that culls and draws every view, in the order they run.
fn views_of(commands: &[(Op, Vec<u32>)]) -> Vec<ViewCommands> {
    let groups: HashMap<u32, [u32; 6]> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::CULL)
        .map(|(_, o)| (o[0], std::array::from_fn(|binding| o[5 + 5 * binding])))
        .collect();
    let mut bundles: HashMap<u32, (Vec<u32>, Vec<u32>)> = HashMap::new();
    let mut recording = None;
    let mut dispatched = Vec::new();
    let mut bound = 0;
    let mut pass = Vec::new();
    let mut executed = Vec::new();
    for (op, o) in commands {
        match op {
            Op::BeginBundle => recording = Some(o[0]),
            Op::EndBundle => recording = None,
            Op::SetVertexBuffer if o[0] == 1 => {
                let bundle = bundles.entry(recording.unwrap()).or_default();
                bundle.0.push(o[1]);
            }
            Op::DrawIndexedIndirect => {
                let bundle = bundles.entry(recording.unwrap()).or_default();
                bundle.1.push(o[0]);
            }
            Op::SetBindGroup if recording.is_none() => bound = o[1],
            Op::Dispatch => dispatched.push(groups[&bound]),
            Op::BeginRenderPass => pass = o.clone(),
            Op::ExecuteBundles => executed.push((pass.clone(), o[1])),
            _ => {}
        }
    }
    assert_eq!(dispatched.len(), executed.len(), "one dispatch per bundle");
    dispatched
        .into_iter()
        .zip(executed)
        .map(|(culling, (pass, bundle))| {
            let (instances, indirect) = bundles.remove(&bundle).unwrap();
            ViewCommands {
                culling,
                pass,
                instances,
                indirect,
            }
        })
        .collect()
}

#[test]
fn two_views_cull_into_buffers_of_their_own_and_draw_their_own_bundles() {
    let mut world = World::new();
    // A second camera to the right of the first and nearer: it sees the objects at x = -1 and 1
    // and the batch at the origin, but not the one at x = -3.
    let side = world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    let views = views_of(&commands);
    let [camera, other] = &views[..] else {
        panic!("two views: {views:?}");
    };

    // Both views cull the same sources and bucket tables, into buffers of their own, which
    // each frame fills from new parameters and reset indirect draws.
    assert_eq!(camera.culling[1..4], other.culling[1..4]);
    for binding in [0, 4, 5] {
        assert_ne!(camera.culling[binding], other.culling[binding]);
    }
    let written = |buffer: u32| {
        commands
            .iter()
            .any(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer)
    };
    for view in &views {
        assert!(written(view.culling[0]) && written(view.culling[5]));
        // Its bundle draws every bucket from the view's own compacted instances and indirect
        // draws.
        assert_eq!(view.instances, [view.culling[4]; 3]);
        assert_eq!(view.indirect, [view.culling[5]; 3]);
    }
    // The camera's render pass resolves into the canvas. The side view's draws into targets of
    // its own, which share the camera's textures, as the two render passes do not overlap.
    assert_eq!(camera.pass[1], 0);
    assert_eq!(other.pass[1], NO_TARGET);
    assert_eq!(count(&commands, Op::CreateTexture), 2);

    // Each view's culling tests its own frustum: the side view's leaves out the object at
    // x = -3, which the camera sees.
    let spheres = world.scene.world(1).spheres();
    let sees = |view: ViewId, object: usize| {
        let slot = world.scene.resolve(world.objects[object]).unwrap() as usize;
        let frustum = world.renderer.view_frame(view).unwrap().frustum;
        frustum.contains_sphere(
            spheres.xs[slot],
            spheres.ys[slot],
            spheres.zs[slot],
            spheres.radii[slot],
        )
    };
    assert!(sees(ViewId::CAMERA, 0) && !sees(side, 0));
    assert!(sees(ViewId::CAMERA, 1) && sees(side, 1));
    assert!(sees(ViewId::CAMERA, 2) && sees(side, 2));
}

#[test]
fn the_frame_runs_the_passes_of_the_render_graph_and_compiles_it_only_when_they_change() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let steps = |world: &World| -> Vec<Vec<String>> {
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
    // The culling pass, then the scene's render pass, which resolves into the canvas while the
    // final pass, which has no work, stays off.
    assert_eq!(steps(&world), [vec!["Culling"], vec!["Opaque", "Resolve"]]);
    let graph = world.renderer.render_graph();
    assert!(!graph.is_enabled(graph.find_pass("Final").unwrap()));
    for frame in 2..=10 {
        world.frame = frame;
        world.record(false);
        mock.replay(world.renderer.list(frame).words()).unwrap();
    }
    assert_eq!(world.renderer.render_graph().compiles(), 1);

    // A new view adds its culling pass to the compute pass, and a render pass of its own.
    world.frame = 11;
    world.scene.begin_frame(11);
    world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    mock.replay(world.renderer.list(11).words()).unwrap();
    assert_eq!(
        steps(&world),
        [
            vec!["Culling", "Culling1"],
            vec!["Opaque", "Resolve"],
            vec!["Opaque1"]
        ]
    );
    assert_eq!(world.renderer.render_graph().compiles(), 2);
    assert_eq!(count(&world.commands(), Op::Dispatch), 2);
}

#[test]
fn a_frame_without_a_camera_clears_and_resolves_the_canvas_only() {
    use null3d_core::handle::Handle;

    let mut world = World::new();
    world
        .renderer
        .settings_mut()
        .set_camera(Handle::NONE, common::LENS);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::BeginComputePass), 0);
    assert_eq!(count(&commands, Op::ExecuteBundles), 0);
    let tail: Vec<Op> = commands[commands.len() - 3..]
        .iter()
        .map(|(op, _)| *op)
        .collect();
    assert_eq!(tail, [Op::BeginRenderPass, Op::EndRenderPass, Op::Submit]);
}

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
    // The first frame uploads every matrix in use: the scene's slots up to the highest one used
    // (slot 0 is never used, then the camera and four objects), then the batch's active rows at
    // their place after every scene slot.
    let sources = SCENE_CAPACITY + 1 + BATCH_ROWS;
    let dispatch = commands.iter().find(|(op, _)| *op == Op::Dispatch).unwrap();
    assert_eq!(dispatch.1, vec![sources.div_ceil(128), 1, 1]);
    let matrix_writes: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == MATRICES)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(matrix_writes.len(), 2);
    assert_eq!(matrix_writes[0][3], 6 * MATRIX_BYTES);
    assert_eq!(matrix_writes[1][1], (SCENE_CAPACITY + 1) * MATRIX_BYTES);
    assert_eq!(matrix_writes[1][3], BATCH_ROWS * MATRIX_BYTES);
    // The GPU culls, so the CPU never learns how many entries are visible.
    assert_eq!(world.renderer.visible_entries(world.frame), None);
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
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == MATRICES)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(matrix_writes.len(), 1);
    assert_eq!(matrix_writes[0][1], (SCENE_CAPACITY + 1) * MATRIX_BYTES);
    assert_eq!(matrix_writes[0][3], BATCH_ROWS * MATRIX_BYTES);
    assert_eq!(count(&commands, Op::ExecuteBundles), 1);

    // A moved camera changes its world matrix, but it draws nothing, so nothing uploads for it.
    world.frame = 3;
    world.scene.begin_frame(3);
    world
        .scene
        .set_position(world.camera, [0.0, 0.5, 20.0])
        .unwrap();
    world.record(false);
    mock.replay(world.renderer.list(3).words()).unwrap();
    let scene_writes = world
        .commands()
        .into_iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == MATRICES)
        .filter(|(_, o)| o[1] < (SCENE_CAPACITY + 1) * MATRIX_BYTES)
        .count();
    assert_eq!(scene_writes, 0);
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
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == INSTANCE_BUCKETS)
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
fn the_source_limit_follows_the_device_storage_binding() {
    use null3d_gpu::drawlist::sizes;
    use null3d_render::frame::grown_size;
    use null3d_render::gpu_driven::{MAX_USEFUL_BINDING_BYTES, PORTABLE_MAX_SOURCES, max_sources};

    // Every device: WebGPU's default binding holds the instances of 2,097,152 sources.
    let portable = sizes::PORTABLE_STORAGE_BINDING_BYTES;
    assert_eq!(PORTABLE_MAX_SOURCES, 2_097_152);
    assert_eq!(PORTABLE_MAX_SOURCES * sizes::INSTANCE_STRIDE, portable);
    // A larger binding raises the limit until one culling dispatch is full.
    let one_dispatch = u32::from(u16::MAX) * sizes::CULL_WORKGROUP_SIZE;
    assert_eq!(max_sources(2 * portable), 2 * PORTABLE_MAX_SOURCES);
    assert_eq!(max_sources(MAX_USEFUL_BINDING_BYTES), one_dispatch);
    assert_eq!(max_sources(u32::MAX - 3), one_dispatch);
    assert_eq!(
        one_dispatch * sizes::INSTANCE_STRIDE,
        MAX_USEFUL_BINDING_BYTES
    );
    // Buffers grow with room to spare, but never past the binding, and never below the need.
    assert_eq!(grown_size(1000, portable), 1536);
    for binding in [portable, MAX_USEFUL_BINDING_BYTES] {
        let full = max_sources(binding) * sizes::INSTANCE_STRIDE;
        assert_eq!(grown_size(full, binding), binding);
        assert_eq!(grown_size(full - 1000, binding), binding);
    }
}

#[test]
fn a_scene_past_the_device_limit_is_refused_with_that_limit() {
    use null3d_gpu::drawlist::sizes;
    use null3d_render::frame::RecordError;
    use null3d_render::gpu_driven::RendererConfig;

    let device = |sources: u32| RendererConfig {
        storage_binding_bytes: sources * sizes::INSTANCE_STRIDE,
        ..RendererConfig::default()
    };
    let sources = SCENE_CAPACITY + 1 + BATCH_ROWS;
    let mut roomy = World::with_config(device(sources));
    assert_eq!(roomy.renderer.max_sources(), sources);
    roomy.try_record(true).unwrap();
    let mut tight = World::with_config(device(sources - 1));
    assert_eq!(
        tight.try_record(true),
        Err(RecordError::TooManySources { limit: sources - 1 })
    );
}

#[test]
fn pipelines_follow_the_shading_model_and_objects_sharing_a_mesh_and_material_share_one_draw() {
    use null3d_core::handle::Handle;
    use null3d_core::scene::{Command, flags};
    use null3d_render::materials::Shading;

    // The world's meshes, in the order it adds them.
    const BOX: u32 = 1;
    const BALL: u32 = 2;
    let mut world = World::new();
    let add = |world: &mut World, mesh: u32, material: u32, commands: &mut Vec<Command>| {
        let object = world.scene.reserve().unwrap();
        world.scene.set_local_radius(object, 0.9).unwrap();
        commands.push(Command::create(object, Handle::NONE, mesh, flags::VISIBLE));
        commands.push(Command::set_material(object, material));
    };
    let lit = |world: &mut World, shade: f32| {
        world
            .renderer
            .settings_mut()
            .materials_mut()
            .create(Shading::Lit, [shade, 0.5, 0.5, 1.0])
            .unwrap()
            + 1
    };
    let mut commands = Vec::new();
    // Ten separate objects with the box mesh and one shared material, and ten balls with a lit
    // material each.
    let shared = lit(&mut world, 0.0);
    for _ in 0..10 {
        add(&mut world, BOX, shared, &mut commands);
    }
    for k in 0..10 {
        let own = lit(&mut world, k as f32 / 10.0);
        add(&mut world, BALL, own, &mut commands);
    }
    world.scene.apply_commands(&commands, 1).unwrap();
    world.record(true);
    let first = world.commands();
    // Pipelines depend on the shading model, not on materials: lit, unlit and the culling pass.
    assert_eq!(count(&first, Op::CreateRenderPipeline), 2);
    assert_eq!(count(&first, Op::CreateComputePipeline), 1);
    // One draw per mesh and material: the world's three, one for the ten boxes, one per ball.
    assert_eq!(count(&first, Op::DrawIndexedIndirect), 3 + 1 + 10);

    // A material and an object added later rebuild the draw tables, but build no pipeline.
    world.frame = 2;
    let mut later = Vec::new();
    let new = lit(&mut world, 1.0);
    add(&mut world, BOX, new, &mut later);
    world.scene.begin_frame(2);
    world.scene.apply_commands(&later, 2).unwrap();
    world.record(true);
    let second = world.commands();
    assert_eq!(count(&second, Op::CreateRenderPipeline), 0);
    assert_eq!(count(&second, Op::DrawIndexedIndirect), 3 + 1 + 10 + 1);
}
