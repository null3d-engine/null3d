//! The capacities a scene can pass, on both frame builders: the draw list, which grows as a frame
//! needs; the all-or-nothing frame, which publishes no commands when it fails; and WebGPU
//! skinning, which spreads its dispatches and its skinned vertices by the device's limits and
//! names the cap a scene passes. Each test records through the mock backend, which rejects what a
//! real GPU would, and decodes the lists.

mod common;

use std::collections::HashMap;

use common::skinned::{RINGS, column_around};
use common::{World, base_format, count};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::caps::MAX_WORKGROUPS_PER_DIMENSION;
use null3d_gpu::drawlist::{MAX_WORDS, Op, layout, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, RecordError};
use null3d_render::geometry::box_geometry;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::Shading;

/// Threads per workgroup of the skinning pass.
const SKIN_WORKGROUP: u32 = 64;
/// One mebibyte.
const MIB: u32 = 1 << 20;

/// Adds `n` objects in a grid that faces the camera, each with a box mesh of its own and all with
/// one lit material, which cast shadows. Returns them.
fn add_distinct_meshes<B: FrameBuilder>(world: &mut World<B>, n: u32) -> Vec<Handle> {
    let settings = world.renderer.settings_mut();
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap()
        + 1;
    let box_mesh = base_format(box_geometry(0.5, 0.5, 0.5, [1, 1, 1]).unwrap());
    (0..n)
        .map(|k| {
            let mesh = world
                .renderer
                .settings_mut()
                .meshes_mut()
                .add(&box_mesh)
                .unwrap()
                + 1;
            let object = world.scene.reserve().unwrap();
            let (column, row) = ((k % 50) as f32, (k / 50 % 50) as f32);
            let position = [column * 0.75 - 18.4, row * 0.45 - 11.0, 0.0];
            world.scene.set_position(object, position).unwrap();
            world.scene.set_local_radius(object, 0.5).unwrap();
            let shown = flags::VISIBLE | flags::CAST_SHADOWS;
            let commands = [
                Command::create(object, Handle::NONE, mesh, shown),
                Command::set_material(object, material),
            ];
            world.scene.apply_commands(&commands, world.frame).unwrap();
            object
        })
        .collect()
}

/// Destroys `objects` in the current frame.
fn destroy<B: FrameBuilder>(world: &mut World<B>, objects: &[Handle]) {
    let commands: Vec<Command> = objects.iter().map(|&o| Command::destroy(o)).collect();
    world.scene.apply_commands(&commands, world.frame).unwrap();
}

/// Records the current frame, which must fail, and moves on to the next one, as the engine does.
/// Checks that the frame publishes no commands, so the thread that draws keeps the last frame that
/// recorded whole. Returns the error.
fn refused<B: FrameBuilder>(world: &mut World<B>) -> RecordError {
    let error = world.try_record(true).expect_err("the frame fails");
    assert!(world.renderer.list(world.frame).is_empty(), "{error:?}");
    world.frame += 1;
    error
}

/// The WebGL2 frame builder with a draw list of `limit` words at most.
fn webgl2(multi_draw: bool, words: usize, limit: usize) -> CpuCulledRenderer {
    CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        draw_list_words: words,
        draw_list_limit: limit,
        ..CpuCulledConfig::default()
    })
}

/// The WebGPU frame builder with a draw list of `limit` words at most.
fn webgpu(words: usize, limit: usize) -> GpuDrivenRenderer {
    GpuDrivenRenderer::new(RendererConfig {
        draw_list_words: words,
        draw_list_limit: limit,
        ..RendererConfig::default()
    })
}

#[test]
fn webgl2_without_multi_draw_draws_2500_meshes_in_the_view_and_four_cascades() {
    // Firefox has no `WEBGL_multi_draw`, so each mesh is a draw of its own in each view that sees
    // it: the camera's 2,500, and the cascades' about twice as many. A list of fixed size held
    // fewer.
    const MESHES: u32 = 2_500;
    let mut world = World::build_sized(webgl2(false, 64 * 1024, MAX_WORDS), MESHES + 64);
    add_distinct_meshes(&mut world, MESHES);
    world.cast_sun_shadows(4);
    let mut mock = MockBackend::default();
    for structure_changed in [true, false] {
        let commands = world.step(&mut mock, structure_changed);
        assert!(count(&commands, Op::DrawIndexed) > 2 * MESHES as usize);
    }
}

