//! Materials with maps, drawn by both frame builders: the maps' arrays, uploads and bind groups
//! in the frame's list, checked through the mock backend, which rejects what a real GPU would.

mod common;

use common::{World, count, map_desc};
use null3d_gpu::drawlist::{Op, layout, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::Shading;

/// The size of the maps of the test's textures.
const SIZE: u32 = 16;

/// The thread that draws holds images 1 to `count`, of the test's size, and took the frames
/// before the current one.
fn arrive<B: FrameBuilder>(world: &mut World<B>, mock: &mut MockBackend, count: u32, size: u32) {
    for image in 1..=count {
        mock.provide_image(image, size, size);
    }
    let taken = world.frame - 1;
    world
        .renderer
        .settings_mut()
        .textures_mut()
        .sync(count, taken);
}

/// Records the current frame and replays it twice on the mock, as a capture replays a frame's list
/// again, then moves on to the next frame.
fn step<B: FrameBuilder>(
    world: &mut World<B>,
    mock: &mut MockBackend,
    structure_changed: bool,
) -> Vec<(Op, Vec<u32>)> {
    world.record(structure_changed);
    for _ in 0..2 {
        mock.replay(world.renderer.list(world.frame).words())
            .unwrap();
    }
    let commands = world.commands();
    world.frame += 1;
    commands
}

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
    let commands = step(&mut world, &mut mock, true);
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

    arrive(&mut world, &mut mock, 2, SIZE);
    let commands = step(&mut world, &mut mock, false);
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
    let commands = step(&mut world, &mut mock, false);
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
    step(&mut world, &mut mock, true);
    arrive(&mut world, &mut mock, 4, SIZE);
    step(&mut world, &mut mock, false);
    // A fifth texture of the size outgrows the array's four layers.
    world.add_mapped(SIZE);
    let commands = step(&mut world, &mut mock, true);
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
    arrive(&mut world, &mut mock, 5, SIZE);
    let commands = step(&mut world, &mut mock, false);
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
    let commands = step(&mut world, &mut mock, false);
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
        let commands = step(&mut world, &mut mock, true);
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
        let commands = step(&mut world, &mut mock, false);
        assert_eq!(count(&commands, Op::UploadImage), 3);
        assert_eq!(table_writes(&commands, Op::WriteTexture, maps), 1);
    }
}

#[test]
fn a_material_whose_map_is_destroyed_draws_with_its_color_after_the_rebuild() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let (texture, mesh, material) = world.add_mapped(SIZE);
    step(&mut world, &mut mock, true);
    arrive(&mut world, &mut mock, 1, SIZE);
    step(&mut world, &mut mock, false);
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
    let commands = step(&mut world, &mut mock, true);
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
    step(&mut world, &mut mock, true);
    arrive(&mut world, &mut mock, 1, SIZE);
    step(&mut world, &mut mock, false);
    // The thread that draws has not taken the frame that uploaded the image, so it still holds
    // the image, and the new device's first frame uploads it again.
    world.renderer.settings_mut().textures_mut().sync(1, 1);
    world.renderer.reset_gpu();
    let mut device = MockBackend::default();
    device.provide_image(1, SIZE, SIZE);
    let commands = step(&mut world, &mut device, false);
    assert_eq!(count(&commands, Op::UploadImage), 1);
    assert_eq!(count(&commands, Op::CreateSampler), 1);
    assert_eq!(
        world.renderer.settings().textures().ready_layer(texture),
        Some(0)
    );
}
