//! The sources and buckets that every view culls and draws: the data texture and row of each
//! source, the buckets with a draw for each part of their mesh, and the clusters of static
//! batches, with the upload of their order.
//!
//! A layout holds one kind of bucket. The scene's layout holds every object and instance row with
//! a mesh and a material, as the views of cameras draw them. The casters' layout holds the scene
//! objects that cast shadows, grouped by mesh alone, as the shadow cascades draw their depth. The
//! outlined layout holds the scene objects that the sketch outlines, grouped by mesh alone, as the
//! outline view draws them into the outline mask, each bucket twice. Every layout places each
//! source at the same row of the same data texture, so the others read the matrices that the
//! scene's layout uploads.

use std::collections::TryReserveError;

use null3d_core::clusters::{
    CLUSTER_ROWS, CLUSTER_SHIFT, ClusterScratch, NO_ROW, RowCells, RowClusters, cluster_room,
};
use null3d_core::culling::{CULL_CHUNK, NO_BUCKET};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::scene::flags;
use null3d_core::world::SphereArrays;
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{DrawList, sizes};

use super::data::{TextureRows, write_rows};
use super::ids;
use super::skin::Skins;
use crate::frame::{
    FrameInput, HIDDEN, RecordError, SceneSettings, UploadArena, bucket_of, collect_bucket_keys,
    put_u32,
};
use crate::outline::mask_keys;
use crate::pipelines::{DrawKey, PassTargets, PipelineCache, Prepass};
use crate::skinning::skinned_in_vertex_shader;

/// The data texture of a bucket's instances, as its draw record names it.
pub(super) const RESIDENT: u32 = 0;
pub(super) const STREAMED: u32 = 1;
/// Bytes of the draw record block that one multi-draw call binds.
pub(super) const MULTI_DRAW_BLOCK_BYTES: u32 = sizes::MULTI_DRAW_RECORDS * sizes::DRAW_RECORD_BYTES;
// A scene slot that draws nowhere has the same marker in the culling tables and the upload trims.
const _: () = assert!(NO_BUCKET == HIDDEN);

/// What a layout's buckets draw.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Drawn {
    /// Every object and instance row with a mesh and a material, as the views of cameras draw
    /// them.
    #[default]
    Scene,
    /// The scene objects that cast shadows, as the shadow cascades draw their depth.
    Casters,
    /// The scene objects that the sketch outlines, as the outline view draws them into the outline
    /// mask.
    Outlined,
}

/// The material of every caster bucket and every outlined bucket: neither a caster's depth nor an
/// object's place in the outline mask depends on its material, so the objects of one mesh share a
/// bucket.
const CASTER_MATERIAL: u32 = 1;

/// What makes a bucket, in draw order: what the mesh and material ask of their pipeline, the bind
/// group of the material's map, the vertex page of the mesh's first part, the engine mesh and
/// material ids, and the data texture.
type BucketKey = (DrawKey, u32, u32, u32, u32, u32);

/// One bucket of a bucket key. Each key has two, next to each other: the bucket whose index list
/// entries are rows, then the bucket whose entries are clusters of rows.
#[derive(Clone, Copy, Debug)]
pub(super) struct Bucket {
    /// The engine material id.
    pub(super) material: u32,
    pub(super) group: u32,
    /// Instances per index list entry, as a shift: 0 for rows, [`CLUSTER_SHIFT`] for clusters.
    pub(super) shift: u32,
}

