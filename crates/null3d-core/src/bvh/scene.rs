//! The scene's top level: one tree over static objects and one over dynamic objects, kept in step
//! with [`SceneStorage`] and the instance batches of a [`BatchTable`].
//!
//! # Items
//!
//! Each scene object with a mesh is one item, whose id is its slot. Each active row of an
//! instance batch is one item too, whose id counts on from the last slot: the rows of each batch
//! take a run of ids, in the order of the batches' ids. [`SceneBvh::source`] turns an id back
//! into a slot or a batch row. Rows of a static batch join the static tree, and rows of a
//! dynamic batch the dynamic tree. A batch's rows are the ones its last update wrote: its active
//! rows then.
//!
//! An item's box is its mesh's own box (see [`super::mesh::MeshBvh::bounds`]) moved by the
//! item's world matrix, widened a little (see [`Aabb::transformed`]). That box holds every
//! triangle that the item draws, so a query that tests the triangles finds every hit. It is
//! also tighter than the box around the bounding sphere, and it holds the mesh even when a
//! sketch gives the object smaller bounds of its own. A hidden object has an empty box, which
//! no query meets.
//!
//! The rows of sprite, point and line batches pack their own values into their matrices (see
//! [`super::rows`]), so their boxes come from those values: a sprite's sphere, as culling takes
//! it, or a segment's box grown by half a width in world units. A sprite or a line sized in
//! pixels of the screen has no size in the world, so its box holds only its anchor or its center
//! line, and a query grows every box by its [`Reach`] instead (see [`SceneBvh::reach`]). The
//! trees keep the largest size in pixels of each such batch for it.
//!
//! # Syncs
//!
//! [`SceneBvh::sync`] brings both trees up to date with the scene's last world output, and only
//! does the work that the changes since the last sync need:
//!
//! | Since the last sync | Static tree | Dynamic tree |
//! | --- | --- | --- |
//! | Nothing | kept | kept |
//! | A new frame or transform update | kept | rebuilt |
//! | Static objects moved within their cells, or were shown or hidden | refitted | rebuilt |
//! | Rows of a static batch were updated, and kept their cells | refitted | rebuilt |
//! | A static object or row changed cell | rebuilt | rebuilt |
//! | An object was created or destroyed, or changed its mesh, or between static and dynamic | rebuilt | rebuilt |
//! | A batch was created or destroyed, or its active rows changed | rebuilt | rebuilt |
//!
//! The engine calls it only before a query, so a frame without queries costs nothing. After the
//! first sync of a scene, a sync allocates nothing until the scene holds more items than it
//! ever did.

use std::collections::TryReserveError;

use super::rows::RowQuery;
use super::top::{TopTree, WorldRay};
use super::{Aabb, Ray, Reach};
use crate::CoreError;
use crate::handle::Handle;
use crate::instances::{BatchTable, InstanceBatch};
use crate::jobs::JobSystem;
use crate::scene::{SceneStorage, flags};

/// The mesh id of an object without a mesh, which queries never find.
pub const NO_MESH: u32 = 0;

/// What an item of the trees is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// The scene object in this slot.
    Object(u32),
    /// A row of an instance batch.
    Row {
        /// The batch's id.
        batch: Handle,
        /// The row.
        row: u32,
    },
}

/// The rows of one instance batch that the trees hold.
#[derive(Clone, Copy, Debug, PartialEq)]
struct BatchRows {
    batch: Handle,
    /// The item id of row 0.
    first: u32,
    /// The number of rows: the active rows of the batch's last update.
    rows: u32,
    dynamic: bool,
    /// The index of row 0 among its tree's items.
    item: u32,
    /// The batch's last update frame, and its version then.
    frame: u32,
    version: u32,
    /// The largest reach of a row around its anchor or center line in CSS pixels, for a batch
    /// sized in pixels of the screen; 0 for any other.
    screen_reach: f32,
}

