//! Steady frames allocate nothing: a counting global allocator watches the test thread while the
//! frame builder records frames of a scene whose batch moves every frame. It counts only the test
//! thread, so the test runner's own work on other threads cannot reach the count. Frames whose
//! structure changes allocate nothing either, on either frame parity, until the scene grows, and
//! neither do frames that draw debug lines or stop drawing them, that draw a texture background,
//! or that sort blended objects whose order changes. The render graph allocates nothing while it
//! stays the same, nor when passes switch on and off after it has compiled once, nor when the
//! render scale changes. WebGPU frames with the depth prepass allocate nothing either. The job
//! workers and the calling thread assign moving lights to the light grid without allocating, and a
//! scene pass's grid takes a moving lamp without allocating either.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

mod common;

use common::blended::add_scene;
use common::graph::{CASCADES, engine_passes};
use common::{World, base_sphere, grid};
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::lights::{POINT_CONE, SunShadow, VisibleLight, kind};
use null3d_core::scene::{Command, flags};
use null3d_core::testing::CountingAllocator;
use null3d_gpu::drawlist::{DrawList, Op, format};
use null3d_render::background::{Background, BackgroundSource};
use null3d_render::camera::{Lens, Perspective};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::light_grid::{ClusterParams, DEFAULT_GRID, GridView, LightGrid, LightLimits};
use null3d_render::materials::Shading;
use null3d_render::outline::Outline;
use null3d_render::output::{Antialias, Output, SceneColor, ToneMapping};
use null3d_render::parallel_record::ParallelRecorder;
use null3d_render::shadow_tiles::TileSettings;
use null3d_render::shadows::ShadowQuality;
use null3d_render::view::ViewId;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn recording_steady_frames_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    // Two frames per parity warm up the lists and the upload arenas.
    for frame in 1..=4 {
        world.frame = frame;
        world.record(frame == 1);
    }
    CountingAllocator::arm();
    for frame in 5..=200 {
        world.frame = frame;
        world.record(false);
    }
    assert_eq!(CountingAllocator::disarm(), 0);
}

/// Records warm-up frames of `world` with every object casting and receiving the sun's shadows
/// in four cascades, far ones that draw every other frame, and a dynamic caster that keeps them
/// drawing, then steady frames and frames whose structure changes, and returns what those
/// allocated.
fn shadow_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let casts = flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let mut commands: Vec<Command> = world
        .objects
        .iter()
        .map(|&object| Command::set_flags(object, casts, casts))
        .collect();
    commands.push(Command::set_dynamic(world.objects[0], true));
    world.scene.apply_commands(&commands, world.frame).unwrap();
    let quality = ShadowQuality {
        filter: 3,
        far_interval: 2,
        follow_movers: true,
        ..ShadowQuality::default()
    };
    world.renderer.settings_mut().set_shadow_quality(quality);
    let shadow = SunShadow {
        cascades: 4,
        map_size: 1024,
        bias: 0.5,
        normal_bias: 1.0,
        distance: 60.0,
        layers: 1,
    };
    world.renderer.settings_mut().set_sun_shadow(Some(shadow));
    world.record(true);
    // Frames of both parities, and a rebuild on each parity, warm up.
    record_until(&mut world, 6, false);
    record_until(&mut world, 8, true);
    CountingAllocator::arm();
    record_until(&mut world, 100, false);
    record_until(&mut world, 120, true);
    CountingAllocator::disarm()
}

#[test]
fn recording_frames_with_shadows_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(shadow_allocations(World::new()), 0);
    for multi_draw in [true, false] {
        let allocated = shadow_allocations(webgl2_world(multi_draw));
        assert_eq!(allocated, 0, "WebGL2, multi-draw {multi_draw}");
    }
}

