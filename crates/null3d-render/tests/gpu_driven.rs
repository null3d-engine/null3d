//! The WebGPU frame builder, checked through the mock backend, which rejects what a real GPU
//! would, and by decoding the lists it records.

mod common;

use std::collections::HashMap;

use common::{BATCH_ROWS, SCENE_CAPACITY, World, count, far_out};
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::{POINT_CONE, VisibleLight, kind};
use null3d_core::scene::{Command, NO_PARENT, flags};
use null3d_core::world::SphereArrays;
use null3d_gpu::drawlist::{NO_TARGET, Op, format, layout, resource_kind};
use null3d_gpu::mock::MockBackend;
use null3d_render::camera::Perspective;
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::light_grid::{CLUSTER_PARAMS_BYTES, DEFAULT_GRID};
use null3d_render::view::ViewId;

const MATRIX_BYTES: u32 = 48;
/// Where a view's culling parameters hold the runs of the cell order: after the planes.
const RANGES: u32 = 112;
/// The builder's buffers of world matrices, of the bucket of every source, and of the layer
/// mask of every source.
const MATRICES: u32 = 2;
const INSTANCE_BUCKETS: u32 = 3;
const SOURCE_LAYERS: u32 = 5;

/// A view's part of a frame's list, found by following what its commands name.
#[derive(Debug)]
struct ViewCommands {
    /// The buffers its culling group binds, by binding: its parameters, the matrices, the bucket
    /// table, the bucket records, its compacted instances, its indirect draws and the layer table.
    culling: [u32; 7],
    /// The operands of the render pass that executes its bundle.
    pass: Vec<u32>,
    /// The buffers its bundle draws from: compacted instances and indirect draws.
    instances: Vec<u32>,
    indirect: Vec<u32>,
}

/// Each view's commands in a frame that culls and draws every view, in the order they run.
fn views_of(commands: &[(Op, Vec<u32>)]) -> Vec<ViewCommands> {
    let groups: HashMap<u32, [u32; 7]> = commands
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
    // its own, which share the camera's textures, as the two render passes do not overlap. The
    // textures: the color and depth targets, the shadow map and the shadow atlas, one texel each
    // while no light casts shadows, the table of specular terms, the materials' custom values,
    // the environment's blank cube, the blank texture that stands in for ambient occlusion, and
    // the views' cell offsets.
    assert_eq!(camera.pass[1], 0);
    assert_eq!(other.pass[1], NO_TARGET);
    assert_eq!(count(&commands, Op::CreateTexture), 9);
    // Each view writes its cell offsets into a row of its own.
    let rows: Vec<u32> = offsets_writes(&commands, offsets_texture(&commands))
        .iter()
        .map(|&(row, _)| row)
        .collect();
    assert_eq!(rows.len(), 2);
    assert_ne!(rows[0], rows[1]);

    // Each view's culling tests its own frustum: the side view's leaves out the object at
    // x = -3, which the camera sees. A frustum is relative to its view's camera, so each sphere
    // moves by the offset from that camera to the sphere's cell.
    let spheres = world.scene.world(1).spheres();
    let sees = |view: ViewId, object: usize| {
        let slot = world.scene.resolve(world.objects[object]).unwrap() as usize;
        let frame = world.renderer.view_frame(view).unwrap();
        let cell = world.scene.cell_table().coords(world.scene.cells()[slot]);
        let [x, y, z] = frame.camera.offset_to(cell);
        frame.frustum.contains_sphere(
            spheres.xs[slot] + x,
            spheres.ys[slot] + y,
            spheres.zs[slot] + z,
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
    // The light clustering and culling passes, then the scene's render pass, which resolves into
    // the canvas while the final pass, which has no work, stays off.
    assert_eq!(
        steps(&world),
        [vec!["LightClusters", "Culling"], vec!["Opaque", "Resolve"]]
    );
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
            vec!["LightClusters", "Culling", "Culling1"],
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

    // Lit and unlit, and the final pass's, made for frames whose render scale drops.
    assert_eq!(count(&commands, Op::CreateRenderPipeline), 3);
    // Culling, and the three steps of light clustering.
    assert_eq!(count(&commands, Op::CreateComputePipeline), 4);
    assert_eq!(count(&commands, Op::ResizeCanvas), 1);
    // The color and depth targets, the shadow map and the shadow atlas, one texel each while no
    // light casts shadows, the table of specular terms, the materials' custom values, the
    // environment's blank cube, the blank texture that stands in for ambient occlusion, and the
    // views' cell offsets.
    assert_eq!(count(&commands, Op::CreateTexture), 9);
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

    // Every WebGPU device: the default binding holds the instances of 2,097,152 sources.
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
            .create(Shading::Lit, 0, [shade, 0.5, 0.5, 1.0])
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
    // Pipelines depend on the shading model, not on materials: lit, unlit, the final pass, the
    // culling pass and light clustering's three.
    assert_eq!(count(&first, Op::CreateRenderPipeline), 3);
    assert_eq!(count(&first, Op::CreateComputePipeline), 4);
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

/// Writes of a frame into a view's culling parameters, the buffer `params`: offset and byte count.
fn cull_params_writes(commands: &[(Op, Vec<u32>)], params: u32) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == params)
        .map(|(_, o)| (o[1], o[3]))
        .collect()
}

/// The texture of cell offsets that a frame's culling groups bind, after their buffers.
fn offsets_texture(commands: &[(Op, Vec<u32>)]) -> u32 {
    let group = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::CULL)
        .map(|(_, o)| o)
        .expect("the frame binds a culling group");
    assert_eq!(group[3 + 8 * 5 + 1], resource_kind::TEXTURE);
    group[3 + 8 * 5 + 2]
}

