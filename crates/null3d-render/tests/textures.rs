//! Materials with maps, drawn by both frame builders: the maps' arrays, uploads and bind groups
//! in the frame's list, checked through the mock backend, which rejects what a real GPU would.

mod common;

use common::{World, count, map_desc};
use null3d_gpu::drawlist::{Op, compare, layout, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::Shading;

/// The size of the maps of the test's textures.
const SIZE: u32 = 16;

/// The material table, whose rows hold the layer of each map: the resource that a list's frame
/// groups bind at binding 1, a buffer on WebGPU and a texture on WebGL2.
fn material_table(commands: &[(Op, Vec<u32>)]) -> u32 {
    let (_, frame_group) = commands
        .iter()
        .find(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::FRAME)
        .expect("the first frame makes the frame group");
    let entry = frame_group[3..]
        .chunks(5)
        .find(|entry| entry[0] == 1)
        .expect("the material table is binding 1");
    entry[2]
}

/// The writes of the material table in a frame's list, by `op`: `WriteBuffer` on WebGPU,
/// `WriteTexture` on WebGL2.
fn table_writes(commands: &[(Op, Vec<u32>)], op: Op, table: u32) -> usize {
    commands
        .iter()
        .filter(|(o, words)| *o == op && words[0] == table)
        .count()
}

/// Each `SetBindGroup` of group index `group` with its bind group id.
fn binds(commands: &[(Op, Vec<u32>)], group: u32) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::SetBindGroup && o[0] == group)
        .map(|(_, o)| o[1])
        .collect()
}

#[test]
fn a_mapped_material_draws_its_layer_once_the_image_is_on_the_gpu_on_webgpu() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (first, _, _) = world.add_mapped(SIZE);
    let (second, _, _) = world.add_mapped(SIZE);
    let commands = world.step(&mut mock, true);
    let maps = material_table(&commands);
    assert_eq!(
        table_writes(&commands, Op::WriteBuffer, maps),
        1,
        "no map is ready"
    );
    assert_eq!(
        commands
            .iter()
            .filter(
                |(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::INSTANCED_UNLIT_MAP
            )
            .map(|(_, o)| o[7])
            .collect::<Vec<_>>(),
        [vertex::UV0]
    );
    // Both textures share an array and a sampler, so both buckets bind one group, once.
    let store = world.renderer.settings().textures();
    let group = store.group_id(first).unwrap();
    assert_eq!(store.group_id(second), Some(group));
    assert_eq!(binds(&commands, 1), [group]);
    assert_eq!(count(&commands, Op::UploadImage), 0, "no image arrived yet");
    assert_eq!(store.ready_layer(first), None);

    world.arrive(&mut mock, 2, SIZE);
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::UploadImage), 2);
    assert_eq!(count(&commands, Op::GenerateMipmaps), 2);
    assert_eq!(
        table_writes(&commands, Op::WriteBuffer, maps),
        1,
        "the material table names both layers"
    );
    let store = world.renderer.settings().textures();
    assert_eq!(store.ready_layer(first), Some(0));
    assert_eq!(store.ready_layer(second), Some(1));
    assert_eq!(
        count(&commands, Op::BeginBundle),
        0,
        "the groups stay the same"
    );
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::UploadImage), 0);
    assert_eq!(
        table_writes(&commands, Op::WriteBuffer, maps),
        0,
        "a steady frame writes no maps"
    );
}

#[test]
fn an_array_that_grows_makes_its_group_again_and_webgpu_records_its_bundle_again() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    for _ in 0..4 {
        world.add_mapped(SIZE);
    }
    world.step(&mut mock, true);
    world.arrive(&mut mock, 4, SIZE);
    world.step(&mut mock, false);
    // A fifth texture of the size outgrows the array's four layers.
    world.add_mapped(SIZE);
    let commands = world.step(&mut mock, true);
    assert_eq!(
        count(&commands, Op::CopyTextureToTexture),
        5,
        "each mip level"
    );
    assert_eq!(
        count(&commands, Op::CreateBindGroup),
        1,
        "the group binds the new texture"
    );
    assert_eq!(count(&commands, Op::BeginBundle), 1);
    world.arrive(&mut mock, 5, SIZE);
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::UploadImage), 1);
    assert_eq!(count(&commands, Op::BeginBundle), 0);
    // Growing again with no new object makes the group again, so the bundle follows.
    let settings = world.renderer.settings_mut();
    for _ in 0..4 {
        let texture = settings.textures_mut().create(map_desc(SIZE)).unwrap();
        settings
            .textures_mut()
            .set_image(texture, SIZE, SIZE, 0)
            .unwrap();
    }
    let commands = world.step(&mut mock, false);
    assert_eq!(count(&commands, Op::CreateTexture), 1);
    assert_eq!(count(&commands, Op::BeginBundle), 1);
}

