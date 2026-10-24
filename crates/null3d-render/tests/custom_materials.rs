//! Custom materials' textures and destroyed materials, drawn by both frame builders: a custom
//! material with textures draws with the bind group of its map slots and reads each texture's
//! layer from its custom values, and a destroyed material draws nothing, gives its id back once
//! no object names it, and releases its template's pipelines. Checked through the mock backend,
//! which rejects what a real GPU would, and by decoding the lists.

mod common;

use common::{World, grid, map_desc};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, layout, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{
    CustomShading, MapSlot, NO_MAP, Shading, feature, texture_layer_offset,
};

/// The size of the test's textures.
const SIZE: u32 = 16;

/// A custom material's shading under the first custom template, with `textures` textures.
fn custom(textures: u32) -> Shading {
    Shading::Custom(CustomShading {
        template: template::CUSTOM_FIRST,
        attributes: vertex::UV0,
        base_color: true,
        textures,
        transmission: false,
        row_values: false,
        caster: false,
        object_ids: false,
    })
}

/// Adds an object that draws a grid with material `material`, an engine id, and returns its
/// handle.
fn add_object<B: FrameBuilder>(world: &mut World<B>, material: u32) -> Handle {
    let mesh = world
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(&grid(1, 1))
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    object
}

/// The layers that a material's custom values hold for its first `count` textures.
fn layers<B: FrameBuilder>(world: &World<B>, material: u32, count: usize) -> Vec<f32> {
    let values = world
        .renderer
        .settings()
        .materials()
        .values(material..material + 1);
    (0..count)
        .map(|k| values[texture_layer_offset(k)])
        .collect()
}

fn check_textures<B: FrameBuilder>(mut world: World<B>) {
    let settings = world.renderer.settings_mut();
    let first = settings.textures_mut().create(map_desc(SIZE)).unwrap();
    let second = settings.textures_mut().create(map_desc(SIZE)).unwrap();
    for texture in [first, second] {
        settings
            .textures_mut()
            .set_image(texture, SIZE, SIZE, 0)
            .unwrap();
    }
    let table = settings.materials_mut();
    let material = table.create(custom(2), 0, [1.0; 4]).unwrap();
    table
        .set_map(material, MapSlot::BaseColor, first, false)
        .unwrap();
    table
        .set_map(material, MapSlot::MetalRough, second, false)
        .unwrap();
    add_object(&mut world, material + 1);
    let mut mock = MockBackend::default();
    let commands = world.step(&mut mock, true);
    assert_eq!(
        layers(&world, material, 2),
        [NO_MAP; 2],
        "no layer while the images are on their way"
    );
    // The draw binds a bind group of the maps' layout, with both textures' arrays.
    let groups: Vec<&Vec<u32>> = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::MATERIAL_MAPS)
        .map(|(_, o)| o)
        .collect();
    assert_eq!(groups.len(), 1, "one bind group for the material's slots");
    let group = groups[0][0];
    let binds = commands
        .iter()
        .any(|(op, o)| *op == Op::SetBindGroup && o[1] == group);
    assert!(binds, "the custom material draws with its textures' group");
    world.arrive(&mut mock, 2, SIZE);
    world.step(&mut mock, false);
    world.step(&mut mock, false);
    let ready = layers(&world, material, 2);
    assert!(ready.iter().all(|&layer| layer >= 0.0), "{ready:?}");
    assert_ne!(ready[0], ready[1], "each texture has a layer of its own");
}

#[test]
fn custom_materials_draw_with_their_textures_on_webgpu() {
    check_textures(World::new());
}

