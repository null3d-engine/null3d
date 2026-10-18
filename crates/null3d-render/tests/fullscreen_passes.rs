//! Full-screen passes: views without a camera that run a custom effect's shader over the whole of
//! a texture of their own. A pass that reads only other passes' textures runs before the camera's
//! passes that show it. A pass that reads the scene color runs after them, and a custom effect
//! that binds its texture reads it in the same frame. Passes and effects bind their own textures in
//! a second bind group. Steady frames whose uniforms change allocate nothing.
#![allow(clippy::disallowed_methods)] // Native job workers are threads.

mod common;

use common::{World, count, grid};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_core::testing::CountingAllocator;
use null3d_gpu::drawlist::{Op, format, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::effects::{EFFECT_FLOATS, Effect, EffectMaps, MAX_TEXTURES};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderGraph;
use null3d_render::materials::{MapSlot, Shading};
use null3d_render::output::{Antialias, SceneColor};
use null3d_render::view::{Fullscreen, PassSource, View, ViewId, ViewNames, ViewTarget};

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// The template of the passes' and the effect's compiled WGSL.
const PASS_TEMPLATE: u32 = template::CUSTOM_FIRST + 1;

/// A canvas of HDR color, on which custom effects run.
fn hdr(antialias: Antialias) -> CanvasOutput {
    CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias,
        transparent: false,
    }
}

/// The world on WebGPU and on WebGL2, with HDR color and `antialias`.
fn worlds(antialias: Antialias) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = hdr(antialias);
    let webgpu = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    (webgpu, webgl2)
}

/// The textures of a pass or an effect: `texture` in the first slot.
fn one_texture(texture: Handle) -> EffectMaps {
    let mut textures = [Handle::NONE; MAX_TEXTURES];
    textures[0] = texture;
    EffectMaps {
        textures,
        ..EffectMaps::NONE
    }
}

/// Adds a full-screen pass named `name` that reads `source` and the textures of `maps`, at half
/// the canvas's size, and returns its view.
fn add_fullscreen<B: FrameBuilder>(
    world: &mut World<B>,
    name: &str,
    source: PassSource,
    maps: EffectMaps,
) -> ViewId {
    let pass = Fullscreen {
        template: PASS_TEMPLATE,
        source,
        depth: source == PassSource::SceneColor,
        values: [0.0; EFFECT_FLOATS],
        maps,
    };
    let target = ViewTarget {
        halvings: 1,
        ..ViewTarget::default()
    };
    let names = ViewNames {
        pass: name.into(),
        target: name.to_lowercase(),
        reads: Vec::new(),
    };
    world
        .renderer
        .settings_mut()
        .add_named_view(View::fullscreen(pass, target), names)
        .unwrap()
}

/// Adds an unlit screen in front of the camera whose material maps `texture`.
fn add_screen<B: FrameBuilder>(world: &mut World<B>, texture: Handle) {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::UnlitMap, 0, [1.0; 4])
        .unwrap();
    settings
        .materials_mut()
        .set_map(material, MapSlot::BaseColor, texture, false)
        .unwrap();
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material + 1),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
}

/// A world with a scene pass whose texture a full-screen pass reads, which a screen shows, and a
/// full-screen pass of the scene color whose texture an effect reads and a second screen shows,
/// as the frame before. Returns the two full-screen passes' views.
fn chain<B: FrameBuilder>(world: &mut World<B>) -> (ViewId, ViewId) {
    let map = world.add_view([0.0, 10.0, 6.0]);
    let map_texture = world.show(map);
    let posterized = add_fullscreen(
        world,
        "Posterize",
        PassSource::None,
        one_texture(map_texture),
    );
    let poster_texture = world.show(posterized);
    add_screen(world, poster_texture);
    let echo = add_fullscreen(world, "Echo", PassSource::SceneColor, EffectMaps::NONE);
    let echo_texture = world.show(echo);
    add_screen(world, echo_texture);
    let effect = Effect {
        template: PASS_TEMPLATE,
        depth: false,
        values: [0.0; EFFECT_FLOATS],
        maps: one_texture(echo_texture),
    };
    world.renderer.settings_mut().set_effect(0, Some(effect));
    world.renderer.check_graph().unwrap();
    (posterized, echo)
}

/// The names of the passes of each step of the compiled plan.
fn steps(graph: &RenderGraph) -> Vec<Vec<String>> {
    let plan = graph.plan().expect("the graph compiled");
    plan.steps()
        .iter()
        .map(|step| {
            plan.passes(step)
                .iter()
                .map(|&pass| graph.pass_name(pass).to_owned())
                .collect()
        })
        .collect()
}

/// The step of the pass named `name`.
fn step_of(steps: &[Vec<String>], name: &str) -> usize {
    steps
        .iter()
        .position(|step| step.iter().any(|pass| pass == name))
        .unwrap_or_else(|| panic!("{name} runs: {steps:?}"))
}

