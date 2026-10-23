//! The sources and buckets that every view culls and draws: the data texture and row of each
//! source, the buckets with a draw for each part of their mesh, and the clusters of static
//! batches, with the upload of their order.
//!
//! A layout holds one kind of bucket. The scene's layout holds every object and instance row with
//! a mesh and a material, as the views of cameras draw them. The casters' layout holds the scene
//! objects that cast shadows, grouped by mesh alone, as the shadow cascades draw their depth. The
//! outlined layout holds the scene objects that the sketch outlines, grouped by mesh alone, as the
//! outline view draws them into the outline mask, each bucket twice. The subsurface layout holds
//! the scene objects whose material has a scatter radius, with the skin pass's builds of their
//! pipelines, as the subsurface view draws them into the skin pass's target. Every layout places
//! each source at the same row of the same data texture, so the others read the matrices that the
//! scene's layout uploads.

use std::collections::TryReserveError;

use null3d_core::clusters::{
    CLUSTER_ROWS, CLUSTER_SHIFT, ClusterScratch, NO_ROW, RowCells, RowClusters, cluster_room,
};
use null3d_core::culling::{CULL_CHUNK, NO_BUCKET, batch_ranges};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::levels::{LevelLink, NO_LINK};
use null3d_core::memory::{MemoryUse, vec_bytes};
use null3d_core::scene::flags;
use null3d_core::world::SphereArrays;
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{DrawList, Op, permutation, sizes, state_flags, template};

use super::data::{TextureRows, write_rows};
use super::ids;
use super::skin::Skins;
use crate::frame::{
    FrameInput, HIDDEN, KeyCounts, RecordError, SceneSettings, UploadArena, bucket_of,
    collect_bucket_keys, put_u32,
};
use crate::levels::{BucketKey, expand_level_keys, is_fade_key, key_level, level_key, links_of};
use crate::object_ranges::{ObjectRanges, STREAMED_KEY};
use crate::outline::mask_keys;
use crate::pipelines::{DrawKey, PassTargets, PipelineCache, Prepass};
use crate::shadows::CasterPasses;
use crate::subsurface::skin_key;

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
    /// The objects and instance rows that cast shadows, as the shadow cascades draw their depth.
    Casters,
    /// The scene objects that the sketch outlines, as the outline view draws them into the outline
    /// mask.
    Outlined,
    /// The scene objects whose material has a scatter radius, as the subsurface view draws them
    /// into the skin pass's target.
    Subsurface,
}

impl Drawn {
    /// True for the passes that draw the scene's surfaces, where the scene's material override
    /// applies: the camera's views and the subsurface view.
    fn overrides(self) -> bool {
        matches!(self, Drawn::Scene | Drawn::Subsurface)
    }
}

/// The material of every caster bucket and every outlined bucket: neither a caster's depth nor an
/// object's place in the outline mask depends on its material, so the objects of one mesh share a
/// bucket.
const CASTER_MATERIAL: u32 = 1;

// What makes a bucket, in draw order: what the mesh and material ask of their pipeline, the bind
// group of the material's map, the vertex page of the mesh's first part, the engine mesh id or a
// level key (see `crate::levels`), the material id, and the data texture.

/// One bucket of a bucket key. Each key has two, next to each other: the bucket whose index list
/// entries are rows, then the bucket whose entries are clusters of rows.
#[derive(Clone, Copy, Debug)]
pub(super) struct Bucket {
    /// The engine material id.
    pub(super) material: u32,
    pub(super) group: u32,
    /// Instances per index list entry, as a shift: 0 for rows, [`CLUSTER_SHIFT`] for clusters.
    pub(super) shift: u32,
    /// While the motion pass draws, true when the bucket's instances move by themselves, as skinned
    /// and morphed meshes and swaying custom materials do.
    pub(super) moves: bool,
}

