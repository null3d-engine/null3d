//! The shadow atlas of point and spot lights on both frame builders: which lights get tiles, and
//! which tiles draw in each frame. A still scene draws no tile, and a caster that moves draws only
//! the tiles of the lights within its reach. Checked through the mock backend, which rejects what
//! a real GPU would, and by decoding the lists the builders record.

mod common;

use common::{World, count};
use null3d_core::animation::{Channel, Interpolation, Play, SourceTrack, resample};
use null3d_core::lights::{LightTable, kind};
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{NO_TARGET, Op, format, view};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::light_grid::LightGrid;
use null3d_render::shadow_tiles::{MAX_REDRAWS, ShadowTiles, TileSettings};
use null3d_render::view::ViewId;

/// Two tiles of 256 texels, without point light shadows.
const TWO_TILES: TileSettings = TileSettings {
    tiles: 2,
    size: 256,
    point_shadows: false,
};

/// What each builder tells the tests.
trait Tiles: FrameBuilder {
    fn tiles(&self) -> &ShadowTiles;
    fn grid(&self) -> &LightGrid;
}

impl Tiles for GpuDrivenRenderer {
    fn tiles(&self) -> &ShadowTiles {
        self.shadow_tiles()
    }
    fn grid(&self) -> &LightGrid {
        self.light_grid()
    }
}

impl Tiles for CpuCulledRenderer {
    fn tiles(&self) -> &ShadowTiles {
        self.shadow_tiles()
    }
    fn grid(&self) -> &LightGrid {
        self.light_grid()
    }
}

/// The common world drawn by `renderer`, with a light table, the atlas set up as `settings`, and
/// the lit box at x = -3 and the ball at x = 1 casting shadows. The object at x = 3 casts too, out
/// of every light's reach.
fn world<B: Tiles>(renderer: B, settings: TileSettings) -> World<B> {
    let mut world = World::build(renderer);
    world.light_table = Some(LightTable::new());
    world.renderer.settings_mut().set_tile_settings(settings);
    let [lit_box, unlit_box, ball, hidden] = world.objects[..] else {
        panic!("four objects")
    };
    let casts = flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let commands = [
        Command::set_flags(lit_box, casts, casts),
        Command::set_flags(ball, casts, casts),
        Command::set_flags(unlit_box, flags::CAST_SHADOWS, flags::CAST_SHADOWS),
        Command::set_flags(hidden, flags::CAST_SHADOWS, flags::CAST_SHADOWS),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world
}

/// Records the next frame and replays it, and returns its commands.
fn step<B: Tiles>(
    world: &mut World<B>,
    mock: &mut MockBackend,
    structure: bool,
) -> Vec<(Op, Vec<u32>)> {
    world.frame += 1;
    world.record(structure);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    world.commands()
}

/// The render passes that draw depth alone: the shadow passes.
fn depth_passes(commands: &[(Op, Vec<u32>)]) -> usize {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::BeginRenderPass && o[0] == NO_TARGET)
        .count()
}

/// Checks that a still scene draws no tile, and that only casters within a light's reach draw its
/// tile again, on either builder.
fn tiles_draw_only_when_their_casters_or_lights_move<B: Tiles>(renderer: B) {
    let mut world = world(renderer, TWO_TILES);
    let [lit_box, _, _, far] = world.objects[..] else {
        panic!("four objects")
    };
    let light = world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    let first = step(&mut world, &mut mock, true);

    // One light casts, so the atlas has one layer of 256 texels, which the frame draws.
    let atlases: Vec<_> = first
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateTexture && o[4] == format::DEPTH32_FLOAT && o[8] == view::D2_ARRAY
        })
        .map(|(_, o)| o[1..4].to_vec())
        .collect();
    assert!(atlases.contains(&vec![256, 256, 1]), "{atlases:?}");
    assert_eq!(world.renderer.tiles().drawn(), 1);
    assert_eq!(depth_passes(&first), 1);
    assert!(world.renderer.tiles().frame(0).is_some());
    assert!(world.renderer.casts_tile_shadows());

    // A still frame draws no tile, and its light still casts shadows.
    let still = step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
    assert_eq!(depth_passes(&still), 0);
    assert!(world.renderer.casts_tile_shadows());

    // A caster beyond the light's reach moves: still no tile.
    world.scene.set_position(far, [3.0, 0.5, 0.0]).unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // A caster within its reach moves: the tile draws once, then rests.
    world.scene.set_position(lit_box, [-3.0, 0.5, 0.0]).unwrap();
    let moved = step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    assert_eq!(depth_passes(&moved), 1);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // A caster that leaves the light's reach draws it once more, as its shadow goes.
    world.scene.set_position(lit_box, [30.0, 0.0, 0.0]).unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // The light moves: its tile draws again.
    world.scene.set_position(light, [-3.0, 4.5, 0.0]).unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
}

