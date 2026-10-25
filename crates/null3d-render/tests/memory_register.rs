//! The memory register against a hand measurement of the same tables, by the method of the memory
//! study: two scene sizes, the growth divided by the slots between them, and the register's figure
//! matched to the hand count within five per cent.
//!
//! The upload arenas hold the bytes that the frame's own write commands copy into them, which the
//! draw list records. The casters' layout keeps a fixed number of words for each scene slot, which
//! the scene's capacity states. Each check runs on the WebGPU and WebGL2 builders, whose layouts
//! keep different numbers of words.

mod common;

use std::mem::size_of;

use common::{World, base_format};
use null3d_core::handle::Handle;
use null3d_core::memory::{MemoryRegister, area};
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::Op;
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::box_geometry;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::Shading;

/// The scene capacities that the checks compare: both are powers of two, and each leaves room for
/// the standard objects after the casters fill the rest.
const SMALL: u32 = 512;
const LARGE: u32 = 1024;
/// Words that a casting scene slot takes in the casters' layout: the WebGPU path keeps its bucket
/// entry, its home bucket and its culling bucket; the WebGL2 path keeps its bucket. A batch's rows
/// and the buckets and draws of a mesh are the same at both sizes, since every caster shares one
/// mesh.
const GPU_CASTER_WORDS: u64 = 3;
const WEBGL2_CASTER_WORDS: u64 = 1;

/// The GPU path's world with room for `capacity` scene slots. Its batch and its objects stay
/// still, so every frame's uploads are the bytes it copies into its arena, not a batch's rows,
/// which upload from their own storage.
fn gpu(capacity: u32) -> World<GpuDrivenRenderer> {
    World::build_with(
        GpuDrivenRenderer::new(RendererConfig::default()),
        capacity,
        false,
    )
}

/// The WebGL2 path's world with room for `capacity` scene slots, as [`gpu`] makes the GPU path's.
fn webgl2(capacity: u32) -> World<CpuCulledRenderer> {
    World::build_with(
        CpuCulledRenderer::new(CpuCulledConfig::default()),
        capacity,
        false,
    )
}

/// Adds visible objects that share one mesh and cast shadows, so the casters' layout holds their
/// slots.
fn add_casters<B: FrameBuilder>(world: &mut World<B>, objects: u32) {
    let settings = world.renderer.settings_mut();
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap()
        + 1;
    let mesh = settings
        .meshes_mut()
        .add(&base_format(
            box_geometry(0.5, 0.5, 0.5, [1, 1, 1]).unwrap(),
        ))
        .unwrap()
        + 1;
    let shown = flags::VISIBLE | flags::CAST_SHADOWS;
    for k in 0..objects {
        let object = world.scene.reserve().unwrap();
        world
            .scene
            .set_position(object, [k as f32 * 0.02, 0.0, 0.0])
            .unwrap();
        world.scene.set_local_radius(object, 0.5).unwrap();
        let commands = [
            Command::create(object, Handle::NONE, mesh, shown),
            Command::set_material(object, material),
        ];
        world.scene.apply_commands(&commands, world.frame).unwrap();
    }
}

/// The register's figures after the world's newest frame.
fn register<B: FrameBuilder>(world: &World<B>) -> MemoryRegister {
    let mut register = MemoryRegister::new();
    register.begin();
    world.renderer.account(&mut register);
    register
}

/// The operations of one recorded frame, and their operands.
type Commands = Vec<(Op, Vec<u32>)>;

/// The bytes that a frame's list copies into its upload arena: the byte lengths of its write
/// commands, which are the arena's own bytes padded to four.
fn uploaded(commands: &[(Op, Vec<u32>)]) -> u64 {
    let mut bytes = 0;
    for (op, operands) in commands {
        match op {
            Op::WriteBuffer => bytes += u64::from(operands[3]),
            Op::WriteTexture => bytes += u64::from(operands[9]),
            _ => {}
        }
    }
    bytes
}

/// Records and replays six frames, and returns the last two frames' commands. The first two frames
/// build the layout and upload the meshes; the rest upload what a settled frame writes.
fn settle<B: FrameBuilder>(world: &mut World<B>) -> (Commands, Commands) {
    let mut mock = MockBackend::default();
    let mut previous = Vec::new();
    let mut newest = Vec::new();
    for frame in 0..6 {
        previous = std::mem::take(&mut newest);
        newest = world.step(&mut mock, frame < 2);
    }
    (previous, newest)
}

/// The two parities' arenas hold the bytes that their two frames' write commands copied in. The
/// register counts both parities, and each arena keeps the frame it recorded last. An arena also
/// counts the list of volatile ranges that its still-camera comparison tracks, which are offsets
/// into those bytes rather than copies; the five per cent tolerance covers that list.
fn upload_arenas_hold_their_frames_writes<B: FrameBuilder>(mut world: World<B>, capacity: u32) {
    add_casters(&mut world, capacity - 8);
    world.cast_sun_shadows(2);
    let (previous, newest) = settle(&mut world);
    let arenas = register(&world).area(area::UPLOADS);
    let hand = uploaded(&previous) + uploaded(&newest);
    assert!(hand > 0, "the frames write nothing into their arenas");
    assert!(
        arenas.used.abs_diff(hand) * 20 <= hand,
        "the upload arenas hold {} bytes, against the {} bytes that the two frames' write commands copied in",
        arenas.used,
        hand
    );
    assert!(
        arenas.reserved >= arenas.used,
        "the upload arenas reserve {} bytes but use {}",
        arenas.reserved,
        arenas.used
    );
    assert!(
        arenas.peak >= arenas.used,
        "the upload arenas peak at {} bytes but use {}",
        arenas.peak,
        arenas.used
    );
}

/// The casters' layout grows by the hand count of words for each added scene slot. The slots are
/// the scene's capacity, which `SceneStorage` states as `capacity + 1` rows.
fn casters_take_words_for_each_slot<B: FrameBuilder>(
    mut small: World<B>,
    mut large: World<B>,
    words: u64,
) {
    add_casters(&mut small, SMALL - 8);
    add_casters(&mut large, LARGE - 8);
    small.cast_sun_shadows(2);
    large.cast_sun_shadows(2);
    for world in [&mut small, &mut large] {
        settle(world);
    }
    let before = register(&small).area(area::CASTERS);
    let after = register(&large).area(area::CASTERS);
    let slots = u64::from(LARGE - SMALL);
    let hand = slots * words * size_of::<u32>() as u64;
    let measured = after.used.saturating_sub(before.used);
    assert!(
        measured.abs_diff(hand) * 20 <= hand,
        "the casters' layout grew {} bytes, against the hand's {} for {slots} slots of {words} words",
        measured,
        hand
    );
}

#[test]
fn the_gpu_driven_upload_arenas_hold_the_bytes_their_frames_write() {
    upload_arenas_hold_their_frames_writes(gpu(SMALL), SMALL);
}

#[test]
fn the_webgl2_upload_arenas_hold_the_bytes_their_frames_write() {
    upload_arenas_hold_their_frames_writes(webgl2(SMALL), SMALL);
}

#[test]
fn the_gpu_driven_casters_take_three_words_for_each_scene_slot() {
    casters_take_words_for_each_slot(gpu(SMALL), gpu(LARGE), GPU_CASTER_WORDS);
}

#[test]
fn the_webgl2_casters_take_one_word_for_each_scene_slot() {
    casters_take_words_for_each_slot(webgl2(SMALL), webgl2(LARGE), WEBGL2_CASTER_WORDS);
}
