//! Debug lines on both frame builders, checked through the mock backend and by decoding the lists
//! they record: a frame with lines draws them in the camera's render pass after its opaque objects,
//! and a frame without lines records no trace of them.

mod common;

use common::{World, count};
use null3d_gpu::drawlist::sizes::LINE_VERTEX_BYTES;
use null3d_gpu::drawlist::{Op, buffer_usage, format, permutation, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;

type Commands = [(Op, Vec<u32>)];

/// Two lines in front of the camera, a red one and a green one.
const LINES: [([f64; 3], u32); 4] = [
    ([-1.0, 0.0, 5.0], 0xff00_00ff),
    ([1.0, 0.0, 5.0], 0xff00_00ff),
    ([0.0, -1.0, 5.0], 0xff00_ff00),
    ([0.0, 1.0, 5.0], 0xff00_ff00),
];

fn webgl2_world(multi_draw: bool) -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw,
        ..CpuCulledConfig::default()
    }))
}

/// The commands inside the render pass that resolves into the canvas: the camera's.
fn camera_pass(commands: &Commands) -> &Commands {
    let begin = commands
        .iter()
        .position(|(op, o)| *op == Op::BeginRenderPass && o[1] == 0)
        .expect("a render pass resolves into the canvas");
    let end = begin
        + commands[begin..]
            .iter()
            .position(|(op, _)| *op == Op::EndRenderPass)
            .unwrap();
    &commands[begin + 1..end]
}

/// The commands that bundles record.
fn in_bundles(commands: &Commands) -> Vec<(Op, Vec<u32>)> {
    let mut recording = false;
    let mut out = Vec::new();
    for (op, o) in commands {
        match op {
            Op::BeginBundle => recording = true,
            Op::EndBundle => recording = false,
            _ if recording => out.push((*op, o.clone())),
            _ => {}
        }
    }
    out
}

/// The id of the pipeline that a frame created for the debug lines, if it made one.
fn lines_pipeline(commands: &Commands) -> Option<u32> {
    commands
        .iter()
        .find(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::DEBUG_LINES)
        .map(|(_, o)| o[0])
}

/// True when the frame created or wrote the buffer.
fn touches(commands: &Commands, buffer: u32) -> (bool, bool) {
    let any = |wanted: Op| {
        commands
            .iter()
            .any(|(op, o)| *op == wanted && o[0] == buffer)
    };
    (any(Op::CreateBuffer), any(Op::WriteBuffer))
}

/// Records the frame after the world's current one, with `lines` drawn in it, and replays it.
fn next_frame<B: FrameBuilder>(
    world: &mut World<B>,
    mock: &mut MockBackend,
    lines: &[([f64; 3], u32)],
    name: &str,
) -> Vec<(Op, Vec<u32>)> {
    world.frame += 1;
    world.draw_lines(lines);
    world.record(false);
    if let Err(error) = mock.replay(world.renderer.list(world.frame).words()) {
        panic!("{name}, frame {}: {error:?}", world.frame);
    }
    world.commands()
}

