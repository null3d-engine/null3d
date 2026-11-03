//! The cluster levels' pass asks for its pipeline only once a frame draws a tree of cluster
//! patches. Its shader loads on first use, so a page whose scene holds no tree never downloads it,
//! and a scene that gains one builds the pipeline on the frame that first draws it.

mod common;

use common::{World, grid};
use null3d_gpu::drawlist::{Op, template};
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
