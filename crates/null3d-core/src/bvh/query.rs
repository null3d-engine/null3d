//! Queries over a scene: raycasts and overlap tests against the triangles of its objects and
//! instance rows.
//!
//! [`SceneQueries`] keeps the scene's trees ([`SceneBvh`]) and one tree per mesh. Each query
//! first syncs them with [`SceneQueries::sync`], which costs nothing more in the same frame. A
//! query then walks the scene's trees to the items whose boxes it meets, and tests each item's
//! triangles through its mesh's tree, in the mesh's own space.
//!
//! # What a query tests
//!
//! - Items whose layer mask shares a bit with the query's mask. Hidden objects never count.
//! - Each triangle as its material draws it: front faces only, or both faces for a
//!   double-sided material, as three.js's `Raycaster` tests a material's `side`.
//! - Positions of the scene's last world output: the frame's transform update and any late
//!   update, and each batch's last update.
//!
//! An overlap query finds the items with a triangle inside the volume or crossing its
//! surface. A volume inside a closed mesh, which touches none of its triangles, does not find
//! it.
//!
//! # Mesh trees
//!
//! A sync builds the tree of each mesh that has none yet, on the job workers, so the first query
//! after a mesh is created pays for its tree. Meshes are never destroyed, so each tree is built
//! once. A mesh from a model file can bring the tree that the asset tool stored
//! ([`SceneQueries::store_mesh_bvh`]), which the sync then uses instead of building one.

use std::sync::atomic::{AtomicBool, Ordering};

use super::mesh::{MeshBvh, Side, Triangles};
use super::scene::{NO_MESH, SceneBvh, Source};
use super::top::WorldRay;
use super::{Aabb, Ray};
use crate::CoreError;
use crate::instances::BatchTable;
use crate::jobs::JobSystem;
use crate::math::{Affine, invert64};
use crate::scene::SceneStorage;
use crate::shared::SharedMut;

/// Rays per chunk of [`SceneQueries::raycast_batch`] on the job workers.
pub const RAY_CHUNK: u32 = 64;

/// The meshes and materials that queries test: each mesh's triangles, in the mesh's own space,
/// and the faces each material draws. Mesh ids run from 1 to [`QueryMeshes::count`].
pub trait QueryMeshes: Sync {
    /// A mesh's triangles.
    type Mesh<'a>: Triangles + Sync
    where
        Self: 'a;

    /// The number of meshes.
    fn count(&self) -> u32;

    /// The triangles of mesh `id`, or `None` for an id that names no mesh.
    fn mesh(&self, id: u32) -> Option<Self::Mesh<'_>>;

    /// The faces that material `id` draws.
    fn side(&self, material: u32) -> Side;
}

/// Everything a query reads: the scene, its instance batches and its meshes.
pub struct QueryScene<'a, M: QueryMeshes> {
    /// The scene's objects.
    pub scene: &'a SceneStorage,
    /// The scene's instance batches.
    pub batches: &'a BatchTable,
    /// The meshes and materials.
    pub meshes: &'a M,
}

/// A hit of a query.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QueryHit {
    /// The object or batch row that the query found.
    pub source: Source,
    /// The distance along the ray, in multiples of its direction; 0 for overlap queries.
    pub distance: f32,
    /// The triangle's index in its mesh; 0 for overlap queries.
    pub triangle: u32,
    /// Where the ray hit, from the origin of the world.
    pub point: [f64; 3],
    /// The unit normal of the triangle in the world, on the side that faces the ray's origin.
    pub normal: [f32; 3],
}

impl QueryHit {
    /// A hit on `source` with no ray, as overlap queries find them.
    fn overlap(source: Source) -> QueryHit {
        QueryHit {
            source,
            distance: 0.0,
            triangle: 0,
            point: [0.0; 3],
            normal: [0.0; 3],
        }
    }
}

/// What a query needs of one item: its world matrix relative to its cell, its mesh and the
/// faces its material draws.
struct Item<'a> {
    matrix: &'a Affine,
    mesh: u32,
    side: Side,
}

