//! The bottom level: one tree per mesh, over its triangles.
//!
//! The tree holds no vertex data. It keeps its nodes and the triangle order that its leaves
//! name, and each query reads the triangles from the mesh's own arrays through [`Triangles`]. A
//! mesh kept for queries therefore costs its positions and indices, plus about 16 bytes per
//! triangle for the tree (see [`MeshBvh::memory_bytes`]).
//!
//! Leaves hold up to [`LEAF_TRIANGLES`] triangles. The build is the SAH build (see
//! [`super::build`]): it runs once per mesh, on a job worker when the mesh loads, or in the asset
//! tool, which stores the result in the file (see [`super::format`]).

use super::build::{SahScratch, build_sah};
use super::{Aabb, Node, Ray, child, refit_nodes, walk_any, walk_near_first};
use crate::CoreError;

/// The most triangles per leaf.
pub const LEAF_TRIANGLES: u32 = 4;

/// Triangles that a tree is built over and queried against. An index past the positions gives
/// a triangle of NaN corners, which no ray hits.
pub trait Triangles {
    /// The number of triangles.
    fn count(&self) -> u32;
    /// The three corners of triangle `i`.
    fn triangle(&self, i: u32) -> [[f32; 3]; 3];
}

/// The corner at `index` of a position array with three floats per vertex, or NaN when the index
/// is past it.
#[inline(always)]
fn vertex(positions: &[f32], index: usize) -> [f32; 3] {
    match positions.get(index * 3..index * 3 + 3) {
        Some(&[x, y, z]) => [x, y, z],
        _ => [f32::NAN; 3],
    }
}

/// Indexed triangles: three floats per vertex, and three indices per triangle.
#[derive(Clone, Copy, Debug)]
pub struct IndexedTriangles<'a, I> {
    /// Vertex positions, x, y and z per vertex.
    pub positions: &'a [f32],
    /// Vertex indices, three per triangle.
    pub indices: &'a [I],
}

impl<I: Copy + Into<u32>> Triangles for IndexedTriangles<'_, I> {
    #[inline(always)]
    fn count(&self) -> u32 {
        (self.indices.len() / 3) as u32
    }

    #[inline(always)]
    fn triangle(&self, i: u32) -> [[f32; 3]; 3] {
        let at = i as usize * 3;
        std::array::from_fn(|c| vertex(self.positions, self.indices[at + c].into() as usize))
    }
}

/// Triangles without indices: nine floats per triangle.
#[derive(Clone, Copy, Debug)]
pub struct TriangleSoup<'a> {
    /// Corner positions, three vertices of x, y and z per triangle.
    pub positions: &'a [f32],
}

impl Triangles for TriangleSoup<'_> {
    #[inline(always)]
    fn count(&self) -> u32 {
        (self.positions.len() / 9) as u32
    }

    #[inline(always)]
    fn triangle(&self, i: u32) -> [[f32; 3]; 3] {
        std::array::from_fn(|c| vertex(self.positions, i as usize * 3 + c))
    }
}

/// Which faces a ray hits, as three.js's material `side` decides: a front face has its corners
/// counterclockwise as the ray sees them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Side {
    /// Front faces only.
    #[default]
    Front,
    /// Back faces only.
    Back,
    /// Both faces.
    Double,
}

/// A ray's hit on a triangle.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TriangleHit {
    /// The distance along the ray, in multiples of its direction.
    pub t: f32,
    /// The triangle's index in the mesh.
    pub triangle: u32,
    /// The barycentric weights of the second and third corners at the hit; the first corner's
    /// is `1 - u - v`.
    pub u: f32,
    /// See `u`.
    pub v: f32,
    /// True when the ray hit the front face.
    pub front: bool,
}

