//! Backgrounds, drawn by both frame builders: the background's pipeline, and its draw at the start
//! of the camera's opaque pass once a texture's texels are on the GPU, for a texture, a cube map of
//! six images and the sky, checked through the mock backend, which rejects what a real GPU would.

mod common;

use common::{World, count, map_desc};
use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{Op, format, layout, sizes, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::background::{Background, BackgroundSource, Sky};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_view::DebugView;
use null3d_render::frame::FrameBuilder;

/// The size of the test's textures.
const SIZE: u32 = 16;

/// Makes a texture of the test's size with an image on its way, the scene's background.
fn add_background<B: FrameBuilder>(world: &mut World<B>) -> Handle {
    let settings = world.renderer.settings_mut();
    let textures = settings.textures_mut();
    let texture = textures.create(map_desc(SIZE)).unwrap();
    textures.set_image(texture, SIZE, SIZE, 0).unwrap();
    settings.set_background_source(Some(background(BackgroundSource::Texture(texture))));
    texture
}

/// A background of `source` at its defaults.
fn background(source: BackgroundSource) -> Background {
    Background {
        source,
        intensity: 1.0,
        blur: 0.0,
        rotation: [0.0; 3],
    }
}

/// The ids of the background pipelines that a frame's list creates. Each draws with no depth test.
fn background_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::BACKGROUND)
        .map(|(_, o)| {
            assert_eq!(o[6], state_flags::NO_DEPTH_TEST);
            o[0]
        })
        .collect()
}

/// The background's draw in a frame's list: the draw after `SetPipeline` of `pipeline`, with the
/// texture's group that it binds at index 1. Checks that it is the first draw of its render pass.
fn background_draw(commands: &[(Op, Vec<u32>)], pipeline: u32) -> Option<(u32, Vec<u32>)> {
    let set = commands
        .iter()
        .position(|(op, o)| *op == Op::SetPipeline && o[0] == pipeline)?;
    let pass = commands[..set]
        .iter()
        .rposition(|(op, _)| *op == Op::BeginRenderPass)
        .expect("the background draws inside a render pass");
    let draws = [
        Op::Draw,
        Op::DrawIndexed,
        Op::DrawIndexedIndirect,
        Op::MultiDrawIndexed,
        Op::ExecuteBundles,
    ];
    assert!(
        !commands[pass..set].iter().any(|(op, _)| draws.contains(op)),
        "the background draws before the pass's objects"
    );
    let after = &commands[set..];
    let group = after
        .iter()
        .find(|(op, o)| *op == Op::SetBindGroup && o[0] == 1)
        .map(|(_, o)| o[1])
        .expect("the background binds a group at index 1");
    let (_, draw) = after.iter().find(|(op, _)| *op == Op::Draw)?;
    Some((group, draw.clone()))
}

/// Steps a world that draws a background through its texture's life, on either frame builder.
fn draws_once_the_texels_are_on_the_gpu<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    let texture = add_background(&mut world);
    let commands = world.step(&mut mock, true);
    let pipelines = background_pipelines(&commands);
    assert_eq!(
        pipelines.len(),
        1,
        "the pipeline builds while the texture loads"
    );
    let pipeline = pipelines[0];
    assert_eq!(background_draw(&commands, pipeline), None, "no texels yet");

    world.arrive(&mut mock, 1, SIZE);
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::UploadImage), 1);
    assert!(background_pipelines(&commands).is_empty(), "made once");
    let store = world.renderer.settings().textures();
    let group = store.group_id(texture).unwrap();
    let layer = store.ready_layer(texture).unwrap();
    assert_eq!(
        background_draw(&commands, pipeline),
        Some((group, vec![3, 1, layer * 3, 0])),
        "one triangle, whose first vertex names the layer"
    );
    let draws = mock.draws;
    world.step(&mut mock, false);
    let with_background = mock.draws - draws;

    // Once the texture is destroyed, the view shows the background color.
    let settings = world.renderer.settings_mut();
    settings
        .textures_mut()
        .destroy(texture, world.frame)
        .unwrap();
    let draws = mock.draws;
    let commands = world.step(&mut mock, false);
    assert_eq!(background_draw(&commands, pipeline), None);
    assert_eq!(
        with_background - (mock.draws - draws),
        2,
        "each of the two replays drew the background once"
    );
    assert_eq!(
        world.renderer.settings().background(),
        Some(background(BackgroundSource::Texture(texture))),
        "the scene keeps its choice"
    );
}

#[test]
fn the_background_draws_once_its_texels_are_on_the_gpu_on_webgpu() {
    draws_once_the_texels_are_on_the_gpu(World::new());
}

#[test]
fn the_background_draws_once_its_texels_are_on_the_gpu_on_webgl2() {
    for multi_draw in [true, false] {
        draws_once_the_texels_are_on_the_gpu(World::build(CpuCulledRenderer::new(
            CpuCulledConfig {
                multi_draw,
                ..CpuCulledConfig::default()
            },
        )));
    }
}