/// A ray's hit on one item, before its point and normal are known.
#[derive(Clone, Copy, Debug, Default)]
struct RawHit {
    id: u32,
    t: f32,
    triangle: u32,
}

/// The scene's trees, each mesh's tree, and the reused lists that queries fill. See the module
/// documentation.
#[derive(Debug, Default)]
pub struct SceneQueries {
    bvh: SceneBvh,
    /// Each mesh's tree, by mesh id less one.
    trees: Vec<MeshBvh>,
    /// Stored trees of meshes that have no tree in `trees` yet, by mesh id.
    stored: Vec<(u32, MeshBvh)>,
    raw: Vec<RawHit>,
    hits: Vec<QueryHit>,
    batch: Vec<Option<QueryHit>>,
}

#[inline(always)]
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline(always)]
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline(always)]
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// A point moved by a 3 × 4 matrix, in 64-bit floats.
#[inline(always)]
fn apply(m: &Affine, p: [f32; 3]) -> [f64; 3] {
    std::array::from_fn(|r| {
        f64::from(m[r * 4]) * f64::from(p[0])
            + f64::from(m[r * 4 + 1]) * f64::from(p[1])
            + f64::from(m[r * 4 + 2]) * f64::from(p[2])
            + f64::from(m[r * 4 + 3])
    })
}

/// A triangle's corners moved by `m`, an item's world matrix, into its cell's frame: the
/// corners that overlap queries test.
#[inline(always)]
pub fn triangle_in_cell(m: &Affine, v: &[[f32; 3]; 3]) -> [[f64; 3]; 3] {
    v.map(|p| apply(m, p))
}

