//! Scene passes: views that draw the scene into textures of their own size, which materials show.
//! The graph runs a pass only while a texture shows it, before the camera's passes. A view never
//! draws an object that shows its own texture. On WebGPU a copy turns each image upright into the
//! texture, and on WebGL2 the view draws into it directly.

mod common;

use common::{LENS, World, count, grid};
use null3d_core::handle::Handle;
use null3d_core::lights::VisibleLight;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, format, layout};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::graph::{ALL_LAYERS, GraphError};
use null3d_render::light_grid::LightGrid;
use null3d_render::materials::{MapSlot, Shading};
use null3d_render::shadow_tiles::TileSettings;
use null3d_render::view::{View, ViewFrame, ViewId, ViewNames, ViewTarget};

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

#[test]
fn on_the_8_bit_path_the_webgpu_copy_decodes_display_color_into_an_srgb_texture() {
    use null3d_gpu::drawlist::{permutation, template};
    use null3d_render::frame::CanvasOutput;
    use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
    use null3d_render::output::{Antialias, SceneColor};
    // The 8-bit path's scene shaders write display color, so the copy decodes it into an sRGB
    // texture, and materials read linear color. HDR color needs no decode. Compatibility mode
    // takes the 8-bit path for MSAA, and HDR color draws with FXAA there.
    for (scene_color, antialias, target, bits) in [
        (
            format::CANVAS,
            Antialias::Msaa,
            format::RGBA8_UNORM_SRGB,
            permutation::TONE_MAP,
        ),
        (
            format::RGBA16_FLOAT,
            Antialias::Fxaa,
            format::RGBA16_FLOAT,
            0,
        ),
    ] {
        let mut world = World::build(GpuDrivenRenderer::new(RendererConfig {
            canvas: CanvasOutput {
                scene_color: SceneColor::from_format(scene_color),
                antialias,
                transparent: false,
            },
            ..RendererConfig::default()
        }));
        let mut mock = MockBackend::default();
        let map = add_map(&mut world, [0.0, 10.0, 6.0], &[]);
        add_screen(&mut world, map);
        let mut made = world.step(&mut mock, true);
        made.extend(world.step(&mut mock, false));
        let copies: Vec<&Vec<u32>> = made
            .iter()
            .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::VIEW_COPY)
            .map(|(_, o)| o)
            .collect();
        assert_eq!(
            copies.len(),
            1,
            "one copy pipeline for scene color {scene_color}"
        );
        assert_eq!(
            (copies[0][2], copies[0][3]),
            (bits, target),
            "the copy's build and target format for scene color {scene_color}"
        );
    }
}

/// The light grid and values of a view in the frame recorded last, on either GPU path.
trait ViewLighting {
    fn view_light_grid(&self, view: ViewId) -> Option<&LightGrid>;
    fn camera_grid(&self) -> &LightGrid;
    fn values(&self, view: ViewId) -> Option<&ViewFrame>;
}

impl ViewLighting for GpuDrivenRenderer {
    fn view_light_grid(&self, view: ViewId) -> Option<&LightGrid> {
        self.view_light_grid(view)
    }
    fn camera_grid(&self) -> &LightGrid {
        self.light_grid()
    }
    fn values(&self, view: ViewId) -> Option<&ViewFrame> {
        self.view_frame(view)
    }
}

impl ViewLighting for CpuCulledRenderer {
    fn view_light_grid(&self, view: ViewId) -> Option<&LightGrid> {
        self.view_light_grid(view)
    }
    fn camera_grid(&self) -> &LightGrid {
        self.light_grid()
    }
    fn values(&self, view: ViewId) -> Option<&ViewFrame> {
        self.view_frame(view)
    }
}

/// Where the second view's camera stands: behind the main camera, which stands at z = 20, both
/// looking down -z.
const BEHIND: [f32; 3] = [0.0, 0.0, 40.0];
/// A lamp between the two cameras, which only the second view sees.
const BETWEEN: [f32; 3] = [0.0, 0.0, 30.0];

/// Records `world`, with a second view at [`BEHIND`] that a texture shows, for a few frames on
/// `mock`, after `setup` added its lights. Returns the view and every frame's operations.
fn lit_views_on<B: FrameBuilder>(
    world: &mut World<B>,
    mock: &mut MockBackend,
    setup: impl FnOnce(&mut World<B>),
) -> (ViewId, Vec<(Op, Vec<u32>)>) {
    let view = world.add_view(BEHIND);
    setup(world);
    let mut commands = Vec::new();
    for frame in 0..4 {
        commands.extend(world.step(mock, frame == 0));
    }
    (view, commands)
}

/// As [`lit_views_on`], on a mock of its own.
fn lit_views<B: FrameBuilder>(
    world: &mut World<B>,
    setup: impl FnOnce(&mut World<B>),
) -> (ViewId, Vec<(Op, Vec<u32>)>) {
    lit_views_on(world, &mut MockBackend::default(), setup)
}

/// The bind groups that the frame's light clustering dispatches set: the groups that `created`
/// made with the light clustering layout, in the order the frame sets them.
fn light_groups(created: &[(Op, Vec<u32>)], frame: &[(Op, Vec<u32>)]) -> Vec<u32> {
    let groups: Vec<u32> = created
        .iter()
        .filter(|(op, words)| *op == Op::CreateBindGroup && words[1] == layout::LIGHT_CLUSTERS)
        .map(|(_, words)| words[0])
        .collect();
    frame
        .iter()
        .filter(|(op, words)| *op == Op::SetBindGroup && groups.contains(&words[1]))
        .map(|(_, words)| words[1])
        .collect()
}

