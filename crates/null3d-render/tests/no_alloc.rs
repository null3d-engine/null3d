//! Steady frames allocate nothing: a counting global allocator watches the test thread while the
//! frame builder records frames of a scene whose batch moves every frame. It counts only the test
//! thread, so the test runner's own work on other threads cannot reach the count. Frames whose
//! structure changes allocate nothing either, on either frame parity, until the scene grows. The
//! render graph allocates nothing while it stays the same, nor when passes switch on and off
//! after it has compiled once.

mod common;

use common::graph::{CASCADES, engine_passes};
use common::{World, grid};
use null3d_core::jobs::JobSystem;
use null3d_core::testing::CountingAllocator;
use null3d_gpu::drawlist::{DrawList, Op, format};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::geometry::sphere_geometry;
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::materials::Shading;
use null3d_render::output::{Output, SceneColor, ToneMapping};
use null3d_render::parallel_record::ParallelRecorder;

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

#[test]
fn hdr_frames_whose_output_settings_change_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        transparent: false,
    };
    let webgpu = World::with_config(RendererConfig {
        canvas,
        ..RendererConfig::default()
    });
    assert_eq!(hdr_allocations(webgpu), 0, "WebGPU");
    for multi_draw in [true, false] {
        let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
            canvas,
            multi_draw,
            ..CpuCulledConfig::default()
        }));
        assert_eq!(
            hdr_allocations(webgl2),
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

/// Records frames up to `last`, each with its structure changed or not.
fn record_until<B: FrameBuilder>(world: &mut World<B>, last: u32, structure_changed: bool) {
    while world.frame < last {
        world.frame += 1;
        world.record(structure_changed);
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
        .add(&sphere_geometry(0.5, 16, 12))
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
