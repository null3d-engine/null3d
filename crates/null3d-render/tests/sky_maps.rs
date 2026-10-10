//! Sky maps on both frame builders: environment maps of the scene's sky, which fill whole in the
//! frame after their generator arrived and then refresh one stage a frame whenever the sky
//! changes. Frames take the new diffuse light in the frame of the last stage, with the new levels.
//! Checked through the mock backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::drawlist::{Op, format};
use null3d_gpu::mock::MockBackend;
use null3d_render::background::{Background, BackgroundSource, Sky};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::environment::{Environment, EnvironmentUniform};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::view::{ViewFrame, ViewId};

/// The width of the cube's largest faces, and its mip levels.
const SIZE: u32 = 16;
const LEVELS: u32 = 4;
/// The map's stages, the copy included, which the thread that draws plans apart from the levels.
const STAGES: u32 = 9;

/// The stages that a frame records, each with its texture, its generator and its sun's position.
fn stages(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32, [f32; 3])> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::SkyMapStep)
        .map(|(_, o)| {
            assert_eq!(o.len(), 19, "a stage takes 19 words");
            let sun = [3, 4, 5].map(|k| f32::from_bits(o[k]));
            (o[0], o[1], o[2], sun)
        })
        .collect()
}

/// The sky with its sun at `sun`.
fn sky(sun: [f32; 3]) -> Background {
    Background {
        source: BackgroundSource::Sky(Sky {
            sun_position: sun,
            cloud_coverage: 0.0,
            ..Sky::default()
        }),
        intensity: 1.0,
        blur: 0.0,
        rotation: [0.0; 3],
    }
}

fn check_sky_maps<B: FrameBuilder>(
    mut world: World<B>,
    frame_of: impl Fn(&B) -> Option<EnvironmentUniform>,
) {
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let noon = [0.0, 1.0, -0.2];
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(sky(noon)));
    let settings = world.renderer.settings_mut();
    let textures = settings.textures_mut();
    let cube = textures
        .create_cube(SIZE, LEVELS, format::RGB9E5_UFLOAT)
        .unwrap();
    let generator = textures.set_generated(cube).unwrap();
    settings.sky_maps_mut().add(cube, STAGES);
    settings.set_environment(Some(Environment {
        texture: cube,
        intensity: 1.0,
        rotation: [0.0; 3],
        sh: [[0.0; 3]; 9],
    }));

    // Until the thread that draws holds the generator, the map records nothing.
    let commands = world.step(&mut mock, false);
    assert!(stages(&commands).is_empty());

    // The first frame after the generator arrived runs it, then every stage of the map, in order,
    // so that frame draws with the whole map and its diffuse light.
    mock.provide_generator(generator);
    let taken = world.frame - 1;
    world
        .renderer
        .settings_mut()
        .textures_mut()
        .sync(generator, taken);
    let commands = world.step(&mut mock, false);
    let (id, _) = world
        .renderer
        .settings()
        .textures()
        .ready_cube(cube)
        .expect("the map is ready");
    let generated = commands
        .iter()
        .position(|(op, _)| *op == Op::GenerateTexture)
        .expect("the generator runs first");
    let first_stage = commands
        .iter()
        .position(|(op, _)| *op == Op::SkyMapStep)
        .unwrap();
    assert!(generated < first_stage);
    let all: Vec<_> = (0..STAGES)
        .map(|stage| (id, generator, stage, noon))
        .collect();
    assert_eq!(stages(&commands), all);
    let lit = frame_of(&world.renderer).expect("the camera's view draws");
    let noon_light = lit.sh;
    assert!(
        noon_light[0][2] > 0.0,
        "the frame takes the sky's diffuse light"
    );

    // A steady sky records no stage.
    assert!(stages(&world.step(&mut mock, false)).is_empty());

    // A sun that moves refreshes the map one stage a frame. Frames draw with the old diffuse
    // light until the frame of the last stage, which takes the new one with the new levels.
    let low = [0.0, 0.1, -1.0];
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(sky(low)));
    for stage in 0..STAGES {
        if stage == 2 {
            // A change during the refresh waits for it to end.
            world
                .renderer
                .settings_mut()
                .set_background_source(Some(sky(noon)));
        }
        let commands = world.step(&mut mock, false);
        assert_eq!(stages(&commands), [(id, generator, stage, low)]);
        let light = frame_of(&world.renderer).unwrap().sh;
        if stage < STAGES - 1 {
            assert_eq!(light, noon_light, "stage {stage} keeps the old light");
        } else {
            assert_ne!(light, noon_light, "the last stage takes the new light");
        }
    }
    // The change that came during the refresh starts the next one.
    let commands = world.step(&mut mock, false);
    assert_eq!(stages(&commands), [(id, generator, 0, noon)]);
    for _ in 1..STAGES {
        world.step(&mut mock, false);
    }
    assert_eq!(frame_of(&world.renderer).unwrap().sh, noon_light);
    assert!(stages(&world.step(&mut mock, false)).is_empty());

    // A new GPU device fills the map whole again in its first frame.
    world.renderer.reset_gpu();
    let mut fresh = MockBackend::default();
    fresh.provide_generator(generator);
    let commands = world.step(&mut fresh, true);
    assert_eq!(stages(&commands).len(), STAGES as usize);

    // A destroyed map records nothing more.
    let frame = world.frame;
    world
        .renderer
        .settings_mut()
        .textures_mut()
        .destroy(cube, frame)
        .unwrap();
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(sky(low)));
    assert!(stages(&world.step(&mut fresh, true)).is_empty());
    assert!(
        world.renderer.settings().sky_maps().sh(cube).is_none(),
        "the store forgets the destroyed map"
    );
}

fn camera_environment(frame: Option<&ViewFrame>) -> Option<EnvironmentUniform> {
    frame.map(|frame| frame.uniform.environment)
}

#[test]
fn a_sky_map_fills_whole_then_refreshes_one_stage_a_frame() {
    check_sky_maps(World::new(), |r: &GpuDrivenRenderer| {
        camera_environment(r.view_frame(ViewId::CAMERA))
    });
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    check_sky_maps(webgl2, |r: &CpuCulledRenderer| {
        camera_environment(r.view_frame(ViewId::CAMERA))
    });
}
