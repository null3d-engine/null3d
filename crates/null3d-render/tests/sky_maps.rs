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
/// The map's stages, the copy included, which the thread that draws plans apart from the levels,
/// for a map of `SIZE`, and the stages that the engine's built-in map has.
const STAGES: u32 = 9;
const SKY_STAGES: u32 = 20;

/// The stages that a frame records, each with its texture, its generator and its sun's position.
fn stages(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32, [f32; 3])> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::SkyMapStep)
        .map(|(_, o)| {
            assert_eq!(o.len(), 22, "a stage takes 22 words");
            assert_eq!(o[3], 0, "the analytic sky names no panorama");
            let sun = [4, 5, 6].map(|k| f32::from_bits(o[k]));
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
        sun_visibility: 1.0,
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

/// A point toward the sun `degrees` above the horizon, toward -Z, at a fixed distance.
fn sun_at(degrees: f32) -> [f32; 3] {
    let radians = degrees.to_radians();
    [0.0, radians.cos() * 1000.0, -radians.sin() * 1000.0]
}

/// A world whose sky map, faces `SIZE` texels wide and `count` stages long, has filled whole with
/// the sky of `sky`, and the map's texture and generator.
fn filled_map(
    world: &mut World,
    mock: &mut MockBackend,
    sky: Background,
    count: u32,
) -> (u32, u32) {
    world.step(mock, true);
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(sky));
    let settings = world.renderer.settings_mut();
    let cube = settings
        .textures_mut()
        .create_cube(SIZE, LEVELS, format::RGB9E5_UFLOAT)
        .unwrap();
    let generator = settings.textures_mut().set_generated(cube).unwrap();
    settings.sky_maps_mut().add(cube, count);
    let taken = world.frame - 1;
    mock.provide_generator(generator);
    world
        .renderer
        .settings_mut()
        .textures_mut()
        .sync(generator, taken);
    let commands = world.step(mock, false);
    assert_eq!(
        stages(&commands).len(),
        count as usize,
        "the map fills whole"
    );
    let id = world
        .renderer
        .settings()
        .textures()
        .ready_cube(cube)
        .expect("the map is ready")
        .0;
    (id, generator)
}

/// Records `count` frames with `world`'s sky as it is, and returns the stages that they recorded
/// between them.
fn run_frames(world: &mut World, mock: &mut MockBackend, count: usize) -> usize {
    (0..count)
        .map(|_| stages(&world.step(mock, false)).len())
        .sum()
}

#[test]
fn a_sky_map_redraws_only_for_a_sun_past_half_a_degree() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (id, generator) = filled_map(&mut world, &mut mock, sky(sun_at(45.0)), STAGES);

    // A sun that turns less than half a degree from the map's keeps its levels, frame after
    // frame, however far it drifts in all.
    let set = |world: &mut World, sun: [f32; 3]| {
        world
            .renderer
            .settings_mut()
            .set_background_source(Some(sky(sun)));
    };
    for degrees in [45.1, 45.2, 45.3, 45.4] {
        set(&mut world, sun_at(degrees));
        assert_eq!(
            run_frames(&mut world, &mut mock, 1),
            0,
            "a sun {degrees} degrees up redraws nothing"
        );
    }

    // A sun past half a degree from the map's starts a refresh at the map's own steps.
    set(&mut world, sun_at(45.6));
    let commands = world.step(&mut mock, false);
    assert_eq!(stages(&commands), [(id, generator, 0, sun_at(45.6))]);
    assert_eq!(
        run_frames(&mut world, &mut mock, STAGES as usize - 1),
        STAGES as usize - 1
    );
    // The map shows that sun now, so a still sky records nothing more.
    assert_eq!(run_frames(&mut world, &mut mock, 3), 0);

    // A sun that stops short of a step has its own exact capture once the sky comes to rest: the
    // first still frame starts it, and no frame after it draws again.
    set(&mut world, sun_at(45.7));
    assert_eq!(
        run_frames(&mut world, &mut mock, 1),
        0,
        "the move's own frame waits"
    );
    let commands = world.step(&mut mock, false);
    assert_eq!(
        stages(&commands),
        [(id, generator, 0, sun_at(45.7))],
        "the resting sky fills exactly"
    );
    assert_eq!(
        run_frames(&mut world, &mut mock, STAGES as usize - 1),
        STAGES as usize - 1,
        "the resting sky fills exactly"
    );
    assert_eq!(
        run_frames(&mut world, &mut mock, 2),
        0,
        "the map holds that sun"
    );

    // Clouds that drift by less than a tenth of their pattern's cell wait, however long they
    // take over it. Clouds have to cover the sky to drift at all.
    let cloudy = |time: f32| {
        let mut background = sky(sun_at(45.7));
        if let BackgroundSource::Sky(ref mut stars) = background.source {
            stars.cloud_coverage = 0.4;
            stars.time = time;
        }
        background
    };
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(cloudy(100.0)));
    assert_eq!(
        run_frames(&mut world, &mut mock, STAGES as usize),
        STAGES as usize,
        "a sky that gains clouds draws them"
    );
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(cloudy(101.0)));
    assert_eq!(run_frames(&mut world, &mut mock, 4), 0, "a second waits");
    // Ten seconds move them a fifth of a cell, which draws them again.
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(cloudy(110.0)));
    assert_eq!(
        run_frames(&mut world, &mut mock, 1),
        1,
        "a tenth of a cell draws again"
    );

    // A colour that drifts past a fiftieth redraws the map, at rest or not.
    let mut airier = sky(sun_at(45.7));
    if let BackgroundSource::Sky(ref mut stars) = airier.source {
        stars.turbidity *= 1.03;
    }
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(airier));
    assert_eq!(
        run_frames(&mut world, &mut mock, 1),
        1,
        "a 3% drift draws again"
    );
}

