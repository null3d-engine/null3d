//! Scene passes: views that draw the scene into textures of their own size, which materials show.
//! The graph runs a pass only while a texture shows it, before the camera's passes. A view never
//! draws an object that shows its own texture. On WebGPU a copy turns each image upright into the
//! texture, and on WebGL2 the view draws into it directly.

mod common;

use common::{LENS, World, count, grid};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, format};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::graph::{ALL_LAYERS, GraphError};
use null3d_render::materials::{MapSlot, Shading};
use null3d_render::view::{View, ViewId, ViewNames, ViewTarget};

/// The size of the minimap's texture in the tests.
const SIZE: u32 = 64;

/// Adds a scene pass named "Map" that draws into "minimap", from a camera at `position` that
/// looks down -z, and returns its view. `reads` names the textures it reads.
fn add_map<B: FrameBuilder>(world: &mut World<B>, position: [f32; 3], reads: &[&str]) -> ViewId {
    add_pass(world, position, "Map", "minimap", reads)
}

fn add_pass<B: FrameBuilder>(
    world: &mut World<B>,
    position: [f32; 3],
    pass: &str,
    target: &str,
    reads: &[&str],
) -> ViewId {
    let camera = world.scene.reserve().unwrap();
    world.scene.set_position(camera, position).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::create(
                camera,
                Handle::NONE,
                NO_MESH,
                flags::VISIBLE,
            )],
            world.frame,
        )
        .unwrap();
    let view = View::new(camera, LENS, ALL_LAYERS).with_target(ViewTarget {
        size: Some((SIZE, SIZE)),
        ..ViewTarget::default()
    });
    let names = ViewNames {
        pass: pass.into(),
        target: target.into(),
        reads: reads.iter().map(|&name| name.into()).collect(),
    };
    world
        .renderer
        .settings_mut()
        .add_named_view(view, names)
        .unwrap()
}

/// Adds a texture that shows `view`'s target, an unlit material that maps it, and a screen that
/// draws with the material in front of the camera. Returns the texture.
fn add_screen<B: FrameBuilder>(world: &mut World<B>, view: ViewId) -> Handle {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
    let texture = settings
        .textures_mut()
        .create_pass(view.index() as u32, SIZE, SIZE, format::RGBA16_FLOAT)
        .unwrap();
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
    texture
}

/// The names of the passes of each step of the compiled plan.
fn steps<B: FrameBuilder>(
    world: &World<B>,
    graph: impl Fn(&B) -> &null3d_render::graph::RenderGraph,
) -> Vec<Vec<String>> {
    let graph = graph(&world.renderer);
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

/// The bind groups that each bundle of a frame's list sets, bundle by bundle.
fn bundle_groups(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, Vec<u32>)> {
    let mut bundles = Vec::new();
    let mut open: Option<(u32, Vec<u32>)> = None;
    for (op, operands) in commands {
        match op {
            Op::BeginBundle => open = Some((operands[0], Vec::new())),
            Op::SetBindGroup => {
                if let Some((_, groups)) = open.as_mut() {
                    groups.push(operands[1]);
                }
            }
            Op::EndBundle => bundles.extend(open.take()),
            _ => {}
        }
    }
    bundles
}

#[test]
fn a_scene_pass_runs_before_the_camera_only_while_a_texture_shows_it() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let map = add_map(&mut world, [0.0, 10.0, 6.0], &[]);
    world.renderer.check_graph().unwrap();
    world.step(&mut mock, true);
    // Nothing shows the map yet, so the graph culls its passes, and its target takes no texture.
    let graph = world.renderer.render_graph();
    assert_eq!(
        steps(&world, |r| r.render_graph()),
        [vec!["LightClusters", "Culling"], vec!["Opaque", "Resolve"]]
    );
    for name in ["MapCulling", "Map", "MapCopy"] {
        let pass = graph.find_pass(name).unwrap();
        assert!(graph.is_culled(pass), "{name} is culled");
    }
    let target = graph.find_resource("minimap").unwrap();
    assert_eq!(graph.plan().unwrap().texture_of(target), None);
    assert!(world.renderer.settings().view_draws(ViewId::CAMERA));
    assert!(!world.renderer.settings().view_draws(map));

    // A screen shows it: the map culls and draws first, its copy turns the image upright into the
    // texture, and the camera's pass, which samples it, runs last.
    let texture = add_screen(&mut world, map);
    world.step(&mut mock, true);
    world.step(&mut mock, false);
    assert_eq!(
        steps(&world, |r| r.render_graph()),
        [
            vec!["LightClusters", "Culling", "MapCulling"],
            vec!["Map"],
            vec!["MapCopy"],
            vec!["Opaque", "Resolve"],
        ]
    );
    let textures = world.renderer.settings().textures();
    assert_eq!(textures.ready_layer(texture), Some(0), "the texture draws");
    let group = textures.group_id(texture).unwrap();

    // The screen draws in the camera's bundle and not in the map's.
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let world_commands = world.commands();
    let bundles = bundle_groups(&world_commands);
    let showing: Vec<u32> = bundles
        .iter()
        .filter(|(_, groups)| groups.contains(&group))
        .map(|&(bundle, _)| bundle)
        .collect();
    assert_eq!(
        showing.len(),
        1,
        "only the camera's bundle draws the screen: {bundles:?}"
    );
    assert_eq!(
        count(&world_commands, Op::BeginBundle),
        2,
        "each view records its bundle"
    );
}

