//! The scene's environment on both frame builders: a cube texture of the texture store, which the
//! camera views' frame groups bind once its texels are on the GPU, with its values in the frame
//! uniform, and a blank cube before and after. Checked through the mock backend and by decoding
//! the lists the builders record.

mod common;

use common::World;
use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{Op, format, layout, view};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::environment::{Environment, EnvironmentUniform};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::GpuDrivenRenderer;
use null3d_render::view::{ViewFrame, ViewId};

/// The width of the cube's largest faces.
const SIZE: u32 = 16;
/// Its mip levels, down to faces of 2 texels.
const LEVELS: u32 = 4;
/// The binding of the environment's cube texture in the frame's group.
const MAP_BINDING: u32 = 12;

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The cube textures that the frame groups that a frame makes bind, one per group.
fn bound_maps(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    operands(commands, Op::CreateBindGroup)
        .into_iter()
        .filter(|o| o[1] == layout::FRAME)
        .filter_map(|o| Some(o[3..].chunks(5).find(|e| e[0] == MAP_BINDING)?[2]))
        .collect()
}

/// An environment whose diffuse light is a constant gray, turned a quarter turn about +Y.
fn environment(texture: Handle) -> Environment {
    let mut sh = [[0.0; 3]; 9];
    sh[0] = [0.5; 3];
    Environment {
        texture,
        intensity: 0.75,
        rotation: [0.0, std::f32::consts::FRAC_PI_2, 0.0],
        sh,
    }
}

fn check_environment<B: FrameBuilder>(
    mut world: World<B>,
    frame_of: impl Fn(&B) -> Option<EnvironmentUniform>,
) {
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let maps = bound_maps(&first);
    let blank = *maps
        .first()
        .expect("the first frame binds a cube in its frame groups");
    assert!(maps.iter().all(|&map| map == blank));
    let made = operands(&first, Op::CreateTexture);
    let blank_made = made.iter().find(|o| o[0] == blank).unwrap();
    assert_eq!(
        (blank_made[1], blank_made[2], blank_made[3], blank_made[8]),
        (1, 1, 6, view::CUBE)
    );
    assert_eq!(
        frame_of(&world.renderer),
        Some(EnvironmentUniform::default())
    );

    // The cube's texels go into engine memory, every level's six faces, and the next frame makes
    // its texture, writes each face of each level, and binds it, as the uploads come before the
    // frame groups read it.
    let textures = world.renderer.settings_mut().textures_mut();
    let cube = textures
        .create_cube(SIZE, LEVELS, format::RGB9E5_UFLOAT)
        .unwrap();
    assert_eq!(textures.group_id(cube), None, "a cube has no 2D group");
    let (texels, _) = textures.set_data(cube, SIZE, SIZE).unwrap();
    let words: u32 = (0..LEVELS).map(|level| 6 * (SIZE >> level).pow(2)).sum();
    assert_eq!(texels.len(), words as usize);
    texels.fill(0x7c00_4020);
    textures.upload_all_next_frame();
    world
        .renderer
        .settings_mut()
        .set_environment(Some(environment(cube)));
    let commands = world.step(&mut mock, false);
    let made = operands(&commands, Op::CreateTexture);
    let [map] = &made[..] else {
        panic!("one texture: {made:?}");
    };
    assert_eq!(
        (map[1], map[2], map[3], map[4], map[7], map[8]),
        (SIZE, SIZE, 6, format::RGB9E5_UFLOAT, LEVELS, view::CUBE)
    );
    let writes: Vec<(u32, u32)> = operands(&commands, Op::WriteTexture)
        .iter()
        .filter(|o| o[0] == map[0])
        .map(|o| (o[1], o[4]))
        .collect();
    let expected: Vec<(u32, u32)> = (0..LEVELS)
        .flat_map(|level| (0..6).map(move |face| (level, face)))
        .collect();
    assert_eq!(writes, expected);
    let maps = bound_maps(&commands);
    assert!(!maps.is_empty() && maps.iter().all(|&m| m == map[0]));
    let uniform = frame_of(&world.renderer).expect("the camera's view draws");
    assert_eq!(uniform.params, [(LEVELS - 1) as f32, 0.75, 1.0, 0.0]);
    assert_eq!(uniform.sh[0], [0.5, 0.5, 0.5, 0.0]);
    // The inverse of a quarter turn about +Y reads the map's +X for a surface that faces -Z.
    let z_row: Vec<f32> = uniform.rotation.iter().map(|row| row[2]).collect();
    assert!((z_row[0] + 1.0).abs() < 1e-6 && z_row[1].abs() < 1e-6);

    // A steady frame binds nothing new.
    assert!(bound_maps(&world.step(&mut mock, false)).is_empty());

    // A destroyed map lights nothing: the groups bind the blank cube again.
    let frame = world.frame;
    let textures = world.renderer.settings_mut().textures_mut();
    textures.destroy(cube, frame).unwrap();
    let commands = world.step(&mut mock, true);
    let maps = bound_maps(&commands);
    assert!(!maps.is_empty() && maps.iter().all(|&m| m == blank));
    assert_eq!(
        frame_of(&world.renderer),
        Some(EnvironmentUniform::default())
    );
}