/// Replays frames of `world`'s chain, and checks the order of its passes and what each draws with.
fn check_chain<B: FrameBuilder>(
    mut world: World<B>,
    graph: impl Fn(&B) -> &RenderGraph,
    path: &str,
) {
    let mut mock = MockBackend::default();
    let (posterized, echo) = chain(&mut world);
    for frame in 0..4 {
        world.step(&mut mock, frame == 0);
    }
    let steps = steps(graph(&world.renderer));
    let map = step_of(&steps, "Opaque1");
    let poster = step_of(&steps, "Posterize");
    let camera = step_of(&steps, "Opaque");
    let after = step_of(&steps, "Echo");
    let effect = step_of(&steps, "Effect0");
    assert!(map < poster && poster < camera, "{path}: {steps:?}");
    assert!(camera < after && after < effect, "{path}: {steps:?}");
    assert!(
        graph(&world.renderer).find_pass("Culling2").is_none(),
        "{path}: a full-screen pass culls nothing"
    );
    // Each pass and the effect draw one triangle, with their textures in group 1.
    world.record(false);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let commands = world.commands();
    let textured_groups: Vec<u32> = commands
        .iter()
        .filter(|(op, operands)| *op == Op::SetBindGroup && operands[0] == 1)
        .map(|(_, operands)| operands[1])
        .collect();
    let settings = world.renderer.settings();
    let pass_group = settings.views()[posterized.index()]
        .fullscreen_pass()
        .unwrap()
        .maps
        .group;
    let effect_group = settings.effects()[0].maps.group;
    assert!(pass_group != 0 && effect_group != 0, "{path}");
    assert!(textured_groups.contains(&pass_group), "{path}");
    assert!(textured_groups.contains(&effect_group), "{path}");
    assert!(
        settings.views()[echo.index()]
            .fullscreen_pass()
            .is_some_and(Fullscreen::reads_scene)
    );
    assert!(count(&commands, Op::Draw) >= 3, "{path}");
    // The textures are ready, and the effect and the pass read their layers in the frame.
    let ready = |values: &[f32; EFFECT_FLOATS]| values[EffectMaps::layer_float(0)] >= 0.0;
    assert!(ready(&settings.effects()[0].values), "{path}");
    let pass = settings.views()[posterized.index()]
        .fullscreen_pass()
        .unwrap();
    assert!(ready(&pass.values), "{path}");
}

#[test]
fn passes_chain_before_and_after_the_camera_and_bind_their_textures_on_both_paths() {
    for antialias in [Antialias::None, Antialias::Fxaa] {
        let (webgpu, webgl2) = worlds(antialias);
        check_chain(
            webgpu,
            |r| r.render_graph(),
            &format!("WebGPU, {antialias:?}"),
        );
        check_chain(
            webgl2,
            |r| r.render_graph(),
            &format!("WebGL2, {antialias:?}"),
        );
    }
}

/// Records warm-up frames of `world`'s chain, then frames in which the passes' uniforms and the
/// effect's change every frame, and returns what those allocated.
fn uniform_allocations<B: FrameBuilder>(mut world: World<B>) -> u64 {
    let (posterized, echo) = chain(&mut world);
    let step = |world: &mut World<B>, last: u32| {
        while world.frame < last {
            world.frame += 1;
            let mut values = [0.0; EFFECT_FLOATS];
            values[0] = world.frame as f32;
            let settings = world.renderer.settings_mut();
            for view in [posterized, echo] {
                let textures = settings.views()[view.index()]
                    .fullscreen_pass()
                    .unwrap()
                    .maps
                    .textures;
                settings.set_fullscreen_values(view, &values, &textures);
            }
            let mut effect = settings.effects()[0];
            effect.values = values;
            settings.set_effect(0, Some(effect));
            world.record(false);
        }
    };
    world.record(true);
    step(&mut world, 12);
    CountingAllocator::arm();
    step(&mut world, 100);
    CountingAllocator::disarm()
}

#[test]
fn passes_whose_uniforms_change_every_frame_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let (webgpu, webgl2) = worlds(Antialias::Fxaa);
    assert_eq!(uniform_allocations(webgpu), 0, "WebGPU");
    assert_eq!(uniform_allocations(webgl2), 0, "WebGL2");
}

/// Replays frames of `world` with a full-screen pass of the scene color that only a screen shows.
fn replay_shown_echo<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    let echo = add_fullscreen(&mut world, "Echo", PassSource::SceneColor, EffectMaps::NONE);
    let texture = world.show(echo);
    add_screen(&mut world, texture);
    world.renderer.check_graph().unwrap();
    for frame in 0..4 {
        world.step(&mut mock, frame == 0);
    }
    let textures = world.renderer.settings().textures();
    assert_eq!(
        textures.ready_layer(texture),
        Some(0),
        "the screen shows the pass"
    );
}

#[test]
fn a_screen_samples_a_pass_that_runs_after_the_camera_on_both_paths() {
    let (webgpu, webgl2) = worlds(Antialias::Fxaa);
    replay_shown_echo(webgpu);
    replay_shown_echo(webgl2);
}
