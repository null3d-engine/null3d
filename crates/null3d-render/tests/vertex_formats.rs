//! Meshes of several vertex formats, and a mesh too large for 16-bit indices, drawn by both frame
//! builders: checked through the mock backend, which rejects what a real GPU would, and by
//! decoding the lists they record.

mod common;

use common::{BATCH_ROWS, World, base_sphere, count, grid};
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::vertex::Type;
use null3d_gpu::drawlist::{Op, template, vertex};
use null3d_gpu::mock::MockBackend;
use null3d_render::arrays::{Data, MeshArrays, Values, from_arrays};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::Shading;
use null3d_render::meshes::{MeshStorage, Packing};
use null3d_render::view::ViewId;

/// The world's scene, plus a small grid with the texture coordinate view, a grid of 90,601
/// vertices that splits into two parts, lit, and the world's box with the texture coordinate
/// view, which draws nowhere because the box has no texture coordinates.
fn formats_world<B: FrameBuilder>(world: &mut World<B>) {
    world.add_object(&grid(4, 4), Shading::TexCoords);
    world.add_object(&grid(300, 300), Shading::Lit);
    let settings = world.renderer.settings_mut();
    let view = settings
        .materials_mut()
        .create(Shading::TexCoords, 0, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, 1, flags::VISIBLE),
        Command::set_material(object, view),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
}

/// Each render pipeline of meshes that a list creates: its template and its vertex format.
fn pipelines(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] != template::FINAL)
        .map(|(_, o)| (o[1], o[7]))
        .collect()
}

#[test]
fn each_vertex_format_gets_its_pipelines_and_a_split_mesh_draws_each_part_on_webgpu() {
    let mut world = World::new();
    formats_world(&mut world);
    world.record(true);
    let commands = world.commands();
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    // The world's lit and unlit meshes have no texture coordinates; both grids have them.
    let mut made = pipelines(&commands);
    made.sort_unstable();
    assert_eq!(
        made,
        vec![
            (template::INSTANCED_LIT, 0),
            (template::INSTANCED_LIT, vertex::UV0),
            (template::INSTANCED_UNLIT, 0),
            (template::INSTANCED_TEXCOORDS, vertex::UV0),
        ]
    );
    // The world's three draws, the small grid's one, and one for each part of the large grid.
    // The large grid's two draws share its bucket's slice of the instances, which binds once.
    assert_eq!(count(&commands, Op::DrawIndexedIndirect), 3 + 1 + 2);
    let slices = commands
        .iter()
        .filter(|(op, o)| *op == Op::SetVertexBuffer && o[0] == 1)
        .count();
    assert_eq!(slices, 3 + 1 + 1);
    // Each vertex format's page has its own buffers: the base format's and the grids' format's,
    // which holds both grids, the large one in two parts.
    let pages = world.renderer.settings().meshes().pages();
    assert_eq!(pages.len(), 2);
    assert_eq!(
        pages.iter().map(|p| p.format).collect::<Vec<_>>(),
        vec![0, vertex::UV0]
    );
}

#[test]
fn a_split_mesh_draws_each_part_on_both_webgl2_draw_paths() {
    for multi_draw in [true, false] {
        let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        }));
        formats_world(&mut world);
        world.record(true);
        let commands = world.commands();
        let mut mock = MockBackend::default();
        mock.replay(world.renderer.list(1).words()).unwrap();
        let mut made = pipelines(&commands);
        made.sort_unstable();
        assert_eq!(made.len(), 4, "multi-draw {multi_draw}");
        // The world's four draws, the small grid's one, and one for each part of the large grid.
        assert_eq!(mock.draws, 4 + 1 + 2, "multi-draw {multi_draw}");
        // Pages: the base format's, the small grid's, and one for each part of the large grid,
        // as each part fills most of a page.
        assert_eq!(world.renderer.settings().meshes().pages().len(), 4);
        // The index list holds the grids' objects once each, beside the world's entries: both
        // parts of the large grid draw the same entry.
        let culled = world.renderer.culled(world.frame, ViewId::CAMERA);
        assert_eq!(culled.len() as u32, BATCH_ROWS + 3 + 2);
    }
}

#[test]
fn a_page_that_outgrows_its_buffers_gets_new_ones_and_webgpu_records_its_bundle_again() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    world.frame = 2;
    world.record(false);
    mock.replay(world.renderer.list(2).words()).unwrap();
    assert_eq!(count(&world.commands(), Op::BeginBundle), 0);
    // A large mesh of the base format, which no object uses yet, outgrows the base page's
    // buffers. The bundle draws from them, so it is recorded again with the new ones.
    world
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(&base_sphere(1.0, [128, 64]))
        .unwrap();
    world.frame = 3;
    world.record(false);
    mock.replay(world.renderer.list(3).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::CreateBuffer), 2);
    assert_eq!(count(&commands, Op::BeginBundle), 1);
    assert_eq!(count(&commands, Op::DrawIndexedIndirect), 3);
    // Only the new buffers take the whole page; the next frame uploads nothing for it.
    world.frame = 4;
    world.record(false);
    mock.replay(world.renderer.list(4).words()).unwrap();
    let commands = world.commands();
    assert_eq!(count(&commands, Op::CreateBuffer), 0);
    assert_eq!(count(&commands, Op::BeginBundle), 0);
}

