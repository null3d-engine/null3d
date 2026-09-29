//! The sources and buckets that every view culls and draws: the data texture and row of each
//! source, the buckets with their two draws each, and the clusters of static batches, with the
//! upload of their order.

use std::collections::TryReserveError;

use null3d_core::clusters::{CLUSTER_ROWS, CLUSTER_SHIFT, ClusterScratch, NO_ROW, RowClusters};
use null3d_core::culling::{CULL_CHUNK, NO_BUCKET};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::world::SphereArrays;
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{TextureRows, write_rows};
use super::ids;
use crate::frame::{
    FrameInput, HIDDEN, RecordError, SceneSettings, UploadArena, bucket_of, collect_bucket_keys,
    put_u32,
};
use crate::materials::Shading;

/// The data texture of a bucket's instances, as its draw record names it.
pub(super) const RESIDENT: u32 = 0;
pub(super) const STREAMED: u32 = 1;
/// Bytes of the draw record block that one multi-draw call binds.
pub(super) const MULTI_DRAW_BLOCK_BYTES: u32 = sizes::MULTI_DRAW_RECORDS * sizes::DRAW_RECORD_BYTES;
// A scene slot that draws nowhere has the same marker in the culling tables and the upload trims.
const _: () = assert!(NO_BUCKET == HIDDEN);

/// What makes a bucket, in draw order: the pipeline, the vertex page, the engine mesh and material
/// ids, and the data texture.
type BucketKey = (Shading, u32, u32, u32, u32);

/// One draw of a bucket key. Each key has two, next to each other: the draw whose index list
/// entries are rows, then the draw whose entries are clusters of rows.
#[derive(Clone, Copy, Debug)]
pub(super) struct Bucket {
    pub(super) shading: Shading,
    pub(super) page: u32,
    /// The engine material id.
    pub(super) material: u32,
    pub(super) group: u32,
    pub(super) index_count: u32,
    pub(super) first_index: u32,
    /// Instances per index list entry, as a shift: 0 for rows, [`CLUSTER_SHIFT`] for clusters.
    pub(super) shift: u32,
}

/// A batch's place in the layout: its data texture, its first row there, its bucket of rows
/// (the bucket after it takes its clusters), and, for a static batch, its first cluster in the
/// cluster texture.
#[derive(Clone, Copy, Debug)]
pub(super) struct BatchSlot {
    pub(super) id: Handle,
    pub(super) dynamic: bool,
    pub(super) base: u32,
    pub(super) bucket: u32,
    pub(super) first_cluster: u32,
}

impl BatchSlot {
    /// True for a static batch that draws: one whose rows can be culled in clusters.
    pub(super) fn clustered(&self) -> bool {
        !self.dynamic && self.bucket != NO_BUCKET
    }
}

/// The room that each view's culling output needs for the layout: rows, culling runs, runs that
/// look up their rows' buckets, and buckets.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct CullRoom {
    pub(super) rows: u32,
    pub(super) runs: u32,
    pub(super) by_row: u32,
    pub(super) buckets: u32,
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
pub(super) struct Layout {
    pub(super) scene_rows: u32,
    pub(super) resident_rows: u32,
    pub(super) streamed_rows: u32,
    /// Entries of the cluster texture: each static batch's rows, rounded up to whole clusters.
    pub(super) cluster_rows: u32,
    pub(super) batches: Vec<BatchSlot>,
    pub(super) buckets: Vec<Bucket>,
    /// Each scene slot's bucket, shown or hidden, or `NO_BUCKET` for a slot that draws nowhere.
    pub(super) scene_buckets: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged.
    key_counts: Vec<(BucketKey, u32)>,
    /// Bytes of one ring slot of draw records.
    pub(super) draws_slot_bytes: u32,
    /// The room each view's culling output needs.
    pub(super) room: CullRoom,
    /// The capacity of the largest static batch, for the scratch space its clusters need.
    pub(super) largest_static: u32,
    pub(super) built: bool,
    /// The frame that last rebuilt the layout.
    pub(super) built_in: u32,
}

impl Layout {
    pub(super) fn batch(&self, target: u32) -> Option<&BatchSlot> {
        self.batches.iter().find(|slot| slot.id.raw() == target)
    }