/// Records warm-up frames of `world` with two spot lights and a point light that cast shadows into
/// a shadow atlas of seven tiles, which the near spot light takes in turn from the others as it
/// moves, then frames in which a caster moves within the lights' reach and out of it and changes
/// its layers, a skinned caster below the point light plays its clip, the far spot light's
/// shadows turn off and on, still frames, and frames whose structure changes, and returns what
/// those allocated.
fn spot_shadow_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let casts = flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let commands: Vec<Command> = world
        .objects
        .iter()
        .map(|&object| Command::set_flags(object, casts, casts))
        .collect();
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world
        .renderer
        .settings_mut()
        .set_tile_settings(TileSettings {
            tiles: 7,
            size: 256,
            point_shadows: true,
        });
    let near = world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let far = world.add_spot([3.0, 4.0, 0.0], 6.0);
    world.add_point([0.0, 3.0, -2.0], 5.0);
    world.add_skinned([0.0, 0.0, -2.0]);
    let mover = world.objects[0];
    // Returns true when the frame's commands change the structure.
    let step = |world: &mut World<B>, frame: u32| {
        // The near light moves toward the camera and back, so the two lights swap the tile.
        let z = if frame % 8 < 4 { 0.0 } else { 15.0 };
        world.scene.set_position(near, [-3.0, 4.0, z]).unwrap();
        let x = if frame.is_multiple_of(3) { -3.0 } else { 30.0 };
        world.scene.set_position(mover, [x, 0.0, 0.0]).unwrap();
        let layers = if frame % 10 < 5 { 1 } else { 0b10 };
        let casts = if frame % 14 < 7 {
            flags::CAST_SHADOWS
        } else {
            0
        };
        let commands = [
            Command::set_layers(mover, layers),
            Command::set_flags(far, flags::CAST_SHADOWS, casts),
        ];
        world.scene.apply_commands(&commands, frame).unwrap();
        world.scene.take_structure_changed()
    };
    world.record(true);
    for frame in 2..=30 {
        let structure = step(&mut world, frame);
        world.frame = frame;
        world.record(structure || frame > 26);
    }
    CountingAllocator::arm();
    for frame in 31..=150 {
        let structure = step(&mut world, frame);
        world.frame = frame;
        world.record(structure || frame.is_multiple_of(20));
    }
    CountingAllocator::disarm()
}

#[test]
fn recording_frames_with_spot_light_shadows_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(spot_shadow_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        let allocated = spot_shadow_allocations(webgl2_world(multi_draw));
        assert_eq!(allocated, 0, "WebGL2, multi-draw {multi_draw}");
    }
}

/// Records warm-up frames of `world` with three skinned columns that play their clip: one that
/// the camera sees, one that only the sun's cascades see, and one that moves in and out of the
/// camera's view. Then it records steady frames and frames whose structure changes, and returns
/// what those allocated.
fn skinning_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    world.add_skinned([0.0, 0.0, 0.0]);
    world.add_skinned([0.0, 30.0, 0.0]);
    let mover = world.add_skinned([3.0, 0.0, 0.0]);
    let shadow = SunShadow {
        cascades: 2,
        map_size: 1024,
        bias: 0.5,
        normal_bias: 1.0,
        distance: 40.0,
        layers: 1,
    };
    world.renderer.settings_mut().set_sun_shadow(Some(shadow));
    world.record(true);
    let step = |world: &mut World<B>, frame: u32, rebuild: bool| {
        let z = if frame % 6 < 3 { 0.0 } else { 40.0 };
        world.scene.set_position(mover, [3.0, 0.0, z]).unwrap();
        world.frame = frame;
        world.record(rebuild);
    };
    // Frames of both parities, and a rebuild on each parity, warm up.
    for frame in 2..=8 {
        step(&mut world, frame, frame > 6);
    }
    CountingAllocator::arm();
    for frame in 9..=100 {
        step(&mut world, frame, frame.is_multiple_of(25));
    }
    CountingAllocator::disarm()
}

#[test]
fn skinning_frames_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(skinning_allocations(World::new()), 0, "WebGPU");
    let allocated = skinning_allocations(webgl2_world(true));
    assert_eq!(allocated, 0, "WebGL2");
}

/// Records warm-up frames of `world` with two morphed boxes whose weights change every frame:
/// one that the camera sees, and one that moves in and out of its view. Then it records steady
/// frames and frames whose structure changes, and returns what those allocated.
fn morph_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    world.renderer.settings_mut().set_morph_cap(1);
    let (_, still) = world.add_morphed([0.0, 0.0, 0.0], [0.5, 0.25]);
    let (mover, moving) = world.add_morphed([3.0, 0.0, 0.0], [0.0, 1.0]);
    world.record(true);
    let step = |world: &mut World<B>, frame: u32, rebuild: bool| {
        let z = if frame % 6 < 3 { 0.0 } else { 40.0 };
        world.scene.set_position(mover, [3.0, 0.0, z]).unwrap();
        // Fractions that change every frame, so weights and bounds move.
        let t = (frame % 10) as f32 * 0.1;
        world.set_weight(still, 0, t);
        world.set_weight(moving, 1, 1.0 - t);
        world.frame = frame;
        world.record(rebuild);
    };
    for frame in 2..=8 {
        step(&mut world, frame, frame > 6);
    }
    CountingAllocator::arm();
    for frame in 9..=100 {
        step(&mut world, frame, frame.is_multiple_of(25));
    }
    CountingAllocator::disarm()
}

