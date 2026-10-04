//! Two-phase occlusion culling of the WebGPU frame builder, checked through the mock backend and
//! by decoding the lists it records: the camera's first culling phase and its occluders' pass,
//! which draws depth alone, the compute pass that builds the depth pyramid and culls again, and the
//! one opaque pass, which draws the second set of indirect draws. Shadow views and builders without
//! occlusion culling cull once.

mod common;

use std::collections::HashMap;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, pass_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::ao::Ao;
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::graph::RenderScale;
use null3d_render::materials::Shading;
use null3d_render::output::{Antialias, SceneColor};

type Commands = Vec<(Op, Vec<u32>)>;

/// Bytes of one indexed indirect draw.
const INDIRECT_BYTES: u32 = 20;
/// Bytes between the parameters of two batches of levels of the depth pyramid.
const BATCH_STRIDE: u32 = 256;
/// Texels of a batch's first level that one of the depth pyramid's workgroups builds, each way.
const TILE: u32 = 8;
/// Levels that one dispatch of the depth pyramid builds at most.
const LEVELS_PER_BATCH: usize = 4;

/// The scene flag that marks an occluder.
const OCCLUDER: u32 = 1 << 7;

/// A world of a few objects, drawn into HDR color with `antialias` by a builder with occlusion
/// culling and `config`'s other settings, without a marked occluder.
fn unmarked(antialias: Antialias, config: RendererConfig) -> World {
    let mut world = World::with_config(RendererConfig {
        canvas: CanvasOutput {
            scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
            antialias,
            transparent: false,
        },
        ..config
    });
    world.add_object(&grid(2, 2), Shading::Lit);
    world.add_object(&grid(1, 1), Shading::Unlit);
    world
}

/// The same world with a wall that the sketch marks as an occluder.
fn world(antialias: Antialias, config: RendererConfig) -> World {
    let mut world = unmarked(antialias, config);
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(4, 4)).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap()
        + 1;
    let wall = world.scene.reserve().unwrap();
    world.scene.set_local_radius(wall, 3.0).unwrap();
    let commands = [
        Command::create(wall, Handle::NONE, mesh, flags::VISIBLE | OCCLUDER),
        Command::set_material(wall, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world
}

fn occluding() -> RendererConfig {
    RendererConfig {
        gpu_occlusion: true,
        ..RendererConfig::default()
    }
}

fn device() -> MockBackend {
    MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16)
}

/// What a frame records, in order: each compute pass's dispatches with the template of the
/// pipeline that each runs, and each render pass's flags and the bundles it replays.
#[derive(Debug, PartialEq, Eq)]
enum Pass {
    Compute(Vec<u32>),
    Render { flags: u32, bundles: Vec<u32> },
}

/// The passes of a frame's commands, with the templates of the compute pipelines that `created`
/// made, by id.
fn passes(commands: &[(Op, Vec<u32>)], created: &HashMap<u32, u32>) -> Vec<Pass> {
    let mut passes = Vec::new();
    let mut pipeline = 0;
    for (op, o) in commands {
        match op {
            Op::BeginComputePass => passes.push(Pass::Compute(Vec::new())),
            Op::SetComputePipeline => pipeline = created[&o[0]],
            Op::Dispatch => {
                if let Some(Pass::Compute(dispatches)) = passes.last_mut() {
                    dispatches.push(pipeline);
                }
            }
            Op::BeginRenderPass => passes.push(Pass::Render {
                flags: o[8],
                bundles: Vec::new(),
            }),
            Op::ExecuteBundles => {
                if let Some(Pass::Render { bundles, .. }) = passes.last_mut() {
                    bundles.extend_from_slice(&o[1..]);
                }
            }
            _ => {}
        }
    }
    passes
}

/// The template and permutation bits of each compute pipeline that the commands create, by id.
fn compute_pipelines(commands: &[(Op, Vec<u32>)]) -> HashMap<u32, (u32, u32)> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateComputePipeline)
        .map(|(_, o)| (o[0], (o[1], o[2])))
        .collect()
}

/// The offsets of the indirect draws that each bundle draws, by bundle id.
fn bundle_draws(commands: &[(Op, Vec<u32>)]) -> HashMap<u32, Vec<u32>> {
    let mut bundles: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut recording = None;
    for (op, o) in commands {
        match op {
            Op::BeginBundle => recording = Some(o[0]),
            Op::EndBundle => recording = None,
            Op::DrawIndexedIndirect => {
                bundles.entry(recording.unwrap()).or_default().push(o[1]);
            }
            _ => {}
        }
    }
    bundles
}

