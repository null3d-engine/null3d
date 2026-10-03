//! The scene's top level: one tree over static objects and one over dynamic objects, kept in step
//! with [`SceneStorage`].
//!
//! [`SceneBvh::sync`] brings both trees up to date with one frame's world output, and only does
//! the work that frame needs:
//!
//! | Since the last sync | Static tree | Dynamic tree |
//! | --- | --- | --- |
//! | Nothing | kept | rebuilt |
//! | Static objects moved within their cells, or were shown or hidden | refitted | rebuilt |
//! | A static object changed cell | rebuilt | rebuilt |
//! | An object was created or destroyed, or changed between static and dynamic | rebuilt | rebuilt |
//! | The same frame was synced already | kept | kept |
//!
//! The engine calls it only in frames that run a query, so a frame without queries costs
//! nothing. Each object's box is the box around its world bounding sphere, so a hidden object,
//! whose radius is negative, has an empty box that no query meets.
//!
//! After the first sync of a scene, a sync allocates nothing until the scene holds more objects
//! than it ever did.

use std::collections::TryReserveError;

use super::top::{TopTree, WorldRay};
use super::{Aabb, Ray};
use crate::CoreError;
use crate::jobs::JobSystem;
use crate::scene::{SceneStorage, flags};

/// The two top-level trees of a scene. See the module documentation.
#[derive(Clone, Debug, Default)]
pub struct SceneBvh {
    statics: TopTree,
    dynamics: TopTree,
    /// The scene's structure epoch when the object lists were made.
    epoch: Option<u32>,
    /// The frame whose world output the trees hold.
    synced: Option<u32>,
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

    /// The tree over static objects.
    pub fn statics(&self) -> &TopTree {
        &self.statics
    }

    /// The tree over dynamic objects.
    pub fn dynamics(&self) -> &TopTree {
        &self.dynamics
    }

    /// Brings the trees up to date with the world output of frame `frame`: world buffer
    /// `frame & 1`, which that frame's transform update wrote. Call it after that update and
    /// before the next, while the objects' cells match that buffer.
    ///
    /// # Errors
    /// [`CoreError::OutOfMemory`] when the trees cannot grow; they are then empty until a sync
    /// succeeds.
    pub fn sync(
        &mut self,
        scene: &SceneStorage,
        frame: u32,
        jobs: &JobSystem,
    ) -> Result<(), CoreError> {
        let epoch = scene.structure_epoch();
        if self.synced == Some(frame) && self.epoch == Some(epoch) {
            return Ok(());
        }
        let result = self.sync_trees(scene, frame, epoch, jobs);
        if result.is_err() {
            self.statics.clear();
            self.dynamics.clear();
            self.epoch = None;
            self.synced = None;
        }
        result.map_err(out_of_memory)
    }

    fn sync_trees(
        &mut self,
        scene: &SceneStorage,
        frame: u32,
        epoch: u32,
        jobs: &JobSystem,
    ) -> Result<(), TryReserveError> {
        let world = scene.world((frame & 1) as usize);
        let (xs, ys, zs, radii) = (world.xs(), world.ys(), world.zs(), world.radii());
        let sphere_box = |slot: u32| {
            let s = slot as usize;
            Aabb::of_sphere([xs[s], ys[s], zs[s]], radii[s])
        };
        let cells = scene.cells();
        let table = scene.cell_table();
        let mut rebuild = self.epoch != Some(epoch);
        if rebuild {
            let kinds = scene.flags();
            let created = scene.created();
            let dynamic = created
                .iter_ones()
                .filter(|&slot| kinds[slot as usize] & flags::DYNAMIC != 0)
                .count() as u32;
            self.statics.clear();
            self.dynamics.clear();
            self.statics.try_reserve(created.count_ones() - dynamic)?;
            self.dynamics.try_reserve(dynamic)?;
            for slot in created.iter_ones() {
                let cell = cells[slot as usize];
                if kinds[slot as usize] & flags::DYNAMIC != 0 {
                    self.dynamics.push(slot, cell, Aabb::EMPTY);
                } else {
                    self.statics.push(slot, cell, sphere_box(slot));
                }
            }
            self.epoch = Some(epoch);
        } else {
            let stamps = scene.changed_frames();
            let mut moved = false;
            for i in 0..self.statics.len() {
                let slot = self.statics.ids()[i as usize];
                if changed_after(stamps[slot as usize], self.synced, frame) {
                    let cell = cells[slot as usize];
                    rebuild |= cell != self.statics.cells()[i as usize];
                    self.statics.set(i, cell, sphere_box(slot));
                    moved = true;
                }
            }
            if moved && !rebuild {
                self.statics.refit();
            }
        }
        if rebuild {
            self.statics.build_sah(table, jobs)?;
        }
        self.dynamics
            .update_parallel(jobs, &|_, slot| (cells[slot as usize], sphere_box(slot)));
        self.dynamics.build_morton(table, jobs)?;
        self.synced = Some(frame);
        Ok(())
    }

    /// The nearest object that `hit` reports a hit on, and the distance. `hit` gets each object
    /// whose box the ray meets, as its slot and the ray in its cell's frame with the far limit
    /// at the nearest hit so far, and returns its hit distance within the ray's limits or
    /// `None` (see [`TopTree::raycast`]).
    pub fn raycast(
        &self,
        ray: &WorldRay,
        mut hit: impl FnMut(u32, &Ray) -> Option<f32>,
    ) -> Option<(u32, f32)> {
        let still = self.statics.raycast(ray, &mut hit);
        let ray = still.map_or(*ray, |(_, t)| ray.with_max(t));
        self.dynamics.raycast(&ray, &mut hit).or(still)
    }

    /// True when `hit` reports a hit on any object whose box the ray meets. It stops at the
    /// first.
    pub fn raycast_any(&self, ray: &WorldRay, mut hit: impl FnMut(u32, &Ray) -> bool) -> bool {
        self.statics.raycast_any(ray, &mut hit) || self.dynamics.raycast_any(ray, &mut hit)
    }

    /// Calls `visit` with every object whose box the ray meets, in no set order.
    pub fn raycast_all(&self, ray: &WorldRay, mut visit: impl FnMut(u32, &Ray)) {
        self.statics.raycast_all(ray, &mut visit);
        self.dynamics.raycast_all(ray, &mut visit);
    }

    /// Calls `visit` with every object whose box touches the box from `min` to `max`, with the
    /// box in the object's cell frame.
    pub fn overlap_box(&self, min: [f64; 3], max: [f64; 3], mut visit: impl FnMut(u32, &Aabb)) {
        self.statics.overlap_box(min, max, &mut visit);
        self.dynamics.overlap_box(min, max, &mut visit);
    }

    /// Calls `visit` with every object whose box touches the sphere, with the centre in the
    /// object's cell frame.
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