/// One draw: a part of a bucket's mesh, which draws every instance that the bucket lists.
#[derive(Clone, Copy, Debug)]
pub(super) struct Draw {
    /// The id of its render pipeline. In the casters' layout, the pipeline that draws into the
    /// shadow cascades, or 0 while the cascades are off.
    pub(super) pipeline: u32,
    /// The id of the render pipeline that draws its depth in the depth prepass, or 0 for a draw
    /// that the prepass leaves out. In the casters' layout, the pipeline that draws into the
    /// shadow atlas's tiles, or 0 while the tiles are off.
    pub(super) prepass: u32,
    /// The bind group of its material's map, or 0 for a pipeline that reads none.
    pub(super) textures: u32,
    /// While the motion pass draws, the id of the render pipeline that draws its motion, or 0 for
    /// a draw with none, and the bind group of the map that that pipeline reads, or 0.
    pub(super) motion: u32,
    pub(super) motion_textures: u32,
    pub(super) page: u32,
    pub(super) bucket: u32,
    pub(super) index_count: u32,
    pub(super) first_index: u32,
    /// True for a draw of a fade bucket, whose entries come in pairs, so it draws half as many
    /// instances as its bucket lists words.
    pub(super) pairs: bool,
    /// The id of the pipeline that draws it into GPU picking's id target, or 0 while picking is
    /// off or its pair has no pick build.
    pub(super) pick: u32,
    /// The bind group of the material's maps that the pick pipeline reads, or 0 for the pick
    /// template, which reads none.
    pub(super) pick_textures: u32,
}

/// A batch's place in the layout: its data texture, its first row there, whether its rows have
/// row values, which the row values texture beside its data texture holds at the same rows, its
/// bucket of rows (the bucket after it takes its clusters), whether its rows pick levels of
/// detail, and, for a static batch, its first cluster in the cluster texture.
#[derive(Clone, Copy, Debug)]
pub(super) struct BatchSlot {
    pub(super) id: Handle,
    pub(super) dynamic: bool,
    pub(super) values: bool,
    pub(super) base: u32,
    pub(super) bucket: u32,
    pub(super) levels: bool,
    pub(super) first_cluster: u32,
}