/// The first frame's commands, which create every pipeline and bundle, and the steady frame's.
fn frames(world: &mut World, mock: &mut MockBackend) -> (Commands, Commands) {
    let first = world.step(mock, true);
    let steady = world.step(mock, false);
    (first, steady)
}

/// The first level of each batch of a pyramid's levels.
fn batches(levels: &[(u32, u32)]) -> Vec<(u32, u32)> {
    levels.iter().copied().step_by(LEVELS_PER_BATCH).collect()
}

/// The levels of a depth pyramid over a render size: each level's width and height.
fn levels(mut width: u32, mut height: u32) -> Vec<(u32, u32)> {
    let mut levels = Vec::new();
    while (width, height) != (1, 1) {
        (width, height) = (width.div_ceil(2), height.div_ceil(2));
        levels.push((width, height));
    }
    levels
}

#[test]
fn the_camera_draws_last_frames_depth_then_builds_its_pyramid_and_culls_before_its_opaque_pass() {
    let mut world = world(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
    let passes = passes(&steady, &templates);

    let early = passes
        .iter()
        .position(|p| matches!(p, Pass::Compute(d) if d.contains(&template::OCCLUSION_EARLY)))
        .expect("the camera's first phase culls");
    // The occluders' pass draws depth alone, which the pyramid reads afterwards.
    let Pass::Render { flags, bundles } = &passes[early + 1] else {
        panic!("the occluders' pass follows the first phase: {passes:?}")
    };
    assert_eq!(
        flags & (pass_flags::CLEAR_DEPTH | pass_flags::STORE_DEPTH | pass_flags::STORE_COLOR),
        pass_flags::CLEAR_DEPTH | pass_flags::STORE_DEPTH
    );
    let depth_bundle = bundles[0];

    // The pyramid's levels, one dispatch each, then the late phase, in one compute pass.
    let Pass::Compute(late) = &passes[early + 2] else {
        panic!("a compute pass follows the occluders' pass: {passes:?}")
    };
    let (width, height) = world.canvas;
    let mut expected = vec![template::DEPTH_PYRAMID; batches(&levels(width, height)).len()];
    expected.push(template::OCCLUSION_LATE);
    assert_eq!(late, &expected);

    // The opaque pass starts its targets and draws once, as without occlusion culling.
    let Pass::Render { flags, bundles } = &passes[early + 3] else {
        panic!("the opaque pass follows: {passes:?}")
    };
    assert_eq!(
        flags & (pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH),
        pass_flags::CLEAR_COLOR | pass_flags::CLEAR_DEPTH
    );
    assert_eq!(
        flags & pass_flags::STORE_DEPTH,
        0,
        "the scene depth stays in tile memory"
    );
    let main_bundle = bundles[0];
    assert_ne!(main_bundle, depth_bundle);
    let opaque_passes = passes
        .iter()
        .filter(|p| matches!(p, Pass::Render { bundles, .. } if bundles.contains(&main_bundle)))
        .count();
    assert_eq!(opaque_passes, 1);

    // The depth bundle draws the first set of indirect draws, and the main bundle the second.
    let draws = bundle_draws(&first);
    let (depth, main) = (&draws[&depth_bundle], &draws[&main_bundle]);
    let set = main.len() as u32 * INDIRECT_BYTES;
    assert!(depth.iter().all(|&offset| offset < set));
    assert!(main.iter().all(|&offset| offset >= set && offset < 2 * set));
}

#[test]
fn each_batch_of_pyramid_levels_dispatches_at_its_own_offset_and_size() {
    let mut world = world(Antialias::Msaa, occluding());
    world.renderer.settings_mut().set_render_scaling(true);
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let dispatch_sizes = |commands: &Commands| {
        let mut pyramid = false;
        let mut sizes = Vec::new();
        let mut offsets = Vec::new();
        for (op, o) in commands {
            match op {
                Op::SetComputePipeline => {
                    pyramid = created[&o[0]].0 == template::DEPTH_PYRAMID;
                }
                Op::SetBindGroup if pyramid => offsets.push(o[3]),
                Op::Dispatch if pyramid => sizes.push((o[0], o[1])),
                _ => {}
            }
        }
        (sizes, offsets)
    };
    let (sizes, offsets) = dispatch_sizes(&steady);
    let (width, height) = world.canvas;
    let expected: Vec<_> = batches(&levels(width, height))
        .iter()
        .map(|&(w, h)| (w.div_ceil(TILE), h.div_ceil(TILE)))
        .collect();
    assert_eq!(sizes, expected);
    let strides: Vec<u32> = (0..expected.len() as u32)
        .map(|b| b * BATCH_STRIDE)
        .collect();
    assert_eq!(offsets, strides);

    // At half the render scale the pyramid covers the corner that the scene draws into, and its
    // new levels upload, with no new buffer.
    world.render_scale = RenderScale::from_thousandths(500);
    let half = world.step(&mut mock, false);
    let (sizes, _) = dispatch_sizes(&half);
    let render = (width.div_ceil(2), height.div_ceil(2));
    assert_eq!(sizes.len(), batches(&levels(render.0, render.1)).len());
    assert_eq!(
        common::count(&half, Op::CreateBuffer),
        0,
        "a new scale makes no buffer"
    );
    let steady_again = world.step(&mut mock, false);
    let uploads = |commands: &Commands| common::count(commands, Op::WriteBuffer);
    assert!(
        uploads(&half) > uploads(&steady_again),
        "a new scale uploads the pyramid's new levels once"
    );
}

#[test]
fn the_occluders_depth_has_one_sample_whatever_the_scenes_samples() {
    for antialias in [Antialias::Msaa, Antialias::Fxaa, Antialias::None] {
        let mut world = world(antialias, occluding());
        let mut mock = device();
        let (first, _) = frames(&mut world, &mut mock);
        // The depth-only bundle, which the occluders' pass replays, draws into one sample.
        let bundles: Vec<(u32, u32, u32)> = first
            .iter()
            .filter(|(op, _)| *op == Op::BeginBundle)
            .map(|(_, o)| (o[1], o[2], o[3]))
            .collect();
        assert!(
            bundles.contains(&(format::NONE, format::DEPTH32_FLOAT, 1)),
            "{antialias:?}: {bundles:?}"
        );
        let pyramid: Vec<_> = compute_pipelines(&first)
            .into_values()
            .filter(|&(t, _)| t == template::DEPTH_PYRAMID)
            .collect();
        assert_eq!(pyramid, [(template::DEPTH_PYRAMID, 0)], "{antialias:?}");
    }
}

#[test]
fn without_occlusion_culling_or_with_the_depth_prepass_each_view_culls_once() {
    for config in [
        RendererConfig::default(),
        RendererConfig {
            depth_prepass: true,
            ..occluding()
        },
    ] {
        let mut world = world(Antialias::Msaa, config);
        let mut mock = device();
        let (first, steady) = frames(&mut world, &mut mock);
        let created = compute_pipelines(&first);
        assert!(
            created.values().all(|&(t, _)| ![
                template::OCCLUSION_EARLY,
                template::OCCLUSION_LATE,
                template::DEPTH_PYRAMID
            ]
            .contains(&t)),
            "{config:?}"
        );
        let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
        let renders = passes(&steady, &templates)
            .iter()
            .filter(|p| matches!(p, Pass::Render { bundles, .. } if !bundles.is_empty()))
            .count();
        assert_eq!(renders, 1, "{config:?}");
    }
}

#[test]
fn shadow_cascades_cull_once_while_the_camera_culls_twice() {
    let mut world = world(Antialias::Msaa, occluding());
    let both = flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let commands: Vec<Command> = world
        .objects
        .iter()
        .map(|&object| Command::set_flags(object, both, both))
        .collect();
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world
        .renderer
        .settings_mut()
        .set_sun_shadow(Some(SunShadow {
            cascades: 3,
            map_size: 1024,
            bias: 0.5,
            normal_bias: 1.0,
            distance: 60.0,
            layers: DEFAULT_LAYERS,
        }));
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
    let dispatched: Vec<u32> = passes(&steady, &templates)
        .into_iter()
        .flat_map(|p| match p {
            Pass::Compute(d) => d,
            Pass::Render { .. } => Vec::new(),
        })
        .collect();
    let count = |t: u32| dispatched.iter().filter(|&&d| d == t).count();
    assert!(count(template::CULL) >= 1, "each cascade culls once");
    assert_eq!(count(template::OCCLUSION_EARLY), 1);
    assert_eq!(count(template::OCCLUSION_LATE), 1);
}

#[test]
fn every_camera_view_has_a_pyramid_of_its_own() {
    let mut world = world(Antialias::Msaa, occluding());
    world.add_view([5.0, 0.0, 20.0]);
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
    let passes = passes(&steady, &templates);
    let lates = passes
        .iter()
        .flat_map(|p| match p {
            Pass::Compute(d) => d.clone(),
            Pass::Render { .. } => Vec::new(),
        })
        .filter(|&t| t == template::OCCLUSION_LATE)
        .count();
    assert_eq!(lates, 2);
    let bundles: Vec<u32> = passes
        .iter()
        .flat_map(|p| match p {
            Pass::Render { bundles, .. } => bundles.clone(),
            Pass::Compute(_) => Vec::new(),
        })
        .collect();
    let mut distinct = bundles.clone();
    distinct.sort_unstable();
    distinct.dedup();
    assert_eq!(bundles.len(), 4, "two passes for each view");
    assert_eq!(distinct.len(), 4, "each pass replays a bundle of its own");
}

#[test]
fn without_a_marked_occluder_the_camera_culls_once_as_without_occlusion_culling() {
    let mut world = unmarked(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
    let passes = passes(&steady, &templates);
    let dispatched: Vec<u32> = passes
        .iter()
        .flat_map(|p| match p {
            Pass::Compute(d) => d.clone(),
            Pass::Render { .. } => Vec::new(),
        })
        .collect();
    // The camera culls once with the plain culling pipeline, as without occlusion culling.
    assert_eq!(dispatched, [template::CULL]);
    let renders = passes
        .iter()
        .filter(|p| matches!(p, Pass::Render { bundles, .. } if !bundles.is_empty()))
        .count();
    assert_eq!(renders, 1, "no occluders' pass: {passes:?}");
}

#[test]
fn marking_an_object_turns_the_two_phases_on_from_the_next_frame_and_unmarking_turns_them_off() {
    let mut world = unmarked(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    let created = compute_pipelines(&first);
    let templates: HashMap<u32, u32> = created.iter().map(|(&id, &(t, _))| (id, t)).collect();
    let dispatched = |commands: &Commands| -> Vec<u32> {
        passes(commands, &templates)
            .into_iter()
            .flat_map(|p| match p {
                Pass::Compute(d) => d,
                Pass::Render { .. } => Vec::new(),
            })
            .collect()
    };
    let object = world.objects[0];
    for (mark, early) in [(OCCLUDER, true), (0, false)] {
        let commands = [Command::set_flags(object, OCCLUDER, mark)];
        world.scene.apply_commands(&commands, world.frame).unwrap();
        let next = world.step(&mut mock, false);
        assert_eq!(
            dispatched(&next).contains(&template::OCCLUSION_EARLY),
            early,
            "marked {}",
            mark != 0
        );
    }
}

#[test]
fn culling_starts_in_two_phases_once_ambient_occlusion_turns_the_prepass_off() {
    let mut world = world(Antialias::Msaa, occluding());
    world.renderer.settings_mut().set_ao(Some(Ao::default()));
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let mut templates: HashMap<u32, u32> = compute_pipelines(&first)
        .iter()
        .map(|(&id, &(t, _))| (id, t))
        .collect();
    // Ambient occlusion holds the depth prepass, so the camera culls once. The two phases'
    // pipelines are made at the start all the same, for when it turns off.
    for phase in [template::OCCLUSION_EARLY, template::OCCLUSION_LATE] {
        assert!(templates.values().any(|&t| t == phase), "{templates:?}");
    }
    let runs = |commands: &Commands, templates: &HashMap<u32, u32>, wanted: u32| {
        passes(commands, templates)
            .iter()
            .any(|p| matches!(p, Pass::Compute(d) if d.contains(&wanted)))
    };
    assert!(!runs(&steady, &templates, template::OCCLUSION_EARLY));

    world.renderer.settings_mut().set_ao(None);
    let switched = world.step(&mut mock, false);
    templates.extend(
        compute_pipelines(&switched)
            .iter()
            .map(|(&id, &(t, _))| (id, t)),
    );
    let steady = world.step(&mut mock, false);
    for wanted in [
        template::OCCLUSION_EARLY,
        template::DEPTH_PYRAMID,
        template::OCCLUSION_LATE,
    ] {
        assert!(
            runs(&steady, &templates, wanted),
            "{wanted}: {:?}",
            passes(&steady, &templates)
        );
    }
}