#[test]
fn morph_frames_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(morph_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        let allocated = morph_allocations(webgl2_world(multi_draw));
        assert_eq!(allocated, 0, "WebGL2, multi-draw {multi_draw}");
    }
}

/// Records warm-up frames of a world with a second view, then steady frames and frames whose
/// structure changes, and returns what those allocated.
fn two_view_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    // Frames of both parities and every ring slot, and a rebuild on each parity, warm up.
    record_until(&mut world, 6, false);
    record_until(&mut world, 8, true);
    CountingAllocator::arm();
    record_until(&mut world, 100, false);
    record_until(&mut world, 120, true);
    CountingAllocator::disarm()
}

/// Records warm-up frames of a world whose second view a texture shows, switching the view on
/// and off, then more such frames, and returns what those allocated.
fn view_switch_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let side = world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    let switch = |world: &mut World<B>, last: u32| {
        while world.frame < last {
            world.frame += 1;
            let on = !world.frame.is_multiple_of(3);
            world.renderer.settings_mut().set_view_enabled(side, on);
            world.record(false);
        }
    };
    switch(&mut world, 12);
    CountingAllocator::arm();
    switch(&mut world, 100);
    CountingAllocator::disarm()
}

#[test]
fn switching_a_scene_pass_on_and_off_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(view_switch_allocations(World::new()), 0, "WebGPU");
    assert_eq!(view_switch_allocations(webgl2_world(true)), 0, "WebGL2");
}

/// Records warm-up frames of a world whose second view a texture shows, with a lamp between the
/// two cameras that moves in and out of the second view's sight, which only that view sees, and a
/// spot light that both views see and the main camera's view gives a shadow tile. Then it records
/// more such frames, and returns what those allocated.
fn pass_lamp_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    world
        .renderer
        .settings_mut()
        .set_tile_settings(TileSettings {
            tiles: 7,
            size: 256,
            point_shadows: true,
        });
    world.add_view([0.0, 0.0, 40.0]);
    let lamp = world.add_point([0.0, 0.0, 30.0], 3.0);
    world.add_spot([0.0, 3.0, 0.0], 6.0);
    world.record(true);
    let step = |world: &mut World<B>, last: u32| {
        while world.frame < last {
            world.frame += 1;
            let frame = world.frame;
            // Out of the view's sight one frame in four, and along the view the rest.
            let x = if frame.is_multiple_of(4) { 500.0 } else { 0.0 };
            let z = 25.0 + (frame % 7) as f32;
            world.scene.set_position(lamp, [x, 0.0, z]).unwrap();
            world.record(false);
        }
    };
    step(&mut world, 12);
    CountingAllocator::arm();
    step(&mut world, 120);
    CountingAllocator::disarm()
}

#[test]
fn a_moving_lamp_that_a_scene_pass_sees_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(pass_lamp_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        let allocated = pass_lamp_allocations(webgl2_world(multi_draw));
        assert_eq!(allocated, 0, "WebGL2, multi-draw {multi_draw}");
    }
}

#[test]
fn recording_frames_of_two_views_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(two_view_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        assert_eq!(
            two_view_allocations(webgl2_world(multi_draw)),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

#[test]
fn recording_frames_with_the_depth_prepass_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let world = || {
        World::with_config(RendererConfig {
            depth_prepass: true,
            ..RendererConfig::default()
        })
    };
    assert_eq!(shadow_allocations(world()), 0, "shadows");
    assert_eq!(two_view_allocations(world()), 0, "two views");
    for multi_draw in [true, false] {
        let world = || {
            World::build(CpuCulledRenderer::new(CpuCulledConfig {
                multi_draw,
                depth_prepass: true,
                ..CpuCulledConfig::default()
            }))
        };
        assert_eq!(
            shadow_allocations(world()),
            0,
            "WebGL2 shadows, multi-draw {multi_draw}"
        );
        assert_eq!(
            two_view_allocations(world()),
            0,
            "WebGL2 two views, multi-draw {multi_draw}"
        );
    }
}

#[test]
fn recording_frames_with_occlusion_culling_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    // Every object of the world is an occluder, so the camera culls in two phases.
    let world = || {
        let mut world = World::with_config(RendererConfig {
            gpu_occlusion: true,
            ..RendererConfig::default()
        });
        let occluder = 1 << 7;
        let commands: Vec<Command> = world
            .objects
            .iter()
            .map(|&object| Command::set_flags(object, occluder, occluder))
            .collect();
        world.scene.apply_commands(&commands, world.frame).unwrap();
        world
    };
    assert_eq!(shadow_allocations(world()), 0, "shadows");
    assert_eq!(two_view_allocations(world()), 0, "two views");
    assert_eq!(scale_change_allocations(world()), 0, "render scale changes");
}