#[test]
fn webgl2_draws_bind_each_maps_group_once_per_run_on_both_draw_paths() {
    for multi_draw in [true, false] {
        let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        }));
        let mut mock = MockBackend::default();
        // Two sizes, so two arrays and two groups; the grids share one vertex page.
        let (small, _, _) = world.add_mapped(SIZE);
        let (large, _, _) = world.add_mapped(2 * SIZE);
        let (other_small, _, _) = world.add_mapped(SIZE);
        let commands = world.step(&mut mock, true);
        let maps = material_table(&commands);
        let store = world.renderer.settings().textures();
        let (a, b) = (
            store.group_id(small).unwrap(),
            store.group_id(large).unwrap(),
        );
        assert_ne!(a, b);
        assert_eq!(store.group_id(other_small), Some(a));
        assert_eq!(binds(&commands, 3), [a, b], "multi-draw {multi_draw}");
        // Every object draws in each replay: the world's four and the three grids.
        assert_eq!(mock.draws, 2 * (4 + 3), "multi-draw {multi_draw}");
        for image in 1..=3 {
            let size = if image == 2 { 2 * SIZE } else { SIZE };
            mock.provide_image(image, size, size);
        }
        let taken = world.frame - 1;
        world.renderer.settings_mut().textures_mut().sync(3, taken);
        let commands = world.step(&mut mock, false);
        assert_eq!(count(&commands, Op::UploadImage), 3);
        assert_eq!(table_writes(&commands, Op::WriteTexture, maps), 1);
    }
}

#[test]
fn a_material_whose_map_is_destroyed_draws_with_its_color_after_the_rebuild() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (texture, mesh, material) = world.add_mapped(SIZE);
    world.step(&mut mock, true);
    world.arrive(&mut mock, 1, SIZE);
    world.step(&mut mock, false);
    let settings = world.renderer.settings_mut();
    assert_eq!(
        settings.pipeline_of(mesh, material).unwrap().template,
        Shading::UnlitMap.template()
    );
    settings
        .textures_mut()
        .destroy(texture, world.frame)
        .unwrap();
    assert_eq!(
        settings.pipeline_of(mesh, material).unwrap().template,
        Shading::Unlit.template()
    );
    let commands = world.step(&mut mock, true);
    assert!(binds(&commands, 1).is_empty(), "no pipeline samples a map");
    assert_eq!(count(&commands, Op::DestroyTexture), 1);
    let store = world.renderer.settings().textures();
    assert_eq!(store.memory_bytes(), 0);
    assert_eq!(store.ready_layer(texture), None);
}

#[test]
fn after_a_gpu_reset_the_maps_upload_again_and_the_frame_replays_on_a_new_device() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (texture, _, _) = world.add_mapped(SIZE);
    world.step(&mut mock, true);
    world.arrive(&mut mock, 1, SIZE);
    world.step(&mut mock, false);
    // The thread that draws has not taken the frame that uploaded the image, so it still holds
    // the image, and the new device's first frame uploads it again.
    world.renderer.settings_mut().textures_mut().sync(1, 1);
    world.renderer.reset_gpu();
    let mut device = MockBackend::default();
    device.provide_image(1, SIZE, SIZE);
    let commands = world.step(&mut device, false);
    assert_eq!(count(&commands, Op::UploadImage), 1);
    // The map's sampler is made again, beside the shadow atlas's comparison sampler, the sampler
    // that reads the shadow map's texels, which compares nothing either, and the environment's
    // sampler.
    let samplers = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateSampler && o[9] == compare::NONE);
    assert_eq!(samplers.count(), 3);
    assert_eq!(
        world.renderer.settings().textures().ready_layer(texture),
        Some(0)
    );
}
