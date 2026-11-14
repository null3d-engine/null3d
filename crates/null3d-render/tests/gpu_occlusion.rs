//! Two-phase occlusion culling of the WebGPU frame builder, checked through the mock backend and
//! by decoding the lists it records: the camera's first culling phase and its occluders' pass,
//! which draws depth alone, the compute pass that builds the depth pyramid and culls again, and the
//! one opaque pass, which draws the second set of indirect draws. Shadow views and builders without
//! occlusion culling cull once. Every opaque object may hide others unless it opts out, and the
//! check of what the passes save turns them off while they cost more than they save.

mod common;

use std::collections::HashMap;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, layout, pass_flags, template};
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
const OCCLUDER: u32 = flags::OCCLUDER;

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

/// A world like [`unmarked`]'s, whose every object and batch row opts out of hiding others.
fn opted_out(antialias: Antialias, config: RendererConfig) -> World {
    let mut world = World::with_config(RendererConfig {
        canvas: CanvasOutput {
            scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
            antialias,
            transparent: false,
        },
        ..config
    });
    let added = [
        world.add_object_at(&grid(2, 2), Shading::Lit, 0, [0.0; 3]),
        world.add_object_at(&grid(1, 1), Shading::Unlit, 0, [0.0; 3]),
    ];
    let commands: Vec<Command> = (world.objects.iter().chain(&added))
        .map(|&object| Command::set_flags(object, flags::OCCLUSION, flags::NOT_OCCLUDER))
        .collect();
    world.scene.apply_commands(&commands, world.frame).unwrap();
    let batch = world.batches.get_mut(world.batch).unwrap();
    batch.set_shadows(batch.row_flags() | flags::NOT_OCCLUDER);
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

/// The templates of occlusion culling's compute pipelines, whose shaders load on first use.
const OCCLUSION_TEMPLATES: [u32; 3] = [
    template::OCCLUSION_EARLY,
    template::OCCLUSION_LATE,
    template::DEPTH_PYRAMID,
];

/// The template of each compute pipeline that the commands create, by id.
fn pipeline_templates(commands: &[(Op, Vec<u32>)]) -> HashMap<u32, u32> {
    compute_pipelines(commands)
        .into_iter()
        .map(|(id, (t, _))| (id, t))
        .collect()
}

/// The template of each dispatch of the commands, in order, with the templates of the compute
/// pipelines that `created` made, by id.
fn dispatched(commands: &[(Op, Vec<u32>)], created: &HashMap<u32, u32>) -> Vec<u32> {
    passes(commands, created)
        .into_iter()
        .flat_map(|p| match p {
            Pass::Compute(d) => d,
            Pass::Render { .. } => Vec::new(),
        })
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
fn with_the_depth_prepass_the_prepass_draws_what_the_second_phase_kept() {
    let config = RendererConfig {
        depth_prepass: true,
        ..occluding()
    };
    let mut world = world(Antialias::Msaa, config);
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let templates = pipeline_templates(&first);
    let passes = passes(&steady, &templates);
    let early = passes
        .iter()
        .position(|p| matches!(p, Pass::Compute(d) if d.contains(&template::OCCLUSION_EARLY)))
        .expect("the camera's first phase culls");
    let Pass::Render { bundles, .. } = &passes[early + 1] else {
        panic!("the occluders' pass follows the first phase: {passes:?}")
    };
    let occluders = bundles[0];
    let Pass::Compute(late) = &passes[early + 2] else {
        panic!("the pyramid and the late phase follow: {passes:?}")
    };
    assert_eq!(late.last(), Some(&template::OCCLUSION_LATE));
    // The prepass and the opaque pass replay their bundles in the render pass after the late
    // phase, and both draw the second set of draws.
    let Pass::Render { bundles, .. } = &passes[early + 3] else {
        panic!("the scene pass follows the late phase: {passes:?}")
    };
    assert_eq!(
        bundles.len(),
        2,
        "the prepass's bundle and the opaque bundle"
    );
    assert!(!bundles.contains(&occluders));
    let draws = bundle_draws(&first);
    let set = draws[&bundles[1]].len() as u32 * INDIRECT_BYTES;
    for bundle in bundles {
        assert!(
            draws[bundle].iter().all(|&offset| offset >= set),
            "{bundle}"
        );
    }
    assert!(draws[&occluders].iter().all(|&offset| offset < set));
}

#[test]
fn a_pick_draws_the_second_set_of_draws_that_the_opaque_pass_drew() {
    let mut world = world(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    world
        .renderer
        .settings_mut()
        .set_pick(null3d_render::pick::PickRequest {
            x: 4.0,
            y: 3.0,
            ring: 0,
            slot: 40,
            destination: 4096,
        });
    let picked = world.step(&mut mock, false);
    let templates: HashMap<u32, u32> = first
        .iter()
        .chain(&picked)
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| (o[0], o[1]))
        .collect();
    // The pick pass records its draws in the frame, outside any bundle, with the pick template.
    let (mut in_bundle, mut template_now) = (false, 0);
    let mut offsets = Vec::new();
    for (op, o) in &picked {
        match op {
            Op::BeginBundle => in_bundle = true,
            Op::EndBundle => in_bundle = false,
            Op::SetPipeline if !in_bundle => template_now = templates[&o[0]],
            Op::DrawIndexedIndirect if !in_bundle && template_now == template::PICK => {
                offsets.push(o[1])
            }
            _ => {}
        }
    }
    assert!(!offsets.is_empty(), "the pick draws the scene's objects");
    let draws = bundle_draws(&first);
    let passes = passes(&first, &pipeline_templates(&first));
    let opaque = passes
        .iter()
        .rev()
        .find_map(|p| match p {
            Pass::Render { bundles, .. }
                if bundles.len() == 1 && draws.contains_key(&bundles[0]) =>
            {
                Some(bundles[0])
            }
            _ => None,
        })
        .expect("the opaque pass replays its bundle");
    let set = draws[&opaque].len() as u32 * INDIRECT_BYTES;
    assert!(
        draws[&opaque].iter().all(|&offset| offset >= set),
        "the opaque pass draws the second set"
    );
    assert!(
        offsets.iter().all(|&offset| offset >= set),
        "the pick reads the draws that the late phase filled: {offsets:?}, set at {set}"
    );
}

#[test]
fn without_occlusion_culling_each_view_culls_once() {
    {
        let config = RendererConfig::default();
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
            intensity: 1.0,
            distance: 60.0,
            auto: false,
            contact: 0.0,
            layers: DEFAULT_LAYERS,
            hero: None,
            hero_size: 0,
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
fn every_opaque_object_may_hide_others_without_a_mark() {
    let mut world = unmarked(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    let mut templates = pipeline_templates(&first);
    let steady = world.step(&mut mock, false);
    templates.extend(pipeline_templates(&steady));
    let mut phases = dispatched(&steady, &templates);
    phases.dedup();
    assert_eq!(
        phases,
        [
            template::OCCLUSION_EARLY,
            template::DEPTH_PYRAMID,
            template::OCCLUSION_LATE
        ]
    );
}

#[test]
fn a_scene_whose_objects_all_opt_out_culls_once_as_without_occlusion_culling() {
    let mut world = opted_out(Antialias::Msaa, occluding());
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
fn letting_an_object_hide_others_turns_the_two_phases_on_and_opting_it_out_turns_them_off() {
    let mut world = opted_out(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    let mut templates = pipeline_templates(&first);
    let object = world.objects[0];
    // The frame that sees the first object that may hide others asks for the pipelines, and the
    // next one runs them, as the mock builds every pipeline at once. Opting it out turns them off
    // in the frame that sees it. A mark of true and no mark both let it hide others.
    for (mark, frames, early) in [
        (OCCLUDER, 2, true),
        (flags::NOT_OCCLUDER, 1, false),
        (0, 1, true),
    ] {
        let commands = [Command::set_flags(object, flags::OCCLUSION, mark)];
        world.scene.apply_commands(&commands, world.frame).unwrap();
        let mut last = Vec::new();
        for _ in 0..frames {
            last = world.step(&mut mock, false);
            templates.extend(pipeline_templates(&last));
        }
        assert_eq!(
            dispatched(&last, &templates).contains(&template::OCCLUSION_EARLY),
            early,
            "marked {mark}"
        );
    }
}

#[test]
fn occlusion_culling_makes_its_pipelines_only_once_an_object_may_hide_others() {
    let mut world = opted_out(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let made = |commands: &Commands| -> Vec<u32> {
        let mut made: Vec<u32> = pipeline_templates(commands)
            .into_values()
            .filter(|t| OCCLUSION_TEMPLATES.contains(t))
            .collect();
        made.sort_unstable();
        made
    };
    // Their shaders load on first use, so a scene whose objects all opt out asks for none of them.
    assert_eq!(made(&first), []);
    assert_eq!(made(&steady), []);

    let commands = [Command::set_flags(world.objects[0], flags::OCCLUSION, 0)];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    let marked: Vec<u32> = (0..3)
        .flat_map(|_| made(&world.step(&mut mock, false)))
        .collect();
    let mut expected = OCCLUSION_TEMPLATES.to_vec();
    expected.sort_unstable();
    assert_eq!(marked, expected, "each made once");
}

#[test]
fn the_camera_culls_once_until_occlusion_cullings_pipelines_are_built() {
    let mut world = opted_out(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    let mut templates = pipeline_templates(&first);
    // The thread that draws reports the frames whose pipelines it has built: from here on, none.
    world.pipelines_built = world.frame;
    let commands = [Command::set_flags(
        world.objects[0],
        flags::OCCLUSION,
        OCCLUDER,
    )];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    for _ in 0..3 {
        let waiting = world.step(&mut mock, false);
        templates.extend(pipeline_templates(&waiting));
        assert_eq!(dispatched(&waiting, &templates), [template::CULL]);
        let renders = passes(&waiting, &templates)
            .iter()
            .filter(|p| matches!(p, Pass::Render { bundles, .. } if !bundles.is_empty()))
            .count();
        assert_eq!(renders, 1, "no occluders' pass while the pipelines build");
    }
    world.pipelines_built = u32::MAX;
    let built = world.step(&mut mock, false);
    let mut phases = dispatched(&built, &templates);
    // The pyramid takes a dispatch for each batch of its levels.
    phases.dedup();
    assert_eq!(
        phases,
        [
            template::OCCLUSION_EARLY,
            template::DEPTH_PYRAMID,
            template::OCCLUSION_LATE
        ]
    );
}

#[test]
fn culling_stays_in_two_phases_while_ambient_occlusion_turns_the_prepass_on_and_off() {
    let mut world = world(Antialias::Msaa, occluding());
    world.renderer.settings_mut().set_ao(Some(Ao::default()));
    let mut mock = device();
    let (first, steady) = frames(&mut world, &mut mock);
    let mut templates: HashMap<u32, u32> = compute_pipelines(&first)
        .iter()
        .map(|(&id, &(t, _))| (id, t))
        .collect();
    // Ambient occlusion holds the depth prepass, which draws after the late phase.
    let runs = |commands: &Commands, templates: &HashMap<u32, u32>, wanted: u32| {
        passes(commands, templates)
            .iter()
            .any(|p| matches!(p, Pass::Compute(d) if d.contains(&wanted)))
    };
    assert!(runs(&steady, &templates, template::OCCLUSION_EARLY));
    assert!(runs(&steady, &templates, template::OCCLUSION_LATE));

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

#[test]
fn a_smaller_canvas_binds_the_pyramid_to_the_occluders_depth_made_again() {
    let mut world = world(Antialias::Msaa, occluding());
    let mut mock = device();
    world.step(&mut mock, true);
    world.step(&mut mock, false);
    // The canvas shrinks: the graph makes the occluders' depth again under its id, at the new
    // size, so the pyramid's group must bind the new texture, not the destroyed one.
    world.canvas = (world.canvas.0 / 2, world.canvas.1 / 2);
    let commands = world.step(&mut mock, false);
    let remade: Vec<u32> = commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateTexture)
        .map(|(_, o)| o[0])
        .collect();
    let bound: Vec<u32> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::DEPTH_PYRAMID)
        .map(|(_, o)| o[15])
        .collect();
    assert!(!remade.is_empty(), "the graph makes its textures again");
    assert_eq!(
        bound.len(),
        1,
        "the pyramid's group binds again: made {remade:?}"
    );
    assert!(remade.contains(&bound[0]));
}

/// The control slot that the tests' reads of the occlusion counts raise.
const READ_SLOT: u32 = 60;

/// True when a frame's commands run the first occlusion phase.
fn runs_early(commands: &Commands, templates: &HashMap<u32, u32>) -> bool {
    dispatched(commands, templates).contains(&template::OCCLUSION_EARLY)
}

/// Runs `frames` frames of a world whose wall hides others, and hands the check each frame's GPU
/// time: `with` for a frame that runs the passes and `without` for one that does not. Returns
/// whether each frame ran them.
fn run_timed(frames: usize, with: u32, without: u32) -> Vec<bool> {
    let mut world = world(Antialias::Msaa, occluding());
    let mut mock = device();
    let (first, _) = self::frames(&mut world, &mut mock);
    let mut templates = pipeline_templates(&first);
    let mut ran = Vec::new();
    for _ in 0..frames {
        let commands = world.step(&mut mock, false);
        templates.extend(pipeline_templates(&commands));
        let early = runs_early(&commands, &templates);
        ran.push(early);
        let micros = if early { with } else { without };
        world.renderer.gpu_frame_time(world.frame - 1, micros);
    }
    ran
}

#[test]
fn the_camera_reads_its_counts_back_after_its_late_phase_without_waiting() {
    let mut world = world(Antialias::Msaa, occluding());
    world.renderer.set_occlusion_read_slot(READ_SLOT);
    let mut mock = device();
    let (first, _) = frames(&mut world, &mut mock);
    let mut templates = pipeline_templates(&first);
    // The check copies the counts of a frame of the window before its first trial.
    let mut read = None;
    for _ in 0..60 {
        let commands = world.step(&mut mock, false);
        templates.extend(pipeline_templates(&commands));
        if commands.iter().any(|(op, _)| *op == Op::ReadBuffer) {
            read = Some(commands);
            break;
        }
    }
    let commands = read.expect("a frame reads the counts");
    assert!(runs_early(&commands, &templates));
    let at = |wanted: Op| commands.iter().position(|(op, _)| *op == wanted).unwrap();
    let late = commands
        .iter()
        .rposition(|(op, _)| *op == Op::Dispatch)
        .expect("the frame dispatches");
    let (copy, reading) = (at(Op::CopyBufferToBuffer), at(Op::ReadBuffer));
    assert!(
        late < copy && copy < reading,
        "the copies follow the culling"
    );
    let read = &commands[reading].1;
    assert_eq!(read[4], READ_SLOT);
    // The counts' four words, then five words for each draw of the first set.
    let copies: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, _)| *op == Op::CopyBufferToBuffer)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(copies.len(), 2);
    assert_eq!(copies[0][4], 16, "the counts");
    assert_eq!(copies[1][1], 0, "the first set starts the buffer");
    assert_eq!(copies[1][4] % INDIRECT_BYTES, 0);
    assert_eq!(read[2], 16 + copies[1][4]);
    assert_eq!(
        copies[0][0], copies[1][0],
        "both from the camera's indirect draws"
    );
    // The counts follow both sets of draws and the history.
    assert!(copies[0][1] >= 2 * copies[1][4]);
}

#[test]
fn a_capture_of_a_frame_whose_counts_read_waits_copies_nothing_into_the_read_buffer() {
    let mut world = world(Antialias::Msaa, occluding());
    world.renderer.set_occlusion_read_slot(READ_SLOT);
    let mut mock = device();
    frames(&mut world, &mut mock);
    for _ in 0..60 {
        world.record(false);
        let words = world.renderer.list(world.frame).words().to_vec();
        let commands = world.commands();
        mock.replay(&words).unwrap();
        // Hold mode's capture draws the frame again at once, while its read still waits. The
        // mock refuses any command on a buffer whose read waits.
        mock.replay_capture(&words).unwrap();
        if let Some((_, read)) = commands.iter().find(|(op, _)| *op == Op::ReadBuffer) {
            // The list copies the counts into the buffer that its read maps, which the capture
            // left out.
            assert!(
                commands
                    .iter()
                    .any(|(op, o)| *op == Op::CopyBufferToBuffer && o[2] == read[0])
            );
            return;
        }
        mock.finish_reads();
        world.frame += 1;
    }
    panic!("no frame reads the counts");
}

#[test]
fn passes_that_make_the_frame_longer_turn_off_but_for_their_trials() {
    // Frames with the passes take a third longer, as when another program's work fills the gaps
    // between them.
    let ran = run_timed(400, 4000, 3000);
    // At first the passes run in every frame.
    assert!(ran[..20].iter().all(|&early| early));
    // Once judged, they run only in the check's trials.
    let late = &ran[200..];
    let on = late.iter().filter(|&&early| early).count();
    assert!(on > 0, "the trials run the passes");
    assert!(
        on * 10 <= late.len(),
        "{on} of {} frames ran the passes",
        late.len()
    );
}

#[test]
fn passes_that_make_the_frame_shorter_stay_on_but_for_their_trials() {
    let ran = run_timed(400, 2000, 3000);
    let late = &ran[200..];
    let off = late.iter().filter(|&&early| !early).count();
    assert!(off > 0, "the trials leave the passes out");
    assert!(
        off * 10 <= late.len(),
        "{off} of {} frames left the passes out",
        late.len()
    );
}