/// Records warm-up frames, then steady frames whose exposure changes every frame, so the final pass
/// uploads its settings each time, and returns what those allocated.
fn hdr_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    record_until(&mut world, 6, false);
    CountingAllocator::arm();
    for frame in 7..=200 {
        world.frame = frame;
        world.renderer.settings_mut().set_output(Output {
            tone_mapping: ToneMapping::Agx,
            exposure: frame as f32 / 100.0,
        });
        world.record(false);
    }
    CountingAllocator::disarm()
}

/// Records warm-up frames of a world whose render scale can drop, then frames whose render scale
/// changes every frame, and returns what those allocated.
fn scale_change_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    world.renderer.settings_mut().set_render_scaling(true);
    record_until(&mut world, 6, false);
    CountingAllocator::arm();
    for frame in 7..=200 {
        world.frame = frame;
        world.render_scale = RenderScale::from_thousandths(500 + (frame * 37) % 501);
        world.record(false);
    }
    CountingAllocator::disarm()
}

#[test]
fn render_scale_changes_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for scene_color in [format::RGBA16_FLOAT, format::CANVAS] {
        let canvas = CanvasOutput {
            scene_color: SceneColor::from_format(scene_color),
            antialias: Antialias::Msaa,
            transparent: false,
        };
        let webgpu = World::with_config(RendererConfig {
            canvas,
            ..RendererConfig::default()
        });
        assert_eq!(scale_change_allocations(webgpu), 0, "WebGPU, {scene_color}");
        let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
            canvas,
            multi_draw: true,
            ..CpuCulledConfig::default()
        }));
        assert_eq!(scale_change_allocations(webgl2), 0, "WebGL2, {scene_color}");
    }
}

/// Records warm-up frames of a world with two outlined objects, then frames whose outline width
/// and render scale change every frame, while the camera moves, and returns what those allocated.
fn outline_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let settings = world.renderer.settings_mut();
    settings.set_render_scaling(true);
    settings.set_outline(Some(Outline::default()));
    let outlined = flags::OUTLINED;
    let commands: Vec<_> = world.objects[..2]
        .iter()
        .map(|&object| Command::set_flags(object, outlined, outlined))
        .collect();
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world.record(true);
    record_until(&mut world, 6, false);
    CountingAllocator::arm();
    for frame in 7..=200 {
        world.frame = frame;
        world.renderer.settings_mut().set_outline(Some(Outline {
            width: 1.0 + (frame % 7) as f32 * 0.5,
            ..Outline::default()
        }));
        world.render_scale = RenderScale::from_thousandths(500 + (frame * 37) % 501);
        world.aim([0.0, 1.0, 20.0], frame as f32 * 0.002, 0.0);
        world.record(false);
    }
    CountingAllocator::disarm()
}

#[test]
fn frames_with_outlines_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for scene_color in [format::RGBA16_FLOAT, format::CANVAS] {
        let canvas = CanvasOutput {
            scene_color: SceneColor::from_format(scene_color),
            antialias: Antialias::Msaa,
            transparent: false,
        };
        let webgpu = World::with_config(RendererConfig {
            canvas,
            ..RendererConfig::default()
        });
        assert_eq!(outline_allocations(webgpu), 0, "WebGPU, {scene_color}");
        let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
            canvas,
            multi_draw: true,
            ..CpuCulledConfig::default()
        }));
        assert_eq!(outline_allocations(webgl2), 0, "WebGL2, {scene_color}");
    }
}

/// Records frames of a world with a second view up to `last`, each giving an object, the batch
/// and both views new layers, with no structure change.
fn record_layer_changes<B: FrameBuilder>(world: &mut World<B>, side: ViewId, last: u32) {
    while world.frame < last {
        world.frame += 1;
        let frame = world.frame;
        let mask = 1 << (frame % 3);
        let object = world.objects[frame as usize % world.objects.len()];
        world
            .scene
            .apply_commands(&[Command::set_layers(object, mask)], frame)
            .unwrap();
        let batch = world.batches.get_mut(world.batch).unwrap();
        batch.set_layers(mask | 1);
        let settings = world.renderer.settings_mut();
        settings.set_layers(ViewId::CAMERA, mask | 0b1000);
        settings.set_layers(side, mask);
        world.record(false);
    }
}

/// Records warm-up frames of a world with a second view, then frames that change layers, and
/// returns what those allocated.
fn layer_change_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let side = world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    record_layer_changes(&mut world, side, 8);
    CountingAllocator::arm();
    record_layer_changes(&mut world, side, 100);
    CountingAllocator::disarm()
}