/// Checks that a lamp that only the second view sees lights that view alone, as its grid lists it
/// for positions relative to the view's camera, and returns the view's grid's lights.
fn lamp_only_the_view_sees<B: FrameBuilder + ViewLighting>(
    world: &mut World<B>,
) -> Vec<VisibleLight> {
    let (view, _) = lit_views(world, |world| {
        world.add_point(BETWEEN, 3.0);
    });
    let renderer = &world.renderer;
    assert!(
        renderer.camera_grid().lights().is_empty(),
        "the camera sees no lamp"
    );
    let grid = renderer.view_light_grid(view).expect("the view has a grid");
    assert_eq!(grid.lights().len(), 1);
    let lamp = grid.lights()[0];
    assert_eq!(
        lamp.position,
        [0.0, 0.0, -10.0],
        "relative to the view's camera"
    );
    let values = renderer.values(view).unwrap();
    assert_ne!(
        values.uniform.cluster_grid[2], 0.0,
        "the view's shaders read its grid"
    );
    let camera = renderer.values(ViewId::CAMERA).unwrap();
    assert_eq!(camera.uniform.cluster_grid[2], 0.0);
    // A surface 1 m in front of the lamp, seen from the view, finds the lamp in its cluster.
    let cluster = grid.cluster_at([0.0, 0.0, -9.0]).expect("in the grid");
    assert!(grid.reaches(0, cluster));
    grid.lights().to_vec()
}

#[test]
fn a_lamp_that_only_a_scene_pass_sees_lights_the_pass_alone_on_both_paths() {
    let gpu = lamp_only_the_view_sees(&mut World::new());
    let cpu = lamp_only_the_view_sees(&mut World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
    assert_eq!(gpu, cpu, "both paths list the same lights");
}

#[test]
fn each_webgpu_view_with_lamps_fills_its_own_grid() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (view, created) = lit_views_on(&mut world, &mut mock, |world| {
        world.add_point(BETWEEN, 3.0);
        world.add_point([0.0, 0.0, 0.0], 3.0);
    });
    // Both views see a lamp: each gets its own light buffers and group, and the light clustering
    // pass fills both grids.
    let frame = world.step(&mut mock, true);
    let set = light_groups(&created, &frame);
    assert_eq!(set.len(), 2, "one group per view with lamps: {set:?}");
    assert_ne!(set[0], set[1]);
    let grid = world.renderer.view_light_grid(view).unwrap();
    assert_eq!(grid.lights().len(), 2, "the view sees both lamps");
    let max_words = grid.max_words() * 4;
    let grids = created
        .iter()
        .filter(|(op, words)| *op == Op::CreateBuffer && words[1] == max_words)
        .count();
    assert_eq!(grids, 2, "a grid buffer for each view");
}

#[test]
fn a_pass_that_sees_no_lamp_makes_no_grid() {
    let mut world = World::new();
    let (view, created) = lit_views(&mut world, |world| {
        // Lamps that only the main camera sees: past the far plane of the view's camera, which
        // stands 20 m further back.
        world.add_point([0.0, 0.0, -70.0], 1.0);
        world.add_point([1.0, 0.0, -70.0], 1.0);
    });
    assert!(world.renderer.view_light_grid(view).is_none());
    assert_eq!(world.renderer.light_grid().lights().len(), 2);
    let made = created
        .iter()
        .filter(|(op, words)| *op == Op::CreateBindGroup && words[1] == layout::LIGHT_CLUSTERS)
        .count();
    assert_eq!(made, 1, "only the camera's light group");
    let mut cpu = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let (view, _) = lit_views(&mut cpu, |world| {
        world.add_point([0.0, 0.0, -70.0], 1.0);
    });
    assert!(cpu.renderer.view_light_grid(view).is_none(), "WebGL2");
}

/// Checks that the second view's shadow lookups add its camera's offset from the main camera,
/// and that a lamp that the main camera's view gives a shadow tile keeps it in the second view,
/// while a lamp that only the second view sees has none.
fn shadows_in_the_view<B: FrameBuilder + ViewLighting>(world: &mut World<B>) {
    let (view, _) = lit_views(world, |world| {
        world
            .renderer
            .settings_mut()
            .set_tile_settings(TileSettings {
                tiles: 7,
                size: 256,
                point_shadows: true,
            });
        world.add_spot([0.0, 3.0, 0.0], 6.0);
        world.add_point(BETWEEN, 3.0);
    });
    let renderer = &world.renderer;
    let values = renderer.values(view).unwrap();
    assert_eq!(values.uniform.shadow_origin, [0.0, 0.0, 20.0, 0.0]);
    let camera = renderer.values(ViewId::CAMERA).unwrap();
    assert_eq!(camera.uniform.shadow_origin, [0.0; 4]);
    let shared = renderer.camera_grid().lights()[0];
    assert!(
        shared.shadow > 0.0,
        "the camera's view gives the spot light a tile"
    );
    let lights = renderer.view_light_grid(view).unwrap().lights();
    assert_eq!(lights.len(), 2);
    let tile_of = |light: u32| lights.iter().find(|l| l.light == light).unwrap().shadow;
    assert_eq!(
        tile_of(shared.light),
        shared.shadow,
        "the view reads the same tile"
    );
    let only = lights.iter().find(|l| l.light != shared.light).unwrap();
    assert_eq!(
        only.shadow, 0.0,
        "a lamp that only the view sees has no tile"
    );
}

#[test]
fn a_pass_reads_the_camera_s_shadow_tiles_from_its_own_camera_on_both_paths() {
    shadows_in_the_view(&mut World::new());
    shadows_in_the_view(&mut World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}