/// Writes of a frame into the texture of cell offsets: the view's row and the cells it writes.
fn offsets_writes(commands: &[(Op, Vec<u32>)], texture: u32) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteTexture && o[0] == texture)
        .map(|(_, o)| (o[3], o[5]))
        .collect()
}

#[test]
fn each_view_writes_its_cell_offsets_into_its_own_row_of_a_float_texture() {
    // Each culling thread reads its own cell's offset. The Galaxy S25's driver read a table in the
    // uniform parameters at one thread's index for all of them, so the offsets sit in a texture.
    let mut world = World::new();
    world.move_far_out();
    world.record(true);
    let commands = world.commands();
    let texture = offsets_texture(&commands);
    let created = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateTexture && o[0] == texture)
        .map(|(_, o)| o.clone())
        .expect("the frame creates the texture of cell offsets");
    assert_eq!([created[1], created[4]], [512, format::RGBA32_FLOAT]);
    // The camera's view, row 0, uses the origin cell and the far cell.
    assert_eq!(offsets_writes(&commands, texture), vec![(0, 2)]);
}

#[test]
fn far_from_the_origin_only_the_camera_offsets_upload_when_the_camera_moves() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    // The objects and the camera 1,000 km out; the batch's rows stay at the origin.
    world.move_far_out();
    let camera = world.camera;
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let far = world.far_cell();
    for &object in &world.objects {
        let slot = world.scene.resolve(object).unwrap() as usize;
        assert_eq!(world.scene.cells()[slot], far);
    }
    // The planes, then the runs of the cell order that the view culls: the far cell's still
    // objects and the batch's moving rows, which follow them, joined into one. The offsets from
    // the camera to the two cells in use go into the view's row of the offsets texture.
    let params = vec![(0, 112), (RANGES, 16)];
    let buffer = views_of(&world.commands())[0].culling[0];
    let texture = offsets_texture(&world.commands());
    assert_eq!(cull_params_writes(&world.commands(), buffer), params);
    assert_eq!(offsets_writes(&world.commands(), texture), vec![(0, 2)]);

    for frame in 2..=5 {
        world.frame = frame;
        world.scene.begin_frame(frame);
        let x = frame as f32 * 0.25;
        world
            .scene
            .set_position(camera, far_out(x, 0.5, 20.0))
            .unwrap();
        world.record(false);
        mock.replay(world.renderer.list(frame).words()).unwrap();
        let commands = world.commands();
        // The static objects keep their matrices on the GPU, and the camera draws nothing: only the
        // batch's rows, after every scene slot, upload.
        let scene_writes = commands
            .iter()
            .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == MATRICES)
            .filter(|(_, o)| o[1] < (SCENE_CAPACITY + 1) * MATRIX_BYTES)
            .count();
        assert_eq!(scene_writes, 0, "frame {frame}");
        assert!(bucket_table_writes(&commands).is_empty(), "frame {frame}");
        assert_eq!(
            cull_params_writes(&commands, buffer),
            params,
            "frame {frame}"
        );
        assert_eq!(
            offsets_writes(&commands, texture),
            vec![(0, 2)],
            "frame {frame}"
        );
    }
}

