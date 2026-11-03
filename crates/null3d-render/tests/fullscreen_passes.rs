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
use null3d_gpu::pass_role::{self, PassRole};
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
    add_fullscreen_switched(world, name, source, maps, true)
}

/// Adds a full-screen pass as [`add_fullscreen`] does, switched `on` or off from its first frame.
/// A pass that starts switched off has never drawn, so its passes stay out of the plan.
fn add_fullscreen_switched<B: FrameBuilder>(
    world: &mut World<B>,
    name: &str,
    source: PassSource,
    maps: EffectMaps,
    on: bool,
) -> ViewId {
    let pass = Fullscreen {
        template: PASS_TEMPLATE,
        fallback: false,
        format: 0,
        history: false,
        layers: 1,
        steps: 1,
        reset: 0,
        source,
        depth: source == PassSource::SceneColor,
        values: [0.0; EFFECT_FLOATS],
        maps,
    };
    let target = ViewTarget {
        halvings: 1,
        enabled: on,
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
        bloom: None,
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

/// The number of draws that `view`'s full-screen pass makes in a frame's commands.
fn fullscreen_draws(commands: &[(Op, Vec<u32>)], view: ViewId) -> usize {
    let label = pass_role::label(PassRole::Fullscreen, view.index() as u32);
    let mut inside = false;
    let mut count = 0;
    for (op, operands) in commands {
        match op {
            Op::BeginRenderPass => {
                let at = operands.len().saturating_sub(2);
                inside = operands.len() >= 2 && operands[at] == label;
            }
            Op::EndRenderPass => inside = false,
            Op::Draw if inside => count += 1,
            _ => {}
        }
    }
    count
}

/// Steps `world` six times with a cadence of two on its full-screen pass, and returns how many
/// frames of each drew it: one turn, then a frame without, and so on.
fn cadence_draws<B: FrameBuilder>(mut world: World<B>, path: &str) {
    let view = add_fullscreen(
        &mut world,
        "Cadence",
        PassSource::SceneColor,
        EffectMaps::NONE,
    );
    // A target that nothing shows is culled, so a screen reads this pass's texture.
    let shown = world.show(view);
    add_screen(&mut world, shown);
    let mut mock = MockBackend::default();
    world.renderer.check_graph().unwrap();
    // The frame that builds the pass draws it once, so the cadence starts after it.
    world.step(&mut mock, true);
    world.renderer.settings_mut().set_view_every(view, 2);
    let mut draws = Vec::new();
    for _ in 0..6 {
        let commands = world.step(&mut mock, false);
        draws.push(fullscreen_draws(&commands, view));
    }
    // A cadence of two draws in the first frame of each pair, and its target keeps the last image
    // in the frame between.
    assert_eq!(draws, vec![1, 0, 1, 0, 1, 0], "{path}");
}

#[test]
fn a_cadenced_full_screen_pass_draws_in_one_frame_of_two() {
    let (webgpu, webgl2) = worlds(Antialias::None);
    cadence_draws(webgpu, "WebGPU");
    cadence_draws(webgl2, "WebGL2");
}

// These tests drive a full-screen view alone. A transparent pass's place in the plan also waits on
// whether the frame blends, and no test here drives that branch.
/// A pass that carries a cadence keeps its place in the plan: neither the frame that its turn
/// comes round nor the frame that it skips compiles the graph. The enabled switch beside it is the
/// control: it changes what the plan holds, so the counter moves when the switch does.
fn cadence_compiles_no_plan<B: FrameBuilder>(
    mut world: World<B>,
    graph: impl Fn(&B) -> &RenderGraph,
    path: &str,
) {
    let mut mock = MockBackend::default();
    // A pass that starts switched off has never drawn, so its passes stay out of the plan.
    let view = add_fullscreen_switched(
        &mut world,
        "Cadence",
        PassSource::SceneColor,
        EffectMaps::NONE,
        false,
    );
    let shown = world.show(view);
    add_screen(&mut world, shown);
    world.renderer.check_graph().unwrap();
    for frame in 0..3 {
        world.step(&mut mock, frame == 0);
    }

    // The control: switching the pass on adds its passes to the plan, which compiles the graph.
    let settled = graph(&world.renderer).compiles();
    world.renderer.settings_mut().set_view_enabled(view, true);
    let commands = world.step(&mut mock, false);
    assert_eq!(
        graph(&world.renderer).compiles(),
        settled + 1,
        "{path}: the enabled switch moves the counter"
    );
    assert_eq!(
        fullscreen_draws(&commands, view),
        1,
        "{path}: the switched-on pass draws"
    );

    // The cadence changes nothing that the plan holds, so the counter does not move on either kind
    // of frame, and the pass still draws in one frame of two.
    world.renderer.settings_mut().set_view_every(view, 2);
    let mut draws = Vec::new();
    for _ in 0..6 {
        let commands = world.step(&mut mock, false);
        draws.push(fullscreen_draws(&commands, view));
        assert_eq!(
            graph(&world.renderer).compiles(),
            settled + 1,
            "{path}: a cadence compiles no plan"
        );
    }
    assert_eq!(draws, vec![1, 0, 1, 0, 1, 0], "{path}: one turn in two");
}

#[test]
fn a_cadence_compiles_no_plan_while_the_enabled_switch_compiles() {
    let (webgpu, webgl2) = worlds(Antialias::None);
    cadence_compiles_no_plan(webgpu, |r| r.render_graph(), "WebGPU");
    cadence_compiles_no_plan(webgl2, |r| r.render_graph(), "WebGL2");
}

/// A cadenced pass that is also switched keeps the two mechanisms apart: a frame that it rests
/// draws nothing, a frame after the switch moves nothing in the plan, and the turns pace it again
/// once it is switched on.
fn resting_cadenced_pass_compiles_no_plan<B: FrameBuilder>(
    mut world: World<B>,
    graph: impl Fn(&B) -> &RenderGraph,
    path: &str,
) {
    let mut mock = MockBackend::default();
    let view = add_fullscreen(
        &mut world,
        "Cadence",
        PassSource::SceneColor,
        EffectMaps::NONE,
    );
    let shown = world.show(view);
    add_screen(&mut world, shown);
    world.renderer.check_graph().unwrap();
    for frame in 0..3 {
        world.step(&mut mock, frame == 0);
    }
    world.renderer.settings_mut().set_view_every(view, 2);
    // One frame with the pass and one without, so the cadence is in effect before the switch.
    let mut draws = Vec::new();
    for _ in 0..2 {
        let commands = world.step(&mut mock, false);
        draws.push(fullscreen_draws(&commands, view));
    }
    assert_eq!(draws, vec![1, 0], "{path}: the cadence is in effect");
    let settled = graph(&world.renderer).compiles();

    // The pass has drawn, so its passes stay in the plan while it rests: the switch stops the
    // drawing without compiling anything.
    world.renderer.settings_mut().set_view_enabled(view, false);
    for _ in 0..4 {
        let commands = world.step(&mut mock, false);
        assert_eq!(
            fullscreen_draws(&commands, view),
            0,
            "{path}: a resting pass draws nothing"
        );
        assert_eq!(
            graph(&world.renderer).compiles(),
            settled,
            "{path}: a switch of a pass that has drawn compiles no plan"
        );
    }

    // Switched on again, it draws in one frame of two, and the plan is still the same.
    world.renderer.settings_mut().set_view_enabled(view, true);
    let mut draws = Vec::new();
    for _ in 0..4 {
        let commands = world.step(&mut mock, false);
        draws.push(fullscreen_draws(&commands, view));
        assert_eq!(
            graph(&world.renderer).compiles(),
            settled,
            "{path}: the cadence and the switch do not compile the plan"
        );
    }
    assert_eq!(
        draws,
        vec![1, 0, 1, 0],
        "{path}: the cadence paces the turns again"
    );
}

#[test]
fn a_resting_cadenced_pass_compiles_no_plan() {
    let (webgpu, webgl2) = worlds(Antialias::None);
    resting_cadenced_pass_compiles_no_plan(webgpu, |r| r.render_graph(), "WebGPU");
    resting_cadenced_pass_compiles_no_plan(webgl2, |r| r.render_graph(), "WebGL2");
}

/// The format of the target that a fallback pass declaring `declared` draws into, on the WebGL2
/// path with an 8-bit canvas, where the scene color cannot hold a compute pass's own values.
fn fallback_target_format(declared: u32) -> u32 {
    let canvas = CanvasOutput {
        scene_color: SceneColor::EIGHT_BIT,
        antialias: Antialias::None,
        transparent: false,
    };
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    let pass = Fullscreen {
        template: PASS_TEMPLATE,
        fallback: true,
        format: declared,
        history: false,
        layers: 1,
        steps: 1,
        reset: 0,
        source: PassSource::None,
        depth: false,
        values: [0.0; EFFECT_FLOATS],
        maps: EffectMaps::NONE,
    };
    let view = world
        .renderer
        .settings_mut()
        .add_named_view(
            View::fullscreen(
                pass,
                ViewTarget {
                    shown: true,
                    ..ViewTarget::default()
                },
            ),
            ViewNames {
                pass: "Fallback".into(),
                target: "fallback".into(),
                reads: Vec::new(),
            },
        )
        .unwrap();
    // A target that nothing shows is culled, so a screen reads this pass's texture.
    let shown = world.show(view);
    add_screen(&mut world, shown);
    world.renderer.check_graph().unwrap();
    let mut mock = MockBackend::default();
    let mut commands = Vec::new();
    for frame in 0..3 {
        commands.extend(world.step(&mut mock, frame == 0));
    }
    let label = pass_role::label(PassRole::Fullscreen, view.index() as u32);
    let target = commands
        .iter()
        .find_map(|(op, operands)| {
            (*op == Op::BeginRenderPass
                && operands.len() >= 2
                && (operands[operands.len() - 1] == label || operands[operands.len() - 2] == label))
                .then(|| operands[0])
        })
        .expect("the fallback pass draws");
    // The pass draws into a view of the target's only layer, so a view names its texture.
    let texture = commands
        .iter()
        .find_map(|(op, operands)| {
            (*op == Op::CreateTextureView && operands[0] == target && operands.len() > 1)
                .then(|| operands[1])
        })
        .unwrap_or(target);
    commands
        .iter()
        .find_map(|(op, operands)| {
            (*op == Op::CreateTexture && operands[0] == texture && operands.len() > 4)
                .then(|| operands[4])
        })
        .expect("the pass's target is made")
}

#[test]
fn a_fallback_pass_keeps_the_format_its_compute_pass_declares() {
    assert_eq!(
        fallback_target_format(format::RGBA16_FLOAT),
        format::RGBA16_FLOAT,
        "the fragment form writes its compute pass's format"
    );
    // A fragment form that declares no format keeps the scene's own.
    assert_eq!(
        fallback_target_format(0),
        format::RGBA8_UNORM_SRGB,
        "a pass without a declared format keeps the scene's"
    );
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