/// Steps `world` from a draw list of a few words: the first frame grows it, and the frames after
/// keep its memory, as each frame parity has a list of its own.
fn grows_once<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    world.step(&mut mock, false);
    let address = |world: &World<B>| world.renderer.list(world.frame).as_ptr();
    world.record(false);
    let (before, words) = (address(&world), world.renderer.list(world.frame).len());
    assert!(words > 16);
    world.frame += 2;
    world.record(false);
    assert_eq!(address(&world), before);
}

#[test]
fn a_draw_list_that_starts_small_grows_once_on_both_builders() {
    grows_once(World::build(webgpu(16, MAX_WORDS)));
    grows_once(World::build(webgl2(true, 16, MAX_WORDS)));
    grows_once(World::build(webgl2(false, 16, MAX_WORDS)));
}

/// Steps a world of `builder` past its draw list's limit, part way through a frame, and checks
/// the frame publishes nothing, later frames fail the same way while the GPU holds what the frame
/// never made, and a new GPU device records the scene whole again.
fn fails_whole_until_a_new_gpu<B: FrameBuilder>(builder: impl Fn(usize) -> B) {
    const OBJECTS: u32 = 1_000;
    let capacity = OBJECTS + 64;
    // The words of the frame that adds the objects, with no limit.
    let mut probe = World::build_sized(builder(MAX_WORDS), capacity);
    probe.step(&mut MockBackend::default(), true);
    add_distinct_meshes(&mut probe, OBJECTS);
    probe.record(true);
    let needed = probe.renderer.list(probe.frame).len();

    let mut world = World::build_sized(builder(needed - 1), capacity);
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    world.step(&mut mock, false);
    let objects = add_distinct_meshes(&mut world, OBJECTS);
    let error = refused(&mut world);
    assert_eq!(error, RecordError::DrawListFull { megabytes: 0 });

    // The builder's state no longer matches the GPU's, so it records nothing, even for a scene
    // that fits again.
    destroy(&mut world, &objects);
    assert_eq!(refused(&mut world), error);

    world.renderer.reset_gpu();
    let mut fresh = MockBackend::default();
    let whole = world.step(&mut fresh, true);
    assert!(count(&whole, Op::Submit) > 0);
    world.step(&mut fresh, false);
}

#[test]
fn a_frame_that_fails_part_way_draws_nothing_and_a_new_gpu_records_again() {
    // With `WEBGL_multi_draw`, a thousand more meshes add only a few words, so the WebGL2
    // builder fails here without it.
    fails_whole_until_a_new_gpu(|limit| webgpu(16 * 1024, limit));
    fails_whole_until_a_new_gpu(|limit| webgl2(false, 64 * 1024, limit));
}

/// A crowd of `n` skinned columns of `around` vertices per ring, one mesh between them, on the
/// WebGPU frame builder with storage bindings of `binding` bytes, in a grid that the camera sees
/// whole.
fn crowd(n: u32, around: u32, binding: u32) -> (World, Vec<Handle>) {
    let renderer = GpuDrivenRenderer::new(RendererConfig {
        storage_binding_bytes: binding,
        ..RendererConfig::default()
    });
    let mut world = World::build_sized(renderer, n + 64);
    world
        .scene
        .set_position(world.camera, [0.0, 0.0, 60.0])
        .unwrap();
    world.make_room_for_crowd(n);
    let place = |k: u32| {
        let (column, row) = ((k % 40) as f32, (k / 40) as f32);
        [column * 1.5 - 29.25, row * 1.5 - 20.0, 0.0]
    };
    let first = world.add_skinned_mesh(place(0), &column_around(around));
    let mut objects = vec![first];
    objects.extend((1..n).map(|k| world.add_twin(first, place(k))));
    (world, objects)
}

/// The workgroups of each dispatch of the skinning pass in `commands`, as x by y.
fn skin_dispatches(commands: &[(Op, Vec<u32>)]) -> Vec<[u32; 2]> {
    let skin = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateComputePipeline && o[1] == template::SKIN)
        .map(|(_, o)| o[0]);
    let mut current = None;
    let mut dispatches = Vec::new();
    for (op, o) in commands {
        match op {
            Op::SetComputePipeline => current = Some(o[0]),
            Op::Dispatch if current.is_some() && current == skin => {
                assert_eq!(o[2], 1);
                dispatches.push([o[0], o[1]]);
            }
            _ => {}
        }
    }
    dispatches
}