#[test]
fn a_pass_that_reads_a_missing_texture_or_closes_a_loop_fails_and_names_it() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    // Nothing shows the map, so the graph culls it. The texture that no pass writes fails anyway,
    // so the call that adds the pass fails, not a later one that makes it run.
    let map = add_pass(&mut world, [0.0, 20.0, 0.0], "Map", "minimap", &["mirror"]);
    let error = world.renderer.check_graph().unwrap_err();
    assert_eq!(error.code(), GraphError::MISSING_INPUT);
    assert_eq!(
        world.renderer.graph_message(error),
        r#"E1502: the pass "Map" uses "mirror", but no pass creates it."#
    );
    add_screen(&mut world, map);

    // A mirror that reads the map, which reads the mirror, closes a loop.
    let mirror = add_pass(
        &mut world,
        [0.0, 2.0, 8.0],
        "Mirror",
        "mirror",
        &["minimap"],
    );
    let error = world.renderer.check_graph().unwrap_err();
    assert_eq!(error.code(), GraphError::CYCLE);
    assert!(
        world.renderer.graph_message(error).contains(r#""Map""#),
        "the message names the passes"
    );
    world.renderer.settings_mut().remove_view(mirror);
    // The frame draws once the loop is gone; the removed mirror's texture shows nothing.
    world.renderer.settings_mut().remove_view(map);
    world.renderer.check_graph().unwrap();
    world.step(&mut mock, true);
}

#[test]
fn a_webgl2_view_draws_into_its_texture_and_leaves_out_the_screen_that_shows_it() {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let mut mock = MockBackend::default();
    let map = add_map(&mut world, [0.0, 0.0, 3.0], &[]);
    let texture = add_screen(&mut world, map);
    world.renderer.check_graph().unwrap();
    // The map's camera sees the screen: the mock refuses a pass that samples its own target, so
    // the replays pass only because the map leaves the screen out.
    for _ in 0..3 {
        world.step(&mut mock, true);
    }
    assert_eq!(
        steps(&world, |r| r.render_graph()),
        [vec!["Map"], vec!["Opaque", "Resolve"]],
        "WebGL2 draws the rows in the order materials sample them, so it copies nothing"
    );
    let textures = world.renderer.settings().textures();
    assert_eq!(textures.ready_layer(texture), Some(0));
}

#[test]
fn the_text_dump_of_a_frame_with_a_scene_pass_matches_its_snapshot() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let map = add_map(&mut world, [0.0, 10.0, 6.0], &[]);
    add_screen(&mut world, map);
    world.renderer.check_graph().unwrap();
    world.step(&mut mock, true);
    let dot = world.renderer.graph_dot();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/snapshots/scene-pass.dot"
    );
    if std::env::var_os("NULL3D_UPDATE_GENERATED").is_some() {
        std::fs::write(path, &dot).unwrap();
    }
    let expected = std::fs::read_to_string(path).unwrap_or_default();
    assert!(
        dot == expected,
        "{path} is out of date: run `NULL3D_UPDATE_GENERATED=1 cargo test -p null3d-render --test scene_passes`\n{dot}"
    );
    // The map's culled twin, a pass that nothing shows, shows dashed.
    let unseen = add_pass(&mut world, [0.0, 2.0, 8.0], "Unseen", "unseen", &[]);
    let dot = world.renderer.graph_dot();
    assert!(
        dot.contains(
            r#"label="Unseen\nscene pass, 64 x 64, all layers, culled: nothing uses its output"];"#
        ),
        "{dot}"
    );
    world.renderer.settings_mut().remove_view(unseen);
}
