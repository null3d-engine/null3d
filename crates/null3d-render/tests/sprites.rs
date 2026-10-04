//! Sprite batches on both frame builders: their rows draw with the sprite template, blended ones
//! in the transparent pass, and sprites sized in pixels of the screen are never culled. Checked
//! through the mock backend, which rejects what a real GPU would.

mod common;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::sprites::SpriteLook;
use null3d_gpu::drawlist::{Op, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{Shading, feature};

/// The rows of each sprite batch.
const ROWS: u32 = 4;

/// Adds a dynamic batch of sprites on a quad with a sprite material of `features`, with every
/// sprite at `position`, and returns it.
fn add_sprites<B: FrameBuilder>(
    world: &mut World<B>,
    features: u32,
    screen_size: bool,
    position: [f32; 3],
) -> Handle {
    let settings = world.renderer.settings_mut();
    let quad = grid(1, 1);
    let mesh = settings.meshes_mut().add(&quad).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Sprite, features | feature::DOUBLE_SIDED, [1.0; 4])
        .unwrap()
        + 1;
    let look = SpriteLook::new(1, 1, screen_size);
    let batch = world
        .batches
        .create_sprites(ROWS, true, mesh, material, 0.75, look)
        .unwrap();
    let sprites = world.batches.get_mut(batch).unwrap();
    for at in sprites.positions_mut().as_chunks_mut::<3>().0 {
        *at = position;
    }
    batch
}

/// The template and state flags of each render pipeline that a list creates.
fn pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| (o[1], o[6]))
        .collect()
}

#[test]
fn sprites_draw_with_the_sprite_template_and_blended_ones_blend_on_both_paths() {
    let gpu = World::new();
    let cpu = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    fn check<B: FrameBuilder>(mut world: World<B>) {
        let mut mock = MockBackend::default();
        add_sprites(&mut world, 0, false, [0.0, 2.0, 0.0]);
        add_sprites(&mut world, feature::BLEND, false, [0.0, -2.0, 0.0]);
        let commands = world.step(&mut mock, true);
        let sprites: Vec<_> = pipelines(&commands)
            .into_iter()
            .filter(|&(t, _)| t == template::SPRITE)
            .collect();
        assert_eq!(sprites.len(), 2, "{sprites:?}");
        assert!(
            sprites
                .iter()
                .all(|&(_, s)| s & state_flags::CULL_NONE != 0)
        );
        let blended = sprites
            .iter()
            .filter(|&&(_, s)| s & state_flags::BLEND != 0);
        assert_eq!(blended.count(), 1);
    }
    check(gpu);
    check(cpu);
}

#[test]
fn sprites_sized_on_screen_are_never_culled_and_world_sized_ones_are() {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let before = world.renderer.visible_entries(world.frame - 1).unwrap();
    // Both batches stand far to the side of the camera's view.
    let aside = [500.0, 0.0, 0.0];
    add_sprites(&mut world, 0, false, aside);
    world.step(&mut mock, true);
    assert_eq!(
        world.renderer.visible_entries(world.frame - 1),
        Some(before)
    );
    add_sprites(&mut world, 0, true, aside);
    world.step(&mut mock, true);
    assert_eq!(
        world.renderer.visible_entries(world.frame - 1),
        Some(before + ROWS)
    );
}

#[test]
fn sprites_stay_out_of_the_depth_prepass() {
    let mut world = World::new();
    let sprites = add_sprites(&mut world, 0, false, [0.0; 3]);
    let batch = world.batches.get(sprites).unwrap();
    let key = world
        .renderer
        .settings()
        .pipeline_of(batch.mesh(), batch.material())
        .unwrap();
    assert_eq!(key.template, template::SPRITE);
    assert_eq!(key.prepass(), None);
}
