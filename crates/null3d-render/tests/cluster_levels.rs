//! The cluster levels' pass asks for its pipeline only once a frame draws a tree of cluster
//! patches. Its shader loads on first use, so a page whose scene holds no tree never downloads it,
//! and a scene that gains one builds the pipeline on the frame that first draws it.

mod common;

use std::collections::HashSet;

use common::{World, count, grid};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, index_format, layout, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::Shading;
use null3d_render::patches::PatchTree;

/// The ids of the compute pipelines that the recorded frame created for `template`.
fn compute_pipelines(world: &World, template: u32) -> Vec<u32> {
    world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateComputePipeline && o[1] == template)
        .map(|(_, o)| o[0])
        .collect()
}

/// The ids of the pipelines that the recorded frame dispatched, by `SetComputePipeline`.
fn dispatched(world: &World) -> Vec<u32> {
    world
        .commands()
        .iter()
        .filter(|(op, _)| *op == Op::SetComputePipeline)
        .map(|(_, o)| o[0])
        .collect()
}

/// A tree of one patch over a grid's six indices, whose four vertices the patch names.
fn one_patch() -> PatchTree {
    PatchTree::new(
        vec![0, 1, 2, 0, 2, 3],
        vec![[0.0, 0.0, 0.0, 1.0]],
        vec![[0, 6, 0, 0]],
        0,
        4,
    )
    .unwrap()
}

#[test]
fn the_cluster_pipeline_waits_for_a_tree_and_comes_with_the_first_one() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    // One object of one mesh, which is what a tree covers: a bucket of one copy and one part.
    let mesh = world.add_object(&grid(1, 1), Shading::Lit);

    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    assert_eq!(
        compute_pipelines(&world, template::CLUSTER),
        Vec::<u32>::new(),
        "a frame whose layouts hold no tree creates no cluster pipeline"
    );
    assert!(
        !dispatched(&world).is_empty(),
        "the frame still culls and lists lights"
    );

    world
        .renderer
        .set_mesh_patches(mesh, Some(one_patch()))
        .unwrap();
    world.frame += 1;
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let created = compute_pipelines(&world, template::CLUSTER);
    assert_eq!(
        created.len(),
        1,
        "the frame that gains a tree creates the cluster pipeline"
    );
    assert!(
        dispatched(&world).contains(&created[0]),
        "the pass dispatches with the pipeline that frame made"
    );

    // The pipeline stays for the frames after it, which create it no more.
    world.frame += 1;
    world.record(false);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    assert_eq!(
        compute_pipelines(&world, template::CLUSTER),
        Vec::<u32>::new(),
        "a later frame creates no pipeline again"
    );
    assert!(dispatched(&world).contains(&created[0]));
}

#[test]
fn a_frame_that_takes_its_tree_away_keeps_the_pipeline_it_made() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let mesh = world.add_object(&grid(1, 1), Shading::Lit);
    world
        .renderer
        .set_mesh_patches(mesh, Some(one_patch()))
        .unwrap();

    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let created = compute_pipelines(&world, template::CLUSTER);
    assert_eq!(created.len(), 1);

    world.renderer.set_mesh_patches(mesh, None).unwrap();
    world.frame += 1;
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    assert_eq!(
        compute_pipelines(&world, template::CLUSTER),
        Vec::<u32>::new()
    );
    assert!(
        !dispatched(&world).contains(&created[0]),
        "nothing dispatches the pass"
    );
}

#[test]
fn a_mesh_past_one_parts_vertices_draws_its_patches_rather_than_its_whole_triangles() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    // 257 by 257 vertices: more than the 65,535 that one part's 16-bit indices reach.
    let geometry = grid(256, 256);
    let mesh = world.add_object(&geometry, Shading::Lit);
    let meshes = world.renderer.settings().meshes();
    let slot = *meshes.mesh(mesh - 1).unwrap();
    let parts = meshes.parts(&slot, false).len();
    assert!(slot.vertex_count > 65_535 && parts > 1, "{parts} parts");
    // One patch over the mesh's last triangle, whose vertices only the last part holds, in the
    // order of the parts' vertices, as the engine stores a model's tree.
    let mut indices = geometry.indices[geometry.indices.len() - 3..].to_vec();
    let vertices = meshes.to_part_order(mesh - 1, &mut indices);
    assert!(indices.iter().all(|&index| index < vertices));
    let tree = PatchTree::new(
        indices,
        vec![[0.0, 0.0, 0.0, 1.0]],
        vec![[0, 3, 0, 0]],
        0,
        vertices,
    )
    .unwrap();

    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let whole = count(&world.commands(), Op::DrawIndexedIndirect);

    world.renderer.set_mesh_patches(mesh, Some(tree)).unwrap();
    world.frame += 1;
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let created = compute_pipelines(&world, template::CLUSTER);
    assert_eq!(created.len(), 1, "the frame creates the cluster pipeline");
    assert!(dispatched(&world).contains(&created[0]));
    let commands = world.commands();
    // The view's list of chosen patch indices is 32-bit, and one draw takes the place of the
    // draws of every part of the mesh.
    assert!(
        commands
            .iter()
            .any(|(op, o)| *op == Op::SetIndexBuffer && o[1] == index_format::UINT32)
    );
    assert_eq!(
        count(&commands, Op::DrawIndexedIndirect),
        whole - (parts - 1),
        "the parts' {parts} draws become one"
    );
}