#[test]
fn an_object_that_moves_into_another_cell_rewrites_its_entry() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let buffer = views_of(&world.commands())[0].culling[0];
    assert_eq!(
        cull_params_writes(&world.commands(), buffer),
        vec![(0, 112)]
    );
    let texture = offsets_texture(&world.commands());
    assert_eq!(offsets_writes(&world.commands(), texture), vec![(0, 1)]);

    world.frame = 2;
    world.scene.begin_frame(2);
    let object = world.objects[0];
    world
        .scene
        .set_position(object, [0.0, 0.0, -2_000.0])
        .unwrap();
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    let slot = world.scene.resolve(object).unwrap();
    let commands = world.commands();
    // Its matrix, now relative to its new cell, and its entry, which names that cell, upload.
    assert_eq!(bucket_table_writes(&commands), vec![(slot * 4, 4)]);
    assert!(commands.iter().any(|(op, o)| {
        *op == Op::WriteBuffer && o[0] == MATRICES && o[1] == slot * MATRIX_BYTES
    }));
    // Two runs of the cell order: the origin cell's still objects and the batch's moving rows. The
    // moved object's cell, out of view, lies between them.
    assert_eq!(
        cull_params_writes(&commands, buffer),
        vec![(0, 112), (RANGES, 2 * 16)]
    );
    assert_eq!(offsets_writes(&commands, texture), vec![(0, 2)]);
}

/// A WebGPU world spread over 5 x 5 grid cells, with room for `objects` more scene objects, and
/// its static batch.
fn spread_world(objects: u32, rows: u32) -> (World, Handle) {
    let renderer = GpuDrivenRenderer::new(RendererConfig::default());
    let mut world = World::build_sized(renderer, objects + 16);
    let batch = world.spread(objects, rows, 11);
    world.record(true);
    (world, batch)
}

/// The first source of each batch: after the scene's slots, the world's moving batch, then the
/// spread world's static batch.
fn batch_bases(world: &World) -> [u32; 2] {
    let scene_rows = world.scene.capacity() + 1;
    [scene_rows, scene_rows + BATCH_ROWS]
}

/// How many times the camera view's culling pass tests each source in the last frame.
fn tested(world: &World) -> HashMap<u32, u32> {
    let mut tested = HashMap::new();
    for source in world.renderer.culled_sources(ViewId::CAMERA) {
        *tested.entry(source).or_insert(0) += 1;
    }
    tested
}