/// One draw: a part of a bucket's mesh, which draws every instance that the bucket lists.
#[derive(Clone, Copy, Debug)]
pub(super) struct Draw {
    /// The id of its render pipeline.
    pub(super) pipeline: u32,
    /// The id of the render pipeline that draws its depth in the depth prepass, or 0 for a draw
    /// that the prepass leaves out.
    pub(super) prepass: u32,
    /// The bind group of its material's map, or 0 for a pipeline that reads none.
    pub(super) textures: u32,
    pub(super) page: u32,
    pub(super) bucket: u32,
    pub(super) index_count: u32,
    pub(super) first_index: u32,
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
/// look up their rows' buckets, and buckets, and the batches whose culling each frame notes.
/// Views that see many grid cells cull more, shorter runs, and grow their room as they need it.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct CullRoom {
    pub(super) rows: u32,
    pub(super) runs: u32,
    pub(super) by_row: u32,
    pub(super) buckets: u32,
    pub(super) batches: u32,
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
pub(super) struct Layout {
    /// What the buckets draw.
    drawn: Drawn,
    pub(super) scene_rows: u32,
    pub(super) resident_rows: u32,
    pub(super) streamed_rows: u32,
    /// Entries of the cluster texture: each static batch's room for clusters inside cells, whole
    /// clusters each.
    pub(super) cluster_rows: u32,
    pub(super) batches: Vec<BatchSlot>,
    pub(super) buckets: Vec<Bucket>,
    /// Every bucket's draws, in bucket order. Buckets are sorted by pipeline and by the vertex page
    /// of their mesh's first part, so the draws of one pipeline and page sit together, apart from
    /// the later parts of meshes split over several pages. The outlined layout lists every
    /// bucket's draws twice: with the pipeline that marks every part, then with the one that marks
    /// the parts that nothing hides.
    pub(super) draws: Vec<Draw>,
    /// Scratch for rebuilds of the outlined layout: the second draw of each bucket.
    second_draws: Vec<Draw>,
    /// Each scene slot's bucket, shown or hidden, or `NO_BUCKET` for a slot that draws nowhere
    /// or draws in the transparent pass.
    pub(super) scene_buckets: Vec<u32>,
    /// Each scene slot's bucket, with 0 for the slots that draw in the transparent pass: the rows
    /// whose matrices the resident texture needs.
    pub(super) drawn_slots: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged.
    key_counts: Vec<(BucketKey, u32)>,
    /// Bytes of one ring slot of draw records: the opaque draws' records, then room for the
    /// records of the transparent pass's draws, from [`Layout::sorted_records_at`] on.
    pub(super) draws_slot_bytes: u32,
    /// Where the transparent pass's records start in a ring slot.
    pub(super) sorted_records_at: u32,
    /// The room each view's culling output needs.
    pub(super) room: CullRoom,
    /// The capacity of the largest static batch, for the scratch space its clusters need.
    pub(super) largest_static: u32,
    pub(super) built: bool,
    /// The frame that last rebuilt the layout.
    pub(super) built_in: u32,
}

impl Layout {
    /// An empty layout of buckets that draw `drawn`.
    pub(super) fn new(drawn: Drawn) -> Self {
        Self {
            drawn,
            ..Self::default()
        }
    }

    /// Empties the buckets, for a layout that draws nothing until it is built again.
    pub(super) fn clear(&mut self) {
        self.buckets.clear();
        self.draws.clear();
        self.scene_buckets.clear();
        self.batches.clear();
        self.room = CullRoom::default();
    }

    pub(super) fn batch(&self, target: u32) -> Option<&BatchSlot> {
        self.batches.iter().find(|slot| slot.id.raw() == target)
    }

    /// Assigns every source to a data texture and a bucket, from the frame's world state, with
    /// each draw's pipeline id from `pipelines`, for a pass that draws into `targets`. It reuses
    /// the layout's tables, which grow only with the scene. A scene of more than `limit` sources
    /// fails. With `multi_draw`, one block of draw records serves each multi-draw call; else each
    /// draw has an aligned record of its own. With `shadows`, the scene's receivers draw with
    /// pipelines that read the shadow maps, and the casters' layout holds the casters. The objects
    /// that `skins` skins draw with pipelines that skin in the vertex shader. With a `prepass`, the
    /// scene's draws that the depth prepass draws get its pipelines too. The caller marks the
    /// layout built once the room it needs is made.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn rebuild(
        &mut self,
        settings: &SceneSettings,
        pipelines: &mut PipelineCache,
        skins: &Skins,
        targets: PassTargets,
        input: &FrameInput<'_>,
        limit: u32,
        multi_draw: bool,
        shadows: bool,
        prepass: Prepass,
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
                clusters = clusters.saturating_add(cluster_room(batch.capacity()));
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