/// The rows of `batch` that its last update wrote, or `None` before its first update.
fn rows_of(batch: &InstanceBatch) -> Option<u32> {
    let frame = batch.frame();
    (frame != 0).then(|| batch.frame_active_count((frame & 1) as usize))
}

/// How the trees bound the rows of one batch.
#[derive(Clone, Copy, Debug)]
enum RowBounds {
    /// Rows that place a mesh, whose box in its own space this is.
    Mesh(Aabb),
    /// Sprites sized in world units: the sphere around each, as culling takes it.
    Sphere,
    /// Sprites sized in pixels: their anchors. A query's reach holds the rest.
    Anchor,
    /// Line segments: the box around each, grown by half a width in world units, or by 0 for a
    /// width in pixels.
    Segment(f32),
    /// Rows that draw nothing: segments of no width.
    Nothing,
}

impl RowBounds {
    /// How the trees bound the rows of `batch`, whose mesh's box `mesh_bounds` gives.
    fn of(batch: &InstanceBatch, mesh_bounds: &dyn Fn(u32) -> Aabb) -> RowBounds {
        if let Some(look) = batch.sprite_look() {
            return if look.screen_size {
                RowBounds::Anchor
            } else {
                RowBounds::Sphere
            };
        }
        match batch.line_look() {
            Some(look) if look.width == 0.0 => RowBounds::Nothing,
            Some(look) => RowBounds::Segment(if look.world_units {
                0.5 * look.width
            } else {
                0.0
            }),
            None => RowBounds::Mesh(mesh_bounds(batch.mesh())),
        }
    }

    /// The box of a row with world radius `radius` and world matrix `m`, or the empty box for a
    /// hidden row, whose radius is negative. It stays out of line: the syncs call it from several
    /// places, and a call costs little beside the box's arithmetic.
    #[inline(never)]
    fn of_row(&self, radius: f32, m: &crate::math::Affine) -> Aabb {
        if radius.is_nan() || radius < 0.0 {
            return Aabb::EMPTY;
        }
        let at = [m[3], m[7], m[11]];
        match *self {
            RowBounds::Mesh(mesh) => mesh.transformed(m),
            RowBounds::Sphere => Aabb::of_sphere(at, radius).widened(),
            RowBounds::Anchor => Aabb { min: at, max: at }.widened(),
            RowBounds::Segment(grow) => {
                let reach: [f32; 3] = std::array::from_fn(|k| m[k * 4].abs() + grow);
                Aabb {
                    min: std::array::from_fn(|k| at[k] - reach[k]),
                    max: std::array::from_fn(|k| at[k] + reach[k]),
                }
                .widened()
            }
            RowBounds::Nothing => Aabb::EMPTY,
        }
    }
}

/// The largest reach of the first `rows` rows of `batch` around their anchors or center lines in
/// CSS pixels, for a batch sized in pixels of the screen, or 0 for any other: half a line's width,
/// or the largest side of a sprite times its quad's radius around its anchor.
fn screen_reach(batch: &InstanceBatch, rows: u32) -> f32 {
    if let Some(look) = batch.line_look() {
        return if look.world_units {
            0.0
        } else {
            0.5 * look.width
        };
    }
    if !batch.sprite_look().is_some_and(|look| look.screen_size) {
        return 0.0;
    }
    let world = batch.current_world();
    let mut side = 0.0f32;
    for r in 0..rows as usize {
        if world.radii()[r] >= 0.0 {
            let m = world.matrix(r);
            side = side.max(m[0].abs()).max(m[5].abs());
        }
    }
    side * batch.local_radius()
}

/// The box of an object: its mesh's box moved by its world matrix, or an empty box for a hidden
/// object, whose world radius is negative.
#[inline(always)]
fn item_box(radius: f32, matrix: &crate::math::Affine, mesh: &Aabb) -> Aabb {
    RowBounds::Mesh(*mesh).of_row(radius, matrix)
}