#[test]
fn each_view_culls_the_sources_of_the_cells_it_can_see_and_every_moving_source() {
    const OBJECTS: u32 = 400;
    const ROWS: u32 = 6000;
    let (mut world, batch) = spread_world(OBJECTS, ROWS);
    let [moving_base, still_base] = batch_bases(&world);
    let sources = still_base + ROWS;
    let mut all_tested = 0;
    for k in 0..10 {
        let k = k as f32;
        world.frame += 1;
        world.scene.begin_frame(world.frame);
        let at = [
            (k * 731.0) % 4000.0 - 2000.0,
            10.0,
            (k * 1173.0) % 4000.0 - 2000.0,
        ];
        world.aim(at, k * 0.9, (k * 0.7).sin() * 0.15);
        world.record(false);
        let tested = tested(&world);
        assert!(
            tested.values().all(|&n| n == 1),
            "pose {k}: a source tested twice"
        );
        // The moving batch's rows are always tested; of the rest, cells out of view leave some.
        let still = sources - BATCH_ROWS;
        let still_tested = tested.len() as u32 - BATCH_ROWS;
        assert!(
            still_tested < still,
            "pose {k}: {still_tested} of {still} other sources tested"
        );
        all_tested += still_tested;
        // Every source whose sphere is in the frustum moved into its cell is tested, and so is
        // every row of the moving batch.
        let frame = *world.renderer.view_frame(ViewId::CAMERA).unwrap();
        let table = world.scene.cell_table();
        let in_view = |spheres: SphereArrays<'_>, row: usize, cell: u32| {
            let offset = frame.camera.offset_to(table.coords(cell));
            let [x, y, z, r] = [spheres.xs, spheres.ys, spheres.zs, spheres.radii].map(|v| v[row]);
            frame.frustum.moved_by(offset).contains_sphere(x, y, z, r)
        };
        let parity = world.scene.parity();
        let scene_spheres = world.scene.world(parity).spheres();
        let mut seen = 0;
        for &object in &world.objects {
            let slot = world.scene.resolve(object).unwrap();
            if in_view(
                scene_spheres,
                slot as usize,
                world.scene.cells()[slot as usize],
            ) {
                seen += 1;
                assert!(tested.contains_key(&slot), "pose {k}: object {slot}");
            }
        }
        let still = world.batches.get(batch).unwrap();
        let rows = still.world(parity).spheres();
        for row in 0..ROWS {
            if in_view(rows, row as usize, still.cells()[row as usize]) {
                seen += 1;
                let source = still_base + row;
                assert!(tested.contains_key(&source), "pose {k}: row {row}");
            }
        }
        assert!(seen > 0, "pose {k} sees nothing");
        let moving = moving_base..moving_base + BATCH_ROWS;
        assert!(
            moving
                .into_iter()
                .all(|source| tested.contains_key(&source))
        );
    }
    let every = 10 * (sources - BATCH_ROWS);
    assert!(all_tested * 3 < every, "{all_tested} of {every} tested");
}

#[test]
fn the_cell_order_follows_creates_destroys_and_moves_between_cells() {
    const OBJECTS: u32 = 60;
    const ROWS: u32 = 500;
    let (mut world, batch) = spread_world(OBJECTS, ROWS);
    let [moving_base, still_base] = batch_bases(&world);
    // A camera high above the square, looking straight down, sees all of it.
    let lens = Perspective {
        fov_degrees: 120.0,
        near: 1.0,
        far: 20_000.0,
    };
    world.renderer.settings_mut().set_camera(world.camera, lens);
    let (sin, cos) = std::f32::consts::FRAC_PI_4.sin_cos();
    let step = |world: &mut World, structure_changed: bool| {
        world.frame += 1;
        world.scene.begin_frame(world.frame);
        world.aim([0.0, 3000.0, 0.0], 0.0, 0.0);
        world
            .scene
            .set_rotation(world.camera, [-sin, 0.0, 0.0, cos])
            .unwrap();
        world.record(structure_changed);
        tested(world)
    };
    // Each drawn source is tested once. The pass takes the still sources cell by cell, then the
    // moving ones.
    let check = |world: &World, tested: &HashMap<u32, u32>| {
        assert!(tested.values().all(|&n| n == 1));
        for &object in &world.objects {
            let slot = world.scene.resolve(object).unwrap();
            assert!(tested.contains_key(&slot), "object {slot} is left out");
        }
        for source in moving_base..still_base + ROWS {
            assert!(tested.contains_key(&source), "source {source} is left out");
        }
        let rows = world.batches.get(batch).unwrap();
        let (scene, parents) = (&world.scene, world.scene.parents());
        let still_cell = |source: u32| -> Option<u32> {
            if source >= still_base {
                return Some(rows.cells()[(source - still_base) as usize]);
            }
            let mut at = source;
            while at < moving_base {
                if scene.flags()[at as usize] & flags::DYNAMIC != 0 {
                    return None;
                }
                match parents[at as usize] {
                    NO_PARENT => return Some(scene.cells()[source as usize]),
                    parent => at = parent,
                }
            }
            None
        };
        let cells: Vec<Option<u32>> = world
            .renderer
            .culled_sources(ViewId::CAMERA)
            .into_iter()
            .map(still_cell)
            .collect();
        let end = cells
            .iter()
            .rposition(Option::is_some)
            .map_or(0, |at| at + 1);
        assert!(
            cells[..end].iter().all(Option::is_some),
            "a moving source among still ones"
        );
        let still: Vec<u32> = cells[..end].iter().flatten().copied().collect();
        assert!(
            still.windows(2).all(|w| w[0] <= w[1]),
            "still sources out of cell order"
        );
    };
    let tested = step(&mut world, false);
    check(&world, &tested);

    // A new object, and a destroyed one.
    let made = world.scene.reserve().unwrap();
    world
        .scene
        .set_position(made, [1900.0, 0.0, -1900.0])
        .unwrap();
    world.scene.set_local_radius(made, 1.0).unwrap();
    let gone = world.objects.remove(3);
    let gone_slot = world.scene.resolve(gone).unwrap();
    let commands = [
        Command::create(made, Handle::NONE, 1, flags::VISIBLE),
        Command::set_material(made, 1),
        Command::destroy(gone),
    ];
    world
        .scene
        .apply_commands(&commands, world.frame + 1)
        .unwrap();
    world.objects.push(made);
    let tested = step(&mut world, true);
    check(&world, &tested);
    let made_slot = world.scene.resolve(made).unwrap();
    assert_ne!(made_slot, gone_slot);
    assert!(tested.contains_key(&made_slot));
    assert!(
        !tested.contains_key(&gone_slot),
        "the destroyed object is still culled"
    );

    // A still object and a still row move into other cells, with no structure change.
    let slot = world.scene.resolve(world.objects[0]).unwrap() as usize;
    let before = world.scene.cells()[slot];
    world
        .scene
        .set_position(world.objects[0], [-2400.0, 0.0, 2400.0])
        .unwrap();
    let rows = world.batches.get_mut(batch).unwrap();
    rows.positions_mut()[..3].copy_from_slice(&[2400.0, 0.0, 2400.0]);
    rows.mark_dirty(0, 1).unwrap();
    let tested = step(&mut world, false);
    assert_ne!(world.scene.cells()[slot], before);
    check(&world, &tested);
}

