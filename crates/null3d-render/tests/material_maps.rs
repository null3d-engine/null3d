//! Standard materials with texture maps, drawn by both frame builders: the template and variant
//! each set of maps picks, and the map set's bind group that the material draws with. On WebGPU
//! each map slot has a binding of its own; on WebGL2 the maps share a few units. Checked through
//! the mock backend, which rejects what a real GPU would, and by decoding the lists.

mod common;

use common::{World, base_sphere, grid, map_desc};
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, format, layout, permutation, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::arrays::{MeshArrays, from_arrays};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::{MapSlot, Shading};
use null3d_render::textures::TextureDesc;

/// The size of the test's maps.
const SIZE: u32 = 16;

/// A 2 x 2 grid with tangents, computed from its texture coordinates.
fn grid_with_tangents() -> Geometry {
    let g = grid(2, 2);
    let (positions, uvs) = (g.attribute(0), g.attribute(2));
    let arrays = MeshArrays {
        positions: (&positions[..]).into(),
        uvs: Some((&uvs[..]).into()),
        indices: Some(&g.indices),
        compute_normals: true,
        compute_tangents: true,
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

/// Adds an object that draws `mesh` with a new standard material that has `maps`, and returns
/// the engine ids of the mesh and the material.
fn add<B: FrameBuilder>(
    world: &mut World<B>,
    mesh: &Geometry,
    maps: &[(MapSlot, Handle)],
) -> (u32, u32) {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap();
    for &(slot, texture) in maps {
        settings
            .materials_mut()
            .set_map(material, slot, texture, false)
            .unwrap();
    }
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material + 1),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    (mesh, material + 1)
}

/// A texture of the test's size, with its image on its way.
fn texture<B: FrameBuilder>(world: &mut World<B>, desc: TextureDesc) -> Handle {
    let store = world.renderer.settings_mut().textures_mut();
    let texture = store.create(desc).unwrap();
    store.set_image(texture, SIZE, SIZE, 0).unwrap();
    texture
}

/// Each render pipeline that a list creates with the maps template: its permutation bits without
/// the pass's own, and its vertex format.
fn map_pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    let mut made: Vec<(u32, u32)> = commands
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateRenderPipeline && o[1] == template::INSTANCED_STANDARD_MAPS
        })
        .map(|(_, o)| (o[2] & !permutation::DEVICE, o[7]))
        .collect();
    made.sort_unstable();
    made
}

/// The texture ids that each map set's bind group binds, by slot.
fn map_sets(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::MATERIAL_MAPS)
        .map(|(_, o)| o[3..].chunks(5).take(6).map(|entry| entry[2]).collect())
        .collect()
}

/// Checks the maps of `world`, whose builder shares units among a standard material's maps when
/// `shared` is true.
fn check<B: FrameBuilder>(mut world: World<B>, shared: bool) {
    let linear = TextureDesc {
        format: format::RGBA8_UNORM,
        ..map_desc(SIZE)
    };
    let base = texture(&mut world, map_desc(SIZE));
    let normal = texture(&mut world, linear);
    let emissive = texture(&mut world, map_desc(SIZE));
    let plain = grid(2, 2);
    // A base color map alone; the same with a normal map, on a grid without tangents and on one
    // with them; an emissive map from the base color map's array; and maps on a mesh without
    // texture coordinates, which draws without them.
    let colored = add(&mut world, &plain, &[(MapSlot::BaseColor, base)]);
    add(
        &mut world,
        &plain,
        &[(MapSlot::BaseColor, base), (MapSlot::Normal, normal)],
    );
    add(
        &mut world,
        &grid_with_tangents(),
        &[(MapSlot::BaseColor, base), (MapSlot::Normal, normal)],
    );
    let glowing = add(&mut world, &plain, &[(MapSlot::Emissive, emissive)]);
    add(
        &mut world,
        &base_sphere(0.5, [8, 6]),
        &[(MapSlot::BaseColor, base)],
    );
    world.record(true);
    let mut mock = MockBackend::default();
    for image in 1..=3 {
        mock.provide_image(image, SIZE, SIZE);
    }
    for _ in 0..2 {
        mock.replay(world.renderer.list(world.frame).words())
            .unwrap();
    }
    let commands = world.commands();
    let uvs = vertex::UV0;
    let tangents = vertex::UV0 | vertex::TANGENT;
    assert_eq!(
        map_pipelines(&commands),
        vec![(0, uvs), (permutation::VERTEX_TANGENT, tangents)],
        "a normal map needs its own variant only on a mesh with tangents"
    );
    let sets = map_sets(&commands);
    let settings = world.renderer.settings();
    let pipeline = settings.pipeline_of(colored.0, colored.1).unwrap();
    assert_eq!(pipeline.template, template::INSTANCED_STANDARD_MAPS);
    let glow = settings.pipeline_of(glowing.0, glowing.1).unwrap();
    let (colored_group, glowing_group) = (
        settings.texture_group(colored.1, pipeline),
        settings.texture_group(glowing.1, glow),
    );
    if shared {
        // Two sets: the base color map's array alone, and with the normal map's after it. The
        // emissive map shares the base color map's array and sampler, so it shares its unit and
        // its set. Each unit without a map binds the one white texel's texture.
        assert_eq!(sets.len(), 2);
        assert_eq!(colored_group, glowing_group);
        let empty = sets[0][1];
        assert_ne!(sets[1][1], empty, "the normal map takes the second unit");
        for set in &sets {
            assert_ne!(set[0], empty);
            assert!(set[2..].iter().all(|&texture| texture == empty));
        }
    } else {
        // Three sets of maps: the base color map alone, with the normal map, and the emissive
        // map. Each slot without a map binds the one white texel's texture.
        assert_eq!(sets.len(), 3);
        let empty = sets[0][MapSlot::MetalRough as usize];
        for set in &sets {
            for slot in [MapSlot::MetalRough, MapSlot::Occlusion, MapSlot::Light] {
                assert_eq!(set[slot as usize], empty);
            }
        }
        assert_ne!(
            colored_group, glowing_group,
            "the emissive map sits in another slot, so another set"
        );
    }
}

#[test]
fn maps_pick_their_template_variant_and_map_set_on_webgpu() {
    check(World::new(), false);
}

#[test]
fn maps_pick_their_template_variant_and_map_set_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check(World::build(CpuCulledRenderer::new(config)), true);
    }
}