impl BatchSlot {
    /// True for a static batch that draws: one whose rows can be culled in clusters. The rows of a
    /// batch whose mesh has levels each pick their own level, so they are culled one by one.
    pub(super) fn clustered(&self) -> bool {
        !self.dynamic && self.bucket != NO_BUCKET && !self.levels
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
    /// The rows of the resident and the streamed textures up to the last row of a batch with row
    /// values, which the row values textures hold, or 0 for a texture without such rows.
    pub(super) resident_value_rows: u32,
    pub(super) streamed_value_rows: u32,
    /// Entries of the cluster texture: each static batch's room for clusters inside cells, whole
    /// clusters each.
    pub(super) cluster_rows: u32,
    pub(super) batches: Vec<BatchSlot>,
    /// The table of object ranges, which the scene's layout builds when it changes while a live
    /// material reads ids, and true while the GPU lacks its last build.
    object_ranges: ObjectRanges,
    ranges_pending: bool,
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
    /// or draws in the transparent pass. A slot of a mesh with levels names its base level's.
    pub(super) scene_buckets: Vec<u32>,
    /// Each bucket's level of detail: its level's error, the bucket of rows of the next coarser
    /// level and its fade bucket, or none for a bucket without levels.
    pub(super) level_links: Vec<LevelLink>,
    /// Each scene slot's bucket, with 0 for the slots that draw in the transparent pass: the rows
    /// whose matrices the resident texture needs.
    pub(super) drawn_slots: Vec<u32>,
    /// True when a bucket draws without writing depth, so a background drawn after the objects
    /// would cover it where nothing lies behind it.
    pub(super) depthless: bool,
    /// The pipelines of the skinned objects that the layout leaves out until they are built.
    waiting: Vec<u32>,
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
    /// Adds the bytes that the layout's tables hold to the memory register.
    pub(super) fn account(&self, use_: &mut MemoryUse) {
        for array in [
            vec_bytes(&self.batches),
            vec_bytes(&self.buckets),
            vec_bytes(&self.draws),
            vec_bytes(&self.second_draws),
            vec_bytes(&self.scene_buckets),
            vec_bytes(&self.level_links),
            vec_bytes(&self.drawn_slots),
            vec_bytes(&self.waiting),
        ] {
            use_.add(array);
        }
        use_.add(self.object_ranges.memory_use());
    }

    /// An empty layout of buckets that draw `drawn`.
    pub(super) fn new(drawn: Drawn) -> Self {
        Self {
            drawn,
            ..Self::default()
        }
    }

    /// Uploads the table of object ranges after the layout built it again.
    pub(super) fn upload_object_ranges(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if !std::mem::take(&mut self.ranges_pending) {
            return Ok(());
        }
        let (at, bytes) = arena.push(self.object_ranges.bytes())?;
        list.push(Op::WriteBuffer, &[ids::OBJECT_RANGES, 0, at, bytes])?;
        Ok(())
    }

    /// Empties the buckets, for a layout that draws nothing until it is built again.
    pub(super) fn clear(&mut self) {
        self.depthless = false;
        self.buckets.clear();
        self.draws.clear();
        self.scene_buckets.clear();
        self.level_links.clear();
        self.batches.clear();
        self.waiting.clear();
        self.room = CullRoom::default();
    }

    /// The pipelines of the skinned objects that the layout leaves out, which must be built before
    /// they draw.
    pub(super) fn waiting(&self) -> &[u32] {
        &self.waiting
    }

    pub(super) fn batch(&self, target: u32) -> Option<&BatchSlot> {
        self.batches.iter().find(|slot| slot.id.raw() == target)
    }

    /// Assigns every source to a data texture and a bucket, from the frame's world state, with
    /// each draw's pipeline id from `pipelines`, for a pass that draws into `targets`. It reuses
    /// the layout's tables, which grow only with the scene. A scene of more than `limit` sources
    /// fails. With `multi_draw`, one block of draw records serves each multi-draw call; else each
    /// draw has an aligned record of its own. While `shadows` has a pass on, the scene's receivers
    /// draw with pipelines that read the shadow maps, and the casters' layout holds the casters,
    /// whose draws get a pipeline for each pass of `shadows` in place of `targets`. The objects
    /// that `skins` skins draw with pipelines that skin in the vertex shader; those that it hides get
    /// no bucket, and the layout asks only for their pipelines. With a `prepass`, the
    /// scene's draws that the depth prepass draws get its pipelines too. The caller marks the
    /// layout built once the room it needs is made. While the motion pass draws into `motion`'s
    /// targets, the scene's draws get their motion pipelines too.
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
        shadows: CasterPasses,
        prepass: Prepass,
        motion: Option<PassTargets>,
        key_counts: &mut KeyCounts,
        pick_targets: PassTargets,
        picking: bool,
    ) -> Result<(), RecordError> {
        let (scene, batches) = (input.scene, input.batches);
        self.scene_rows = scene.capacity() + 1;
        self.batches.clear();
        let (mut resident, mut streamed, mut clusters) = (self.scene_rows, 0u32, 0u32);
        let mut largest_static = 0;
        let mut value_rows = [0u32; 2];
        for (id, batch) in batches.iter() {
            let dynamic = batch.is_dynamic();
            let rows = if dynamic {
                &mut streamed
            } else {
                &mut resident
            };
            let values = batch.has_row_values();
            self.batches.push(BatchSlot {
                id,
                dynamic,
                values,
                base: *rows,
                bucket: NO_BUCKET,
                levels: false,
                first_cluster: clusters,
            });
            *rows = rows.saturating_add(batch.capacity());
            if values {
                value_rows[usize::from(dynamic)] = *rows;
            }
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
        [self.resident_value_rows, self.streamed_value_rows] = value_rows;
        self.cluster_rows = clusters.saturating_mul(CLUSTER_ROWS);
        self.largest_static = largest_static;
        if self.drawn == Drawn::Scene && settings.materials().reads_object_ids() {
            let key = |slot: &BatchSlot| slot.base | if slot.dynamic { STREAMED_KEY } else { 0 };
            let ranges = self.batches.iter().map(|slot| (key(slot), slot.id));
            self.object_ranges.build(self.scene_rows, ranges);
            self.ranges_pending = true;
        }

        let meshes = settings.meshes();
        let drawn = self.drawn;
        let skin = |key: DrawKey, slot: Option<usize>| {
            slot.and_then(|slot| skins.key(slot, key)).unwrap_or(key)
        };
        let key_of = |pipeline: Option<DrawKey>,
                      mesh: u32,
                      material: u32,
                      group: u32,
                      object: u32,
                      skinned: Option<usize>| {
            let pipeline = pipeline?;
            // A decal draws in the decal pass alone: no shadow, depth or outline.
            if pipeline.decal() {
                return None;
            }
            let page = meshes.parts(meshes.mesh(mesh - 1)?, false).first()?.page;
            match drawn {
                Drawn::Casters => {
                    // A masked caster tests its material's alpha; the others draw with none.
                    let (caster, textures) = settings.caster_of(pipeline, material);
                    let material = if caster.template == template::SHADOW_DEPTH {
                        CASTER_MATERIAL
                    } else {
                        material
                    };
                    return Some((skin(caster, skinned), textures, page, mesh, material, group));
                }
                Drawn::Outlined => {
                    let (every, _) = mask_keys(skin(pipeline, skinned));
                    return Some((every, 0, page, mesh, CASTER_MATERIAL, group));
                }
                Drawn::Scene | Drawn::Subsurface => {}
            }
            // Blended pairs, and pairs that let light through, draw in the transparent pass, which
            // sorts them on the job workers.
            if pipeline.sorts() {
                return None;
            }
            let pipeline = if shadows.any() && object & flags::RECEIVE_SHADOWS != 0 {
                settings.receiving(pipeline)
            } else {
                pipeline
            };
            let pipeline = settings.area_key(pipeline);
            let textures = settings.texture_group(material, pipeline);
            // The skin pass draws the pair with its own builds, which bind the same maps.
            let pipeline = match drawn {
                Drawn::Subsurface => skin_key(skin(pipeline, skinned))?,
                _ => skin(pipeline, skinned),
            };
            Some((pipeline, textures, page, mesh, material, group))
        };
        let group_of = |batch: &InstanceBatch| {
            if batch.is_dynamic() {
                STREAMED
            } else {
                RESIDENT
            }
        };
        let any_key = |slot: usize| {
            let object = scene.flags()[slot];
            let own = scene.materials()[slot];
            let material = if drawn.overrides() {
                settings.drawn_material(own)
            } else {
                own
            };
            let left_out = match drawn {
                Drawn::Scene => false,
                Drawn::Casters => !shadows.any() || object & flags::CAST_SHADOWS == 0,
                Drawn::Outlined => object & flags::OUTLINED == 0,
                Drawn::Subsurface => !settings.scatters(material),
            };
            if left_out {
                return None;
            }
            let mesh = scene.meshes()[slot];
            key_of(
                settings.pipeline_of(mesh, material),
                mesh,
                material,
                RESIDENT,
                object,
                Some(slot),
            )
        };
        let scene_key = |slot: usize| {
            if skins.hides(slot) {
                None
            } else {
                any_key(slot)
            }
        };
        // Instance batches cast and receive shadows as their shadow bits say, take no outlines,
        // and no animated instance skins them.
        let batch_key = |batch: &InstanceBatch| {
            let bits = batch.shadows();
            match drawn {
                Drawn::Casters if bits & flags::CAST_SHADOWS == 0 => None,
                Drawn::Scene | Drawn::Casters => {
                    let (material, pipeline) = if drawn.overrides() {
                        settings.drawn_batch_pipeline_of(batch)
                    } else {
                        (batch.material(), settings.batch_pipeline_of(batch))
                    };
                    key_of(
                        pipeline,
                        batch.mesh(),
                        material,
                        group_of(batch),
                        bits,
                        None,
                    )
                }
                Drawn::Outlined | Drawn::Subsurface => None,
            }
        };
        collect_bucket_keys(key_counts, scene, batches, scene_key, |_, batch| {
            batch_key(batch)
        });
        // A morphed object draws its base level: a level carries no morph targets. A skinned
        // object may pick one when every level of its set draws the base mesh's own vertices, which
        // the skin moves and the level then names from indices of its own.
        let levels = settings.levels();
        let eligible = |key: &BucketKey| levels.may_pick(key.3, key.0.permutation);
        // A level may name a material of its own, so its bucket key comes from the level's mesh and
        // material, while it keeps the fields of the bucket that names it: its group, and the
        // object's receive-shadows bit, which the base key's pipeline holds.
        let level_bucket = |key: &BucketKey, level: usize| {
            let (base, _) = key_level(key.3);
            let set = levels.of(base)?;
            let mesh = set.mesh(level);
            let material = match set.material(level) {
                0 => key.4,
                own => own,
            };
            let object = if key.0.permutation & permutation::RECEIVE_SHADOWS != 0 {
                flags::RECEIVE_SHADOWS
            } else {
                0
            };
            let mut bucket = key_of(
                settings.pipeline_of(mesh, material),
                mesh,
                material,
                key.5,
                object,
                None,
            )?;
            // The level draws the vertices that its base key's skin moves, so it keeps the
            // skin and morph bits that the scene gave that key.
            bucket.0.permutation |= key.0.permutation & (permutation::SKIN | permutation::MORPH);
            bucket.3 = level_key(base, level);
            Some(bucket)
        };
        let fades = drawn == Drawn::Scene && settings.levels_fade();
        // The keys whose sources draw in a distance band, which need a fade bucket beside each of
        // their levels only while the quality settings fade those bands.
        let mut ranged_keys: Vec<BucketKey> = Vec::new();
        if fades {
            for slot in 0..scene.capacity() as usize + 1 {
                let [start, end] = scene
                    .draw_ranges()
                    .get(slot * 2..slot * 2 + 2)
                    .map_or([0.0, f32::INFINITY], |range| [range[0], range[1]]);
                if start > 0.0 || end.is_finite() {
                    ranged_keys.extend(scene_key(slot));
                }
            }
            for (_, batch) in batches.iter() {
                if !batch_ranges(batches, batch).is_none() {
                    ranged_keys.extend(batch_key(batch));
                }
            }
            ranged_keys.sort_unstable();
            ranged_keys.dedup();
        }
        let ranged = |key: &BucketKey| ranged_keys.binary_search(key).is_ok();
        expand_level_keys(key_counts, levels, fades, ranged, eligible, &level_bucket);
        self.depthless = key_counts
            .iter()
            .any(|&((pipeline, ..), _)| !pipeline.writes_depth());

        // A caster's two pipelines draw into the cascades and into the tiles.
        let pipelines_of = move |pipelines: &mut PipelineCache, key: DrawKey| match drawn {
            Drawn::Casters => shadows.pipelines(pipelines, key),
            _ => pipelines.opaque(key, targets, prepass),
        };
        self.waiting.clear();
        for slot in 0..self.scene_rows as usize {
            if !skins.hides(slot) {
                continue;
            }
            if let Some((pipeline, ..)) = any_key(slot) {
                let (first, prepass) = pipelines_of(pipelines, pipeline);
                // The outlined layout's buckets draw with both pipelines of the outline mask.
                let second = (drawn == Drawn::Outlined)
                    .then(|| pipelines.id(mask_keys(pipeline).1.in_pass(targets)));
                self.waiting.extend(
                    [first, prepass, second.unwrap_or(0)]
                        .into_iter()
                        .filter(|&id| id != 0),
                );
            }
        }

        self.buckets.clear();
        self.draws.clear();
        self.second_draws.clear();
        self.level_links.clear();
        for &(key, _) in key_counts.iter() {
            let (pipeline, textures, _, mesh, material, group) = key;
            let mesh = levels
                .mesh_of_key(mesh)
                .expect("level keys name known levels");
            let slot = meshes.mesh(mesh - 1).expect("keys name known meshes");
            let motion_key = motion
                .filter(|_| drawn == Drawn::Scene)
                .and_then(|targets| Some((settings.motion_of(pipeline, material)?, targets)));
            let (motion_pipeline, motion_textures) = motion_key
                .map_or((0, 0), |((key, group), targets)| {
                    (pipelines.id(key.in_pass(targets)), group)
                });
            let moves = motion_key.is_some_and(|((key, _), _)| {
                pipeline.permutation & (permutation::SKIN | permutation::MORPH) != 0
                    || key.permutation & permutation::MOTION != 0
            });
            // GPU picking draws this key's parts with the pick template, or with a custom
            // material's pick builds, which repeat its vertex offset.
            let (pick, pick_textures) = match (picking, drawn) {
                (true, Drawn::Scene) => {
                    match crate::pick::key_of(pipeline, settings.sways(material), true) {
                        Some((key, maps)) => (
                            pipelines.id(key.in_pass(pick_targets)),
                            if maps { textures } else { 0 },
                        ),
                        None => (0, 0),
                    }
                }
                _ => (0, 0),
            };
            let (first, prepass) = pipelines_of(pipelines, pipeline);
            let pairs = is_fade_key(&key);
            // Each key's bucket of rows is at twice its place in the keys.
            let links = links_of(key, &*key_counts, levels, eligible, &level_bucket);
            self.level_links.push(LevelLink {
                value: links.value,
                switch: links.switch,
                next: links.next.map_or(NO_LINK, |key| 2 * key),
                fade: links.fade.map_or(NO_LINK, |key| 2 * key),
            });
            self.level_links.push(LevelLink::NONE);
            let second = (drawn == Drawn::Outlined)
                .then(|| pipelines.id(mask_keys(pipeline).1.in_pass(targets)));
            let lines = pipeline.state & state_flags::LINE_LIST != 0;
            let pipeline = first;
            for shift in [0, CLUSTER_SHIFT] {
                let bucket = self.buckets.len() as u32;
                self.buckets.push(Bucket {
                    material,
                    group,
                    shift,
                    moves,
                });
                for part in meshes.parts(slot, lines) {
                    let draw = Draw {
                        pipeline,
                        prepass,
                        textures,
                        motion: motion_pipeline,
                        motion_textures,
                        page: part.page,
                        bucket,
                        index_count: part.index_count,
                        first_index: part.first_index,
                        pairs,
                        pick,
                        pick_textures,
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
        let counts = &*key_counts;
        let bucket_of =
            |key: Option<BucketKey>| bucket_of(counts, key).map_or(NO_BUCKET, |key| 2 * key);
        self.scene_buckets.clear();
        for slot in 0..self.scene_rows as usize {
            self.scene_buckets.push(bucket_of(scene_key(slot)));
        }
        let mut runs = self.scene_rows.div_ceil(CULL_CHUNK);
        let mut batch_rows = 0u32;
        // Runs whose rows pick levels look their buckets up, as the scene's runs do.
        let mut by_row = self.scene_rows.div_ceil(CULL_CHUNK);
        let links = &self.level_links;
        let picks = |bucket: u32| links.get(bucket as usize).is_some_and(LevelLink::has_next);
        // A run whose rows draw in a distance band looks each row up too, even without levels.
        let scene_ranges = (0..self.scene_rows as usize).any(|slot| {
            let [start, end] = scene
                .draw_ranges()
                .get(slot * 2..slot * 2 + 2)
                .map_or([0.0, f32::INFINITY], |range| [range[0], range[1]]);
            start > 0.0 || end.is_finite()
        });
        // Rows that fade list two pairs of words in place of one entry, and a row inside a
        // distance band's edge lists its entry and a fade value.
        let mut fading_rows = if picks_any(&self.scene_buckets, links) || scene_ranges {
            self.scene_rows
        } else {
            0
        };
        for ((_, batch), slot) in batches.iter().zip(&mut self.batches) {
            slot.bucket = bucket_of(batch_key(batch));
            let picked = picks(slot.bucket);
            let ranged = !batch_ranges(batches, batch).is_none();
            slot.levels = picked || ranged;
            if slot.bucket != NO_BUCKET {
                let chunks = batch.capacity().div_ceil(CULL_CHUNK);
                runs += chunks;
                batch_rows = batch_rows.saturating_add(batch.capacity());
                if slot.levels {
                    by_row += chunks;
                    fading_rows = fading_rows.saturating_add(batch.capacity());
                }
            }
        }
        let fading_words = fading_rows.saturating_mul(3);

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
        // A cascade lists at most the scene's rows and the rows of the batches that cast, and the
        // outline and subsurface views the scene's rows, as batches take neither.
        let listed = match drawn {
            Drawn::Scene => resident.saturating_add(streamed),
            Drawn::Casters | Drawn::Outlined | Drawn::Subsurface => {
                self.scene_rows.saturating_add(batch_rows)
            }
        };
        self.room = CullRoom {
            rows: listed.saturating_add(fading_words),
            runs,
            by_row,
            buckets: self.buckets.len() as u32,
            batches: self.batches.len() as u32,
        };
        Ok(())
    }
}

/// True when a scene slot's bucket has coarser levels.
fn picks_any(scene_buckets: &[u32], links: &[LevelLink]) -> bool {
    scene_buckets
        .iter()
        .any(|&bucket| links.get(bucket as usize).is_some_and(LevelLink::has_next))
}

impl Layout {
    /// Makes room in each ring slot of draw records for `bytes` bytes of the transparent and decal
    /// passes' records, after the opaque draws' records, and marks the scene slots in `sorted` and
    /// `decals` as rows that draw.
    pub(super) fn add_sorted(&mut self, bytes: u32, sorted: &[u32], decals: &[u32]) {
        self.draws_slot_bytes = self.sorted_records_at + bytes;
        self.drawn_slots.clone_from(&self.scene_buckets);
        for &slot in sorted.iter().chain(decals) {
            self.drawn_slots[slot as usize] = 0;
        }
    }
}

/// The end of the run of draws that starts at `start`: the draws that share both its pipelines,
/// its maps' bind group and its vertex page.
pub(super) fn run_end(draws: &[Draw], start: usize) -> usize {
    let first = draws[start];
    draws[start..]
        .iter()
        .position(|d| {
            d.pipeline != first.pipeline
                || d.prepass != first.prepass
                || d.textures != first.textures
                || d.motion != first.motion
                || d.motion_textures != first.motion_textures
                || d.pick != first.pick
                || d.page != first.page
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

    /// The static batches that cull by cluster in the scene's layout or in the casters' layout,
    /// as the scene's layout places them. A blended batch that casts shadows has a bucket in the
    /// casters' layout alone. Both layouts list the same batches in the same order, at the same
    /// places in the cluster texture.
    fn clustered<'a>(
        layout: &'a Layout,
        casters: &'a Layout,
    ) -> impl Iterator<Item = &'a BatchSlot> {
        layout.batches.iter().enumerate().filter_map(|(k, slot)| {
            (slot.clustered() || casters.batches.get(k).is_some_and(BatchSlot::clustered))
                .then_some(slot)
        })
    }

    /// The static batches whose current clusters the cluster texture does not hold yet, with
    /// their cluster sets.
    fn uploads<'a>(
        &'a self,
        layout: &'a Layout,
        casters: &'a Layout,
    ) -> impl Iterator<Item = (&'a BatchSlot, &'a ClusterSet)> {
        Self::clustered(layout, casters)
            .map(|slot| (slot, self.set(slot)))
            .filter(|(_, set)| set.current && !set.uploaded)
    }

    /// The bytes that the next [`Clusters::upload`] copies into the arena.
    pub(super) fn pending_bytes(&self, layout: &Layout, casters: &Layout) -> usize {
        self.uploads(layout, casters)
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
        casters: &Layout,
    ) -> Result<(), RecordError> {
        for (slot, set) in self.uploads(layout, casters) {
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
        for slot in Self::clustered(layout, casters) {
            let set = &mut self.sets[slot.id.slot() as usize];
            set.uploaded |= set.current;
        }
        Ok(())
    }
}