#[test]
fn hdr_frames_whose_output_settings_change_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for antialias in Antialias::ALL {
        let canvas = CanvasOutput {
            scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
            antialias,
            transparent: false,
        };
        let webgpu = World::with_config(RendererConfig {
            canvas,
            transient_attachments: true,
            ..RendererConfig::default()
        });
        assert_eq!(hdr_allocations(webgpu), 0, "WebGPU, {antialias:?}");
        for multi_draw in [true, false] {
            let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
                canvas,
                multi_draw,
                ..CpuCulledConfig::default()
            }));
            assert_eq!(
                hdr_allocations(webgl2),
                0,
                "WebGL2, multi-draw {multi_draw}, {antialias:?}"
            );
        }
    }
}

#[test]
fn layer_changes_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(layer_change_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        assert_eq!(
            layer_change_allocations(webgl2_world(multi_draw)),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

/// The world drawn by the WebGL2 frame builder, with or without multi-draw.
fn webgl2_world(multi_draw: bool) -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }))
}

#[test]
fn recording_steady_webgl2_frames_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for multi_draw in [true, false] {
        let mut world = webgl2_world(multi_draw);
        // Frames of both parities and every ring slot warm up the lists, arenas and textures.
        for frame in 1..=6 {
            world.frame = frame;
            world.record(frame == 1);
        }
        CountingAllocator::arm();
        for frame in 7..=200 {
            world.frame = frame;
            world.record(false);
        }
        assert_eq!(CountingAllocator::disarm(), 0, "multi-draw {multi_draw}");
    }
}

#[test]
fn webgl2_structure_changes_after_warm_up_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for multi_draw in [true, false] {
        let mut world = webgl2_world(multi_draw);
        world.record(true);
        record_until(&mut world, 6, false);
        CountingAllocator::arm();
        record_until(&mut world, 40, true);
        assert_eq!(CountingAllocator::disarm(), 0, "multi-draw {multi_draw}");
    }
}

#[test]
fn webgl2_static_batches_coming_to_rest_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    for multi_draw in [true, false] {
        let mut world = webgl2_world(multi_draw);
        let still = world.batches.create(3000, false, false, 1, 1, 0.9).unwrap();
        world.record(true);
        record_until(&mut world, 6, false);
        CountingAllocator::arm();
        // Some rows move every fifth frame, and every structure change rebuilds the layout: each
        // time the batch is culled by row, then comes to rest, builds its clusters again and
        // uploads their order.
        while world.frame < 200 {
            world.frame += 1;
            if world.frame.is_multiple_of(5) {
                let batch = world.batches.get_mut(still).unwrap();
                batch.positions_mut()[3] += 0.5;
                batch.mark_dirty(1, 40).unwrap();
            }
            world.record(world.frame.is_multiple_of(7));
        }
        assert_eq!(CountingAllocator::disarm(), 0, "multi-draw {multi_draw}");
    }
}

/// Records warm-up frames of a world with blended objects and a second view, then frames in
/// which the blended rows pass each other and a blended object moves, so the sorted order and
/// its runs change, and frames whose structure changes. Returns what those allocated.
fn sorted_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let blended = add_scene(&mut world);
    world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    let sort_frames = |world: &mut World<B>, last: u32| {
        while world.frame < last {
            world.frame += 1;
            let frame = world.frame;
            let rows = world.batches.get_mut(blended.batch).unwrap();
            rows.positions_mut()[2] = (frame % 11) as f32 - 5.0;
            rows.mark_dirty(0, 1).unwrap();
            world
                .scene
                .set_position(blended.box_object, [0.0, 0.0, (frame % 7) as f32 - 3.0])
                .unwrap();
            world.record(frame.is_multiple_of(9));
        }
    };
    sort_frames(&mut world, 20);
    CountingAllocator::arm();
    sort_frames(&mut world, 120);
    CountingAllocator::disarm()
}

/// Records frames of a world spread over grid cells whose camera turns and moves, so each frame
/// sees other cells. Every eighth frame a still object and a still row move into another cell and
/// back, which builds the cell order again. The camera's path repeats every 24 frames, so the
/// warm-up sees every view that later frames see. Returns what the frames after it allocated.
fn spread_allocations<B: FrameBuilder>(renderer: B) -> u64 {
    let mut world = World::build_sized(renderer, 216);
    let batch = world.spread(200, 3000, 5);
    world.record(true);
    let object = world.objects[4];
    let step = |world: &mut World<B>| {
        world.frame += 1;
        world.scene.begin_frame(world.frame);
        let k = (world.frame % 24) as f32;
        world.aim([k * 150.0 - 1800.0, 10.0, 900.0 - k * 80.0], k * 0.6, 0.05);
        if world.frame.is_multiple_of(8) {
            let x = if world.frame.is_multiple_of(16) {
                -2000.0
            } else {
                2000.0
            };
            world.scene.set_position(object, [x, 0.0, x]).unwrap();
            let rows = world.batches.get_mut(batch).unwrap();
            rows.positions_mut()[..3].copy_from_slice(&[x, 5.0, -x]);
            rows.mark_dirty(0, 1).unwrap();
        }
        world.record(false);
    };
    while world.frame < 60 {
        step(&mut world);
    }
    CountingAllocator::arm();
    while world.frame < 200 {
        step(&mut world);
    }
    CountingAllocator::disarm()
}