/// The two top-level trees of a scene. See the module documentation.
#[derive(Clone, Debug, Default)]
pub struct SceneBvh {
    statics: TopTree,
    dynamics: TopTree,
    /// The static scene objects: the first items of the static tree.
    static_objects: u32,
    /// The dynamic scene objects: the first items of the dynamic tree.
    dynamic_objects: u32,
    /// The id of the first batch row: one past the scene's last slot.
    row_base: u32,
    /// The batches whose rows the trees hold, by their run of ids.
    batches: Vec<BatchRows>,
    /// The scene's structure epoch when the item lists were made.
    epoch: Option<u32>,
    /// The scene's frame and world version whose world output the trees hold.
    synced: Option<(u32, u32)>,
}

/// True when a change stamp lies after frame `since` and at or before frame `now`, or there was
/// no earlier sync.
#[inline(always)]
fn changed_after(stamp: u32, since: Option<u32>, now: u32) -> bool {
    since.is_none_or(|since| stamp.wrapping_sub(since).wrapping_sub(1) < now.wrapping_sub(since))
}

fn out_of_memory(_: TryReserveError) -> CoreError {
    CoreError::OutOfMemory { bytes: u32::MAX }
}

impl SceneBvh {
    /// Empty trees. They allocate nothing until the first sync.
    pub fn new() -> Self {
        Self::default()
    }

    /// The tree over static objects and rows.
    pub fn statics(&self) -> &TopTree {
        &self.statics
    }

    /// The tree over dynamic objects and rows.
    pub fn dynamics(&self) -> &TopTree {
        &self.dynamics
    }

    /// What the item with id `id` is.
    #[inline]
    pub fn source(&self, id: u32) -> Source {
        if id < self.row_base {
            return Source::Object(id);
        }
        let k = self.batches.partition_point(|b| b.first <= id) - 1;
        let rows = &self.batches[k];
        Source::Row {
            batch: rows.batch,
            row: id - rows.first,
        }
    }

    /// Makes the next sync list every item again, as after a structure change, so each item's box
    /// follows its mesh's box anew.
    pub fn invalidate(&mut self) {
        self.epoch = None;
    }

    /// Empties both trees.
    fn clear(&mut self) {
        self.statics.clear();
        self.dynamics.clear();
        self.batches.clear();
        self.static_objects = 0;
        self.dynamic_objects = 0;
        self.epoch = None;
        self.synced = None;
    }

    /// True when the trees hold the rows of the same batches as `batches` gives now, with the
    /// same row counts.
    fn same_batches(&self, batches: &BatchTable) -> bool {
        let mut held = self.batches.iter();
        for (id, batch) in batches.iter() {
            let Some(rows) = rows_of(batch) else {
                continue;
            };
            match held.next() {
                Some(b) if b.batch == id && b.rows == rows && b.dynamic == batch.is_dynamic() => {}
                _ => return false,
            }
        }
        held.next().is_none()
    }

    /// True when a batch was updated since the trees took its rows.
    fn batches_updated(&self, batches: &BatchTable) -> bool {
        self.batches.iter().any(|b| {
            batches
                .get(b.batch)
                .is_ok_and(|batch| batch.frame() != b.frame || batch.version() != b.version)
        })
    }