/// Writes to the layer table in a frame's commands: offset and byte count.
fn layer_table_writes(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == SOURCE_LAYERS)
        .map(|(_, o)| (o[1], o[3]))
        .collect()
}

#[test]
fn new_layers_rewrite_the_layer_table_without_a_rebuild() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    assert!(world.scene.take_structure_changed());
    // The first frame writes the mask of every source: the scene's slots, then the batch's rows.
    let sources = SCENE_CAPACITY + 1 + BATCH_ROWS;
    assert_eq!(
        layer_table_writes(&world.commands()),
        vec![(0, sources * 4)]
    );
    // The culling tests the camera's view against the mask of a new camera: layer 0.
    let view_layers = |world: &World| world.renderer.view_frame(ViewId::CAMERA).unwrap().layers;
    assert_eq!(view_layers(&world), DEFAULT_LAYERS);

    // An object moves to layer 1, and the camera draws layers 0 and 1. Only the object's mask
    // uploads, and the view's culling and its pass in the render graph take the new mask.
    world.frame = 2;
    let object = world.objects[1];
    world
        .scene
        .apply_commands(&[Command::set_layers(object, 0b10)], 2)
        .unwrap();
    assert!(!world.scene.take_structure_changed());
    world
        .renderer
        .settings_mut()
        .set_layers(ViewId::CAMERA, 0b11);
    assert!(!world.record(false));
    mock.replay(world.renderer.list(2).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::BeginBundle), 0);
    assert_eq!(count(&commands, Op::CreateBuffer), 0);
    let slot = world.scene.resolve(object).unwrap();
    assert_eq!(layer_table_writes(&commands), vec![(slot * 4, 4)]);
    assert!(bucket_table_writes(&commands).is_empty());
    assert_eq!(view_layers(&world), 0b11);
    let graph = world.renderer.render_graph();
    assert_eq!(graph.pass_layers(graph.find_pass("Opaque").unwrap()), 0b11);

    // The batch moves to layer 2: every one of its rows takes the mask, active or not.
    world.frame = 3;
    world
        .batches
        .get_mut(world.batch)
        .unwrap()
        .set_layers(0b100);
    assert!(!world.record(false));
    mock.replay(world.renderer.list(3).words()).unwrap();
    let base = SCENE_CAPACITY + 1;
    assert_eq!(
        layer_table_writes(&world.commands()),
        vec![(base * 4, BATCH_ROWS * 4)]
    );

    // A frame that changes no mask writes none.
    world.frame = 4;
    world.record(false);
    mock.replay(world.renderer.list(4).words()).unwrap();
    assert!(layer_table_writes(&world.commands()).is_empty());
}