#[test]
fn custom_materials_draw_with_their_textures_on_webgl2() {
    check_textures(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// A custom material whose one texture is a texture array of several layers: the shader picks the
/// layer, so the material reads the array's first layer, and its whole array draws.
fn check_texture_array<B: FrameBuilder>(mut world: World<B>) {
    let settings = world.renderer.settings_mut();
    let mut desc = map_desc(SIZE);
    desc.depth = 6;
    let array = settings.textures_mut().create(desc).unwrap();
    let (texels, _) = settings.textures_mut().set_data(array, SIZE, SIZE).unwrap();
    texels.fill(u32::MAX);
    let table = settings.materials_mut();
    let material = table.create(custom(1), 0, [1.0; 4]).unwrap();
    table
        .set_map(material, MapSlot::BaseColor, array, false)
        .unwrap();
    add_object(&mut world, material + 1);
    let mut mock = MockBackend::default();
    world.step(&mut mock, false);
    world.step(&mut mock, false);
    assert_eq!(
        layers(&world, material, 1),
        [0.0],
        "the shader picks a layer of the texture's own array"
    );
}

#[test]
fn custom_materials_sample_texture_arrays_on_webgpu() {
    check_texture_array(World::new());
}

#[test]
fn custom_materials_sample_texture_arrays_on_webgl2() {
    check_texture_array(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// The bindings of a maps' group that a list creates under `wanted`, from its operands.
fn map_bindings(commands: &[(Op, Vec<u32>)], wanted: u32) -> Vec<(u32, Vec<u32>)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == wanted)
        .map(|(_, o)| {
            let count = o[2] as usize;
            let bindings = (0..count).map(|entry| o[3 + 5 * entry]).collect();
            (o.len() as u32, bindings)
        })
        .collect()
}

/// A material that reads the scene's depth takes a maps' group with the last slot and the
/// displacement map left out, which frees the fragment stage a sampled texture for the copy. A
/// material that reads neither keeps the group it had, binding for binding.
fn check_scene_depth_maps<B: FrameBuilder>(mut world: World<B>) {
    let (scene_material, plain_material) = {
        let settings = world.renderer.settings_mut();
        let first = settings.textures_mut().create(map_desc(SIZE)).unwrap();
        let second = settings.textures_mut().create(map_desc(SIZE)).unwrap();
        for texture in [first, second] {
            settings
                .textures_mut()
                .set_image(texture, SIZE, SIZE, 0)
                .unwrap();
        }
        let table = settings.materials_mut();
        // The same two textures, so only the depth tells the two groups apart: the group's key
        // must keep the flag, or one material would draw with the other's layout.
        let mut make = |features| {
            let material = table.create(custom(2), features, [1.0; 4]).unwrap();
            for (slot, texture) in [(MapSlot::BaseColor, first), (MapSlot::MetalRough, second)] {
                table.set_map(material, slot, texture, false).unwrap();
            }
            material
        };
        (make(feature::SCENE_DEPTH), make(0))
    };
    add_object(&mut world, scene_material + 1);
    add_object(&mut world, plain_material + 1);
    let mut mock = MockBackend::default();
    let commands = world.step(&mut mock, true);
    let scene = map_bindings(&commands, layout::MATERIAL_MAPS_SCENE);
    assert_eq!(scene.len(), 1, "one group for the depth-reading material");
    // Seven arrays and their samplers: the shader numbers its samplers from the slot count, so the
    // group keeps those bindings and leaves the last slot's pair out.
    assert_eq!(scene[0].0, 3 + 5 * 14);
    assert_eq!(scene[0].1, [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]);
    let plain = map_bindings(&commands, layout::MATERIAL_MAPS);
    assert_eq!(
        plain.len(),
        1,
        "one group for the material that reads neither"
    );
    let mut all: Vec<u32> = (0..8).collect();
    all.extend(8..16);
    all.extend([16, 17]);
    assert_eq!(plain[0].1, all);
    // The group's words are as many as the layout has entries, so a material that reads neither
    // costs the draw list what it did before.
    assert_eq!(plain[0].0, 3 + 5 * 18);
}

#[test]
fn custom_materials_that_read_the_depth_take_a_smaller_maps_group_on_webgpu() {
    check_scene_depth_maps(World::new());
}

#[test]
fn custom_materials_that_read_the_depth_take_a_smaller_maps_group_on_webgl2() {
    check_scene_depth_maps(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// The pipelines of the custom template that a list creates, and the ones it destroys.
fn custom_pipelines(commands: &[(Op, Vec<u32>)]) -> (Vec<u32>, Vec<u32>) {
    let created = commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::CUSTOM_FIRST)
        .map(|(_, o)| o[0])
        .collect();
    let destroyed = commands
        .iter()
        .filter(|(op, _)| *op == Op::DestroyPipeline)
        .map(|(_, o)| o[0])
        .collect();
    (created, destroyed)
}

fn check_destroy<B: FrameBuilder>(mut world: World<B>) {
    let table = world.renderer.settings_mut().materials_mut();
    let material = table.create(custom(0), 0, [1.0; 4]).unwrap();
    let object = add_object(&mut world, material + 1);
    let mut mock = MockBackend::default();
    let (created, _) = custom_pipelines(&world.step(&mut mock, true));
    assert!(!created.is_empty());

    // Destroyed while the object still names it: it draws nothing, keeps its id, and its
    // template's pipelines go.
    let table = world.renderer.settings_mut().materials_mut();
    table.destroy(material).unwrap();
    assert!(table.destroy(material).is_err(), "a second destroy fails");
    let commands = world.step(&mut mock, true);
    let (_, destroyed) = custom_pipelines(&commands);
    assert_eq!(destroyed, created, "the template's pipelines are released");
    let sets_custom = commands
        .iter()
        .any(|(op, o)| *op == Op::SetPipeline && created.contains(&o[0]));
    assert!(!sets_custom, "nothing draws with the destroyed material");
    let table = world.renderer.settings_mut().materials_mut();
    let other = table.create(Shading::Lit, 0, [1.0; 4]).unwrap();
    assert_ne!(
        other, material,
        "the object still names the destroyed material"
    );
    assert!(table.set(material, 0, &[0.0; 3]).is_err());

    // Once no object names it, its id goes to the next material.
    world
        .scene
        .apply_commands(&[Command::destroy(object)], world.frame)
        .unwrap();
    world.step(&mut mock, true);
    let table = world.renderer.settings_mut().materials_mut();
    assert_eq!(table.create(custom(0), 0, [1.0; 4]), Ok(material));
    let (again, destroyed) = custom_pipelines(&{
        add_object(&mut world, material + 1);
        world.step(&mut mock, true)
    });
    assert!(destroyed.is_empty());
    assert!(
        again.iter().all(|id| !created.contains(id)),
        "a template that comes back gets new pipeline ids"
    );
}

#[test]
fn destroyed_materials_free_their_ids_and_pipelines_on_webgpu() {
    check_destroy(World::new());
}

#[test]
fn destroyed_materials_free_their_ids_and_pipelines_on_webgl2() {
    for multi_draw in [true, false] {
        check_destroy(World::build(CpuCulledRenderer::new(CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        })));
    }
}

#[test]
fn destroying_a_custom_material_keeps_the_pipelines_of_custom_effects() {
    use null3d_render::effects::{EFFECT_FLOATS, Effect, EffectMaps};
    use null3d_render::frame::CanvasOutput;
    use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
    use null3d_render::output::{Antialias, SceneColor};
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(null3d_gpu::drawlist::format::RGBA16_FLOAT),
        antialias: Antialias::None,
        transparent: false,
    };
    let mut world = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let mut mock = MockBackend::default();
    // Three effects take the templates after the material's, as the sketch's templates count up.
    // The first two draw as a group with a joined shader, and the last folds into the final pass.
    let effects = template::CUSTOM_FIRST + 1..template::CUSTOM_FIRST + 4;
    let (group, fold) = (template::CUSTOM_FIRST + 4, template::CUSTOM_FIRST + 5);
    let settings = world.renderer.settings_mut();
    for (place, template) in effects.clone().enumerate() {
        let effect = Effect {
            template,
            depth: false,
            bloom: None,
            values: [0.0; EFFECT_FLOATS],
            maps: EffectMaps::default(),
        };
        settings.set_effect(place, Some(effect));
    }
    settings.set_effect_group(0, 2, group);
    settings.set_effect_fold(2, fold);
    let material = settings
        .materials_mut()
        .create(custom(0), 0, [1.0; 4])
        .unwrap();
    let object = add_object(&mut world, material + 1);
    // Groups and the fold ask for their pipelines once their effects' own pipelines are built.
    let mut post = Vec::new();
    for _ in 0..4 {
        let commands = world.step(&mut mock, true);
        post.extend(
            commands
                .iter()
                .filter(|(op, o)| {
                    *op == Op::CreateRenderPipeline && (effects.start..=fold).contains(&o[1])
                })
                .map(|(_, o)| (o[1], o[0])),
        );
    }
    for template in effects.start..=fold {
        assert!(
            post.iter().any(|&(t, _)| t == template),
            "the frames make the pipeline of template {template}: {post:?}"
        );
    }
    // The material goes: its pipelines go, and those of the effects, the group and the fold stay.
    world
        .scene
        .apply_commands(&[Command::destroy(object)], world.frame)
        .unwrap();
    world
        .renderer
        .settings_mut()
        .materials_mut()
        .destroy(material)
        .unwrap();
    let mut destroyed = Vec::new();
    for _ in 0..3 {
        let commands = world.step(&mut mock, true);
        destroyed.extend(
            commands
                .iter()
                .filter(|(op, _)| *op == Op::DestroyPipeline)
                .map(|(_, o)| o[0]),
        );
    }
    assert!(!destroyed.is_empty(), "the material's pipelines go");
    for (template, pipeline) in post {
        assert!(
            !destroyed.contains(&pipeline),
            "the pipeline {pipeline} of template {template} stays: {destroyed:?}"
        );
    }
}