    /// Brings the trees up to date with the scene's last world output, and with each batch's
    /// last update. `mesh_bounds` gives the box of a mesh by its id, in the mesh's own space:
    /// the empty box for a mesh that queries cannot test. Call it after a transform update and
    /// before the next frame starts, while the objects' cells match the world output.
    ///
    /// # Errors
    /// [`CoreError::OutOfMemory`] when the trees cannot grow, and [`CoreError::OutOfRange`] when
    /// the scene holds more items than ids reach; the trees are then empty until a sync
    /// succeeds.
    pub fn sync(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        jobs: &JobSystem,
        mesh_bounds: &(dyn Fn(u32) -> Aabb + Sync),
    ) -> Result<(), CoreError> {
        let frame = scene.frame();
        if frame == 0 {
            // No transform update has run, so nothing has a place in the world yet.
            self.clear();
            return Ok(());
        }
        let key = (frame, scene.world_version());
        let epoch = scene.structure_epoch();
        let rebuild = self.epoch != Some(epoch) || !self.same_batches(batches);
        if !rebuild && self.synced == Some(key) && !self.batches_updated(batches) {
            return Ok(());
        }
        let result = self.sync_trees(scene, batches, jobs, mesh_bounds, rebuild);
        if result.is_err() {
            self.clear();
        } else {
            self.epoch = Some(epoch);
            self.synced = Some(key);
        }
        result
    }

    fn sync_trees(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        jobs: &JobSystem,
        mesh_bounds: &(dyn Fn(u32) -> Aabb + Sync),
        mut rebuild: bool,
    ) -> Result<(), CoreError> {
        let frame = scene.frame();
        let world = scene.world(scene.parity());
        let (meshes, cells, radii) = (scene.meshes(), scene.cells(), world.radii());
        let object_box = |slot: u32| {
            let s = slot as usize;
            item_box(radii[s], world.matrix(s), &mesh_bounds(meshes[s]))
        };
        let table = scene.cell_table();
        if rebuild {
            self.list_items(scene, batches, &object_box, mesh_bounds)?;
        } else {
            // The objects stamped in the frame of the last sync are looked at again: a late
            // transform update can move them after that sync, in the same frame. Only a box or a
            // cell that changed refits the tree.
            let since = self.synced.map(|(f, _)| f.wrapping_sub(1));
            let stamps = scene.changed_frames();
            let mut moved = false;
            for i in 0..self.static_objects {
                let slot = self.statics.ids()[i as usize];
                if changed_after(stamps[slot as usize], since, frame) {
                    let (cell, b) = (cells[slot as usize], object_box(slot));
                    let k = i as usize;
                    if cell != self.statics.cells()[k] || b != self.statics.boxes()[k] {
                        rebuild |= cell != self.statics.cells()[k];
                        self.statics.set(i, cell, b);
                        moved = true;
                    }
                }
            }
            for rows in &mut self.batches {
                if rows.dynamic {
                    continue;
                }
                let Ok(batch) = batches.get(rows.batch) else {
                    continue;
                };
                if batch.version() == rows.version {
                    continue;
                }
                let bounds = RowBounds::of(batch, mesh_bounds);
                let world = batch.current_world();
                for row in 0..rows.rows {
                    let r = row as usize;
                    let i = rows.item + row;
                    let cell = batch.cells()[r];
                    rebuild |= cell != self.statics.cells()[i as usize];
                    let b = bounds.of_row(world.radii()[r], world.matrix(r));
                    self.statics.set(i, cell, b);
                }
                rows.screen_reach = screen_reach(batch, rows.rows);
                moved = true;
            }
            if moved && !rebuild {
                self.statics.refit();
            }
        }
        for rows in &mut self.batches {
            if let Ok(batch) = batches.get(rows.batch) {
                (rows.frame, rows.version) = (batch.frame(), batch.version());
            }
        }
        if rebuild {
            self.statics.build_sah(table, jobs).map_err(out_of_memory)?;
        }
        self.dynamics
            .update_parallel(jobs, 0..self.dynamic_objects, &|_, slot| {
                (cells[slot as usize], object_box(slot))
            });
        for rows in &mut self.batches {
            if !rows.dynamic {
                continue;
            }
            let Ok(batch) = batches.get(rows.batch) else {
                continue;
            };
            let bounds = RowBounds::of(batch, mesh_bounds);
            let world = batch.current_world();
            let (row_cells, row_radii) = (batch.cells(), world.radii());
            let item = rows.item;
            self.dynamics
                .update_parallel(jobs, item..item + rows.rows, &|i, _| {
                    let r = (i - item) as usize;
                    (row_cells[r], bounds.of_row(row_radii[r], world.matrix(r)))
                });
            rows.screen_reach = screen_reach(batch, rows.rows);
        }
        self.dynamics
            .build_morton(table, jobs)
            .map_err(out_of_memory)?;
        Ok(())
    }