/// A grid's twin in integers: plain 16-bit positions, 8-bit normals and normalized 16-bit
/// texture coordinates, which take 16 bytes per vertex where the grid's floats take 32.
fn quantized(g: &Geometry) -> Geometry {
    let positions: Vec<u16> = g.attribute(0).iter().map(|&p| p as u16).collect();
    let normals: Vec<i8> = g.attribute(1).iter().map(|&n| (n * 127.0) as i8).collect();
    let uvs: Vec<u16> = g
        .attribute(2)
        .iter()
        .map(|&t| (t * 65535.0) as u16)
        .collect();
    let arrays = MeshArrays {
        positions: Values::integers(Data::U16(&positions), false),
        normals: Some(Values::integers(Data::I8(&normals), true)),
        uvs: Some(Values::integers(Data::U16(&uvs), true)),
        indices: Some(&g.indices),
        ..MeshArrays::default()
    };
    from_arrays(&arrays, &JobSystem::new(0)).unwrap()
}

/// The bytes that a world's first frame writes into GPU buffers, with one object of `mesh`.
fn uploaded<B: FrameBuilder>(mut world: World<B>, mesh: &Geometry) -> u32 {
    world.add_object(mesh, Shading::TexCoords);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    world
        .commands()
        .iter()
        .filter(|(op, _)| *op == Op::WriteBuffer)
        .map(|(_, o)| o[3])
        .sum()
}

#[test]
fn a_quantized_mesh_uploads_half_the_vertex_bytes_of_its_float_twin_on_both_paths() {
    // A grid of 65 x 65 = 4,225 vertices, whose floats take 32 bytes each.
    let floats = grid(64, 64);
    let integers = quantized(&floats);
    assert_eq!(vertex::type_of(integers.format, 0), Some(Type::Uint16));
    assert_eq!((floats.stride(), integers.stride()), (32, 16));
    assert_eq!(integers.vertex_count(), 4225);
    let saved = 4225 * (32 - 16);
    let gpu = uploaded(World::new(), &floats) - uploaded(World::new(), &integers);
    assert_eq!(gpu, saved);
    let webgl2 = || World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    assert_eq!(
        uploaded(webgl2(), &floats) - uploaded(webgl2(), &integers),
        saved
    );
}

#[test]
fn every_attribute_type_packs_into_pages_of_its_own_format_in_both_packings() {
    // One quad per type of each attribute, with every other attribute in its default type.
    let quad = grid(1, 1);
    let mut meshes = Vec::new();
    for (location, attribute) in vertex::ATTRIBUTES.iter().enumerate() {
        for &ty in attribute.types {
            let format = vertex::with(quad.format, location, ty).unwrap();
            let stride = vertex::stride(format) as usize;
            // Each vertex's bytes count up, so every vertex is unique.
            let vertices = (0..4 * stride).map(|k| (k % 251) as u8).collect();
            meshes.push(Geometry {
                format,
                vertices,
                indices: quad.indices.clone(),
            });
        }
    }
    let formats: std::collections::BTreeSet<u32> = meshes.iter().map(|m| m.format).collect();
    // The quad has float positions, normals and first coordinates, so their float types repeat
    // its format; every other type makes a format of its own.
    assert_eq!((meshes.len(), formats.len()), (41, 39));
    for packing in [Packing::SharedBuffers, Packing::Pages] {
        let mut storage = MeshStorage::new(packing);
        let ids: Vec<u32> = meshes.iter().map(|m| storage.add(m).unwrap()).collect();
        for (mesh, id) in meshes.iter().zip(ids) {
            let slot = storage.mesh(id).unwrap();
            assert_eq!(slot.format, mesh.format);
            let part = storage.parts(slot)[0];
            let page = &storage.pages()[part.page as usize];
            assert_eq!(page.format, mesh.format);
            assert_eq!(page.vertices.len() % mesh.stride(), 0);
            // Each index reaches the vertex whose bytes the mesh gave it.
            for (k, &original) in mesh.indices.iter().enumerate() {
                let index = page.indices[part.first_index as usize + k] as usize;
                let at = (part.base_vertex as usize + index) * mesh.stride();
                let from = original as usize * mesh.stride();
                assert_eq!(
                    page.vertices[at..at + mesh.stride()],
                    mesh.vertices[from..from + mesh.stride()],
                    "{packing:?}"
                );
            }
        }
        assert_eq!(storage.pages().len(), formats.len(), "{packing:?}");
    }
}