/// A tree of a root over a grid's six indices, with `error`, and two children below it that each
/// hold `child_indices` indices, exact: a view that the root's error fails draws the children.
fn root_and_two_children(error: f32, child_indices: usize) -> PatchTree {
    let mut indices = vec![0, 1, 2, 0, 2, 3];
    for _ in 0..2 * child_indices / 3 {
        indices.extend_from_slice(&[0, 1, 2]);
    }
    let child = child_indices as u32;
    PatchTree::new(
        indices,
        vec![
            [0.0, 0.0, 0.0, 2.0],
            [-0.5, 0.0, 0.0, 1.0],
            [0.5, 0.0, 0.0, 1.0],
        ],
        vec![
            [0, 6, 0, error.to_bits()],
            [6, child, 1, 0],
            [6 + child, child, 1, 0],
        ],
        0,
        4,
    )
    .unwrap()
}

/// Adds a grid object at the origin that casts and receives shadows, with `tree` as its mesh's tree
/// of cluster patches.
fn caster_with_tree(world: &mut World, tree: PatchTree) {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Lit, 0, [1.0, 1.0, 1.0, 1.0])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 2.0).unwrap();
    let both = flags::VISIBLE | flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS;
    let commands = [
        Command::create(object, Handle::NONE, mesh, both),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    world.renderer.set_mesh_patches(mesh, Some(tree)).unwrap();
}

/// Each cluster pass group of a frame, as its list's buffer and the bytes it was made with, and the
/// buffer of its draws.
fn cluster_lists(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::CLUSTER_CULL)
        .map(|(_, o)| {
            let entry = |binding: u32| {
                o[3..]
                    .chunks(5)
                    .find(|entry| entry[0] == binding)
                    .map_or(0, |entry| entry[2])
            };
            let list = entry(7);
            let bytes = commands
                .iter()
                .filter(|(op, c)| *op == Op::CreateBuffer && c[0] == list)
                .map(|(_, c)| c[1])
                .next_back()
                .unwrap_or(0);
            (list, bytes, entry(8))
        })
        .collect()
}

#[test]
fn each_shadow_view_picks_and_draws_its_own_patches_from_a_list_sized_to_them() {
    // Two children of 30,000 indices each below an exact root: every view picks the root alone, so
    // each view's list holds a few patches' worth, not the tree's 60,006 indices.
    let mut world = World::new();
    let mut mock = MockBackend::default();
    world.cast_sun_shadows(3);
    caster_with_tree(&mut world, root_and_two_children(0.0, 30_000));
    world.record(true);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    let commands = world.commands();
    let lists = cluster_lists(&commands);
    // The camera's view and each of the three cascades has a list and draws of its own.
    assert_eq!(lists.len(), 4, "{lists:?}");
    let mut ids: Vec<u32> = lists.iter().map(|&(list, _, _)| list).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 4, "each view has a list of its own: {lists:?}");
    for &(_, bytes, _) in &lists {
        assert!(bytes > 0 && bytes < 16 * 1024, "{lists:?}");
    }
    // Each view's pass draws its cluster mesh from its own draws.
    let drawn: HashSet<u32> = commands
        .iter()
        .filter(|(op, _)| *op == Op::DrawIndexedIndirect)
        .map(|(_, o)| o[0])
        .collect();
    for &(_, _, draws) in &lists {
        assert!(
            drawn.contains(&draws),
            "no pass draws from {draws}: {lists:?} {drawn:?}"
        );
    }

    // A coarse root, which no view's threshold passes near the caster, makes the camera's view
    // pick the children: its list grows to hold them, and the frame records it again.
    let mut world = World::new();
    world.cast_sun_shadows(3);
    caster_with_tree(&mut world, root_and_two_children(1.0e3, 30_000));
    world.record(true);
    let lists = cluster_lists(&world.commands());
    assert!(
        lists.iter().any(|&(_, bytes, _)| bytes >= 60_000 * 4),
        "{lists:?}"
    );
}