    /// Assigns every source to a data texture and a bucket, from the frame's world state. It
    /// reuses the layout's tables, which grow only with the scene. A scene of more than `limit`
    /// sources fails. With `multi_draw`, one block of draw records serves each multi-draw call;
    /// else each draw has an aligned record of its own. The caller marks the layout built once
    /// the room it needs is made.
    pub(super) fn rebuild(
        &mut self,
        settings: &SceneSettings,
        input: &FrameInput<'_>,
        limit: u32,
        multi_draw: bool,
    ) -> Result<(), RecordError> {
        let (scene, batches) = (input.scene, input.batches);
        self.scene_rows = scene.capacity() + 1;
        self.batches.clear();
        let (mut resident, mut streamed, mut clusters) = (self.scene_rows, 0u32, 0u32);
        let mut largest_static = 0;
        for (id, batch) in batches.iter() {
            let dynamic = batch.is_dynamic();
            let rows = if dynamic {
                &mut streamed
            } else {
                &mut resident
            };
            self.batches.push(BatchSlot {
                id,
                dynamic,
                base: *rows,
                bucket: NO_BUCKET,
                first_cluster: clusters,
            });
            *rows = rows.saturating_add(batch.capacity());
            if !dynamic {
                clusters = clusters.saturating_add(batch.capacity().div_ceil(CLUSTER_ROWS));
                largest_static = largest_static.max(batch.capacity());
            }
        }
        if resident.saturating_add(streamed) > limit {
            return Err(RecordError::TooManySources { limit });
        }
        self.resident_rows = resident;
        self.streamed_rows = streamed;
        self.cluster_rows = clusters.saturating_mul(CLUSTER_ROWS);
        self.largest_static = largest_static;

        let key_of = |mesh: u32, material: u32, group: u32| -> Option<BucketKey> {
            let shading = settings.shading_of(mesh, material)?;
            let page = settings.meshes().mesh(mesh - 1)?.page;
            Some((shading, page, mesh, material, group))
        };
        let group_of = |batch: &InstanceBatch| {
            if batch.is_dynamic() {
                STREAMED
            } else {
                RESIDENT
            }
        };
        let scene_key =
            |slot: usize| key_of(scene.meshes()[slot], scene.materials()[slot], RESIDENT);
        collect_bucket_keys(
            &mut self.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| key_of(batch.mesh(), batch.material(), group_of(batch)),
        );

        self.buckets.clear();
        for &((shading, page, mesh, material, group), _) in &self.key_counts {
            let slot = settings
                .meshes()
                .mesh(mesh - 1)
                .expect("keys name known meshes");
            for shift in [0, CLUSTER_SHIFT] {
                self.buckets.push(Bucket {
                    shading,
                    page,
                    material,
                    group,
                    index_count: slot.index_count,
                    first_index: slot.first_index,
                    shift,
                });
            }
        }
        // A key's bucket of rows; its bucket of clusters is the next one.
        let counts = &self.key_counts;
        let bucket_of =
            |key: Option<BucketKey>| bucket_of(counts, key).map_or(NO_BUCKET, |key| 2 * key);
        self.scene_buckets.clear();
        for slot in 0..self.scene_rows as usize {
            self.scene_buckets.push(bucket_of(scene_key(slot)));
        }
        let mut runs = self.scene_rows.div_ceil(CULL_CHUNK);
        for ((_, batch), slot) in batches.iter().zip(&mut self.batches) {
            slot.bucket = bucket_of(key_of(batch.mesh(), batch.material(), group_of(batch)));
            if slot.bucket != NO_BUCKET {
                runs += batch.capacity().div_ceil(CULL_CHUNK);
            }
        }

        // The ring slot of draw records: one block per multi-draw call, or one aligned record per
        // bucket.
        let buckets = self.buckets.len() as u32;
        self.draws_slot_bytes = if multi_draw {
            let mut calls = 0;
            let mut start = 0;
            while start < self.buckets.len() {
                let run = run_end(&self.buckets, start) - start;
                calls += (run as u32).div_ceil(sizes::MULTI_DRAW_RECORDS);
                start += run;
            }
            calls.max(1) * MULTI_DRAW_BLOCK_BYTES
        } else {
            buckets.max(1) * OFFSET_ALIGNMENT
        };
        self.room = CullRoom {
            rows: resident.saturating_add(streamed),
            runs,
            by_row: self.scene_rows.div_ceil(CULL_CHUNK),
            buckets,
        };
        Ok(())
    }
}

/// The end of the run of buckets that starts at `start`: the buckets that share its pipeline and
/// vertex page.
pub(super) fn run_end(buckets: &[Bucket], start: usize) -> usize {
    let first = buckets[start];
    buckets[start..]
        .iter()
        .position(|b| b.shading != first.shading || b.page != first.page)
        .map_or(buckets.len(), |n| start + n)
}