        let meshes = settings.meshes();
        let drawn = self.drawn;
        let skin = |key: DrawKey, skinned: bool| {
            if skinned {
                skinned_in_vertex_shader(key)
            } else {
                key
            }
        };
        let key_of = |mesh: u32, material: u32, group: u32, object: u32, skinned: bool| {
            let pipeline = settings.pipeline_of(mesh, material)?;
            let page = meshes.parts(meshes.mesh(mesh - 1)?).first()?.page;
            match drawn {
                Drawn::Casters => {
                    let caster = skin(settings.caster_of(pipeline), skinned);
                    return Some((caster, 0, page, mesh, CASTER_MATERIAL, group));
                }
                Drawn::Outlined => {
                    let (every, _) = mask_keys(skin(pipeline, skinned));
                    return Some((every, 0, page, mesh, CASTER_MATERIAL, group));
                }
                Drawn::Scene => {}
            }
            // Blended pairs draw in the transparent pass, which sorts them on the job workers.
            if pipeline.blends() {
                return None;
            }
            let pipeline = if shadows && object & flags::RECEIVE_SHADOWS != 0 {
                settings.receiving(pipeline)
            } else {
                pipeline
            };
            let textures = settings.texture_group(material, pipeline);
            Some((
                skin(pipeline, skinned),
                textures,
                page,
                mesh,
                material,
                group,
            ))
        };
        let group_of = |batch: &InstanceBatch| {
            if batch.is_dynamic() {
                STREAMED
            } else {
                RESIDENT
            }
        };
        let scene_key = |slot: usize| {
            let object = scene.flags()[slot];
            let left_out = match drawn {
                Drawn::Scene => false,
                Drawn::Casters => !shadows || object & flags::CAST_SHADOWS == 0,
                Drawn::Outlined => object & flags::OUTLINED == 0,
            };
            if left_out {
                return None;
            }
            key_of(
                scene.meshes()[slot],
                scene.materials()[slot],
                RESIDENT,
                object,
                skins.skinned(slot),
            )
        };
        // Instance batches cast no shadows yet, take no outlines, and no animated instance skins
        // them.
        let batch_key = |batch: &InstanceBatch| match drawn {
            Drawn::Scene => key_of(batch.mesh(), batch.material(), group_of(batch), 0, false),
            Drawn::Casters | Drawn::Outlined => None,
        };
        collect_bucket_keys(
            &mut self.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| batch_key(batch),
        );

        self.buckets.clear();
        self.draws.clear();
        self.second_draws.clear();
        for &((pipeline, textures, _, mesh, material, group), _) in &self.key_counts {
            let slot = meshes.mesh(mesh - 1).expect("keys name known meshes");
            let (first, prepass) = pipelines.opaque(pipeline, targets, prepass);
            let second = (drawn == Drawn::Outlined)
                .then(|| pipelines.id(mask_keys(pipeline).1.in_pass(targets)));
            let pipeline = first;
            for shift in [0, CLUSTER_SHIFT] {
                let bucket = self.buckets.len() as u32;
                self.buckets.push(Bucket {
                    material,
                    group,
                    shift,
                });
                for part in meshes.parts(slot) {
                    let draw = Draw {
                        pipeline,
                        prepass,
                        textures,
                        page: part.page,
                        bucket,
                        index_count: part.index_count,
                        first_index: part.first_index,
                    };
                    self.draws.push(draw);
                    if let Some(second) = second {
                        self.second_draws.push(Draw {
                            pipeline: second,
                            ..draw
                        });
                    }
                }
            }
        }
        self.draws.extend_from_slice(&self.second_draws);
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
            slot.bucket = bucket_of(batch_key(batch));
            if slot.bucket != NO_BUCKET {
                runs += batch.capacity().div_ceil(CULL_CHUNK);
            }
        }