#[test]
fn webgpu_tiles_draw_only_when_their_casters_or_lights_move() {
    tiles_draw_only_when_their_casters_or_lights_move(GpuDrivenRenderer::new(Default::default()));
}

#[test]
fn webgl2_tiles_draw_only_when_their_casters_or_lights_move() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        tiles_draw_only_when_their_casters_or_lights_move(CpuCulledRenderer::new(config));
    }
}

#[test]
fn a_tile_cull_and_draw_on_webgpu_reads_the_casters_alone() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), TWO_TILES);
    world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    // Each frame with lights lists the lights of the camera's clusters in three dispatches.
    let clustering = 3;
    let commands = step(&mut world, &mut mock, true);
    // The camera's culling dispatch and the tile's, and two bundles run: the camera's and the
    // tile's.
    assert_eq!(count(&commands, Op::Dispatch), clustering + 2);
    assert_eq!(count(&commands, Op::ExecuteBundles), 2);
    let still = step(&mut world, &mut mock, false);
    assert_eq!(count(&still, Op::Dispatch), clustering + 1);
    assert_eq!(count(&still, Op::ExecuteBundles), 1);
}

#[test]
fn the_lights_that_look_largest_take_the_tiles_and_their_records_name_them() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), TWO_TILES);
    // From the camera at z = 20: the near light looks largest, the far one smallest.
    world.add_spot([-3.0, 4.0, -40.0], 6.0);
    world.add_spot([1.0, 4.0, 10.0], 6.0);
    world.add_spot([3.0, 4.0, -10.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    // The budget of two tiles holds two of the three lights, so the atlas has two layers.
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 2);
    assert_eq!(world.renderer.tiles().drawn(), 2);
    let grid = &world.lights;
    let [a, b, c] = grid[..] else {
        panic!("three lights are visible")
    };
    let rows = [a.light, b.light, c.light];
    let tile = |world: &World, row: u32| world.renderer.tiles().tile_of(row, &world.shadow_lights);
    // Spot lights take tiles from the last one down: the largest takes tile 1, the next tile 0.
    let tiles = |world: &World| rows.map(|row| tile(world, row));
    assert_eq!(tiles(&world), [0.0, 2.0, 1.0]);
    // The records that the shaders read hold the same tiles.
    let records = |world: &World| {
        let grid = world.renderer.light_grid().lights();
        rows.map(|row| grid.iter().find(|l| l.light == row).unwrap().shadow)
    };
    assert_eq!(records(&world), [0.0, 2.0, 1.0]);

    // The far light comes near: it looks largest now and takes the tile of the light that looks
    // smallest, which draws for it. The other light keeps its tile, which does not draw.
    let table = world.light_table.as_ref().unwrap();
    let far_object = table.object(rows[0]).unwrap();
    world
        .scene
        .set_position(far_object, [-3.0, 4.0, 15.0])
        .unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(tiles(&world), [1.0, 2.0, 0.0]);
    assert_eq!(records(&world), [1.0, 2.0, 0.0]);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    assert!(world.renderer.tiles().frame(0).is_some());
}

#[test]
fn tiles_draw_again_while_a_pipeline_may_still_build() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), TWO_TILES);
    world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.pipelines_built = 0;
    world.frame = 0;
    step(&mut world, &mut mock, true);
    // Frame 1 created pipelines, and the thread that draws has not drawn a frame with every
    // pipeline built yet, so the tile draws in the next frames too.
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    world.pipelines_built = 2;
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 1);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
}

#[test]
fn without_tiles_in_the_budget_spot_lights_cast_no_shadows() {
    let none = TileSettings {
        tiles: 0,
        ..TWO_TILES
    };
    let mut world = world(GpuDrivenRenderer::new(Default::default()), none);
    world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    let commands = step(&mut world, &mut mock, true);
    assert!(world.renderer.tiles().shape().is_none());
    assert!(!world.renderer.casts_tile_shadows());
    assert_eq!(depth_passes(&commands), 0);
    let tiles = world.renderer.tiles();
    assert!(
        world
            .lights
            .iter()
            .all(|l| tiles.tile_of(l.light, &world.shadow_lights) == 0.0)
    );
    assert!(world.renderer.view_frame(ViewId::tile(0)).is_none());
}