/// The squared distance from `p` to the segment from `a` to `b`.
fn segment_distance2(p: [f64; 3], a: [f64; 3], b: [f64; 3]) -> f64 {
    let ab = sub(b, a);
    let ap = sub(p, a);
    let len2 = dot(ab, ab);
    let s = if len2 > 0.0 {
        (dot(ap, ab) / len2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let d = sub(ap, ab.map(|v| v * s));
    dot(d, d)
}

/// True when the sphere touches the triangle: some point of the triangle lies within `radius`
/// of the centre. A triangle with no area is tested as its edges.
pub fn sphere_touches_triangle(center: [f64; 3], radius: f64, v: &[[f64; 3]; 3]) -> bool {
    let r2 = radius * radius;
    let n = cross(sub(v[1], v[0]), sub(v[2], v[0]));
    let n2 = dot(n, n);
    if n2 > 0.0 {
        // Inside the triangle's prism, the nearest point lies on its face.
        let inside = (0..3).all(|k| {
            let (a, b) = (v[k], v[(k + 1) % 3]);
            dot(cross(sub(b, a), sub(center, a)), n) >= 0.0
        });
        if inside {
            let h = dot(sub(center, v[0]), n);
            return h * h <= r2 * n2;
        }
    }
    (0..3).any(|k| segment_distance2(center, v[k], v[(k + 1) % 3]) <= r2)
}

/// True when the triangle touches the box, by the separating axis test of Akenine-Möller
/// ("Fast 3D triangle-box overlap testing", 2001): the box's three axes, the triangle's normal,
/// and the nine cross products of the box's axes with the triangle's edges.
pub fn box_touches_triangle(b: &Aabb, v: &[[f64; 3]; 3]) -> bool {
    let c: [f64; 3] = std::array::from_fn(|k| (f64::from(b.min[k]) + f64::from(b.max[k])) * 0.5);
    let h: [f64; 3] = std::array::from_fn(|k| (f64::from(b.max[k]) - f64::from(b.min[k])) * 0.5);
    let p = v.map(|q| sub(q, c));
    // The box's axes.
    for k in 0..3 {
        let lo = p[0][k].min(p[1][k]).min(p[2][k]);
        let hi = p[0][k].max(p[1][k]).max(p[2][k]);
        if lo > h[k] || hi < -h[k] {
            return false;
        }
    }
    let edges = [sub(p[1], p[0]), sub(p[2], p[1]), sub(p[0], p[2])];
    let separates = |axis: [f64; 3]| {
        let r = h[0] * axis[0].abs() + h[1] * axis[1].abs() + h[2] * axis[2].abs();
        let d = p.map(|q| dot(q, axis));
        let lo = d[0].min(d[1]).min(d[2]);
        let hi = d[0].max(d[1]).max(d[2]);
        lo > r || hi < -r
    };
    // The triangle's plane.
    if separates(cross(edges[0], edges[1])) {
        return false;
    }
    for e in edges {
        for k in 0..3 {
            let mut unit = [0.0; 3];
            unit[k] = 1.0;
            if separates(cross(unit, e)) {
                return false;
            }
        }
    }
    true
}

/// The box around `b`, a box in the frame of an item's cell, in the item's own space; `None`
/// when the item's matrix cannot be inverted.
fn local_box(m: &Affine, b: &Aabb) -> Option<Aabb> {
    let inverse = invert64(&m.map(f64::from))?;
    Some(b.transformed(&inverse.map(|v| v as f32)))
}

/// The unit normal in the world of a triangle that `m` moves, on the side that faces against
/// `direction`. The normal moves by the inverse transpose of the matrix, which is the matrix of
/// its cofactors up to a scale; the scale's sign does not matter, because the normal then turns
/// to face the ray.
fn world_normal(m: &Affine, v: &[[f32; 3]; 3], direction: [f32; 3]) -> [f32; 3] {
    let p = v.map(|q| q.map(f64::from));
    let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    let column = |k: usize| [m[k], m[4 + k], m[8 + k]].map(f64::from);
    let (a0, a1, a2) = (column(0), column(1), column(2));
    let (c0, c1, c2) = (cross(a1, a2), cross(a2, a0), cross(a0, a1));
    let mut w: [f64; 3] = std::array::from_fn(|k| c0[k] * n[0] + c1[k] * n[1] + c2[k] * n[2]);
    if dot(w, direction.map(f64::from)) > 0.0 {
        w = w.map(|x| -x);
    }
    let len = dot(w, w).sqrt();
    if len > 0.0 {
        w.map(|x| (x / len) as f32)
    } else {
        [0.0; 3]
    }
}

impl SceneQueries {
    /// Empty trees and lists. They allocate nothing until the first sync.
    pub fn new() -> Self {
        Self::default()
    }

    /// Makes room for `hits` hits in the lists that queries fill, so queries that find at most
    /// that many allocate nothing. The lists also grow as queries need, and never shrink.
    ///
    /// # Errors
    /// [`CoreError::OutOfMemory`] when the lists cannot grow.
    pub fn reserve(&mut self, hits: u32) -> Result<(), CoreError> {
        let n = hits as usize;
        let oom = |_| CoreError::OutOfMemory {
            bytes: hits.saturating_mul(std::mem::size_of::<QueryHit>() as u32),
        };
        self.raw
            .try_reserve(n.saturating_sub(self.raw.len()))
            .map_err(oom)?;
        self.hits
            .try_reserve(n.saturating_sub(self.hits.len()))
            .map_err(oom)
    }

    /// The scene's trees.
    pub fn scene_bvh(&self) -> &SceneBvh {
        &self.bvh
    }

    /// The tree of mesh `id`, once a sync built it.
    pub fn mesh_bvh(&self, id: u32) -> Option<&MeshBvh> {
        self.trees.get(id.checked_sub(1)? as usize)
    }

    /// Gives mesh `id` a tree that was built before, such as one that a model file stores, which
    /// a sync then uses instead of building one. The caller has checked it against the mesh's
    /// triangles with [`MeshBvh::from_bytes`]. A mesh that has a tree already keeps it: both give
    /// the same hits.
    ///
    /// # Errors
    /// [`CoreError::OutOfMemory`] when the list of stored trees cannot grow.
    pub fn store_mesh_bvh(&mut self, id: u32, tree: MeshBvh) -> Result<(), CoreError> {
        let Some(index) = id.checked_sub(1) else {
            return Ok(());
        };
        if (index as usize) < self.trees.len() {
            return Ok(());
        }
        self.stored
            .try_reserve(1)
            .map_err(|_| CoreError::OutOfMemory {
                bytes: std::mem::size_of::<(u32, MeshBvh)>() as u32,
            })?;
        self.stored.retain(|(m, _)| *m != id);
        self.stored.push((id, tree));
        Ok(())
    }

    /// Builds the trees of the meshes that have none, on the job workers, and brings the
    /// scene's trees up to date (see [`SceneBvh::sync`]). Call it before the queries of a frame.
    ///
    /// # Errors
    /// [`CoreError::OutOfMemory`] when a tree cannot grow. Queries then find nothing until a
    /// sync succeeds.
    pub fn sync<M: QueryMeshes>(
        &mut self,
        view: &QueryScene<'_, M>,
        jobs: &JobSystem,
    ) -> Result<(), CoreError> {
        self.build_mesh_trees(view.meshes, jobs)?;
        let trees = &self.trees;
        let bounds = |mesh: u32| match mesh.checked_sub(1) {
            Some(i) => trees.get(i as usize).map_or(Aabb::EMPTY, MeshBvh::bounds),
            None => Aabb::EMPTY,
        };
        self.bvh.sync(view.scene, view.batches, jobs, &bounds)
    }

    fn build_mesh_trees<M: QueryMeshes>(
        &mut self,
        meshes: &M,
        jobs: &JobSystem,
    ) -> Result<(), CoreError> {
        let first = self.trees.len() as u32;
        let count = meshes.count();
        if count <= first {
            return Ok(());
        }
        let more = (count - first) as usize;
        self.trees
            .try_reserve_exact(more)
            .map_err(|_| CoreError::OutOfMemory {
                bytes: u32::try_from(more * std::mem::size_of::<MeshBvh>()).unwrap_or(u32::MAX),
            })?;
        self.trees.resize_with(count as usize, MeshBvh::default);
        // Stored trees take their places, and the jobs build the others.
        let mut built = vec![false; more];
        for (id, tree) in self.stored.drain(..) {
            let Some(k) = (id - 1).checked_sub(first) else {
                continue;
            };
            if let (Some(slot), Some(done)) = (
                self.trees.get_mut((first + k) as usize),
                built.get_mut(k as usize),
            ) {
                *slot = tree;
                *done = true;
            }
        }
        let failed = AtomicBool::new(false);
        let out = SharedMut::new(&mut self.trees[first as usize..]);
        let built = &built;
        jobs.parallel_for(count - first, 1, &|range, _| {
            for k in range {
                if built[k as usize] {
                    continue;
                }
                let tree = meshes
                    .mesh(first + k + 1)
                    .map_or(Ok(MeshBvh::default()), |mesh| MeshBvh::build(&mesh));
                match tree {
                    // SAFETY: each chunk writes only the trees of its own meshes, whose empty
                    // trees hold no memory to drop.
                    Ok(tree) => unsafe { out.write(k as usize, tree) },
                    Err(_) => failed.store(true, Ordering::Relaxed),
                }
            }
        });
        if failed.into_inner() {
            self.trees.truncate(first as usize);
            return Err(CoreError::OutOfMemory { bytes: u32::MAX });
        }
        Ok(())
    }

    /// The item with id `id`, when its layer mask shares a bit with `layers` and it is shown.
    fn item<'a, M: QueryMeshes>(
        &self,
        view: &QueryScene<'a, M>,
        id: u32,
        layers: u32,
    ) -> Option<Item<'a>> {
        match self.bvh.source(id) {
            Source::Object(slot) => {
                let (scene, s) = (view.scene, slot as usize);
                let world = scene.world(scene.parity());
                let shown = world.radii()[s] >= 0.0 && scene.layers()[s] & layers != 0;
                shown.then(|| Item {
                    matrix: world.matrix(s),
                    mesh: scene.meshes()[s],
                    side: view.meshes.side(scene.materials()[s]),
                })
            }
            Source::Row { batch, row } => {
                let batch = view.batches.get(batch).ok()?;
                let world = batch.current_world();
                let r = row as usize;
                let shown = world.radii()[r] >= 0.0 && batch.layers() & layers != 0;
                shown.then(|| Item {
                    matrix: world.matrix(r),
                    mesh: batch.mesh(),
                    side: view.meshes.side(batch.material()),
                })
            }
        }
    }

    /// The mesh tree and triangles of an item's mesh.
    fn mesh_of<'m, M: QueryMeshes>(
        &self,
        meshes: &'m M,
        mesh: u32,
    ) -> Option<(&MeshBvh, M::Mesh<'m>)> {
        if mesh == NO_MESH {
            return None;
        }
        Some((self.mesh_bvh(mesh)?, meshes.mesh(mesh)?))
    }

    /// The ray's closest hit on an item, within the ray's limits: its distance and triangle.
    fn item_raycast<M: QueryMeshes>(
        &self,
        view: &QueryScene<'_, M>,
        id: u32,
        ray: &Ray,
        layers: u32,
    ) -> Option<(f32, u32)> {
        let item = self.item(view, id, layers)?;
        let (tree, mesh) = self.mesh_of(view.meshes, item.mesh)?;
        let local = ray.to_local(item.matrix)?;
        tree.raycast(&mesh, &local, item.side)
            .map(|hit| (hit.t, hit.triangle))
    }

    /// A hit with its point and normal in the world.
    fn finish<M: QueryMeshes>(
        &self,
        view: &QueryScene<'_, M>,
        ray: &WorldRay,
        hit: RawHit,
    ) -> QueryHit {
        let mut normal = [0.0; 3];
        if let Some(item) = self.item(view, hit.id, u32::MAX)
            && let Some(mesh) = view.meshes.mesh(item.mesh)
        {
            normal = world_normal(item.matrix, &mesh.triangle(hit.triangle), ray.direction);
        }
        let t = f64::from(hit.t);
        QueryHit {
            source: self.bvh.source(hit.id),
            distance: hit.t,
            triangle: hit.triangle,
            point: std::array::from_fn(|k| ray.origin[k] + t * f64::from(ray.direction[k])),
            normal,
        }
    }

    /// The ray's closest hit on the items on `layers`, or `None`. Of hits at the same distance,
    /// the one the walk reaches last counts.
    pub fn raycast<M: QueryMeshes>(
        &self,
        view: &QueryScene<'_, M>,
        ray: &WorldRay,
        layers: u32,
    ) -> Option<QueryHit> {
        let mut triangle = 0;
        let (id, t) = self.bvh.raycast(ray, |id, ray| {
            let (t, tri) = self.item_raycast(view, id, ray, layers)?;
            triangle = tri;
            Some(t)
        })?;
        Some(self.finish(view, ray, RawHit { id, t, triangle }))
    }

    /// True when the ray hits any item on `layers`. It stops at the first hit it finds.
    pub fn raycast_any<M: QueryMeshes>(
        &self,
        view: &QueryScene<'_, M>,
        ray: &WorldRay,
        layers: u32,
    ) -> bool {
        self.bvh.raycast_any(ray, |id, ray| {
            let Some(item) = self.item(view, id, layers) else {
                return false;
            };
            let Some((tree, mesh)) = self.mesh_of(view.meshes, item.mesh) else {
                return false;
            };
            ray.to_local(item.matrix)
                .is_some_and(|local| tree.raycast_any(&mesh, &local, item.side))
        })
    }

    /// Every hit of the ray on the items on `layers`, one per triangle it crosses, nearest
    /// first. Hits at the same distance come in the order of their items' ids, then of their
    /// triangles.
    pub fn raycast_all<M: QueryMeshes>(
        &mut self,
        view: &QueryScene<'_, M>,
        ray: &WorldRay,
        layers: u32,
    ) -> &[QueryHit] {
        let mut raw = std::mem::take(&mut self.raw);
        raw.clear();
        self.bvh.raycast_all(ray, |id, cell_ray| {
            let Some(item) = self.item(view, id, layers) else {
                return;
            };
            let Some((tree, mesh)) = self.mesh_of(view.meshes, item.mesh) else {
                return;
            };
            if let Some(local) = cell_ray.to_local(item.matrix) {
                tree.raycast_all(&mesh, &local, item.side, |hit| {
                    raw.push(RawHit {
                        id,
                        t: hit.t,
                        triangle: hit.triangle,
                    });
                });
            }
        });
        super::heap_sort_by(&mut raw, |a, b| {
            a.t.total_cmp(&b.t)
                .then(a.id.cmp(&b.id))
                .then(a.triangle.cmp(&b.triangle))
                .is_lt()
        });
        let mut hits = std::mem::take(&mut self.hits);
        hits.clear();
        hits.extend(raw.iter().map(|&hit| self.finish(view, ray, hit)));
        self.raw = raw;
        self.hits = hits;
        &self.hits
    }

    /// The closest hit of each of `count` rays, which `ray` gives by index, on the items on
    /// `layers`, on the job workers. The result of ray `i` is entry `i`, and a miss where `ray`
    /// gives `None`.
    pub fn raycast_batch<M: QueryMeshes>(
        &mut self,
        view: &QueryScene<'_, M>,
        jobs: &JobSystem,
        count: u32,
        ray: &(dyn Fn(u32) -> Option<WorldRay> + Sync),
        layers: u32,
    ) -> Result<&[Option<QueryHit>], CoreError> {
        let mut out = std::mem::take(&mut self.batch);
        out.clear();
        if out.capacity() < count as usize {
            out.try_reserve_exact(count as usize)
                .map_err(|_| CoreError::OutOfMemory {
                    bytes: count.saturating_mul(std::mem::size_of::<QueryHit>() as u32),
                })?;
        }
        out.resize(count as usize, None);
        {
            let shared = SharedMut::new(&mut out);
            let queries = &*self;
            jobs.parallel_for(count, RAY_CHUNK, &|range, _| {
                for i in range {
                    let hit = ray(i).and_then(|ray| queries.raycast(view, &ray, layers));
                    // SAFETY: each chunk writes only the results of its own rays.
                    unsafe { shared.write(i as usize, hit) };
                }
            });
        }
        self.batch = out;
        Ok(&self.batch)
    }

    /// Every item on `layers` with a triangle within `radius` of `center`, in no set order.
    pub fn overlap_sphere<M: QueryMeshes>(
        &mut self,
        view: &QueryScene<'_, M>,
        center: [f64; 3],
        radius: f32,
        layers: u32,
    ) -> &[QueryHit] {
        let mut hits = std::mem::take(&mut self.hits);
        hits.clear();
        self.bvh.overlap_sphere(center, radius, |id, c| {
            let around = Aabb::of_sphere(c, radius);
            let c = c.map(f64::from);
            let r = f64::from(radius);
            if self.item_overlaps(view, id, layers, &around, |v| {
                sphere_touches_triangle(c, r, v)
            }) {
                hits.push(QueryHit::overlap(self.bvh.source(id)));
            }
        });
        self.hits = hits;
        &self.hits
    }

    /// Every item on `layers` with a triangle inside the box from `min` to `max`, or crossing
    /// it, in no set order.
    pub fn overlap_box<M: QueryMeshes>(
        &mut self,
        view: &QueryScene<'_, M>,
        min: [f64; 3],
        max: [f64; 3],
        layers: u32,
    ) -> &[QueryHit] {
        let mut hits = std::mem::take(&mut self.hits);
        hits.clear();
        self.bvh.overlap_box(min, max, |id, b| {
            if self.item_overlaps(view, id, layers, b, |v| box_touches_triangle(b, v)) {
                hits.push(QueryHit::overlap(self.bvh.source(id)));
            }
        });
        self.hits = hits;
        &self.hits
    }

    /// True when `touches` passes a triangle of the item, moved into its cell's frame, among the
    /// triangles near `around`, a box in that frame.
    fn item_overlaps<M: QueryMeshes>(
        &self,
        view: &QueryScene<'_, M>,
        id: u32,
        layers: u32,
        around: &Aabb,
        touches: impl Fn(&[[f64; 3]; 3]) -> bool,
    ) -> bool {
        let Some(item) = self.item(view, id, layers) else {
            return false;
        };
        let Some((tree, mesh)) = self.mesh_of(view.meshes, item.mesh) else {
            return false;
        };
        let Some(local) = local_box(item.matrix, around) else {
            return false;
        };
        tree.overlap(&local, |tri| {
            touches(&triangle_in_cell(item.matrix, &mesh.triangle(tri)))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRI: [[f64; 3]; 3] = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];

    #[test]
    fn spheres_touch_faces_edges_and_corners() {
        // Above the face.
        assert!(sphere_touches_triangle([0.25, 0.25, 0.5], 0.5, &TRI));
        assert!(!sphere_touches_triangle([0.25, 0.25, 0.5], 0.49, &TRI));
        // Beside the long edge, and past a corner.
        // Half a meter out from the middle of the long edge, along its outward normal.
        let off = 0.5 + 0.5 / 2f64.sqrt();
        assert!(sphere_touches_triangle([off, off, 0.0], 0.51, &TRI));
        assert!(!sphere_touches_triangle([off, off, 0.0], 0.49, &TRI));
        assert!(sphere_touches_triangle([-1.0, 0.0, 0.0], 1.0, &TRI));
        assert!(!sphere_touches_triangle([-1.0, -1.0, 0.0], 1.0, &TRI));
        // A triangle with no area is its edges.
        let line = [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [1.0, 0.0, 0.0]];
        assert!(sphere_touches_triangle([1.0, 1.0, 0.0], 1.0, &line));
        assert!(!sphere_touches_triangle([1.0, 1.0, 0.0], 0.9, &line));
    }

    #[test]
    fn boxes_touch_triangles_that_cross_them() {
        let b = |min: [f32; 3], max: [f32; 3]| Aabb { min, max };
        assert!(box_touches_triangle(
            &b([0.2, 0.2, -1.0], [0.3, 0.3, 1.0]),
            &TRI
        ));
        // Beyond the long edge: only the edge's cross product separates them.
        assert!(!box_touches_triangle(
            &b([0.6, 0.6, -1.0], [0.7, 0.7, 1.0]),
            &TRI
        ));
        // Above the face: the plane separates them.
        assert!(!box_touches_triangle(
            &b([0.1, 0.1, 0.1], [0.2, 0.2, 0.2]),
            &TRI
        ));
        // A triangle inside the box.
        assert!(box_touches_triangle(
            &b([-1.0, -1.0, -1.0], [2.0, 2.0, 2.0]),
            &TRI
        ));
    }

    #[test]
    fn normals_face_the_ray_through_any_matrix() {
        let tri = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        // Scaled by -2 along x: a mirror, which turns the winding over.
        let m = [
            -2.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0,
        ];
        assert_eq!(world_normal(&m, &tri, [0.0, 0.0, -1.0]), [0.0, 0.0, 1.0]);
        assert_eq!(world_normal(&m, &tri, [0.0, 0.0, 1.0]), [0.0, 0.0, -1.0]);
        // Sheared: the normal stays at right angles to the moved triangle.
        let shear = [
            1.0, 0.0, 1.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0,
        ];
        let tilted = [[0.0, 0.0, 0.0], [1.0, 0.0, 1.0], [0.0, 1.0, 0.0]];
        let n = world_normal(&shear, &tilted, [0.0, 0.0, -1.0]).map(f64::from);
        let moved = triangle_in_cell(&shear, &tilted);
        assert!(dot(n, sub(moved[1], moved[0])).abs() < 1e-6);
        assert!(dot(n, sub(moved[2], moved[0])).abs() < 1e-6);
    }
}
