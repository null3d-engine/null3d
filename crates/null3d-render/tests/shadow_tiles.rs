//! The shadow atlas of point and spot lights on both frame builders: which lights get tiles, and
//! which tiles draw in each frame. A still scene draws no tile, and a caster that moves draws only
//! the tiles of the lights within its reach. Checked through the mock backend, which rejects what
//! a real GPU would, and by decoding the lists the builders record.

mod common;

use common::{World, count};
use null3d_core::lights::LightTable;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{NO_TARGET, Op, format, view};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::shadow_tiles::{ShadowTiles, TileSettings};
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
}

impl Tiles for GpuDrivenRenderer {
    fn tiles(&self) -> &ShadowTiles {
        self.shadow_tiles()
    }
}

impl Tiles for CpuCulledRenderer {
    fn tiles(&self) -> &ShadowTiles {
        self.shadow_tiles()
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

    // A still frame draws no tile.
    let still = step(&mut world, &mut mock, false);
    assert_eq!(world.renderer.tiles().drawn(), 0);
    assert_eq!(depth_passes(&still), 0);

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
    let commands = step(&mut world, &mut mock, true);
    // The camera's culling dispatch and the tile's, and two bundles run: the camera's and the
    // tile's.
    assert_eq!(count(&commands, Op::Dispatch), 2);
    assert_eq!(count(&commands, Op::ExecuteBundles), 2);
    let still = step(&mut world, &mut mock, false);
    assert_eq!(count(&still, Op::Dispatch), 1);
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