/// Eight tiles of 128 texels, with point light shadows.
const POINT_TILES: TileSettings = TileSettings {
    tiles: 8,
    size: 128,
    point_shadows: true,
};

/// Checks that a point light draws six tiles, then none while the scene stands still, and the tile of
/// the one face that a caster below it touches when the caster moves, on either builder.
fn a_point_light_draws_six_tiles_when_its_casters_move<B: Tiles>(renderer: B) {
    let mut world = world(renderer, POINT_TILES);
    let lit_box = world.objects[0];
    world.add_point([-3.0, 3.0, 0.0], 5.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    let first = step(&mut world, &mut mock, true);
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 6);
    assert_eq!(world.renderer.tiles().drawn(), 6);
    assert_eq!(depth_passes(&first), 6);
    let still = step(&mut world, &mut mock, false);
    assert_eq!(depth_passes(&still), 0);
    world.scene.set_position(lit_box, [-3.0, 0.2, 0.0]).unwrap();
    let moved = step(&mut world, &mut mock, false);
    assert_eq!(depth_passes(&moved), 1);
    // Its record names its first tile, and the tiles' block says that it has six.
    let row = world.lights[0].light;
    assert_eq!(world.renderer.grid().lights()[0].shadow, 1.0);
    assert_eq!(
        world.renderer.tiles().tile_of(row, &world.shadow_lights),
        1.0
    );
    let params = world.renderer.tiles().uniform().params;
    assert!(params[..6].iter().all(|p| p[3] == 6.0));
}

#[test]
fn webgpu_point_lights_draw_six_tiles_when_their_casters_move() {
    a_point_light_draws_six_tiles_when_its_casters_move(GpuDrivenRenderer::new(Default::default()));
}

#[test]
fn webgl2_point_lights_draw_six_tiles_when_their_casters_move() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        a_point_light_draws_six_tiles_when_its_casters_move(CpuCulledRenderer::new(config));
    }
}

#[test]
fn point_lights_take_blocks_from_the_first_tile_and_spot_lights_from_the_last() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), POINT_TILES);
    world.add_spot([3.0, 4.0, 0.0], 6.0);
    world.add_point([-3.0, 3.0, 0.0], 5.0);
    world.add_spot([0.0, 4.0, -5.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    // One point light and two spot lights fill the eight tiles.
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 8);
    assert_eq!(world.renderer.tiles().drawn(), 8);
    let tiles = world.renderer.tiles();
    let mut firsts: Vec<(u32, f32)> = world
        .shadow_lights
        .iter()
        .map(|l| (l.kind, tiles.tile_of(l.light, &world.shadow_lights)))
        .collect();
    firsts.sort_by(|a, b| a.1.total_cmp(&b.1));
    assert_eq!(firsts[0], (kind::POINT, 1.0));
    assert_eq!([firsts[1].1, firsts[2].1], [7.0, 8.0]);
}

