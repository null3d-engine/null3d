//! What a raycast reports about where on a surface it hit: the first texture coordinates of the
//! hit triangle, blended across its three corners. A quad with float coordinates and a skinned
//! quad whose coordinates are quantized integers both give the same answer, and a mesh with no
//! first texture coordinate set gives none.

mod common;

use common::World;
use null3d_core::bvh::query::{QueryHit, QueryScene, SceneQueries};
use null3d_core::bvh::top::WorldRay;
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::{Command, flags};
use null3d_render::arrays::{Data, MeshArrays, Values, from_arrays};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::Shading;

/// The layer that the objects of these tests sit on, which nothing else in the test world uses.
const LAYER: u32 = 1 << 3;

/// The distance from the quad's plane at which every ray starts.
const FROM: f64 = 4.0;

/// A quad in the x-y plane from `(0, 0, 0)` to `(1, 1, 0)`, whose four corners carry the texture
/// coordinates `(0, 0)`, `(1, 0)`, `(0, 1)` and `(1, 1)`, so the coordinates are the point's own
/// across the surface. Its two triangles are `(0, 1, 2)` and `(2, 1, 3)`.
const CORNERS: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0];
const INDICES: [u32; 6] = [0, 1, 2, 2, 1, 3];

/// The quad with its texture coordinates as floats.
fn quad() -> Geometry {
    let uvs: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];
    from_arrays(
        &MeshArrays {
            positions: Values::f32(&CORNERS),
            uvs: Some(Values::f32(&uvs)),
            indices: Some(&INDICES),
            compute_normals: true,
            ..MeshArrays::default()
        },
        &JobSystem::new(0),
    )
    .unwrap()
}

/// The same quad as a skinned mesh: every vertex takes all its weight from joint 0, and the
/// texture coordinates are normalized 16-bit integers, as a quantized glTF file holds them.
fn skinned_quad() -> Geometry {
    let joints: [u16; 16] = [0; 16];
    let mut weights = [0u8; 16];
    for vertex in 0..4 {
        weights[vertex * 4] = u8::MAX;
    }
    // The largest 16-bit value reads as 1, so the corners keep the coordinates of `quad`.
    let uvs: [u16; 8] = [0, 0, u16::MAX, 0, 0, u16::MAX, u16::MAX, u16::MAX];
    from_arrays(
        &MeshArrays {
            positions: Values::f32(&CORNERS),
            uvs: Some(Values::integers(Data::U16(&uvs), true)),
            joints: Some(Values::integers(Data::U16(&joints), false)),
            weights: Some(Values::integers(Data::U8(&weights), true)),
            indices: Some(&INDICES),
            compute_normals: true,
            ..MeshArrays::default()
        },
        &JobSystem::new(0),
    )
    .unwrap()
}

/// The same quad with no texture coordinates at all.
fn bare_quad() -> Geometry {
    from_arrays(
        &MeshArrays {
            positions: Values::f32(&CORNERS),
            indices: Some(&INDICES),
            compute_normals: true,
            ..MeshArrays::default()
        },
        &JobSystem::new(0),
    )
    .unwrap()
}

/// Adds `geometry` to the world at the origin, on [`LAYER`] alone, and updates the scene's world
/// output, so a query sees it.
fn place(world: &mut World, geometry: &Geometry) {
    let mesh = world
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(geometry)
        .unwrap()
        + 1;
    let material = world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(Shading::Lit, 0, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    // A radius the whole quad is inside, which every query box is built from.
    world.scene.set_local_radius(object, 2.0).unwrap();
    let frame = world.frame;
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
        Command::set_layers(object, LAYER),
    ];
    world.scene.apply_commands(&commands, frame).unwrap();
    world.scene.update_transforms(&world.jobs);
}

/// The closest hit of a ray from above `(x, y)` straight down, on [`LAYER`] alone.
fn down_at(world: &World, queries: &mut SceneQueries, x: f64, y: f64) -> Option<QueryHit> {
    let view = QueryScene {
        scene: &world.scene,
        batches: &world.batches,
        meshes: world.renderer.settings(),
        rows: Default::default(),
    };
    queries.sync(&view, &world.jobs).unwrap();
    let ray = WorldRay::new([x, y, FROM], [0.0, 0.0, -1.0]);
    queries.raycast(&view, &ray, LAYER)
}

/// The texture coordinates that a hit reports, or a panic that names the place on the quad.
fn uv_at(world: &World, queries: &mut SceneQueries, x: f64, y: f64) -> [f32; 2] {
    let hit = down_at(world, queries, x, y)
        .unwrap_or_else(|| panic!("the ray through ({x}, {y}) hit nothing"));
    hit.uv
        .unwrap_or_else(|| panic!("the hit at ({x}, {y}) reported no texture coordinates"))
}

/// Checks that `got` lies within a hundredth of a texel of `want`, which the arithmetic of the
/// intersection and the blend can move.
fn close(got: [f32; 2], want: [f32; 2]) {
    assert!(
        (got[0] - want[0]).abs() < 1e-4 && (got[1] - want[1]).abs() < 1e-4,
        "the hit reported {got:?}, not {want:?}"
    );
}

#[test]
fn a_quad_reports_where_on_its_surface_the_ray_hit() {
    let mut world = World::new();
    place(&mut world, &quad());
    let mut queries = SceneQueries::new();
    // The middle, a quarter in from two edges, and near two opposite corners: the coordinates are
    // the point's own across the surface, whichever triangle it falls in.
    close(uv_at(&world, &mut queries, 0.5, 0.5), [0.5, 0.5]);
    close(uv_at(&world, &mut queries, 0.25, 0.75), [0.25, 0.75]);
    close(uv_at(&world, &mut queries, 0.75, 0.25), [0.75, 0.25]);
    close(uv_at(&world, &mut queries, 0.1, 0.1), [0.1, 0.1]);
    close(uv_at(&world, &mut queries, 0.9, 0.9), [0.9, 0.9]);
}

#[test]
fn a_skinned_mesh_reports_the_same_coordinates_as_one_with_float_ones() {
    let mut world = World::new();
    place(&mut world, &skinned_quad());
    let mut queries = SceneQueries::new();
    close(uv_at(&world, &mut queries, 0.5, 0.5), [0.5, 0.5]);
    close(uv_at(&world, &mut queries, 0.25, 0.75), [0.25, 0.75]);
    close(uv_at(&world, &mut queries, 0.125, 0.5), [0.125, 0.5]);
}

#[test]
fn a_mesh_with_no_texture_coordinates_reports_none() {
    let mut world = World::new();
    place(&mut world, &bare_quad());
    let mut queries = SceneQueries::new();
    let hit = down_at(&world, &mut queries, 0.5, 0.5).expect("the ray hit the quad");
    assert_eq!(hit.uv, None);
}