fn camera_environment(frame: Option<&ViewFrame>) -> Option<EnvironmentUniform> {
    frame.map(|frame| frame.uniform.environment)
}

#[test]
fn an_environment_binds_once_its_texels_are_up_and_until_it_is_destroyed() {
    check_environment(World::new(), |r: &GpuDrivenRenderer| {
        camera_environment(r.view_frame(ViewId::CAMERA))
    });
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    check_environment(webgl2, |r: &CpuCulledRenderer| {
        camera_environment(r.view_frame(ViewId::CAMERA))
    });
}

#[test]
fn a_cube_takes_only_its_float_formats_and_no_images() {
    let mut world = World::new();
    let textures = world.renderer.settings_mut().textures_mut();
    assert!(
        textures
            .create_cube(4096, 1, format::RGB9E5_UFLOAT)
            .is_err()
    );
    assert!(textures.create_cube(16, 1, format::RGBA8_UNORM).is_err());
    assert!(textures.create_cube(16, 6, format::RGBA16_FLOAT).is_err());
    let cube = textures.create_cube(16, 5, format::RGBA16_FLOAT).unwrap();
    assert!(textures.set_image(cube, 16, 16, 0).is_err());
    assert!(
        textures.set_generated(cube).is_err(),
        "generators fill rgb9e5ufloat cubes"
    );
    assert_eq!(textures.ready_cube(cube), None);
}

#[test]
fn a_generated_cube_fills_once_its_generator_arrived_and_again_on_a_new_device() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let textures = world.renderer.settings_mut().textures_mut();
    let cube = textures
        .create_cube(SIZE, LEVELS, format::RGB9E5_UFLOAT)
        .unwrap();
    let generator = textures.set_generated(cube).unwrap();
    assert_eq!(generator, 1, "a generator takes the next image id");
    world
        .renderer
        .settings_mut()
        .set_environment(Some(environment(cube)));

    // Until the thread that draws holds the generator, the cube waits and lights nothing.
    let commands = world.step(&mut mock, false);
    assert!(operands(&commands, Op::GenerateTexture).is_empty());
    let textures = world.renderer.settings_mut().textures_mut();
    assert_eq!(textures.ready_cube(cube), None);

    // Then one command fills every level, with no texel writes, and the frame groups bind it.
    mock.provide_generator(generator);
    let taken = world.frame - 1;
    textures.sync(generator, taken);
    let commands = world.step(&mut mock, false);
    let textures = world.renderer.settings_mut().textures_mut();
    let (id, levels) = textures.ready_cube(cube).expect("the cube is ready");
    assert_eq!(levels, LEVELS);
    assert_eq!(
        operands(&commands, Op::GenerateTexture),
        [vec![id, generator]]
    );
    assert!(operands(&commands, Op::WriteTexture).is_empty());
    assert!(operands(&commands, Op::ReleaseImage).is_empty());
    let maps = bound_maps(&commands);
    assert!(!maps.is_empty() && maps.iter().all(|&m| m == id));
    assert!(
        operands(&world.step(&mut mock, false), Op::GenerateTexture).is_empty(),
        "a steady frame fills nothing"
    );

    // A new GPU device fills the cube again from the generator that the store kept.
    world.renderer.reset_gpu();
    let mut fresh = MockBackend::default();
    fresh.provide_generator(generator);
    let commands = world.step(&mut fresh, true);
    assert_eq!(
        operands(&commands, Op::GenerateTexture),
        [vec![id, generator]]
    );

    // Destroying the cube releases its generator.
    let frame = world.frame;
    let textures = world.renderer.settings_mut().textures_mut();
    textures.destroy(cube, frame).unwrap();
    let commands = world.step(&mut fresh, true);
    assert_eq!(operands(&commands, Op::ReleaseImage), [vec![generator]]);
}