#[test]
fn point_lights_cast_no_shadows_where_the_preset_turns_them_off() {
    let off = TileSettings {
        point_shadows: false,
        ..POINT_TILES
    };
    let mut world = world(GpuDrivenRenderer::new(Default::default()), off);
    world.add_point([-3.0, 3.0, 0.0], 5.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    let commands = step(&mut world, &mut mock, true);
    assert!(world.renderer.tiles().shape().is_none());
    assert_eq!(depth_passes(&commands), 0);
}

#[test]
fn a_point_light_beyond_the_budget_casts_none_and_a_spot_light_takes_a_tile() {
    let five = TileSettings {
        tiles: 5,
        ..POINT_TILES
    };
    let mut world = world(GpuDrivenRenderer::new(Default::default()), five);
    world.add_point([-3.0, 3.0, 0.0], 5.0);
    world.add_spot([3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    // Six tiles do not fit five, so only the spot light casts.
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 5);
    assert_eq!(world.renderer.tiles().drawn(), 1);
}

/// The tiles among the first `count` that the frame planned last draws.
fn drawn_tiles<B: Tiles>(world: &World<B>, count: usize) -> Vec<usize> {
    let tiles = world.renderer.tiles();
    (0..count).filter(|&t| tiles.frame(t).is_some()).collect()
}

/// Checks that a caster that moves near a point light redraws only the faces of the cube that it
/// touches, before or after its move, on either builder.
fn a_moved_caster_redraws_only_the_faces_it_touches<B: Tiles>(renderer: B) {
    let mut world = world(renderer, POINT_TILES);
    let [lit_box, _, ball, _] = world.objects[..] else {
        panic!("four objects")
    };
    world.add_point([-3.0, 3.0, 0.0], 5.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    assert_eq!(world.renderer.tiles().drawn(), 6);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // The box stands straight below the light, inside the -y face alone.
    world.scene.set_position(lit_box, [-3.0, 0.2, 0.0]).unwrap();
    let moved = step(&mut world, &mut mock, false);
    assert_eq!(drawn_tiles(&world, 6), [3], "the -y face");
    assert_eq!(depth_passes(&moved), 1);

    // The ball moves from +x and below the light to straight beside it: the +x and -y faces.
    world.scene.set_position(ball, [1.0, 2.5, 0.0]).unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(drawn_tiles(&world, 6), [0, 3]);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
}

#[test]
fn webgpu_a_moved_caster_redraws_only_the_faces_it_touches() {
    a_moved_caster_redraws_only_the_faces_it_touches(GpuDrivenRenderer::new(Default::default()));
}

#[test]
fn webgl2_a_moved_caster_redraws_only_the_faces_it_touches() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        a_moved_caster_redraws_only_the_faces_it_touches(CpuCulledRenderer::new(config));
    }
}

#[test]
fn faces_outside_the_camera_s_view_wait_until_they_come_into_it() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), POINT_TILES);
    // The camera at z = 20 looks down -z. The light stands 5 m behind it, and its range reaches
    // 5 m into the view, through its -z face alone.
    world.add_point([0.0, 0.0, 25.0], 10.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    assert_eq!(drawn_tiles(&world, 6), [5], "the -z face");
    assert_eq!(world.lights.len(), 1);
    assert_eq!(world.renderer.grid().lights()[0].shadow, 1.0);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // The camera turns to face the light: the five faces that waited draw now, and the one that
    // drew does not draw again.
    world.aim([0.0, 0.0, 20.0], std::f32::consts::PI, 0.0);
    step(&mut world, &mut mock, false);
    assert_eq!(drawn_tiles(&world, 6), [0, 1, 2, 3, 4]);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
}

/// Checks that a caster whose layers stop sharing a bit with its light's draws the light's tile
/// again, as its shadow goes, and again when they share one once more, on either builder.
fn a_caster_s_layer_change_draws_its_light_s_tile<B: Tiles>(renderer: B) {
    let mut world = world(renderer, TWO_TILES);
    let lit_box = world.objects[0];
    world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
    for layers in [0b10, 0b11] {
        world
            .scene
            .apply_commands(&[Command::set_layers(lit_box, layers)], world.frame + 1)
            .unwrap();
        let structure = world.scene.take_structure_changed();
        step(&mut world, &mut mock, structure);
        assert_eq!(world.renderer.tiles().drawn(), 1, "layers {layers:#b}");
        step(&mut world, &mut mock, false);
        assert_eq!(world.renderer.tiles().drawn(), 0);
    }
}

#[test]
fn webgpu_a_caster_s_layer_change_draws_its_light_s_tile() {
    a_caster_s_layer_change_draws_its_light_s_tile(GpuDrivenRenderer::new(Default::default()));
}

#[test]
fn webgl2_a_caster_s_layer_change_draws_its_light_s_tile() {
    a_caster_s_layer_change_draws_its_light_s_tile(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    ));
}