#[test]
fn sorting_blended_objects_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(sorted_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        assert_eq!(
            sorted_allocations(webgl2_world(multi_draw)),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

#[test]
fn culling_by_grid_cell_allocates_nothing_in_steady_frames() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let webgpu = GpuDrivenRenderer::new(RendererConfig::default());
    assert_eq!(spread_allocations(webgpu), 0, "WebGPU");
    for multi_draw in [true, false] {
        let webgl2 = CpuCulledRenderer::new(CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        });
        assert_eq!(
            spread_allocations(webgl2),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

/// Records warm-up frames of a world with a map that uploads and that the background shows too,
/// then frames that upload a larger map in bands, and steady frames, and returns what those
/// allocated.
fn map_upload_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let (background, _, _) = world.add_mapped(16);
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(Background {
            source: BackgroundSource::Texture(background),
            intensity: 1.0,
            blur: 0.0,
            rotation: [0.0; 3],
        }));
    world.record(true);
    let textures = world.renderer.settings_mut().textures_mut();
    textures.set_budget(16 * 1024);
    textures.sync(1, 0);
    record_until(&mut world, 6, false);
    // A map of 256 rows, 1 KiB each, goes up in 16 bands, and its object draws once it is up.
    let (texture, _, _) = world.add_mapped(256);
    world.frame += 1;
    world.record(true);
    let textures = world.renderer.settings_mut().textures_mut();
    textures.sync(2, world.frame - 1);
    // The frame of the other parity after the scene grew makes room for it too.
    world.frame += 1;
    world.record(false);
    CountingAllocator::arm();
    record_until(&mut world, 60, false);
    let allocated = CountingAllocator::disarm();
    let textures = world.renderer.settings().textures();
    assert!(textures.ready_layer(texture).is_some());
    assert!(textures.ready_layer(background).is_some());
    allocated
}

#[test]
fn frames_that_upload_maps_in_bands_and_steady_mapped_frames_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(map_upload_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        assert_eq!(
            map_upload_allocations(webgl2_world(multi_draw)),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

/// Records frames up to `last`, each with its structure changed or not.
fn record_until<B: FrameBuilder>(world: &mut World<B>, last: u32, structure_changed: bool) {
    while world.frame < last {
        world.frame += 1;
        world.record(structure_changed);
    }
}

/// Twelve lines of a box around the origin, drawn in some frames and not in others: returns what
/// the frames after warm-up allocated.
fn debug_line_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let corner = |k: u32| {
        let side = |bit: u32| if k & bit == 0 { -1.0 } else { 1.0 };
        [side(1), side(2), side(4)]
    };
    let mut points = [([0.0; 3], 0xff00_ffff); 24];
    let mut next = 0;
    for a in 0..8u32 {
        for bit in [1, 2, 4] {
            if a & bit == 0 {
                points[next].0 = corner(a);
                points[next + 1].0 = corner(a | bit);
                next += 2;
            }
        }
    }
    let run = |world: &mut World<B>, last: u32| {
        while world.frame < last {
            world.frame += 1;
            // Lines in two frames of every three: each parity draws with them and without them.
            if !world.frame.is_multiple_of(3) {
                world.draw_lines(&points);
            }
            world.record(false);
        }
    };
    world.record(true);
    run(&mut world, 12);
    CountingAllocator::arm();
    run(&mut world, 200);
    CountingAllocator::disarm()
}

#[test]
fn frames_with_and_without_debug_lines_allocate_nothing_after_warm_up() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    assert_eq!(debug_line_allocations(World::new()), 0, "WebGPU");
    for multi_draw in [true, false] {
        assert_eq!(
            debug_line_allocations(webgl2_world(multi_draw)),
            0,
            "WebGL2, multi-draw {multi_draw}"
        );
    }
}

#[test]
fn structure_changes_after_warm_up_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    world.record(true);
    record_until(&mut world, 4, false);
    // The rebuilds land on both parities, including the one whose frames have not rebuilt yet.
    CountingAllocator::arm();
    record_until(&mut world, 40, true);
    assert_eq!(CountingAllocator::disarm(), 0);
}