        // The ring slot of draw records: one block per multi-draw call, or one aligned record per
        // draw.
        self.draws_slot_bytes = if multi_draw {
            let mut calls = 0;
            let mut start = 0;
            while start < self.draws.len() {
                let run = run_end(&self.draws, start) - start;
                calls += (run as u32).div_ceil(sizes::MULTI_DRAW_RECORDS);
                start += run;
            }
            calls.max(1) * MULTI_DRAW_BLOCK_BYTES
        } else {
            (self.draws.len() as u32).max(1) * OFFSET_ALIGNMENT
        };
        self.sorted_records_at = self.draws_slot_bytes;
        // Only the scene's objects cast shadows or take outlines, so a cascade or the outline view
        // lists at most the scene's rows.
        let listed = match drawn {
            Drawn::Scene => resident.saturating_add(streamed),
            Drawn::Casters | Drawn::Outlined => self.scene_rows,
        };
        self.room = CullRoom {
            rows: listed,
            runs,
            by_row: self.scene_rows.div_ceil(CULL_CHUNK),
            buckets: self.buckets.len() as u32,
            batches: self.batches.len() as u32,
        };
        Ok(())
    }
}

impl Layout {
    /// Makes room in each ring slot of draw records for `bytes` bytes of the transparent pass's
    /// records, after the opaque draws' records, and marks the scene slots in `sorted` as rows
    /// that draw.
    pub(super) fn add_sorted(&mut self, bytes: u32, sorted: &[u32]) {
        self.draws_slot_bytes = self.sorted_records_at + bytes;
        self.drawn_slots.clone_from(&self.scene_buckets);
        for &slot in sorted {
            self.drawn_slots[slot as usize] = 0;
        }
    }
}

/// The end of the run of draws that starts at `start`: the draws that share its pipeline, its
/// maps' bind group and its vertex page.
pub(super) fn run_end(draws: &[Draw], start: usize) -> usize {
    let first = draws[start];
    draws[start..]
        .iter()
        .position(|d| {
            d.pipeline != first.pipeline || d.textures != first.textures || d.page != first.page
        })
        .map_or(draws.len(), |n| start + n)
}

/// A static batch's clusters, kept across layout rebuilds by the batch's id.
#[derive(Debug, Default)]
pub(super) struct ClusterSet {
    id: Handle,
    pub(super) clusters: RowClusters,
    /// True when the clusters match the batch's rows in both world buffers.
    current: bool,
    /// True when the batch's rows, as they rest, lie in more cells than its room for clusters
    /// allows, so it culls row by row until it changes.
    unfit: bool,
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

    /// The rows of the batch in a layout slot in cluster order, while its clusters are current.
    pub(super) fn current_order(&self, slot: &BatchSlot) -> Option<&[u32]> {
        let set = self.sets.get(slot.id.slot() as usize)?;
        (set.id == slot.id && set.current).then(|| set.clusters.order())
    }

    /// Keeps a static batch's clusters in step with its rows: they go stale while the batch
    /// changes, and once it is at rest, with `active` rows whose spheres are `spheres` and whose
    /// cells are `cells`, they are built again, to upload their order. Returns the number of
    /// clusters while they are current. Rows spread over more cells than the batch's room for
    /// clusters allows get none, and cull row by row.
    pub(super) fn refresh(
        &mut self,
        slot: &BatchSlot,
        at_rest: bool,
        spheres: SphereArrays<'_>,
        active: u32,
        cells: RowCells<'_>,
    ) -> Option<u32> {
        let set = &mut self.sets[slot.id.slot() as usize];
        if !at_rest {
            set.current = false;
            set.unfit = false;
        } else if !set.current && !set.unfit {
            set.current = set
                .clusters
                .build(spheres, active, cells, &mut self.scratch);
            set.unfit = !set.current;
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
