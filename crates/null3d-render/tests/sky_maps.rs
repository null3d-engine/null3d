//! Sky maps on both frame builders: environment maps of the scene's sky, which fill whole in the
//! frame after their generator arrived and then refresh one stage a frame whenever the sky
//! changes. Frames take the new diffuse light in the frame of the last stage, with the new levels.
//! Checked through the mock backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::drawlist::{Op, format, template};
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

/// The stage at which a map captures a layer's light: two stages before the copy, as a page places
/// it, so that the read lands before the levels that the copy publishes.
const CAPTURE: u32 = STAGES - 3;

/// The stages that a frame records, each with its texture, its generator and its sun's position.
fn stages(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32, [f32; 3])> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::SkyMapStep)
        .map(|(_, o)| {
            assert_eq!(o.len(), 29, "a stage takes 29 words");
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
    settings.sky_maps_mut().add(cube, STAGES, CAPTURE);
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
    settings.sky_maps_mut().add(cube, count, CAPTURE);
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
    // Half a minute at 60 frames a second, which a day cycle draws the map over for each sun
    // speed below. A fill takes 20 frames, one stage a frame, so a minute holds twice the fills
    // that a half minute drew.
    const FRAMES: usize = 1_800;
    // Each case gives the sun's turn in degrees a frame, whether the clouds drift, and the frames
    // that may draw a stage. A ten-minute day turns a hundredth of a degree a frame, so its steps
    // hold the map at about two frames in five, and the same frames passed before the rule drew
    // every one of them. A day that a fill cannot keep up with draws in every frame.
    let cases: [(&str, f32, bool, std::ops::RangeInclusive<usize>); 5] = [
        ("Still sun, clouds drifting", 0.0, true, 80..=160),
        ("An hour a day", 360.0 / 3_600.0 / 60.0, true, 80..=160),
        ("A ten-minute day", 0.01, true, 600..=720),
        (
            "The showcase's 80-second day",
            360.0 / 80.0 / 60.0,
            false,
            1_770..=FRAMES,
        ),
        ("A day a minute", 0.1, false, 1_770..=FRAMES),
    ];
    let mut report = String::new();
    for (name, degrees, clouds, expected) in cases {
        let drawn = day_frames(FRAMES, degrees, clouds);
        // The fills a minute follow from the half minute counted: one fill every 20 frames.
        report.push_str(&format!(
            "{name}: {drawn} of {FRAMES} frames drew a stage, {} fills a minute\n",
            drawn / 10
        ));
        assert!(
            expected.contains(&drawn),
            "{name} drew {drawn} of {FRAMES} frames, outside {expected:?}"
        );
    }
    println!("sky map fills, at 60 frames a second:\n{report}");
}

/// The words of each stage that a frame recorded.
fn stage_words(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::SkyMapStep)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The stages that `count` frames record between them.
fn stages_in(world: &mut World, mock: &mut MockBackend, count: usize) -> usize {
    (0..count).map(|_| stages(&step(world, mock)).len()).sum()
}

/// Steps a frame, and finishes the reads that it left in flight, as the thread that draws does when
/// it raises their slots a frame or two later.
fn step(world: &mut World, mock: &mut MockBackend) -> Vec<(Op, Vec<u32>)> {
    let commands = world.step(mock, false);
    mock.finish_reads();
    commands
}

/// The stages of each recorded frame, by the stage that each command names.
fn stage_number(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::SkyMapStep)
        .map(|(_, o)| o[2])
        .collect()
}

/// Runs frames until the map starts no fill for longer than a layer's grace, which spends the
/// fills that a layer whose light never lands makes. Without a GPU, no capture lands, so every test
/// of a layer's values spends them first.
fn settle_with_layer(world: &mut World, mock: &mut MockBackend) {
    let mut quiet = 0;
    let mut frames = 0;
    while quiet <= LAYER_GRACE as usize && frames < 200 {
        let stages = stage_number(&step(world, mock));
        quiet = if stages.is_empty() { quiet + 1 } else { 0 };
        frames += 1;
    }
}