#[test]
fn rebuilds_with_meshes_of_several_formats_and_parts_allocate_nothing_after_warm_up() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    // A grid of 90,601 vertices splits into two parts, of another vertex format than the world's
    // meshes, and draws with a pipeline of its own.
    let large = grid(300, 300);
    let mut webgpu = World::new();
    webgpu.add_object(&large, Shading::TexCoords);
    webgpu.record(true);
    record_until(&mut webgpu, 4, false);
    CountingAllocator::arm();
    record_until(&mut webgpu, 40, true);
    assert_eq!(CountingAllocator::disarm(), 0, "WebGPU");
    for multi_draw in [true, false] {
        let mut world = webgl2_world(multi_draw);
        world.add_object(&large, Shading::TexCoords);
        world.record(true);
        record_until(&mut world, 6, false);
        CountingAllocator::arm();
        record_until(&mut world, 40, true);
        assert_eq!(CountingAllocator::disarm(), 0, "multi-draw {multi_draw}");
    }
}

#[test]
fn only_the_frames_after_the_scene_grows_allocate() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    world.record(true);
    record_until(&mut world, 4, false);
    // A new mesh and a new batch: the next frame of each parity makes room for them.
    let ball = world
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(&base_sphere(0.5, [16, 12]))
        .unwrap()
        + 1;
    let batch = world
        .batches
        .create(500, true, false, ball, 1, 0.5)
        .unwrap();
    world
        .batches
        .get_mut(batch)
        .unwrap()
        .set_active_count(500)
        .unwrap();
    record_until(&mut world, 6, true);
    CountingAllocator::arm();
    record_until(&mut world, 40, true);
    assert_eq!(CountingAllocator::disarm(), 0);
}

#[test]
fn parallel_recording_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    // No job workers: the calling thread runs every chunk, so it is the thread to watch.
    CountingAllocator::track_this_thread();
    let jobs = JobSystem::new(0);
    let mut recorder = ParallelRecorder::new(jobs.thread_count(), 8192, 64);
    let mut out = DrawList::with_capacity(8192);
    let record = |range: std::ops::Range<u32>, list: &mut DrawList| {
        for i in range {
            list.push(Op::Draw, &[i, 1, 0, 0])?;
        }
        Ok(())
    };
    recorder.record(&jobs, 1000, 32, &record, &mut out).unwrap();
    CountingAllocator::arm();
    for _ in 0..100 {
        out.clear();
        recorder.record(&jobs, 1000, 32, &record, &mut out).unwrap();
    }
    assert_eq!(CountingAllocator::disarm(), 0);
}

/// Walks every part of the render graph's plan that a frame builder reads each frame.
fn walk_plan(graph: &null3d_render::graph::RenderGraph) -> usize {
    let plan = graph.plan().expect("the graph compiled");
    let mut seen = plan.textures().len();
    for step in plan.steps() {
        for &pass in plan.passes(step) {
            seen += graph.pass_name(pass).len() + graph.pass_layers(pass) as usize % 2;
        }
        for attachment in plan.attachments(step) {
            seen += attachment.layer as usize;
            seen += usize::from(plan.sampled_texture_of(attachment.resource).is_some());
        }
    }
    seen
}

#[test]
fn an_unchanged_render_graph_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut graph = engine_passes();
    graph.set_transient_attachments(true);
    graph.compile().unwrap();
    CountingAllocator::arm();
    let mut seen = 0;
    for _ in 0..1000 {
        assert_eq!(graph.compile(), Ok(false));
        seen += walk_plan(&graph);
    }
    assert_eq!(CountingAllocator::disarm(), 0);
    assert!(seen > 0);
}

#[test]
fn switching_render_graph_passes_after_the_first_compile_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut graph = engine_passes();
    graph.set_transient_attachments(true);
    graph.compile().unwrap();
    let cascades = CASCADES.map(|name| graph.find_pass(name).unwrap());
    let prepass = graph.find_pass("DepthPrepass").unwrap();
    let lines = graph.find_pass("DebugLines").unwrap();
    CountingAllocator::arm();
    // Far cascades update in turn, and the prepass and the debug lines come and go: the graph
    // compiles again every frame.
    for frame in 0..300_usize {
        for (index, &cascade) in cascades.iter().enumerate().skip(1) {
            graph.set_enabled(cascade, frame % 3 == index - 1);
        }
        graph.set_enabled(prepass, frame % 5 != 0);
        graph.set_enabled(lines, frame % 7 < 3);
        assert_eq!(graph.compile(), Ok(true));
        walk_plan(&graph);
    }
    assert_eq!(CountingAllocator::disarm(), 0);
}