/// The frames that every builder records the same way.
fn check<B: FrameBuilder>(mut world: World<B>, name: &str) {
    let mut mock = MockBackend::default();
    // A second view, whose render pass must not draw the lines.
    world.add_view([5.0, 0.0, 6.0]);
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let first = world.commands();
    assert_eq!(count(&first, Op::Draw), 0, "{name}");
    assert_eq!(lines_pipeline(&first), None, "{name}");

    // The first frame with lines makes their pipeline and vertex buffer, uploads the points and
    // draws them all in one call, last in the camera's render pass. On the 8-bit path, as here,
    // the lines tone map themselves, as the mesh shaders do.
    let commands = next_frame(&mut world, &mut mock, &LINES, name);
    let pipeline = lines_pipeline(&commands).expect(name);
    let made = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateRenderPipeline && o[0] == pipeline)
        .unwrap();
    assert_eq!(
        made.1[2..],
        [
            permutation::TONE_MAP,
            format::CANVAS,
            format::DEPTH32_FLOAT,
            4,
            state_flags::LINE_LIST,
            0
        ],
        "{name}"
    );
    let pass = camera_pass(&commands);
    let (before, lines) = pass.split_at(pass.len() - 4);
    let ops: Vec<Op> = lines.iter().map(|(op, _)| *op).collect();
    assert_eq!(
        ops,
        [
            Op::SetPipeline,
            Op::SetBindGroup,
            Op::SetVertexBuffer,
            Op::Draw
        ],
        "{name}: the lines come last in the camera's render pass"
    );
    assert_eq!(lines[0].1, [pipeline], "{name}");
    assert_eq!(lines[3].1, [4, 1, 0, 0], "{name}");
    let buffer = lines[2].1[1];
    assert_eq!(lines[2].1, [0, buffer, 0, 4 * LINE_VERTEX_BYTES], "{name}");
    let created = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBuffer && o[0] == buffer)
        .expect(name);
    assert!(created.1[1] >= 4 * LINE_VERTEX_BYTES, "{name}");
    assert_eq!(
        created.1[2],
        buffer_usage::VERTEX | buffer_usage::COPY_DST,
        "{name}"
    );
    let writes: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(writes.len(), 1, "{name}");
    assert_eq!(writes[0][3], 4 * LINE_VERTEX_BYTES, "{name}");
    assert_eq!(
        count(&commands, Op::Draw),
        1,
        "{name}: only the camera's view draws lines"
    );

    // The lines bind the camera's frame group as its opaque pass does: in the pass itself on
    // WebGL2, and in the bundle that the first frame recorded on WebGPU.
    let bind = &lines[1].1;
    let opaque_binds: Vec<Vec<u32>> = before
        .iter()
        .cloned()
        .chain(in_bundles(&first))
        .filter(|(op, o)| *op == Op::SetBindGroup && o[0] == 0 && o[1] == bind[1])
        .map(|(_, o)| o)
        .collect();
    assert!(!opaque_binds.is_empty(), "{name}");
    for opaque in opaque_binds {
        assert_eq!(
            &opaque, bind,
            "{name}: the lines bind the camera's frame group"
        );
    }

    // A later frame with as many lines keeps the pipeline and the buffer, and one with more
    // lines makes the buffer again, larger.
    let steady = next_frame(&mut world, &mut mock, &LINES, name);
    assert_eq!(lines_pipeline(&steady), None, "{name}");
    assert_eq!(touches(&steady, buffer), (false, true), "{name}");
    let many: Vec<([f64; 3], u32)> = (0..600)
        .map(|k| ([f64::from(k) * 0.01, 0.0, 4.0], 0xffff_ffff))
        .collect();
    let grown = next_frame(&mut world, &mut mock, &many, name);
    assert_eq!(touches(&grown, buffer), (true, true), "{name}");

    // A frame without lines after them records no trace of them.
    let after = next_frame(&mut world, &mut mock, &[], name);
    assert_eq!(count(&after, Op::Draw), 0, "{name}");
    assert_eq!(touches(&after, buffer), (false, false), "{name}");

    // A new GPU device has none of the lines' objects: the next frame with lines makes them
    // again, and a device that sees only that frame draws it.
    world.renderer.reset_gpu();
    let fresh = next_frame(&mut world, &mut MockBackend::default(), &LINES, name);
    assert_eq!(lines_pipeline(&fresh), Some(pipeline), "{name}");
    assert_eq!(touches(&fresh, buffer), (true, true), "{name}");
}

#[test]
fn lines_draw_last_in_the_camera_render_pass_only_in_frames_with_lines() {
    check(World::new(), "WebGPU");
    check(webgl2_world(true), "WebGL2 with multi-draw");
    check(webgl2_world(false), "WebGL2 without multi-draw");
}

#[test]
fn a_point_without_a_partner_draws_nothing() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let odd = next_frame(&mut world, &mut mock, &LINES[..3], "WebGPU");
    let draws: Vec<&Vec<u32>> = camera_pass(&odd)
        .iter()
        .filter(|(op, _)| *op == Op::Draw)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(draws, [&vec![2, 1, 0, 0]], "the third point has no partner");
    let lone = next_frame(&mut world, &mut mock, &LINES[..1], "WebGPU");
    assert_eq!(count(&lone, Op::Draw), 0);
    let graph = world.renderer.render_graph();
    let pass = graph.find_pass("DebugLines").unwrap();
    assert!(
        !graph.is_enabled(pass),
        "a frame without a whole line keeps the pass off"
    );
}