/// The fills that a map makes for a layer whose light never lands, and the quiet frames between
/// them, as `SkyMaps` counts them.
const LAYER_RETRIES: u8 = 3;
const LAYER_GRACE: u8 = 4;

/// The words of a stage's command that name the layer's build of the map's shader, the first of its
/// values, and the buffer that a light capture lands in, as `SkyMaps` lays them out.
const LAYER_WORD: usize = 20;
const LAYER_VALUES: usize = 21;
const LIGHT_BUFFER_WORD: usize = 28;

/// The layer's four cloud values, the share of the sun that it hides, its opacity and its clock,
/// from the words of a stage's command.
fn layer_values(words: &[u32]) -> [f32; 7] {
    std::array::from_fn(|k| f32::from_bits(words[LAYER_VALUES + k]))
}

/// A layer over the test's sky, with the templates that its compiled WGSL would take.
fn layer(template: u32, map: u32, refresh: f32) -> null3d_render::background::SkyLayer {
    null3d_render::background::SkyLayer {
        template,
        map,
        opacity: 0.75,
        sun: 0.25,
        refresh,
    }
}

/// The sky of the test with its clock at `time`.
fn sky_at(time: f32) -> Background {
    let mut background = sky(sun_at(45.0));
    if let BackgroundSource::Sky(ref mut values) = background.source {
        values.time = time;
    }
    background
}

/// Sets the frame's clock, which a layer over the sky moves with.
fn set_clock(world: &mut World, time: f32) {
    let frame = world.frame;
    world
        .renderer
        .settings_mut()
        .set_clock(time, 1.0 / 60.0, frame);
}

#[test]
fn a_sky_layer_fills_the_map_with_itself_and_captures_its_light() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    filled_map(&mut world, &mut mock, sky(sun_at(45.0)), STAGES);
    // A steady sky with no layer records no stage.
    assert_eq!(stages_in(&mut world, &mut mock, 2), 0);

    // The layer arrives: the map fills again from its first stage, drawing the sky with the layer's
    // own build of the map's shader, and with the core sky's clouds and the layer's values.
    world.renderer.settings_mut().set_sky_layer(
        Some(layer(
            template::CUSTOM_FIRST,
            template::CUSTOM_FIRST + 1,
            0.0,
        )),
        7,
    );
    let commands = step(&mut world, &mut mock);
    let stages = stage_words(&commands);
    assert_eq!(stages.len(), 1, "the fill starts one stage");
    let words = &stages[0];
    assert_eq!(words[2], 0);
    assert_eq!(words[LAYER_WORD], template::CUSTOM_FIRST + 1);
    let shown = Sky {
        sun_position: sun_at(45.0),
        cloud_coverage: 0.0,
        ..Sky::default()
    };
    assert_eq!(
        layer_values(words),
        [
            shown.cloud_coverage,
            shown.cloud_density,
            shown.cloud_elevation,
            shown.cloud_scale,
            0.25,
            0.75,
            0.0,
        ],
        "the sky's clouds, the sun's share, the opacity and the clock"
    );
    assert_eq!(
        words[LIGHT_BUFFER_WORD], 0,
        "the first stage captures nothing"
    );

    // The fill runs a stage a frame. The stage that the page named captures the map's own light: it
    // names a buffer of the ring, and the read of that buffer into engine memory follows it. The
    // capture comes before the copy, so the light is ready by the frame the levels publish.
    for stage in 1..STAGES {
        let commands = step(&mut world, &mut mock);
        let stages = stage_words(&commands);
        assert_eq!(stages.len(), 1, "stage {stage}");
        assert_eq!(stages[0][2], stage);
        assert_eq!(stages[0][LAYER_WORD], template::CUSTOM_FIRST + 1);
        if stage != CAPTURE {
            assert_eq!(
                stages[0][LIGHT_BUFFER_WORD], 0,
                "stage {stage} captures nothing"
            );
            continue;
        }
        let capture = stages[0][LIGHT_BUFFER_WORD];
        assert_ne!(capture, 0, "the capture stage takes a buffer of the ring");
        let read = commands
            .iter()
            .find(|(op, _)| *op == Op::ReadBuffer)
            .map(|(_, o)| o.clone())
            .expect("the capture reads its buffer back");
        assert_eq!(read[0], capture, "the read names the capture's buffer");
        assert_eq!(read[1..3], [0, 256], "the row of a light capture");
        assert_ne!(read[3], 0, "the coefficients land in engine memory");
        assert_eq!(read[4], 7, "at the slot that the page gave");
    }

    // Without a GPU the map's light never lands, so the map fills again for it, a grace of frames
    // apart, up to three times, and then holds the levels that it has.
    let mut retries = 0;
    let mut quiet = 0;
    while quiet <= (LAYER_GRACE as usize + STAGES as usize) && retries <= LAYER_RETRIES as usize {
        let stages = stage_number(&step(&mut world, &mut mock));
        retries += stages.iter().filter(|stage| **stage == 0).count();
        quiet = if stages.is_empty() { quiet + 1 } else { 0 };
    }
    assert!(
        (1..=LAYER_RETRIES as usize).contains(&retries),
        "the map retried {retries} times"
    );
    assert_eq!(stages_in(&mut world, &mut mock, 8), 0, "and then holds");

    // A layer that stands still and keeps its values owes no stage, however the sky is set again.
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(sky_at(0.0)));
    world.renderer.settings_mut().set_sky_layer(
        Some(layer(
            template::CUSTOM_FIRST,
            template::CUSTOM_FIRST + 1,
            0.0,
        )),
        7,
    );
    assert_eq!(stages_in(&mut world, &mut mock, STAGES as usize), 0);

    // Removing the layer fills the map again, and its stages draw the sky without it.
    world.renderer.settings_mut().set_sky_layer(None, 7);
    let commands = step(&mut world, &mut mock);
    let stages = stage_words(&commands);
    assert_eq!(stages.len(), 1);
    assert_eq!(stages[0][LAYER_WORD], 0, "the map draws no layer");
    assert_eq!(
        stages_in(&mut world, &mut mock, STAGES as usize - 1),
        STAGES as usize - 1
    );
}