/// A static batch's clusters, kept across layout rebuilds by the batch's id.
#[derive(Debug, Default)]
pub(super) struct ClusterSet {
    id: Handle,
    pub(super) clusters: RowClusters,
    /// True when the clusters match the batch's rows in both world buffers.
    current: bool,
    /// True when the cluster texture holds the clusters' order at the batch's place.
    uploaded: bool,
}

/// Every static batch's clusters, at its batch's table slot, and the scratch space that building
/// them needs.
#[derive(Debug, Default)]
pub(super) struct Clusters {
    sets: Vec<ClusterSet>,
    scratch: ClusterScratch,
}

impl Clusters {
    /// The clusters of the batch in a layout slot.
    pub(super) fn set(&self, slot: &BatchSlot) -> &ClusterSet {
        &self.sets[slot.id.slot() as usize]
    }

    /// Keeps a static batch's clusters in step with its rows: they go stale while the batch
    /// changes, and once it is at rest, with `active` rows whose spheres are `spheres`, they are
    /// built again, to upload their order. Returns the number of clusters while they are current.
    pub(super) fn refresh(
        &mut self,
        slot: &BatchSlot,
        at_rest: bool,
        spheres: SphereArrays<'_>,
        active: u32,
    ) -> Option<u32> {
        let set = &mut self.sets[slot.id.slot() as usize];
        if !at_rest {
            set.current = false;
        } else if !set.current {
            set.clusters.build(spheres, active, &mut self.scratch);
            set.current = true;
            set.uploaded = false;
        }
        set.current.then(|| set.clusters.len())
    }

    /// Makes room for the clusters of every static batch after a layout rebuild. Each batch keeps
    /// its clusters at its table slot, so a rebuild keeps clusters that are still good. Their
    /// places in the cluster texture may have moved, so each uploads again.
    pub(super) fn prepare(
        &mut self,
        batches: &BatchTable,
        layout: &Layout,
    ) -> Result<(), TryReserveError> {
        let slots = batches
            .iter()
            .map(|(id, _)| id.slot() + 1)
            .max()
            .unwrap_or(0) as usize;
        if self.sets.len() < slots {
            self.sets.try_reserve(slots - self.sets.len())?;
            self.sets.resize_with(slots, ClusterSet::default);
        }
        for (id, batch) in batches.iter().filter(|(_, batch)| !batch.is_dynamic()) {
            let set = &mut self.sets[id.slot() as usize];
            if set.id != id {
                set.id = id;
                set.current = false;
            }
            set.uploaded = false;
            set.clusters.try_reserve(batch.capacity())?;
        }
        self.scratch.try_reserve(layout.largest_static)
    }

    /// The static batches whose current clusters the cluster texture does not hold yet, with
    /// their cluster sets.
    fn uploads<'a>(
        &'a self,
        layout: &'a Layout,
    ) -> impl Iterator<Item = (&'a BatchSlot, &'a ClusterSet)> {
        layout
            .batches
            .iter()
            .filter(|slot| slot.clustered())
            .map(|slot| (slot, self.set(slot)))
            .filter(|(_, set)| set.current && !set.uploaded)
    }

    /// The bytes that the next [`Clusters::upload`] copies into the arena.
    pub(super) fn pending_bytes(&self, layout: &Layout) -> usize {
        self.uploads(layout)
            .map(|(_, set)| set.clusters.order().len() * 4)
            .sum()
    }

    /// Writes the cluster order of each static batch whose clusters are new, or moved in the
    /// cluster texture. Each entry becomes the row's place in the resident texture, and the end
    /// of the last cluster stays [`NO_ROW`].
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        for (slot, set) in self.uploads(layout) {
            let order = set.clusters.order();
            let (at, bytes) = arena.push_zeroed(order.len() * 4)?;
            for (k, &row) in order.iter().enumerate() {
                let source = if row == NO_ROW {
                    NO_ROW
                } else {
                    slot.base + row
                };
                put_u32(bytes, k, source);
            }
            let rows = TextureRows::indices(slot.first_cluster * CLUSTER_ROWS, order.len() as u32);
            write_rows(list, ids::CLUSTERS, rows, at)?;
        }
        for slot in layout.batches.iter().filter(|slot| slot.clustered()) {
            let set = &mut self.sets[slot.id.slot() as usize];
            set.uploaded |= set.current;
        }
        Ok(())
    }
}