#[test]
fn each_view_culls_with_its_own_layers() {
    let mut world = World::new();
    let side = world.add_view([5.0, 0.0, 6.0]);
    world.renderer.settings_mut().set_layers(side, 0b1010);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    // Both views cull the same layer table, each with its own mask.
    let views = views_of(&world.commands());
    assert_eq!(views[0].culling[6], SOURCE_LAYERS);
    assert_eq!(views[1].culling[6], SOURCE_LAYERS);
    let layers = |view| world.renderer.view_frame(view).unwrap().layers;
    assert_eq!(layers(ViewId::CAMERA), DEFAULT_LAYERS);
    assert_eq!(layers(side), 0b1010);
}

#[test]
fn the_gpu_lists_the_lights_in_frames_whose_lights_changed() {
    let light = |z: f32| VisibleLight {
        position: [0.0, 0.0, z],
        range: 3.0,
        color: [1.0; 3],
        decay: 2.0,
        direction: [0.0; 3],
        cone_cos: POINT_CONE[0],
        penumbra_cos: POINT_CONE[1],
        kind: kind::POINT,
        light: 1,
        shadow: 0.0,
    };
    let dispatches = |world: &World| -> Vec<Vec<u32>> {
        world
            .commands()
            .into_iter()
            .filter(|(op, _)| *op == Op::Dispatch)
            .map(|(_, operands)| operands)
            .collect()
    };
    // The bytes of each upload of the light clustering parameters, and of the light list that
    // follows it.
    let uploads = |world: &World| -> Vec<[u32; 2]> {
        let writes: Vec<u32> = world
            .commands()
            .into_iter()
            .filter(|(op, _)| *op == Op::WriteBuffer)
            .map(|(_, o)| o[3])
            .collect();
        writes
            .windows(2)
            .filter(|pair| pair[0] == CLUSTER_PARAMS_BYTES)
            .map(|pair| [pair[0], pair[1]])
            .collect()
    };
    let both = vec![[CLUSTER_PARAMS_BYTES, 2 * 64]];
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.lights = vec![light(-5.0), light(-9.0)];
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    // The CPU uploads the light list and the parameters, and the GPU fills the grid in three
    // steps, before the culling pass: a run of tiles of each slice, then every cluster in one
    // workgroup, then the runs of tiles again.
    assert_eq!(uploads(&world), both);
    let tiles = [DEFAULT_GRID.tiles().div_ceil(128), DEFAULT_GRID.slices, 1];
    let found = dispatches(&world);
    assert_eq!(found.len(), 4);
    assert_eq!(found[..3], [tiles.to_vec(), vec![1, 1, 1], tiles.to_vec()]);

    // Nothing uploads while the lights and the view stay, but the GPU fills the grid again, in
    // case the thread that draws skipped the dispatches of pipelines it was still building.
    world.frame = 2;
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    assert!(uploads(&world).is_empty());
    assert_eq!(dispatches(&world).len(), 4);

    // A light that moves uploads the list again.
    world.frame = 3;
    world.lights[1] = light(-8.0);
    world.record(false);
    mock.replay(world.renderer.list(3).words()).unwrap();
    assert_eq!(uploads(&world), both);
    assert_eq!(dispatches(&world).len(), 4);

    // Without lights the shaders skip the grid, and the GPU fills none.
    world.frame = 4;
    world.lights.clear();
    world.record(false);
    mock.replay(world.renderer.list(4).words()).unwrap();
    assert_eq!(dispatches(&world).len(), 1);
    let frame = world.renderer.view_frame(ViewId::CAMERA).unwrap();
    assert_eq!(frame.uniform.cluster_grid[2], 0.0);
}