    /// Lists every item again: the static objects, then the rows of static batches, in the
    /// static tree, and the dynamic objects, then the rows of dynamic batches, in the dynamic
    /// tree. Static items get their boxes; dynamic items get theirs before each build.
    fn list_items(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        object_box: &dyn Fn(u32) -> Aabb,
        mesh_bounds: &dyn Fn(u32) -> Aabb,
    ) -> Result<(), CoreError> {
        self.statics.clear();
        self.dynamics.clear();
        self.batches.clear();
        let (kinds, meshes, cells) = (scene.flags(), scene.meshes(), scene.cells());
        let created = scene.created();
        let drawn = |slot: &u32| meshes[*slot as usize] != NO_MESH;
        let is_dynamic = |slot: u32| kinds[slot as usize] & flags::DYNAMIC != 0;
        let (mut statics, mut dynamics) = (0u32, 0u32);
        for slot in created.iter_ones().filter(drawn) {
            if is_dynamic(slot) {
                dynamics += 1;
            } else {
                statics += 1;
            }
        }
        (self.static_objects, self.dynamic_objects) = (statics, dynamics);
        self.row_base = scene.capacity() + 1;
        if self.batches.capacity() < batches.capacity() as usize {
            self.batches
                .try_reserve_exact(batches.capacity() as usize)
                .map_err(out_of_memory)?;
        }
        let mut next = self.row_base;
        for (id, batch) in batches.iter() {
            let Some(rows) = rows_of(batch) else {
                continue;
            };
            let dynamic = batch.is_dynamic();
            let tree = if dynamic { &mut dynamics } else { &mut statics };
            self.batches.push(BatchRows {
                batch: id,
                first: next,
                rows,
                dynamic,
                item: *tree,
                frame: batch.frame(),
                version: batch.version(),
                screen_reach: screen_reach(batch, rows),
            });
            *tree += rows;
            next = next.checked_add(rows).ok_or(CoreError::OutOfRange {
                value: u32::MAX,
                limit: u32::MAX - self.row_base,
            })?;
        }
        self.statics.try_reserve(statics).map_err(out_of_memory)?;
        self.dynamics.try_reserve(dynamics).map_err(out_of_memory)?;
        for slot in created.iter_ones().filter(drawn) {
            let cell = cells[slot as usize];
            if is_dynamic(slot) {
                self.dynamics.push(slot, cell, Aabb::EMPTY);
            } else {
                self.statics.push(slot, cell, object_box(slot));
            }
        }
        for rows in &self.batches {
            let batch = batches.get(rows.batch)?;
            let bounds = RowBounds::of(batch, mesh_bounds);
            let world = batch.current_world();
            for row in 0..rows.rows {
                let (id, r) = (rows.first + row, row as usize);
                let cell = batch.cells()[r];
                if rows.dynamic {
                    self.dynamics.push(id, cell, Aabb::EMPTY);
                } else {
                    let b = bounds.of_row(world.radii()[r], world.matrix(r));
                    self.statics.push(id, cell, b);
                }
            }
        }
        Ok(())
    }

    /// The nearest item that `hit` reports a hit on, and the distance. `hit` gets each item
    /// whose box the ray meets, as its id and the ray in its cell's frame with the far limit at
    /// the nearest hit so far, and returns its hit distance within the ray's limits or `None`
    /// (see [`TopTree::raycast`]).
    pub fn raycast(
        &self,
        ray: &WorldRay,
        reach: &Reach,
        mut hit: impl FnMut(u32, &Ray) -> Option<f32>,
    ) -> Option<(u32, f32)> {
        let still = self.statics.raycast_reaching(ray, reach, &mut hit);
        let ray = still.map_or(*ray, |(_, t)| ray.with_max(t));
        self.dynamics
            .raycast_reaching(&ray, reach, &mut hit)
            .or(still)
    }