/// The frames of `count` that recorded a sky-map stage, for a sun that rises `degrees` a frame,
/// with clouds that drift in every frame, as a sketch that writes its sky in every frame does.
/// `clouds` gives the sky clouds.
fn day_frames(count: usize, degrees: f32, clouds: bool) -> usize {
    let at = |frame: usize| {
        let mut background = sky(sun_at(degrees * frame as f32));
        if let BackgroundSource::Sky(ref mut stars) = background.source {
            stars.cloud_coverage = if clouds { 0.4 } else { 0.0 };
            stars.time = frame as f32 / 60.0;
        }
        background
    };
    let mut world = World::new();
    let mut mock = MockBackend::default();
    filled_map(&mut world, &mut mock, at(0), SKY_STAGES);
    (1..=count)
        .map(|frame| {
            world
                .renderer
                .settings_mut()
                .set_background_source(Some(at(frame)));
            usize::from(!stages(&world.step(&mut mock, false)).is_empty())
        })
        .sum()
}

#[test]
fn a_day_cycle_draws_the_sky_map_only_for_the_frames_its_sun_steps() {
    // Ten seconds of a ten-minute day, which turns 0.01 degrees a frame: the map draws for a step
    // of half a degree, about two frames in five. The same ten seconds before the threshold drew
    // in every frame that the sun moved.
    let drawn = day_frames(600, 0.01, true);
    assert!(
        (200..=240).contains(&drawn),
        "a ten-minute day drew {drawn} of 600 frames"
    );

    // A day of a minute turns 0.1 degrees a frame, so a step comes every five frames and the map
    // draws in every frame, as it did before the threshold.
    let drawn = day_frames(600, 0.1, false);
    assert!(drawn >= 590, "a one-minute day drew {drawn} of 600 frames");

    // A still sun draws only for the clouds' own step: once in these ten seconds.
    let drawn = day_frames(600, 0.0, true);
    assert!(drawn <= 40, "drifting clouds drew {drawn} of 600 frames");
}