/// The sizes of the skinned vertex buffers that the skinning pass's bind groups write.
fn skinned_buffers(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    let sizes: HashMap<u32, u32> = commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateBuffer)
        .map(|(_, o)| (o[0], o[1]))
        .collect();
    let mut buffers: Vec<u32> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::SKIN)
        .map(|(_, o)| o[3 + 2 * 5 + 2])
        .collect();
    buffers.sort_unstable();
    buffers.dedup();
    buffers.iter().map(|id| sizes[id]).collect()
}

/// Checks that the first frame of a crowd of `n` columns of `around` vertices per ring skins every
/// vertex, in dispatches within the device's limits, into buffers within its storage binding of
/// `binding` bytes. Returns the dispatches and the buffers' sizes.
fn skins_every_vertex(n: u32, around: u32, binding: u32) -> (Vec<[u32; 2]>, Vec<u32>) {
    let (mut world, _) = crowd(n, around, binding);
    let first = world.step(&mut MockBackend::default(), true);
    let dispatches = skin_dispatches(&first);
    let groups: u32 = dispatches.iter().map(|[x, y]| x * y).sum();
    let needed = n * (RINGS * around).div_ceil(SKIN_WORKGROUP);
    // A dispatch over rows may round up by less than one workgroup per row.
    let rows: u32 = dispatches.iter().map(|[_, y]| y).sum();
    assert!(groups >= needed && groups < needed + rows, "{dispatches:?}");
    let buffers = skinned_buffers(&first);
    assert!(buffers.iter().all(|&bytes| bytes <= binding), "{buffers:?}");
    (dispatches, buffers)
}

#[test]
fn a_crowd_past_one_dispatchs_workgroups_skins_every_vertex() {
    // 470 columns of 9,000 vertices: 66,270 workgroups of one mesh page in one skinned vertex
    // buffer, past the 65,535 that one axis of a dispatch reaches.
    let (dispatches, buffers) = skins_every_vertex(470, 3_000, 256 * MIB);
    assert_eq!(buffers.len(), 1);
    assert_eq!(dispatches.len(), 1);
    let [x, y] = dispatches[0];
    assert!(y > 1 && x <= MAX_WORKGROUPS_PER_DIMENSION);
}

#[test]
fn a_crowd_of_1000_characters_spreads_its_skinned_vertices_over_storage_bindings() {
    // 1,000 columns of 4,962 vertices, as many as 1,000 of S5's knights: about 119 MB of skinned
    // vertices, more than one storage binding of 64 MiB holds.
    let (dispatches, buffers) = skins_every_vertex(1_000, 1_654, 64 * MIB);
    assert_eq!(buffers.len(), 2);
    assert!(dispatches.len() >= 2);
}

#[test]
fn skinned_vertices_past_every_buffer_fail_with_their_cap_and_recover() {
    // At a 1 MiB binding, the eight skinned vertex buffers hold 8 MiB: 24 columns of 288,000
    // bytes, three to a buffer.
    let (mut world, objects) = crowd(25, 4_000, MIB);
    let mut mock = MockBackend::default();
    assert_eq!(
        refused(&mut world),
        RecordError::SkinnedVerticesFull { megabytes: 8 }
    );
    // The frame failed before it recorded a command, so the next one records as the scene stands.
    destroy(&mut world, &objects[24..]);
    let first = world.step(&mut mock, true);
    assert_eq!(skinned_buffers(&first).len(), 8);
    world.step(&mut mock, false);
}

#[test]
fn skinned_meshes_past_the_passs_mesh_pages_fail_with_their_cap() {
    // At a 1 MiB binding a mesh page holds two of these columns, so 66 of them fill 33 pages.
    let renderer = GpuDrivenRenderer::new(RendererConfig {
        storage_binding_bytes: MIB,
        ..RendererConfig::default()
    });
    let mut world = World::build_sized(renderer, 128);
    world.make_room_for_crowd(66);
    let objects: Vec<Handle> = (0..66)
        .map(|k| world.add_skinned_mesh([k as f32, 0.0, 0.0], &column_around(3_000)))
        .collect();
    assert_eq!(
        refused(&mut world),
        RecordError::SkinnedPagesFull { limit: 32 }
    );
    destroy(&mut world, &objects[8..]);
    world.step(&mut MockBackend::default(), true);
}