/// The ray's hit on one triangle between `ray.t_min` and `ray.t_max`, by the Möller-Trumbore
/// test. Edges and corners count as inside. A triangle with no area, or one the ray runs
/// along, is never hit. A tree query and a loop over every triangle both call this test, so they
/// agree to the bit.
#[inline(always)]
pub fn ray_triangle(ray: &Ray, v: &[[f32; 3]; 3], side: Side) -> Option<(f32, f32, f32, bool)> {
    let sub = |a: [f32; 3], b: [f32; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let cross = |a: [f32; 3], b: [f32; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let e1 = sub(v[1], v[0]);
    let e2 = sub(v[2], v[0]);
    let p = cross(ray.direction, e2);
    let det = dot(e1, p);
    // A positive determinant is a front face: the corners turn counterclockwise to the ray.
    let front = det > 0.0;
    let wanted = match side {
        Side::Front => front,
        Side::Back => det < 0.0,
        Side::Double => det != 0.0,
    };
    if !wanted {
        return None;
    }
    let inv = 1.0 / det;
    let s = sub(ray.origin, v[0]);
    let u = dot(s, p) * inv;
    // Each test fails for NaN.
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let w = dot(ray.direction, q) * inv;
    if !(w >= 0.0 && u + w <= 1.0) {
        return None;
    }
    let t = dot(e2, q) * inv;
    if !(t >= ray.t_min && t <= ray.t_max) {
        return None;
    }
    Some((t, u, w, front))
}

/// The tree over one mesh's triangles.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MeshBvh {
    pub(crate) nodes: Vec<Node>,
    pub(crate) order: Vec<u32>,
    pub(crate) bounds: Aabb,
}

impl MeshBvh {
    /// Builds the tree over a mesh's triangles. A mesh with no triangles gives an empty tree.
    ///
    /// # Errors
    /// [`CoreError::OutOfRange`] when the mesh has more than [`child::MAX_PRIMITIVES`] triangles,
    /// and [`CoreError::OutOfMemory`] when memory cannot grow for the build.
    pub fn build(mesh: &impl Triangles) -> Result<MeshBvh, CoreError> {
        let n = mesh.count();
        if n > child::MAX_PRIMITIVES {
            return Err(CoreError::OutOfRange {
                value: n,
                limit: child::MAX_PRIMITIVES,
            });
        }
        let oom = |bytes: usize| CoreError::OutOfMemory {
            bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
        };
        let mut order = Vec::new();
        order
            .try_reserve_exact(n as usize)
            .map_err(|_| oom(n as usize * 4))?;
        order.extend(0..n);
        let mut nodes = Vec::new();
        build_sah(
            |tri| Aabb::of_triangle(&mesh.triangle(tri)),
            &mut order,
            0..n,
            LEAF_TRIANGLES,
            &mut nodes,
            &mut SahScratch::default(),
        )
        .map_err(|_| oom(n as usize * 32))?;
        nodes.shrink_to_fit();
        let bounds = nodes.first().map_or(Aabb::EMPTY, Node::bounds);
        Ok(MeshBvh {
            nodes,
            order,
            bounds,
        })
    }

    /// The nodes; node 0 is the root.
    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    /// The triangle index of each leaf entry.
    pub fn order(&self) -> &[u32] {
        &self.order
    }

    /// The box around every triangle.
    pub fn bounds(&self) -> Aabb {
        self.bounds
    }

    /// The number of triangles.
    pub fn triangle_count(&self) -> u32 {
        self.order.len() as u32
    }

    /// The bytes the tree holds, apart from the mesh's own arrays.
    pub fn memory_bytes(&self) -> usize {
        self.nodes.len() * super::NODE_BYTES + self.order.len() * 4
    }

    /// The closest hit of the ray on the mesh, or `None`.
    pub fn raycast(&self, mesh: &impl Triangles, ray: &Ray, side: Side) -> Option<TriangleHit> {
        if self.nodes.is_empty() {
            return None;
        }
        let mut best: Option<TriangleHit> = None;
        let mut near = *ray;
        walk_near_first(&self.nodes, 0, ray, |first, count, t_max| {
            near.t_max = t_max;
            for &tri in &self.order[first as usize..(first + count) as usize] {
                if let Some((t, u, v, front)) = ray_triangle(&near, &mesh.triangle(tri), side) {
                    near.t_max = t;
                    best = Some(TriangleHit {
                        t,
                        triangle: tri,
                        u,
                        v,
                        front,
                    });
                }
            }
            near.t_max
        });
        best
    }

    /// True when the ray hits any triangle. It stops at the first hit it finds.
    pub fn raycast_any(&self, mesh: &impl Triangles, ray: &Ray, side: Side) -> bool {
        !self.nodes.is_empty()
            && walk_any(&self.nodes, 0, ray, |first, count| {
                self.order[first as usize..(first + count) as usize]
                    .iter()
                    .any(|&tri| ray_triangle(ray, &mesh.triangle(tri), side).is_some())
            })
    }

    /// Calls `visit` with every hit of the ray, in no set order.
    pub fn raycast_all(
        &self,
        mesh: &impl Triangles,
        ray: &Ray,
        side: Side,
        mut visit: impl FnMut(TriangleHit),
    ) {
        if self.nodes.is_empty() {
            return;
        }
        walk_any(&self.nodes, 0, ray, |first, count| {
            for &tri in &self.order[first as usize..(first + count) as usize] {
                if let Some((t, u, v, front)) = ray_triangle(ray, &mesh.triangle(tri), side) {
                    visit(TriangleHit {
                        t,
                        triangle: tri,
                        u,
                        v,
                        front,
                    });
                }
            }
            false
        });
    }

    /// Refits the boxes to the mesh's current positions, keeping the tree's shape: for a mesh
    /// whose vertices moved. Queries stay exact; they slow down as the shape drifts from the
    /// build's.
    ///
    /// # Panics
    /// When the mesh has fewer triangles than the tree.
    pub fn refit(&mut self, mesh: &impl Triangles) {
        assert!(mesh.count() >= self.triangle_count());
        refit_nodes(&mut self.nodes, &self.order, |tri| {
            Aabb::of_triangle(&mesh.triangle(tri))
        });
        self.bounds = self.nodes.first().map_or(Aabb::EMPTY, Node::bounds);
    }
}

/// The closest hit by testing every triangle: the reference that tests compare trees with.
pub fn raycast_brute_force(mesh: &impl Triangles, ray: &Ray, side: Side) -> Option<TriangleHit> {
    let mut ray = *ray;
    let mut best = None;
    for tri in 0..mesh.count() {
        if let Some((t, u, v, front)) = ray_triangle(&ray, &mesh.triangle(tri), side) {
            ray.t_max = t;
            best = Some(TriangleHit {
                t,
                triangle: tri,
                u,
                v,
                front,
            });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn faces_follow_the_winding() {
        let tri = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        // Counterclockwise seen from +z: a ray down -z sees the front.
        let down = Ray::new([0.25, 0.25, 1.0], [0.0, 0.0, -1.0]);
        let up = Ray::new([0.25, 0.25, -1.0], [0.0, 0.0, 1.0]);
        let (t, u, v, front) = ray_triangle(&down, &tri, Side::Front).unwrap();
        assert_eq!((t, u, v, front), (1.0, 0.25, 0.25, true));
        assert!(ray_triangle(&up, &tri, Side::Front).is_none());
        assert!(!ray_triangle(&up, &tri, Side::Back).unwrap().3);
        assert!(ray_triangle(&up, &tri, Side::Double).is_some());
        assert!(ray_triangle(&down.with_max(0.5), &tri, Side::Front).is_none());
    }

    #[test]
    fn small_meshes_build_and_answer() {
        let positions = [
            0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, -1.0, 1.0, 0.0, -1.0, 0.0, 1.0, -1.0,
        ];
        let mesh = TriangleSoup {
            positions: &positions,
        };
        let bvh = MeshBvh::build(&mesh).unwrap();
        assert_eq!(bvh.nodes().len(), 1);
        let ray = Ray::new([0.2, 0.2, 1.0], [0.0, 0.0, -1.0]);
        let hit = bvh.raycast(&mesh, &ray, Side::Front).unwrap();
        assert_eq!((hit.t, hit.triangle), (1.0, 0));
        assert!(bvh.raycast_any(&mesh, &ray, Side::Front));
        let mut all = Vec::new();
        bvh.raycast_all(&mesh, &ray, Side::Front, |h| all.push(h.triangle));
        all.sort();
        assert_eq!(all, [0, 1]);
        let empty = MeshBvh::build(&TriangleSoup { positions: &[] }).unwrap();
        assert!(empty.raycast(&mesh, &ray, Side::Front).is_none());
        assert!(!empty.raycast_any(&mesh, &ray, Side::Front));
    }

    #[test]
    fn indices_past_the_positions_never_hit() {
        let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        let indices: [u16; 6] = [0, 1, 2, 0, 1, 9];
        let mesh = IndexedTriangles {
            positions: &positions,
            indices: &indices,
        };
        let bvh = MeshBvh::build(&mesh).unwrap();
        let ray = Ray::new([0.2, 0.2, 1.0], [0.0, 0.0, -1.0]);
        let mut all = Vec::new();
        bvh.raycast_all(&mesh, &ray, Side::Double, |h| all.push(h.triangle));
        assert_eq!(all, [0]);
    }
}
