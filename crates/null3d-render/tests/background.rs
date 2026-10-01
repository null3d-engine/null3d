//! Texture backgrounds, drawn by both frame builders: the background's pipeline, and its draw at
//! the start of the camera's opaque pass once the texture's texels are on the GPU, checked through
//! the mock backend, which rejects what a real GPU would.

mod common;

use common::{World, count, map_desc};
use null3d_core::handle::Handle;
use null3d_gpu::drawlist::{Op, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;

/// The size of the test's textures.
const SIZE: u32 = 16;

/// Makes a texture of the test's size with an image on its way, the scene's background.
fn add_background<B: FrameBuilder>(world: &mut World<B>) -> Handle {
    let settings = world.renderer.settings_mut();
    let textures = settings.textures_mut();
    let texture = textures.create(map_desc(SIZE)).unwrap();
    textures.set_image(texture, SIZE, SIZE, 0).unwrap();
    settings.set_background_texture(texture);
    texture
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
        .expect("the background binds its texture's group");
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
        world.renderer.settings().background_texture(),
        texture,
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
    world
        .renderer
        .settings_mut()
        .set_background_texture(Handle::NONE);
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