/// Checks that a skinned caster that stands still while its clip moves an inner joint draws its
/// light's tile in each frame whose pose changed, though its bounding sphere stays the same, and
/// in no other, on either builder.
fn a_still_animated_caster_draws_its_light_s_tile_as_its_pose_changes<B: Tiles>(renderer: B) {
    let mut world = world(renderer, TWO_TILES);
    let column = world.add_skinned([-3.0, -1.0, 0.0]);
    // The middle joint steps up a quarter of a meter for half a second, and its child steps down
    // as far, so the top ring stays where it is and the column's sphere does not change.
    let animations = world.animations.as_mut().unwrap();
    let up = [0.0, 1.0, 0.0, 0.0, 1.25, 0.0, 0.0, 1.0, 0.0];
    let down = [0.0, 1.0, 0.0, 0.0, 0.75, 0.0, 0.0, 1.0, 0.0];
    let tracks = [(1, &up), (2, &down)].map(|(joint, values)| SourceTrack {
        joint,
        channel: Channel::Translation,
        interpolation: Interpolation::Step,
        times: &[0.0, 0.5, 1.0],
        values,
    });
    let clip = resample(animations.skeleton(0).unwrap(), &tracks, 30.0).unwrap();
    let clip = animations.add_clip(0, clip).unwrap();
    let play = Play {
        layer: 0,
        fade: 0.0,
        speed: 1.0,
        looping: true,
        additive: false,
    };
    animations.play(0, clip, play).unwrap();
    world.add_spot([-3.0, 4.0, 0.0], 8.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    let sphere = |world: &World<B>| {
        let slot = world.scene.resolve(column).unwrap() as usize;
        world.scene.world(world.scene.parity()).sphere(slot)
    };
    step(&mut world, &mut mock, false);
    let first = sphere(&world);
    // Two loops of the clip at 60 frames per second: the pose changes four times.
    let mut changes = Vec::new();
    for frame in 3..=122 {
        step(&mut world, &mut mock, false);
        assert_eq!(sphere(&world), first, "frame {frame}");
        if world.renderer.tiles().drawn() > 0 {
            changes.push(frame);
        }
    }
    assert_eq!(changes.len(), 4, "{changes:?}");
}

#[test]
fn webgpu_a_still_animated_caster_draws_its_light_s_tile_as_its_pose_changes() {
    a_still_animated_caster_draws_its_light_s_tile_as_its_pose_changes(GpuDrivenRenderer::new(
        Default::default(),
    ));
}

#[test]
fn webgl2_a_still_animated_caster_draws_its_light_s_tile_as_its_pose_changes() {
    a_still_animated_caster_draws_its_light_s_tile_as_its_pose_changes(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    ));
}

#[test]
fn turning_one_light_s_shadows_off_and_on_keeps_the_atlas_and_the_graph() {
    let three = TileSettings {
        tiles: 3,
        ..TWO_TILES
    };
    let mut world = world(GpuDrivenRenderer::new(Default::default()), three);
    world.add_spot([-3.0, 4.0, 0.0], 6.0);
    let toggled = world.add_spot([1.0, 4.0, 0.0], 6.0);
    let mut mock = MockBackend::default();
    world.frame = 0;
    step(&mut world, &mut mock, true);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 2);
    let compiles = world.renderer.render_graph().compiles();
    let atlas_made = |commands: &[(Op, Vec<u32>)]| {
        commands.iter().any(|(op, o)| {
            *op == Op::CreateTexture && o[4] == format::DEPTH32_FLOAT && o[8] == view::D2_ARRAY
        })
    };
    for casts in [0, flags::CAST_SHADOWS, 0, flags::CAST_SHADOWS] {
        world
            .scene
            .apply_commands(
                &[Command::set_flags(toggled, flags::CAST_SHADOWS, casts)],
                world.frame + 1,
            )
            .unwrap();
        let structure = world.scene.take_structure_changed();
        let commands = step(&mut world, &mut mock, structure);
        assert!(!atlas_made(&commands), "casts {casts}");
        assert_eq!(world.renderer.tiles().shape().unwrap().layers, 2);
        assert_eq!(world.renderer.render_graph().compiles(), compiles);
        let lights = world.shadow_lights.len();
        assert_eq!(lights, if casts == 0 { 1 } else { 2 });
    }
}

/// Twenty-four tiles of 128 texels, with point light shadows.
const FOUR_CUBES: TileSettings = TileSettings {
    tiles: 24,
    size: 128,
    point_shadows: true,
};

#[test]
fn a_burst_of_redraws_spreads_over_frames_under_the_cap() {
    let mut world = world(GpuDrivenRenderer::new(Default::default()), FOUR_CUBES);
    for x in [-4.5, -1.5, 1.5, 4.5] {
        world.add_point([x, 1.5, 0.0], 6.0);
    }
    let mut mock = MockBackend::default();
    world.frame = 0;
    // Tiles that hold no depth of their light yet draw at once, whatever the cap.
    step(&mut world, &mut mock, true);
    assert_eq!(world.renderer.tiles().shape().unwrap().layers, 24);
    assert_eq!(world.renderer.tiles().drawn(), 24);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);

    // A structure change marks every tile: they draw again over two frames, the cap's worth in
    // the first, and every light keeps its shadows meanwhile.
    let cap = MAX_REDRAWS;
    step(&mut world, &mut mock, true);
    assert_eq!(world.renderer.tiles().drawn(), cap);
    assert_eq!(world.renderer.tiles().waiting(), 24 - cap);
    let grid = world.renderer.grid().lights();
    assert!(grid.iter().all(|l| l.shadow > 0.0), "{grid:?}");
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 24 - cap);
    assert_eq!(world.renderer.tiles().waiting(), 0);
    step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
}