/// Assigns `count` point lights that move every frame to a light grid with a frame cap of `cap`,
/// on job workers that count their allocations, and returns what the steady frames allocated.
/// With `on_gpu`, the grid only prepares what the GPU's passes read, as on WebGPU.
fn light_grid_allocations(count: u32, cap: u32, on_gpu: bool) -> u64 {
    let lens = Lens::Perspective(Perspective {
        fov_degrees: 60.0,
        near: 0.1,
        far: 300.0,
    });
    let world = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let view = GridView {
        view_proj: lens.relative_view_projection(&world, 1.5),
        depth: lens.depth(&world),
    };
    let limits = LightLimits {
        lights: cap,
        ..LightLimits::default()
    };
    let mut grid = LightGrid::new(DEFAULT_GRID, limits);
    let mut params = ClusterParams::default();
    let mut lights: Vec<VisibleLight> = (0..count)
        .map(|i| VisibleLight {
            range: 4.0 + (i % 5) as f32,
            color: [1.0; 3],
            decay: 2.0,
            cone_cos: POINT_CONE[0],
            penumbra_cos: POINT_CONE[1],
            kind: kind::POINT,
            light: i + 1,
            ..VisibleLight::default()
        })
        .collect();
    let jobs = JobSystem::new(3);
    std::thread::scope(|scope| {
        for i in 0..3 {
            let jobs = &jobs;
            scope.spawn(move || CountingAllocator::track_while(|| jobs.worker_loop(i)));
        }
        let mut frames = |first: u32, last: u32| {
            for frame in first..last {
                for (i, light) in lights.iter_mut().enumerate() {
                    let angle = frame as f32 * 0.05 + i as f32;
                    let ring = 5.0 + (i % 40) as f32;
                    light.position = [ring * angle.cos(), (i % 7) as f32 - 3.0, -ring * 1.5];
                }
                if on_gpu {
                    grid.prepare(&view, &lights);
                    grid.gpu_params(&mut params);
                } else {
                    grid.assign(&jobs, &view, &lights);
                }
            }
        };
        frames(0, 4);
        CountingAllocator::arm();
        frames(4, 100);
        let allocations = CountingAllocator::disarm();
        jobs.shutdown();
        assert!(!grid.lights().is_empty());
        allocations
    })
}

#[test]
fn assigning_moving_lights_to_the_light_grid_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    // Enough lights over enough slices that the job workers take part.
    assert_eq!(
        light_grid_allocations(1000, 1024, false),
        0,
        "every light listed"
    );
    assert_eq!(
        light_grid_allocations(1200, 1000, false),
        0,
        "the nearest lights listed"
    );
    assert_eq!(
        light_grid_allocations(5, 1024, false),
        0,
        "on the calling thread"
    );
    assert_eq!(
        light_grid_allocations(1200, 1000, true),
        0,
        "prepared for the GPU"
    );
}

#[test]
fn recording_webgl2_frames_with_software_occlusion_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = webgl2_world(true);
    // Walls of the world's box mesh that block the view, in rows the camera flies through, so
    // some cross its near plane.
    let mut commands = Vec::new();
    for k in 0..12 {
        let wall = world.scene.reserve().unwrap();
        let at = [(k % 4) as f32 * 8.0 - 12.0, 0.0, 8.0 - (k / 4) as f32 * 8.0];
        world.scene.set_position(wall, at).unwrap();
        world.scene.set_scale(wall, [6.0, 8.0, 1.0]).unwrap();
        world.scene.set_local_radius(wall, 0.9).unwrap();
        let shown = flags::VISIBLE | flags::OCCLUDER;
        commands.push(Command::create(wall, Handle::NONE, 1, shown));
        commands.push(Command::set_material(wall, 1));
    }
    world.scene.apply_commands(&commands, 1).unwrap();
    world.renderer.set_software_occlusion(true);
    let camera = world.camera;
    let fly = |world: &mut World<CpuCulledRenderer>, frame: u32| {
        let t = frame as f32 * 0.37;
        let at = [t.sin() * 5.0, 1.0, 20.0 - (frame % 40) as f32];
        world.scene.set_position(camera, at).unwrap();
        world.frame = frame;
    };
    for frame in 1..=4 {
        fly(&mut world, frame);
        world.record(frame == 1);
    }
    CountingAllocator::arm();
    let mut occluded = 0;
    for frame in 5..=200 {
        fly(&mut world, frame);
        world.record(false);
        occluded += world.renderer.occluded_entries(frame).unwrap();
    }
    assert_eq!(CountingAllocator::disarm(), 0);
    assert!(occluded > 0, "the walls hid nothing");
}
