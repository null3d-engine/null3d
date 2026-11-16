//! The physical sky on both frame builders (D-143): its tables draw once, and again only when what
//! they hold changes; the background draws once every table holds the frame's sky; a scene
//! without it records nothing of it; the aerial perspective's values reach the frame's block; and
//! with the quality setting off, the analytic sky stands in. Checked through the mock backend,
//! which rejects what a real GPU would, and by decoding the lists the builders record.

mod common;

use common::{World, count};
use null3d_gpu::drawlist::{Op, format, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::background::{Background, BackgroundSource};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::physical_sky::Atmosphere;
use null3d_render::view::ViewId;

/// The physical sky as the scene's background, with `atmosphere`'s settings.
fn physical(atmosphere: Atmosphere) -> Option<Background> {
    Some(Background {
        source: BackgroundSource::Atmosphere(atmosphere),
        intensity: 1.0,
        blur: 0.0,
        rotation: [0.0; 3],
        sun_visibility: 1.0,
    })
}

/// The ids of the pipelines of `template` that a frame's list creates.
fn pipelines_of(commands: &[(Op, Vec<u32>)], template: u32) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template)
        .map(|(_, o)| o[0])
        .collect()
}

/// The steps that a frame's list draws with the tables' pipeline `pipeline`: each draw's first
/// vertex over three.
fn steps(commands: &[(Op, Vec<u32>)], pipeline: u32) -> Vec<u32> {
    let mut bound = false;
    let mut out = Vec::new();
    for (op, o) in commands {
        match op {
            Op::SetPipeline => bound = o[0] == pipeline,
            Op::Draw if bound => out.push(o[2] / 3),
            _ => {}
        }
    }
    out
}

/// True when the frame's list draws with pipeline `pipeline`.
fn draws_with(commands: &[(Op, Vec<u32>)], pipeline: u32) -> bool {
    commands
        .windows(2)
        .any(|w| w[0].0 == Op::SetPipeline && w[0].1[0] == pipeline)
}

fn the_tables_draw_only_when_they_change<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let commands = world.step(&mut mock, false);
    assert!(
        pipelines_of(&commands, template::SKY_TABLE).is_empty(),
        "a scene without the physical sky asks for none of its pipelines"
    );

    let mut atmosphere = Atmosphere::default();
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    let commands = world.step(&mut mock, false);
    let tables = pipelines_of(&commands, template::SKY_TABLE);
    let background = pipelines_of(&commands, template::BACKGROUND_ATMOSPHERE);
    assert_eq!((tables.len(), background.len()), (1, 1));
    let created = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateTexture && o[4] == format::RGBA16_FLOAT && o[3] == 1)
        .map(|(_, o)| (o[1], o[2]))
        .collect::<Vec<_>>();
    for size in [(256, 64), (32, 32), (256, 128), (512, 256)] {
        assert!(
            created.contains(&size),
            "the {size:?} table is made: {created:?}"
        );
    }
    assert_eq!(
        steps(&commands, tables[0]),
        [0, 1, 2],
        "every table draws, in order"
    );
    assert!(
        draws_with(&commands, background[0]),
        "the sky draws once its tables do"
    );

    // A still sky draws no table, and a moving sun draws only the sky view.
    let commands = world.step(&mut mock, false);
    assert!(steps(&commands, tables[0]).is_empty());
    assert!(draws_with(&commands, background[0]));
    atmosphere.sun_position = [0.3, 0.1, -1.0];
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    let commands = world.step(&mut mock, false);
    assert_eq!(steps(&commands, tables[0]), [2]);
    assert_eq!(
        count(&commands, Op::CreateTexture),
        0,
        "the tables are kept"
    );

    // Clouds drawn per pixel draw no table; new air draws them all.
    atmosphere.time = 5.0;
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    assert!(steps(&world.step(&mut mock, false), tables[0]).is_empty());
    atmosphere.haze = 3.0;
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    assert_eq!(steps(&world.step(&mut mock, false), tables[0]), [0, 1, 2]);
}

#[test]
fn the_tables_draw_only_when_they_change_on_webgpu() {
    the_tables_draw_only_when_they_change(World::new());
}

#[test]
fn the_tables_draw_only_when_they_change_on_webgl2() {
    the_tables_draw_only_when_they_change(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

fn the_sky_waits_for_its_tables<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(Atmosphere::default()));
    // The thread that draws has not built the frame's pipelines yet.
    world.pipelines_built = 1;
    let commands = world.step(&mut mock, false);
    let background = pipelines_of(&commands, template::BACKGROUND_ATMOSPHERE);
    let tables = pipelines_of(&commands, template::SKY_TABLE);
    assert!(steps(&commands, tables[0]).is_empty());
    assert!(
        !draws_with(&commands, background[0]),
        "the sky shows nothing until its tables are drawn"
    );
    world.pipelines_built = u32::MAX;
    let commands = world.step(&mut mock, false);
    assert_eq!(steps(&commands, tables[0]), [0, 1, 2]);
    assert!(draws_with(&commands, background[0]));
}

#[test]
fn the_sky_waits_for_its_tables_on_webgpu() {
    the_sky_waits_for_its_tables(World::new());
}

#[test]
fn the_sky_waits_for_its_tables_on_webgl2() {
    the_sky_waits_for_its_tables(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

#[test]
fn the_air_reaches_the_frame_block_and_the_analytic_sky_stands_in() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let aerial = |world: &World| {
        world
            .renderer
            .view_frame(ViewId::CAMERA)
            .unwrap()
            .uniform
            .aerial
    };
    assert_eq!(aerial(&world).moon_light[3], 0.0, "no physical sky, no air");
    let atmosphere = Atmosphere::default();
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    world.step(&mut mock, false);
    let air = aerial(&world);
    assert_eq!(air.moon_light[3], 1.0);
    assert!(air.rayleigh[2] > air.rayleigh[0], "blue scatters most");
    assert!(
        air.sun_light[0] > air.sun_light[2],
        "the sun reddens through the air"
    );

    // With the quality setting off, the analytic sky draws in its place, and the air stays.
    world.renderer.settings_mut().set_physical_sky(false);
    let commands = world.step(&mut mock, false);
    assert_eq!(pipelines_of(&commands, template::BACKGROUND_SKY).len(), 1);
    assert!(pipelines_of(&commands, template::SKY_TABLE).is_empty());
    assert_eq!(aerial(&world).moon_light[3], 1.0);
    match world.renderer.settings().background().map(|b| b.source) {
        Some(BackgroundSource::Sky(sky)) => {
            let sun = atmosphere.sun();
            let length = sky.sun_position.iter().map(|c| c * c).sum::<f32>().sqrt();
            assert!((sky.sun_position[1] / length - sun[1]).abs() < 1e-5);
        }
        other => panic!("the analytic sky stands in, not {other:?}"),
    }
    let intensity = world.renderer.settings().background().unwrap().intensity;
    assert!(
        intensity > 0.0 && intensity < 1.0,
        "matched brightness: {intensity}"
    );

    // Without the aerial perspective, the shaders skip it.
    let atmosphere = Atmosphere {
        aerial_perspective: 0.0,
        ..atmosphere
    };
    world
        .renderer
        .settings_mut()
        .set_background_source(physical(atmosphere));
    world.step(&mut mock, false);
    assert_eq!(aerial(&world).moon_light[3], 0.0);
}