    /// True when `hit` reports a hit on any item whose box the ray meets. It stops at the first.
    pub fn raycast_any(
        &self,
        ray: &WorldRay,
        reach: &Reach,
        mut hit: impl FnMut(u32, &Ray) -> bool,
    ) -> bool {
        self.statics.raycast_any_reaching(ray, reach, &mut hit)
            || self.dynamics.raycast_any_reaching(ray, reach, &mut hit)
    }

    /// Calls `visit` with every item whose box the ray meets, in no set order.
    pub fn raycast_all(&self, ray: &WorldRay, reach: &Reach, mut visit: impl FnMut(u32, &Ray)) {
        self.statics.raycast_all_reaching(ray, reach, &mut visit);
        self.dynamics.raycast_all_reaching(ray, reach, &mut visit);
    }

    /// How far a raycast on `layers` must grow every box to reach the rows of sprite, point and
    /// line batches whose boxes do not hold all that it can hit: rows sized in pixels of the
    /// screen, and the points and lines that a threshold reaches. [`Reach::NONE`] when the
    /// trees hold no such rows on those layers, so raycasts against meshes alone cost no more.
    pub fn reach(&self, batches: &BatchTable, rows: &RowQuery, layers: u32) -> Reach {
        let mut reach = Reach::NONE;
        if let Some(camera) = &rows.camera {
            reach.eye = camera.eye;
            reach.forward = camera.forward;
        }
        let grow_by_pixels = |pixels: f32, reach: &mut Reach| {
            let Some(camera) = &rows.camera else {
                return;
            };
            let size = pixels * camera.pixel_reach();
            if camera.perspective {
                reach.slope = reach.slope.max(size);
            } else {
                reach.base = reach.base.max(size);
            }
        };
        for b in &self.batches {
            let Ok(batch) = batches.get(b.batch) else {
                continue;
            };
            if batch.layers() & layers == 0 {
                continue;
            }
            let threshold = if batch.sprite_look().is_some_and(|look| look.points) {
                rows.point_threshold
            } else if batch.line_look().is_some() {
                rows.line_threshold
            } else {
                None
            };
            match threshold {
                Some(t) => reach.base = reach.base.max(t),
                None if b.screen_reach > 0.0 => grow_by_pixels(b.screen_reach, &mut reach),
                None => {}
            }
        }
        reach
    }

    /// Calls `visit` with every item whose box touches the box from `min` to `max`, with the
    /// box in the item's cell frame.
    pub fn overlap_box(&self, min: [f64; 3], max: [f64; 3], mut visit: impl FnMut(u32, &Aabb)) {
        self.statics.overlap_box(min, max, &mut visit);
        self.dynamics.overlap_box(min, max, &mut visit);
    }

    /// Calls `visit` with every item whose box touches the sphere, with the centre in the
    /// item's cell frame.
    pub fn overlap_sphere(
        &self,
        center: [f64; 3],
        radius: f32,
        mut visit: impl FnMut(u32, [f32; 3]),
    ) {
        self.statics.overlap_sphere(center, radius, &mut visit);
        self.dynamics.overlap_sphere(center, radius, &mut visit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_count_after_the_last_sync() {
        assert!(changed_after(5, None, 5));
        assert!(changed_after(6, Some(5), 7));
        assert!(changed_after(7, Some(5), 7));
        assert!(!changed_after(5, Some(5), 7));
        assert!(!changed_after(8, Some(5), 7));
        assert!(!changed_after(0, Some(5), 7));
        // Across the wrap of the frame counter.
        assert!(changed_after(1, Some(u32::MAX), 2));
        assert!(!changed_after(u32::MAX, Some(u32::MAX), 2));
    }
}