#[test]
fn a_scene_without_a_background_texture_makes_no_background_pipeline() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let texture = add_background(&mut world);
    world.renderer.settings_mut().set_background_source(None);
    let commands = world.step(&mut mock, true);
    assert!(background_pipelines(&commands).is_empty());
    world.arrive(&mut mock, 1, SIZE);
    let commands = world.step(&mut mock, false);
    assert_eq!(
        count(&commands, Op::UploadImage),
        1,
        "the texture still uploads"
    );
    assert!(background_pipelines(&commands).is_empty());
    assert!(
        !commands
            .iter()
            .any(|(op, o)| *op == Op::Draw && o[0] == 3 && o[1] == 1),
        "no background draw"
    );
    assert!(world.renderer.settings().textures().is_live(texture));
}

/// The ids of the pipelines of `template` that a frame's list creates. Each draws both faces with
/// no depth test.
fn box_pipelines(commands: &[(Op, Vec<u32>)], template: u32) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template)
        .map(|(_, o)| {
            assert_eq!(o[6], state_flags::NO_DEPTH_TEST | state_flags::CULL_NONE);
            o[0]
        })
        .collect()
}

/// The uniform buffer that the background's group binds, from the frame that made the group.
fn values_buffer(commands: &[(Op, Vec<u32>)]) -> u32 {
    let (_, words) = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::BACKGROUND)
        .expect("the frame makes the background's group");
    assert_eq!(words[7], sizes::BACKGROUND_UNIFORM_BYTES);
    words[5]
}

/// The writes of the background's values into `buffer` in a frame's list.
fn value_writes(commands: &[(Op, Vec<u32>)], buffer: u32) -> usize {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::WriteBuffer && o[0] == buffer)
        .count()
}

/// Steps a world through a cube map of six images, then the sky, on either frame builder: each
/// draws the box around the camera with the background's own group, writes its values once, and
/// writes them again only when they change.
fn cube_maps_and_the_sky_draw_a_box<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    let settings = world.renderer.settings_mut();
    let textures = settings.textures_mut();
    let cube = textures
        .create_cube(SIZE, 1, format::RGBA8_UNORM_SRGB)
        .unwrap();
    assert_eq!(textures.set_cube_images(cube, 0).unwrap(), 1);
    settings.set_background_source(Some(background(BackgroundSource::Cubemap(cube))));
    let commands = world.step(&mut mock, true);
    let pipelines = box_pipelines(&commands, template::BACKGROUND_CUBE);
    assert_eq!(
        pipelines.len(),
        1,
        "the pipeline builds while the faces load"
    );
    assert_eq!(
        background_draw(&commands, pipelines[0]),
        None,
        "no texels yet"
    );

    world.arrive(&mut mock, 6, SIZE);
    let commands = world.step(&mut mock, false);
    let uploads: Vec<_> = commands
        .iter()
        .filter(|(op, _)| *op == Op::UploadImage)
        .map(|(_, o)| (o[4], o[7]))
        .collect();
    assert_eq!(
        uploads,
        (0..6).map(|face| (face, face + 1)).collect::<Vec<_>>(),
        "each face takes its own image"
    );
    let buffer = values_buffer(&commands);
    assert_eq!(value_writes(&commands, buffer), 1);
    let (_, draw) = background_draw(&commands, pipelines[0]).expect("the cube map draws");
    assert_eq!(draw, vec![36, 1, 0, 0], "a box of twelve triangles");

    // The faces' images go once the thread that draws took a later frame.
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::ReleaseImage), 6);
    assert_eq!(
        value_writes(&commands, buffer),
        0,
        "the same values are not written again"
    );

    // The sky needs no texture, and a change of its values writes them again.
    let mut sky = Sky::default();
    let settings = world.renderer.settings_mut();
    settings.set_background_source(Some(background(BackgroundSource::Sky(sky))));
    let commands = world.step(&mut mock, false);
    let pipelines = box_pipelines(&commands, template::BACKGROUND_SKY);
    assert_eq!(pipelines.len(), 1);
    assert!(background_draw(&commands, pipelines[0]).is_some());
    assert_eq!(
        count(&commands, Op::CreateBindGroup),
        1,
        "the group binds the blank cube"
    );
    assert_eq!(value_writes(&commands, buffer), 1);
    let commands = world.step(&mut mock, false);
    assert_eq!(value_writes(&commands, buffer), 0);
    sky.time = 2.0;
    world
        .renderer
        .settings_mut()
        .set_background_source(Some(background(BackgroundSource::Sky(sky))));
    let commands = world.step(&mut mock, false);
    assert_eq!(value_writes(&commands, buffer), 1, "the clouds moved");
    assert_eq!(count(&commands, Op::CreateBindGroup), 0);
}

#[test]
fn cube_maps_and_the_sky_draw_a_box_on_webgpu() {
    cube_maps_and_the_sky_draw_a_box(World::new());
}

#[test]
fn cube_maps_and_the_sky_draw_a_box_on_webgl2() {
    cube_maps_and_the_sky_draw_a_box(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

#[test]
fn a_debug_view_draws_no_background() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let settings = world.renderer.settings_mut();
    settings.set_background_source(Some(background(BackgroundSource::Sky(Sky::default()))));
    settings.set_debug_view(DebugView::Normals);
    let commands = world.step(&mut mock, true);
    assert!(box_pipelines(&commands, template::BACKGROUND_SKY).is_empty());
}