#[test]
fn a_moving_sky_layer_fills_the_map_at_its_refresh() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    filled_map(&mut world, &mut mock, sky(sun_at(45.0)), STAGES);
    world.renderer.settings_mut().set_sky_layer(
        Some(layer(
            template::CUSTOM_FIRST,
            template::CUSTOM_FIRST + 1,
            0.5,
        )),
        7,
    );
    // The install fills the map, a stage a frame, and then the fills that a layer's light which
    // never lands makes, which a GPU would stop.
    assert_eq!(
        stages_in(&mut world, &mut mock, STAGES as usize),
        STAGES as usize
    );
    settle_with_layer(&mut world, &mut mock);

    // A clock that stands still holds the map.
    assert_eq!(stages_in(&mut world, &mut mock, 4), 0);

    // The clock moves by less than the layer asks: the map keeps its levels.
    set_clock(&mut world, 0.3);
    assert_eq!(stages_in(&mut world, &mut mock, 4), 0);

    // The clock moves past the layer's refresh: the map fills again.
    set_clock(&mut world, 0.6);
    assert_eq!(
        stages_in(&mut world, &mut mock, 1),
        1,
        "the layer's step refills"
    );

    // A layer that asks to be captured faster than a fill takes gets another fill as soon as the
    // last one ends: the engine never holds a moving layer back to the map's pace.
    settle_with_layer(&mut world, &mut mock);
    world.renderer.settings_mut().set_sky_layer(
        Some(layer(
            template::CUSTOM_FIRST,
            template::CUSTOM_FIRST + 1,
            0.016,
        )),
        7,
    );
    // The layer's values changed, so a fill starts at once; then every frame that follows a fill
    // starts the next, because the clock has moved a frame's worth.
    let mut fills = 0;
    let mut clock = 0.6;
    for _ in 0..(STAGES as usize * 2) {
        clock += 1.0 / 60.0;
        set_clock(&mut world, clock);
        fills += stage_number(&step(&mut world, &mut mock))
            .iter()
            .filter(|stage| **stage == 0)
            .count();
    }
    assert_eq!(fills, 2, "the map fills again as soon as each fill ends");
}
