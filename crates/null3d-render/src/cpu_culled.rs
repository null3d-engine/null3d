//! The WebGL2 frame builder. WebGL2 has no compute shaders, so the job workers cull every object
//! and instance on the CPU. The frame lists the visible ones, bucket by bucket, in an index list,
//! and the render worker draws each bucket's slice of the list with instanced draws: many buckets
//! in one call where the device has `WEBGL_multi_draw`, one draw per bucket elsewhere.
//!
//! # Sources and data textures
//!
//! Every scene slot and every row of every instance batch is a source, and each source's world
//! matrix is three texels of a float data texture. The resident texture holds the scene's slots
//! and the rows of static batches, and each frame writes only the rows that changed. The streamed
//! texture holds the rows of dynamic batches, which change every frame, so each frame writes them
//! whole into the next of three textures, never into one the GPU may still read for an earlier
//! frame. The index list goes into the next of three textures the same way: one 32-bit index per
//! visible source, where full matrices would take 48 bytes.
//!
//! # Buckets and draws
//!
//! A bucket is one pipeline, vertex page, mesh, material and data texture. Buckets are sorted, so
//! the buckets of one pipeline and one vertex page sit next to each other, and one multi-draw call
//! draws a whole run of them. Each draw has a record in a uniform block: the start of its slice of
//! the index list, its material and its data texture. The multi-draw shader reads the record of
//! `gl_DrawID`; without the extension, each draw binds its own record.
//!
//! Buckets change only with the scene's structure, as on WebGPU. Showing or hiding an object, or
//! changing a batch's active count, needs no rebuild: culling skips hidden objects and stops at
//! each batch's active count.
//!
//! # Clusters of static rows
//!
//! A static batch at rest is culled in clusters of nearby rows (see
//! [`null3d_core::clusters`]), one sphere per cluster, and its index list entries name clusters
//! instead of rows. A cluster texture lists each such batch's rows in cluster order, and the
//! vertex shader finds an instance's row there. Every bucket therefore has two draws: one whose
//! entries are rows, and one whose entries are clusters, which draws a cluster's worth of
//! instances per entry. A static batch that changed in the frame is culled row by row. The next
//! frame's update copies the change into the other world buffer, so both buffers hold the same
//! rows: that frame builds the batch's clusters again, and the cluster texture gets their order.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. Each frame parity keeps its own culling
//! output, because the render worker replays a frame's list while the next frame culls, and the
//! list uploads the index list straight from that output. Only the first frames after the scene
//! grows allocate.

use std::collections::TryReserveError;

use null3d_core::clusters::{CLUSTER_ROWS, CLUSTER_SHIFT, ClusterScratch, NO_ROW, RowClusters};
use null3d_core::culling::{BY_ROW, BucketedCull, CULL_CHUNK, CullRun, Frustum, NO_BUCKET};
use null3d_core::handle::Handle;
use null3d_core::instances::InstanceBatch;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_core::world::{MATRIX_FLOATS, SphereArrays};
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, index_format, layout, permutation, resource_kind,
    sizes, template, texture_usage,
};

use crate::frame::{
    FrameBuilder, FrameInput, HIDDEN, PageUploads, ParityLists, RecordError, SceneSettings,
    SceneTargets, UploadArena, address, bucket_of, collect_bucket_keys, drawn_rows,
    floats_as_bytes, grown_size, put_u32, words_as_bytes,
};
use crate::frame_data::FrameUniform;
use crate::materials::{MATERIAL_FLOATS, Shading};
use crate::meshes::{MAX_BUFFER_BYTES, MeshStorage, Packing, Page};

/// Frames that the rings of streamed and index list textures cover: the frame being recorded and
/// the two the GPU may still be drawing.
const RING: u32 = 3;
/// Bytes of one frame's slot in the ring of frame uniforms: the uniform block, aligned for binding.
const FRAME_SLOT_BYTES: u32 = OFFSET_ALIGNMENT;
/// Bytes of the draw record block that one multi-draw call binds.
const MULTI_DRAW_BLOCK_BYTES: u32 = sizes::MULTI_DRAW_RECORDS * sizes::DRAW_RECORD_BYTES;
/// Bytes of one world matrix: three rows of four floats.
const MATRIX_BYTES: u32 = (MATRIX_FLOATS * 4) as u32;
/// The data texture of a bucket's instances, as its draw record names it.
const RESIDENT: u32 = 0;
const STREAMED: u32 = 1;
// A scene slot that draws nowhere has the same marker in the culling tables and the upload trims.
const _: () = assert!(NO_BUCKET == HIDDEN);

/// A slot of one of the frame rings that moves on only when a frame writes new data, so a frame
/// whose data did not change draws from the slot that already holds it. A slot is written again
/// only after the two other slots, so the GPU has finished reading it, as with a ring that moves
/// every frame.
#[derive(Clone, Copy, Debug, Default)]
struct RingSlot {
    slot: u32,
    /// The frame whose data the slot holds, or 0 for none.
    holds: u32,
}

impl RingSlot {
    /// True when the slot holds data that a frame can draw from.
    fn holds_any(&self) -> bool {
        self.holds != 0
    }

    /// True when the slot holds the data of the frame before `frame`.
    fn holds_previous(&self, frame: u32) -> bool {
        self.holds_any() && self.holds == frame.wrapping_sub(1)
    }

    /// The slot `frame` draws from: the next one when the frame writes new data.
    fn take(&mut self, frame: u32, write: bool) -> u32 {
        if write {
            self.slot = (self.slot + 1) % RING;
        }
        self.holds = frame;
        self.slot
    }

    /// Forgets what the slot holds, so the next frame writes its data again.
    fn forget(&mut self) {
        self.holds = 0;
    }
}

/// The ring slots a frame draws from.
#[derive(Clone, Copy, Debug)]
struct FrameSlots {
    /// The frame uniform's slot.
    uniform: u32,
    /// The streamed texture's slot.
    streamed: u32,
    /// The index list texture's and the draw records' slot.
    listed: u32,
}

/// The builder's GPU objects. It owns every id it uses.
mod ids {
    pub const FRAME: u32 = 1;
    pub const MATERIALS: u32 = 2;
    pub const DRAWS: u32 = 3;
    /// Page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in `PAGES + 2p + 1`.
    pub const PAGES: u32 = 16;

    pub const COLOR: u32 = 1;
    pub const DEPTH: u32 = 2;
    pub const RESIDENT: u32 = 3;
    /// The ring of streamed textures, one per ring slot.
    pub const STREAMED: u32 = 4;
    /// The ring of index list textures, one per ring slot.
    pub const VISIBLE: u32 = 7;
    /// The rows of static batches in cluster order.
    pub const CLUSTERS: u32 = 10;

    pub const LIT: u32 = 1;
    pub const UNLIT: u32 = 2;

    pub const FRAME_GROUP: u32 = 1;
    pub const DRAWS_GROUP: u32 = 2;
    /// The textures of each pair of ring slots: the streamed texture's and the index list's, at
    /// `INSTANCES_GROUP + streamed * RING + listed`.
    pub const INSTANCES_GROUP: u32 = 3;
}

/// Sizes the builder allocates once, and what the device offers.
#[derive(Clone, Copy, Debug)]
pub struct CpuCulledConfig {
    /// MSAA samples of the color and depth targets.
    pub samples: u32,
    /// Materials the table holds, at most [`sizes::MAX_MATERIALS`].
    pub max_materials: u32,
    /// Words of each frame's draw list.
    pub draw_list_words: usize,
    /// The device's largest texture width and height; WebGL2 allows at least 2,048.
    pub max_texture_size: u32,
    /// True when the device has `WEBGL_multi_draw`.
    pub multi_draw: bool,
}

impl Default for CpuCulledConfig {
    fn default() -> Self {
        Self {
            samples: 4,
            max_materials: sizes::MAX_MATERIALS,
            draw_list_words: 64 * 1024,
            max_texture_size: 2048,
            multi_draw: false,
        }
    }
}

/// The most sources the builder can draw on a device whose textures reach `max_texture_size`:
/// each texture group, and the index list, must fit one texture.
pub const fn max_sources(max_texture_size: u32) -> u32 {
    sizes::MATRICES_PER_TEXTURE_ROW.saturating_mul(max_texture_size)
}

/// What makes a bucket, in draw order: the pipeline, the vertex page, the engine mesh and material
/// ids, and the data texture.
type BucketKey = (Shading, u32, u32, u32, u32);

/// One draw of a bucket key. Each key has two, next to each other: the draw whose index list
/// entries are rows, then the draw whose entries are clusters of rows.
#[derive(Clone, Copy, Debug)]
struct Bucket {
    shading: Shading,
    page: u32,
    /// The engine material id.
    material: u32,
    group: u32,
    index_count: u32,
    first_index: u32,
    /// Instances per index list entry, as a shift: 0 for rows, [`CLUSTER_SHIFT`] for clusters.
    shift: u32,
}

/// A batch's place in the layout: its data texture, its first row there, its bucket of rows
/// (the bucket after it takes its clusters), and, for a static batch, its first cluster in the
/// cluster texture.
#[derive(Clone, Copy, Debug)]
struct BatchSlot {
    id: Handle,
    dynamic: bool,
    base: u32,
    bucket: u32,
    first_cluster: u32,
}

impl BatchSlot {
    /// True for a static batch that draws: one whose rows can be culled in clusters.
    fn clustered(&self) -> bool {
        !self.dynamic && self.bucket != NO_BUCKET
    }
}

/// A static batch's clusters, kept across layout rebuilds by the batch's id.
#[derive(Debug, Default)]
struct ClusterSet {
    id: Handle,
    clusters: RowClusters,
    /// True when the clusters match the batch's rows in both world buffers.
    current: bool,
    /// True when the cluster texture holds the clusters' order at the batch's place.
    uploaded: bool,
}

/// The source layout and bucket tables, rebuilt when the structure changes.
#[derive(Default)]
struct Layout {
    scene_rows: u32,
    resident_rows: u32,
    streamed_rows: u32,
    /// Entries of the cluster texture: each static batch's rows, rounded up to whole clusters.
    cluster_rows: u32,
    batches: Vec<BatchSlot>,
    buckets: Vec<Bucket>,
    /// Each scene slot's bucket, shown or hidden, or `NO_BUCKET` for a slot that draws nowhere.
    scene_buckets: Vec<u32>,
    /// Scratch for rebuilds: every bucket key with its source count, sorted and merged.
    key_counts: Vec<(BucketKey, u32)>,
    /// Bytes of one ring slot of draw records.
    draws_slot_bytes: u32,
    built: bool,
    /// The frame that last rebuilt the layout.
    built_in: u32,
}

impl Layout {
    fn batch(&self, target: u32) -> Option<&BatchSlot> {
        self.batches.iter().find(|slot| slot.id.raw() == target)
    }
}

/// A vertex page's GPU buffers: their sizes, and how much of the page they hold.
#[derive(Clone, Copy, Debug, Default)]
struct PageBuffers {
    vertex_bytes: u32,
    index_bytes: u32,
    uploaded: PageUploads,
}

impl PageBuffers {
    /// Bytes of the page's vertices and indices, as its buffers must hold them.
    fn needed(page: &Page) -> (u32, u32) {
        (
            (page.vertices.len() * 4) as u32,
            (page.indices.len() * 2).next_multiple_of(4) as u32,
        )
    }

    /// True when the page outgrew its buffers, so they must be made again and filled whole.
    fn outgrown(&self, page: &Page) -> bool {
        let (vertex_bytes, index_bytes) = Self::needed(page);
        vertex_bytes > self.vertex_bytes || index_bytes > self.index_bytes
    }
}

/// Records one draw list per frame for the WebGL2 path.
pub struct CpuCulledRenderer {
    config: CpuCulledConfig,
    settings: SceneSettings,
    lists: ParityLists,
    layout: Layout,
    /// Each frame parity's culling output: the frame's index list, grouped by bucket.
    culls: [BucketedCull; 2],
    /// The frame's culling runs.
    runs: Vec<CullRun>,
    /// The frame whose culling `culls` holds for its parity, and that frame's constants, or
    /// `None` when it has no camera.
    culled: u32,
    uniform: Option<FrameUniform>,
    pages: Vec<PageBuffers>,
    /// Each batch's clusters, in the layout's batch order; only static batches use theirs.
    cluster_sets: Vec<ClusterSet>,
    cluster_scratch: ClusterScratch,
    /// Rows of the resident, streamed, index list and cluster textures; 0 before they exist.
    texture_rows: [u32; 4],
    /// The frame rings' slots: the frame uniform, whose last upload is `uniform_uploaded`, the
    /// streamed texture, and the index list texture with its draw records.
    uniform_slot: RingSlot,
    uniform_uploaded: FrameUniform,
    streamed_slot: RingSlot,
    listed_slot: RingSlot,
    draws_bytes: u32,
    created: bool,
    canvas: (u32, u32),
}

impl CpuCulledRenderer {
    pub fn new(config: CpuCulledConfig) -> Self {
        assert!(
            config.max_materials <= sizes::MAX_MATERIALS,
            "the material block holds {} materials",
            sizes::MAX_MATERIALS
        );
        Self {
            config,
            settings: SceneSettings::new(MeshStorage::new(Packing::Pages), config.max_materials),
            lists: ParityLists::new(config.draw_list_words),
            layout: Layout::default(),
            culls: [BucketedCull::default(), BucketedCull::default()],
            runs: Vec::new(),
            culled: 0,
            uniform: None,
            pages: Vec::new(),
            cluster_sets: Vec::new(),
            cluster_scratch: ClusterScratch::default(),
            texture_rows: [0; 4],
            uniform_slot: RingSlot::default(),
            uniform_uploaded: FrameUniform::default(),
            streamed_slot: RingSlot::default(),
            listed_slot: RingSlot::default(),
            draws_bytes: 0,
            created: false,
            canvas: (0, 0),
        }
    }

    fn targets(&self) -> SceneTargets {
        SceneTargets {
            color: ids::COLOR,
            depth: ids::DEPTH,
            samples: self.config.samples,
        }
    }

    /// The culling output of a frame's parity: the frame's visible sources, bucket by bucket.
    pub fn culled(&self, frame: u32) -> &BucketedCull {
        &self.culls[(frame & 1) as usize]
    }

    /// Assigns every source to a data texture and a bucket, from the frame's world state. It
    /// reuses the layout's tables, which grow only with the scene.
    fn rebuild_layout(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        let limit = FrameBuilder::max_sources(self);
        let settings = &self.settings;
        let layout = &mut self.layout;
        let (scene, batches) = (input.scene, input.batches);
        layout.scene_rows = scene.capacity() + 1;
        layout.batches.clear();
        let (mut resident, mut streamed, mut clusters) = (layout.scene_rows, 0u32, 0u32);
        let mut largest_static = 0;
        for (id, batch) in batches.iter() {
            let dynamic = batch.is_dynamic();
            let rows = if dynamic {
                &mut streamed
            } else {
                &mut resident
            };
            layout.batches.push(BatchSlot {
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
        layout.resident_rows = resident;
        layout.streamed_rows = streamed;
        layout.cluster_rows = clusters.saturating_mul(CLUSTER_ROWS);

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
            &mut layout.key_counts,
            scene,
            batches,
            scene_key,
            |_, batch| key_of(batch.mesh(), batch.material(), group_of(batch)),
        );

        layout.buckets.clear();
        for &((shading, page, mesh, material, group), _) in &layout.key_counts {
            let slot = settings
                .meshes()
                .mesh(mesh - 1)
                .expect("keys name known meshes");
            for shift in [0, CLUSTER_SHIFT] {
                layout.buckets.push(Bucket {
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
        let counts = &layout.key_counts;
        let bucket_of =
            |key: Option<BucketKey>| bucket_of(counts, key).map_or(NO_BUCKET, |key| 2 * key);
        layout.scene_buckets.clear();
        for slot in 0..layout.scene_rows as usize {
            layout.scene_buckets.push(bucket_of(scene_key(slot)));
        }
        let mut runs = layout.scene_rows.div_ceil(CULL_CHUNK);
        for ((_, batch), slot) in batches.iter().zip(&mut layout.batches) {
            slot.bucket = bucket_of(key_of(batch.mesh(), batch.material(), group_of(batch)));
            if slot.bucket != NO_BUCKET {
                runs += batch.capacity().div_ceil(CULL_CHUNK);
            }
        }

        // The ring slot of draw records: one block per multi-draw call, or one aligned record per
        // bucket.
        let buckets = layout.buckets.len() as u32;
        layout.draws_slot_bytes = if self.config.multi_draw {
            let mut calls = 0;
            let mut start = 0;
            while start < layout.buckets.len() {
                let run = run_end(&layout.buckets, start) - start;
                calls += (run as u32).div_ceil(sizes::MULTI_DRAW_RECORDS);
                start += run;
            }
            calls.max(1) * MULTI_DRAW_BLOCK_BYTES
        } else {
            buckets.max(1) * OFFSET_ALIGNMENT
        };

        let rows = resident.saturating_add(streamed);
        let by_row = layout.scene_rows.div_ceil(CULL_CHUNK);
        let out_of_memory = |_: TryReserveError| RecordError::OutOfMemory {
            bytes: rows.saturating_mul(8),
        };
        // Each batch keeps its clusters at its table slot, so a rebuild keeps clusters that are
        // still good. Their places in the cluster texture may have moved, so each uploads again.
        let slots = batches
            .iter()
            .map(|(id, _)| id.slot() + 1)
            .max()
            .unwrap_or(0) as usize;
        if self.cluster_sets.len() < slots {
            self.cluster_sets
                .try_reserve(slots - self.cluster_sets.len())
                .map_err(out_of_memory)?;
            self.cluster_sets.resize_with(slots, ClusterSet::default);
        }
        for (id, batch) in batches.iter().filter(|(_, batch)| !batch.is_dynamic()) {
            let set = &mut self.cluster_sets[id.slot() as usize];
            if set.id != id {
                set.id = id;
                set.current = false;
            }
            set.uploaded = false;
            set.clusters
                .try_reserve(batch.capacity())
                .map_err(out_of_memory)?;
        }
        self.cluster_scratch
            .try_reserve(largest_static)
            .map_err(out_of_memory)?;
        // Emptied first, so the room asked for is the whole run count, not more on top of the
        // previous frame's runs.
        self.runs.clear();
        self.runs
            .try_reserve(runs as usize)
            .map_err(out_of_memory)?;
        for cull in &mut self.culls {
            cull.try_reserve(rows, runs, by_row, buckets)
                .map_err(out_of_memory)?;
        }
        layout.built = true;
        layout.built_in = input.frame;
        // New buckets make new draw records, and the index list textures may be new.
        self.listed_slot.forget();
        // Room for every static batch's cluster order, so a batch coming to rest later uploads
        // its clusters without growing the arena.
        let bound = self.upload_bound_without_clusters() + self.layout.cluster_rows as usize * 4;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound).map_err(out_of_memory)?;
        }
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the material table, the frame's constants, its draw records, the arrays of
    /// its multi-draw calls, and the cluster orders not uploaded yet.
    fn upload_bound(&self) -> usize {
        let clusters: usize = self
            .cluster_uploads()
            .map(|(_, set)| set.clusters.order().len() * 4)
            .sum();
        self.upload_bound_without_clusters() + clusters
    }

    /// [`Self::upload_bound`] without the cluster orders.
    fn upload_bound_without_clusters(&self) -> usize {
        let meshes: usize = self
            .settings
            .meshes()
            .pages()
            .iter()
            .enumerate()
            .map(|(p, page)| {
                let buffers = self.pages.get(p).copied().unwrap_or_default();
                let uploaded = if buffers.outgrown(page) {
                    PageUploads::default()
                } else {
                    buffers.uploaded
                };
                uploaded.pending_bytes(page)
            })
            .sum();
        let materials = self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4;
        let draws = self.layout.draws_slot_bytes as usize + self.layout.buckets.len() * 12;
        meshes + materials + sizes::FRAME_UNIFORM_BYTES as usize + draws
    }

    /// The static batches whose current clusters the cluster texture does not hold yet, with
    /// their cluster sets.
    fn cluster_uploads(&self) -> impl Iterator<Item = (&BatchSlot, &ClusterSet)> {
        self.layout
            .batches
            .iter()
            .filter(|slot| slot.clustered())
            .map(|slot| (slot, &self.cluster_sets[slot.id.slot() as usize]))
            .filter(|(_, set)| set.current && !set.uploaded)
    }

    /// Writes the cluster order of each static batch whose clusters are new, or moved in the
    /// cluster texture. Each entry becomes the row's place in the resident texture, and the end
    /// of the last cluster stays [`NO_ROW`].
    fn upload_clusters(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        for (slot, set) in self.cluster_uploads() {
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
        for slot in self.layout.batches.iter().filter(|slot| slot.clustered()) {
            let set = &mut self.cluster_sets[slot.id.slot() as usize];
            set.uploaded |= set.current;
        }
        Ok(())
    }

    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let bits = if self.config.multi_draw {
            permutation::DRAW_INDEX
        } else {
            0
        };
        for (id, tmpl) in [
            (ids::LIT, template::INSTANCED_LIT),
            (ids::UNLIT, template::INSTANCED_UNLIT),
        ] {
            list.push(
                Op::CreateRenderPipeline,
                &[
                    id,
                    tmpl,
                    bits,
                    format::CANVAS,
                    format::DEPTH32_FLOAT,
                    self.config.samples,
                    0,
                ],
            )?;
        }
        let material_bytes = sizes::MAX_MATERIALS * MATERIAL_FLOATS as u32 * 4;
        for (id, size) in [
            (ids::FRAME, RING * FRAME_SLOT_BYTES),
            (ids::MATERIALS, material_bytes),
        ] {
            list.push(
                Op::CreateBuffer,
                &[id, size, usage::UNIFORM | usage::COPY_DST],
            )?;
        }
        list.push(
            Op::CreateBindGroup,
            &[
                ids::FRAME_GROUP,
                layout::FRAME,
                2,
                0,
                resource_kind::BUFFER,
                ids::FRAME,
                0,
                sizes::FRAME_UNIFORM_BYTES,
                1,
                resource_kind::BUFFER,
                ids::MATERIALS,
                0,
                material_bytes,
            ],
        )?;
        self.created = true;
        Ok(())
    }

    /// Uploads mesh data added since the last upload, from copies in the frame's arena. A page
    /// whose buffers are too small gets new ones, with room to grow, and uploads again whole.
    fn upload_meshes(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        for (p, page) in self.settings.meshes().pages().iter().enumerate() {
            if self.pages.len() <= p {
                self.pages.push(PageBuffers::default());
            }
            let buffers = &mut self.pages[p];
            let buffer_ids = [ids::PAGES + 2 * p as u32, ids::PAGES + 2 * p as u32 + 1];
            if buffers.outgrown(page) {
                let (vertex_bytes, index_bytes) = PageBuffers::needed(page);
                let limit = MAX_BUFFER_BYTES as u32;
                buffers.vertex_bytes = grown_size(vertex_bytes, limit);
                buffers.index_bytes = grown_size(index_bytes, limit);
                list.push(
                    Op::CreateBuffer,
                    &[
                        buffer_ids[0],
                        buffers.vertex_bytes,
                        usage::VERTEX | usage::COPY_DST,
                    ],
                )?;
                list.push(
                    Op::CreateBuffer,
                    &[
                        buffer_ids[1],
                        buffers.index_bytes,
                        usage::INDEX | usage::COPY_DST,
                    ],
                )?;
                buffers.uploaded = PageUploads::default();
            }
            let capacity = [buffers.vertex_bytes, buffers.index_bytes];
            buffers
                .uploaded
                .upload(list, arena, page, buffer_ids, capacity)?;
        }
        Ok(())
    }

    /// Makes the data textures, the cluster texture and the draw record buffer big enough for the
    /// layout, with room to grow, and binds each ring slot's textures. Returns true when the
    /// resident texture is new, so it needs every row again. A new cluster texture needs every
    /// batch's clusters again, which the layout rebuild before it has already asked for.
    fn size_resources(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let layout = &self.layout;
        let limit = self.config.max_texture_size;
        let matrix_width = sizes::MATRICES_PER_TEXTURE_ROW * sizes::MATRIX_TEXELS;
        let needed = [
            layout
                .resident_rows
                .div_ceil(sizes::MATRICES_PER_TEXTURE_ROW)
                .max(1),
            layout
                .streamed_rows
                .div_ceil(sizes::MATRICES_PER_TEXTURE_ROW)
                .max(1),
            (layout.resident_rows + layout.streamed_rows)
                .div_ceil(sizes::INDICES_PER_TEXTURE_ROW)
                .max(1),
            layout
                .cluster_rows
                .div_ceil(sizes::INDICES_PER_TEXTURE_ROW)
                .max(1),
        ];
        let textures: [(&[u32], u32, u32); 4] = [
            (&[ids::RESIDENT], matrix_width, format::RGBA32_FLOAT),
            (
                &[ids::STREAMED, ids::STREAMED + 1, ids::STREAMED + 2],
                matrix_width,
                format::RGBA32_FLOAT,
            ),
            (
                &[ids::VISIBLE, ids::VISIBLE + 1, ids::VISIBLE + 2],
                sizes::INDICES_PER_TEXTURE_ROW,
                format::R32_UINT,
            ),
            (
                &[ids::CLUSTERS],
                sizes::INDICES_PER_TEXTURE_ROW,
                format::R32_UINT,
            ),
        ];
        let mut recreated = [false; 4];
        for (k, (texture_ids, width, tex_format)) in textures.into_iter().enumerate() {
            if self.texture_rows[k] >= needed[k] {
                continue;
            }
            let rows = grown_rows(needed[k], limit);
            for &id in texture_ids {
                list.push(
                    Op::CreateTexture,
                    &[
                        id,
                        width,
                        rows,
                        1,
                        tex_format,
                        texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                        1,
                        1,
                    ],
                )?;
            }
            self.texture_rows[k] = rows;
            recreated[k] = true;
        }
        if recreated.contains(&true) {
            for streamed in 0..RING {
                for listed in 0..RING {
                    list.push(
                        Op::CreateBindGroup,
                        &[
                            ids::INSTANCES_GROUP + streamed * RING + listed,
                            layout::INSTANCES,
                            4,
                            0,
                            resource_kind::TEXTURE,
                            ids::RESIDENT,
                            0,
                            0,
                            1,
                            resource_kind::TEXTURE,
                            ids::STREAMED + streamed,
                            0,
                            0,
                            2,
                            resource_kind::TEXTURE,
                            ids::VISIBLE + listed,
                            0,
                            0,
                            3,
                            resource_kind::TEXTURE,
                            ids::CLUSTERS,
                            0,
                            0,
                        ],
                    )?;
                }
            }
        }
        let draws_bytes = RING * layout.draws_slot_bytes;
        if self.draws_bytes < draws_bytes {
            self.draws_bytes = grown_size(draws_bytes, u32::MAX);
            list.push(
                Op::CreateBuffer,
                &[
                    ids::DRAWS,
                    self.draws_bytes,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            let block = if self.config.multi_draw {
                MULTI_DRAW_BLOCK_BYTES
            } else {
                sizes::DRAW_RECORD_BYTES
            };
            list.push(
                Op::CreateBindGroup,
                &[
                    ids::DRAWS_GROUP,
                    layout::DRAWS,
                    1,
                    0,
                    resource_kind::BUFFER,
                    ids::DRAWS,
                    0,
                    block,
                ],
            )?;
        }
        Ok(recreated[0])
    }

    /// Uploads changed world matrices of the scene and of static batches into the resident
    /// texture, straight from the core's world buffers of this parity, or every one of them after
    /// the layout changed.
    fn upload_resident(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        everything: bool,
    ) -> Result<(), RecordError> {
        let parity = input.parity();
        let layout = &self.layout;
        let upload = |list: &mut DrawList, base: u32, matrices: &[f32], start: u32, count: u32| {
            write_matrices(
                list,
                ids::RESIDENT,
                base + start,
                matrices_of(matrices, start, count),
            )
        };
        if everything || input.snapshot.overflowed() {
            // Slots past the highest one ever used, and rows past a batch's active count, draw
            // nothing; they upload when they change.
            let scene = input.scene.world(parity).matrices();
            upload(list, 0, scene, 0, input.scene.slots().high_water())?;
            for slot in layout.batches.iter().filter(|slot| !slot.dynamic) {
                let batch = input
                    .batches
                    .get(slot.id)
                    .expect("the layout names live batches");
                upload(
                    list,
                    slot.base,
                    batch.world(parity).matrices(),
                    0,
                    batch.frame_active_count(parity),
                )?;
            }
            return Ok(());
        }
        for range in input.snapshot.uploads() {
            if range.target == SCENE_TARGET {
                let scene = input.scene.world(parity).matrices();
                if let Some((start, count)) =
                    drawn_rows(&layout.scene_buckets, range.start, range.count)
                {
                    upload(list, 0, scene, start, count)?;
                }
                continue;
            }
            let Some(slot) = layout.batch(range.target).filter(|slot| !slot.dynamic) else {
                continue;
            };
            let Ok(batch) = input.batches.get(slot.id) else {
                continue;
            };
            upload(
                list,
                slot.base,
                batch.world(parity).matrices(),
                range.start,
                range.count,
            )?;
        }
        Ok(())
    }

    /// True when a dynamic batch has active rows this frame, which it writes into a new slot of
    /// the streamed ring.
    fn has_moving_rows(&self, input: &FrameInput<'_>) -> bool {
        let parity = input.parity();
        self.layout.batches.iter().any(|slot| {
            slot.dynamic
                && input
                    .batches
                    .get(slot.id)
                    .is_ok_and(|batch| batch.frame_active_count(parity) > 0)
        })
    }

    /// Writes the active rows of every dynamic batch into the streamed texture of `streamed`, and
    /// the frame's index list into the index list texture of `listed`; `None` writes nothing.
    fn upload_frame_data(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        streamed: Option<u32>,
        listed: Option<u32>,
    ) -> Result<(), RecordError> {
        let parity = input.parity();
        if let Some(streamed) = streamed {
            for slot in self.layout.batches.iter().filter(|slot| slot.dynamic) {
                let Ok(batch) = input.batches.get(slot.id) else {
                    continue;
                };
                let active = batch.frame_active_count(parity);
                let matrices = matrices_of(batch.world(parity).matrices(), 0, active);
                write_matrices(list, ids::STREAMED + streamed, slot.base, matrices)?;
            }
        }
        let Some(listed) = listed else {
            return Ok(());
        };
        let indices = self.culls[parity].indices();
        write_rows(
            list,
            ids::VISIBLE + listed,
            TextureRows::indices(0, indices.len() as u32),
            address(words_as_bytes(indices)),
        )
    }

    /// Writes the frame's draw records into the listed slot of the record ring for a new list,
    /// then records the render pass that draws every bucket with visible instances from the
    /// frame's ring slots.
    fn record_draws(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        input: &FrameInput<'_>,
        slots: FrameSlots,
        new_list: bool,
    ) -> Result<(), RecordError> {
        let buckets = &self.layout.buckets;
        let starts = self.culls[input.parity()].bucket_starts();
        let visible = |b: usize| starts[b + 1] - starts[b];
        let multi = self.config.multi_draw;
        let slot = slots.listed * self.layout.draws_slot_bytes;
        // A multi-draw call binds a block of records; a single draw binds one aligned record.
        let stride = if multi {
            MULTI_DRAW_BLOCK_BYTES
        } else {
            OFFSET_ALIGNMENT
        };

        let mut calls = 0;
        for_each_call(buckets, &visible, multi, |_, _| {
            calls += 1;
            Ok(())
        })?;
        if new_list && calls > 0 {
            let (at, records) = arena.push_zeroed((calls * stride) as usize)?;
            for_each_call(buckets, &visible, multi, |index, call| {
                let drawn = (call.from..call.to).filter(|&b| visible(b) > 0);
                for (r, b) in drawn.enumerate() {
                    let word = (index * stride / 4) as usize + r * 4;
                    put_u32(records, word, starts[b]);
                    put_u32(records, word + 1, buckets[b].material - 1);
                    put_u32(records, word + 2, buckets[b].group);
                    put_u32(records, word + 3, buckets[b].shift);
                }
                Ok(())
            })?;
            list.push(Op::WriteBuffer, &[ids::DRAWS, slot, at, calls * stride])?;
        }

        self.settings.record_begin_pass(list, self.targets())?;
        list.push(
            Op::SetBindGroup,
            &[0, ids::FRAME_GROUP, 1, slots.uniform * FRAME_SLOT_BYTES],
        )?;
        let instances = ids::INSTANCES_GROUP + slots.streamed * RING + slots.listed;
        list.push(Op::SetBindGroup, &[2, instances, 0])?;
        let mut pipeline = None;
        let mut run = usize::MAX;
        for_each_call(buckets, &visible, multi, |index, call| {
            if call.run != run {
                run = call.run;
                let first = buckets[run];
                let wanted = match first.shading {
                    Shading::Lit => ids::LIT,
                    Shading::Unlit => ids::UNLIT,
                };
                if pipeline != Some(wanted) {
                    list.push(Op::SetPipeline, &[wanted])?;
                    pipeline = Some(wanted);
                }
                let (vertices, indices) =
                    (ids::PAGES + 2 * first.page, ids::PAGES + 2 * first.page + 1);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
            }
            list.push(
                Op::SetBindGroup,
                &[1, ids::DRAWS_GROUP, 1, slot + index * stride],
            )?;
            let drawn = (call.from..call.to).filter(|&b| visible(b) > 0);
            if multi {
                let n = call.drawn as usize;
                let (counts_at, counts) = arena.push_zeroed(n * 4)?;
                for (k, b) in drawn.clone().enumerate() {
                    put_u32(counts, k, buckets[b].index_count);
                }
                let (offsets_at, offsets) = arena.push_zeroed(n * 4)?;
                for (k, b) in drawn.clone().enumerate() {
                    put_u32(offsets, k, buckets[b].first_index * 2);
                }
                let (instances_at, instances) = arena.push_zeroed(n * 4)?;
                for (k, b) in drawn.enumerate() {
                    put_u32(instances, k, visible(b) << buckets[b].shift);
                }
                list.push(
                    Op::MultiDrawIndexed,
                    &[call.drawn, counts_at, offsets_at, instances_at],
                )?;
            } else {
                for b in drawn {
                    let bucket = buckets[b];
                    let instances = visible(b) << bucket.shift;
                    list.push(
                        Op::DrawIndexed,
                        &[bucket.index_count, instances, bucket.first_index, 0, 0],
                    )?;
                }
            }
            Ok(())
        })?;
        list.push(Op::EndRenderPass, &[])?;
        list.push(Op::Submit, &[])?;
        Ok(())
    }

    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        if self.culled != input.frame {
            self.cull(input)?;
        }
        if !self.created {
            self.create_fixed(list)?;
        }
        if input.canvas != self.canvas {
            self.canvas = self.targets().record_resize(list, input.canvas)?;
        }
        let rebuilt = self.layout.built_in == input.frame;
        arena.reset(self.upload_bound());
        self.upload_meshes(list, arena)?;
        if self.settings.materials_mut().take_changed() {
            let parameters = self.settings.materials().parameters();
            let (at, bytes) = arena.push(floats_as_bytes(parameters))?;
            list.push(Op::WriteBuffer, &[ids::MATERIALS, 0, at, bytes])?;
        }
        let new_texture = if rebuilt {
            self.size_resources(list)?
        } else {
            false
        };
        self.upload_resident(list, input, rebuilt || new_texture)?;
        self.upload_clusters(list, arena)?;
        let Some(uniform) = self.uniform else {
            self.settings.record_clear_only(list, self.targets())?;
            return Ok(rebuilt);
        };
        // Each ring moves to a new slot only for new data: a changed frame uniform, moving rows,
        // or an index list that differs from the previous frame's.
        let frame = input.frame;
        let new_uniform = !self.uniform_slot.holds_any() || uniform != self.uniform_uploaded;
        let moving = self.has_moving_rows(input);
        let new_list = !self.keeps_previous_list(input);
        let slots = FrameSlots {
            uniform: self.uniform_slot.take(frame, new_uniform),
            streamed: self.streamed_slot.take(frame, moving),
            listed: self.listed_slot.take(frame, new_list),
        };
        self.upload_frame_data(
            list,
            input,
            moving.then_some(slots.streamed),
            new_list.then_some(slots.listed),
        )?;
        if new_uniform {
            let (at, bytes) = arena.push(uniform.as_bytes())?;
            let offset = slots.uniform * FRAME_SLOT_BYTES;
            list.push(Op::WriteBuffer, &[ids::FRAME, offset, at, bytes])?;
            self.uniform_uploaded = uniform;
        }
        self.record_draws(list, arena, input, slots, new_list)?;
        Ok(rebuilt)
    }

    /// True when the listed slot holds the previous frame's culling output and this frame's is the
    /// same: the same entries in the same buckets. The frame then draws from that slot as it is.
    fn keeps_previous_list(&self, input: &FrameInput<'_>) -> bool {
        let parity = input.parity();
        let (now, before) = (&self.culls[parity], &self.culls[parity ^ 1]);
        self.listed_slot.holds_previous(input.frame)
            && now.bucket_starts() == before.bucket_starts()
            && now.indices() == before.indices()
    }
}

impl FrameBuilder for CpuCulledRenderer {
    fn settings(&self) -> &SceneSettings {
        &self.settings
    }

    fn settings_mut(&mut self) -> &mut SceneSettings {
        &mut self.settings
    }

    fn max_sources(&self) -> u32 {
        max_sources(self.config.max_texture_size)
    }

    fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError> {
        for cull in &mut self.culls {
            cull.try_reserve(sources, 0, 0, 0)?;
        }
        Ok(())
    }

    fn cull(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        if input.structure_changed || !self.layout.built {
            self.rebuild_layout(input)?;
        }
        let parity = input.parity();
        self.uniform = self
            .settings
            .frame_uniform(input.scene, parity, input.canvas);
        self.culled = input.frame;
        let Some(uniform) = &self.uniform else {
            return Ok(());
        };
        let layout = &self.layout;
        self.runs.clear();
        // Slots past the highest one ever used hold no object.
        push_runs(
            &mut self.runs,
            0,
            input.scene.slots().high_water(),
            BY_ROW,
            0,
        );
        // Set 0 is the scene, sets 1 to n the batches' rows, and the next n the batches' clusters.
        let first_cluster_set = layout.batches.len() as u32 + 1;
        for (k, slot) in layout.batches.iter().enumerate() {
            if slot.bucket == NO_BUCKET {
                continue;
            }
            let batch = input
                .batches
                .get(slot.id)
                .expect("the layout names live batches");
            let active = batch.frame_active_count(parity);
            if slot.clustered() {
                let set = &mut self.cluster_sets[slot.id.slot() as usize];
                // At rest: nothing changed in this frame's update, which also copies the previous
                // frame's changes into this buffer, so both world buffers hold the same rows.
                let at_rest = batch.frame() == input.frame
                    && batch.changed_ranges().is_empty()
                    && batch.frame_active_count(parity ^ 1) == active;
                if !at_rest {
                    set.current = false;
                } else if !set.current {
                    let spheres = batch.world(parity).spheres();
                    set.clusters
                        .build(spheres, active, &mut self.cluster_scratch);
                    set.current = true;
                    set.uploaded = false;
                }
                if set.current {
                    let clusters = set.clusters.len();
                    let bucket = slot.bucket + 1;
                    let set = first_cluster_set + k as u32;
                    push_runs(&mut self.runs, set, clusters, bucket, slot.first_cluster);
                    continue;
                }
            }
            push_runs(&mut self.runs, k as u32 + 1, active, slot.bucket, slot.base);
        }
        let (scene, batches, cluster_sets) = (input.scene, input.batches, &self.cluster_sets);
        let slots = &layout.batches;
        let sets = |set: u32| -> SphereArrays<'_> {
            let set = set as usize;
            if set == 0 {
                return scene.world(parity).spheres();
            }
            if set <= slots.len() {
                return batches
                    .get(slots[set - 1].id)
                    .expect("the layout names live batches")
                    .world(parity)
                    .spheres();
            }
            let slot = &slots[set - 1 - slots.len()];
            cluster_sets[slot.id.slot() as usize].clusters.spheres()
        };
        null3d_core::culling::cull_into_buckets(
            input.jobs,
            &Frustum::from_view_projection(&uniform.view_proj),
            &sets,
            &self.runs,
            &layout.scene_buckets,
            layout.buckets.len() as u32,
            &mut self.culls[parity],
        );
        Ok(())
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame);
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena);
        result
    }

    fn reset_gpu(&mut self) {
        self.created = false;
        self.canvas = (0, 0);
        self.layout.built = false;
        self.pages.clear();
        self.texture_rows = [0; 4];
        self.uniform_slot.forget();
        self.streamed_slot.forget();
        self.listed_slot.forget();
        self.draws_bytes = 0;
        self.culled = 0;
        self.settings.materials_mut().mark_changed();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }
}

/// The end of the run of buckets that starts at `start`: the buckets that share its pipeline and
/// vertex page.
fn run_end(buckets: &[Bucket], start: usize) -> usize {
    let first = buckets[start];
    buckets[start..]
        .iter()
        .position(|b| b.shading != first.shading || b.page != first.page)
        .map_or(buckets.len(), |n| start + n)
}

/// One draw call of a frame: buckets `from..to` of the run that starts at bucket `run`, `drawn` of
/// them with visible instances.
#[derive(Clone, Copy, Debug)]
struct Call {
    run: usize,
    from: usize,
    to: usize,
    drawn: u32,
}

/// Calls `f` with each draw call of a frame and its number, in draw order: per run of buckets that
/// share a pipeline and a vertex page, one multi-draw call per block of drawn buckets, or one
/// draw per drawn bucket. Buckets with no visible instances draw nothing.
fn for_each_call(
    buckets: &[Bucket],
    visible: &dyn Fn(usize) -> u32,
    multi: bool,
    mut f: impl FnMut(u32, Call) -> Result<(), RecordError>,
) -> Result<(), RecordError> {
    let per_call = if multi { sizes::MULTI_DRAW_RECORDS } else { 1 };
    let mut index = 0;
    let mut start = 0;
    while start < buckets.len() {
        let end = run_end(buckets, start);
        let mut b = start;
        while b < end {
            if visible(b) == 0 {
                b += 1;
                continue;
            }
            let from = b;
            let mut drawn = 0;
            while b < end && drawn < per_call {
                drawn += u32::from(visible(b) > 0);
                b += 1;
            }
            f(
                index,
                Call {
                    run: start,
                    from,
                    to: b,
                    drawn,
                },
            )?;
            index += 1;
        }
        start = end;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bucket(shading: Shading, page: u32) -> Bucket {
        Bucket {
            shading,
            page,
            material: 1,
            group: RESIDENT,
            index_count: 36,
            first_index: 0,
            shift: 0,
        }
    }

    fn calls(
        buckets: &[Bucket],
        visible: &[u32],
        multi: bool,
    ) -> Vec<(u32, usize, usize, usize, u32)> {
        let mut out = Vec::new();
        for_each_call(buckets, &|b| visible[b], multi, |index, call| {
            out.push((index, call.run, call.from, call.to, call.drawn));
            Ok(())
        })
        .unwrap();
        out
    }

    #[test]
    fn calls_follow_runs_of_pipeline_and_page_and_skip_empty_buckets() {
        let buckets = [
            bucket(Shading::Lit, 0),
            bucket(Shading::Lit, 0),
            bucket(Shading::Lit, 1),
            bucket(Shading::Unlit, 1),
            bucket(Shading::Unlit, 1),
        ];
        let visible = [4, 0, 2, 0, 7];
        // One multi-draw call per run with drawn buckets; the empty run draws nothing.
        assert_eq!(
            calls(&buckets, &visible, true),
            vec![(0, 0, 0, 2, 1), (1, 2, 2, 3, 1), (2, 3, 4, 5, 1)]
        );
        // One draw per drawn bucket.
        assert_eq!(
            calls(&buckets, &visible, false),
            vec![(0, 0, 0, 1, 1), (1, 2, 2, 3, 1), (2, 3, 4, 5, 1)]
        );
        assert!(calls(&buckets, &[0; 5], true).is_empty());
    }

    #[test]
    fn a_run_longer_than_one_block_splits_into_calls() {
        let per_call = sizes::MULTI_DRAW_RECORDS as usize;
        let buckets = vec![bucket(Shading::Lit, 0); per_call + 3];
        let visible = vec![1; per_call + 3];
        let found = calls(&buckets, &visible, true);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], (0, 0, 0, per_call, per_call as u32));
        assert_eq!(found[1], (1, 0, per_call, per_call + 3, 3));
    }

    fn rectangles(first: u32, count: u32) -> Vec<Vec<u32>> {
        let mut list = DrawList::with_capacity(64);
        let rows = TextureRows {
            first,
            count,
            per_row: 512,
            texels: 3,
            bytes: 48,
        };
        write_rows(&mut list, 9, rows, 1000).unwrap();
        null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().operands.to_vec())
            .collect()
    }

    #[test]
    fn rows_go_out_in_at_most_three_rectangles() {
        // Inside one texture row.
        assert_eq!(rectangles(10, 5), vec![vec![9, 30, 0, 15, 1, 1000, 240]]);
        // Whole rows only.
        assert_eq!(
            rectangles(512, 1024),
            vec![vec![9, 0, 1, 1536, 2, 1000, 1024 * 48]]
        );
        // The end of a row, whole rows, then the start of a row.
        let parts = rectangles(500, 12 + 1024 + 7);
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], vec![9, 1500, 0, 36, 1, 1000, 12 * 48]);
        assert_eq!(parts[1], vec![9, 0, 1, 1536, 2, 1000 + 12 * 48, 1024 * 48]);
        assert_eq!(parts[2], vec![9, 0, 3, 21, 1, 1000 + 1036 * 48, 7 * 48]);
        assert!(rectangles(7, 0).is_empty());
    }
}

/// Splits rows `0..rows` of a set into culling runs of at most one chunk each.
fn push_runs(runs: &mut Vec<CullRun>, set: u32, rows: u32, bucket: u32, base: u32) {
    let mut start = 0;
    while start < rows {
        let end = (start + CULL_CHUNK).min(rows);
        runs.push(CullRun {
            set,
            start,
            end,
            bucket,
            base,
        });
        start = end;
    }
}

/// The floats of matrices `start..start + count`.
fn matrices_of(matrices: &[f32], start: u32, count: u32) -> &[f32] {
    &matrices[start as usize * MATRIX_FLOATS..(start + count) as usize * MATRIX_FLOATS]
}

/// Writes world matrices into a data texture, from matrix `first` of the texture on.
fn write_matrices(
    list: &mut DrawList,
    texture: u32,
    first: u32,
    matrices: &[f32],
) -> Result<(), RecordError> {
    write_rows(
        list,
        texture,
        TextureRows {
            first,
            count: (matrices.len() / MATRIX_FLOATS) as u32,
            per_row: sizes::MATRICES_PER_TEXTURE_ROW,
            texels: sizes::MATRIX_TEXELS,
            bytes: MATRIX_BYTES,
        },
        address(floats_as_bytes(matrices)),
    )
}

/// Items of a data texture: `count` items from item `first` on, `per_row` items to a texture row,
/// each `texels` texels and `bytes` bytes.
#[derive(Clone, Copy, Debug)]
struct TextureRows {
    first: u32,
    count: u32,
    per_row: u32,
    texels: u32,
    bytes: u32,
}

impl TextureRows {
    /// `count` 32-bit indices of the index list or cluster textures, from index `first` on.
    fn indices(first: u32, count: u32) -> Self {
        Self {
            first,
            count,
            per_row: sizes::INDICES_PER_TEXTURE_ROW,
            texels: 1,
            bytes: 4,
        }
    }
}

/// Writes tightly packed items from `source` into a data texture, as at most three rectangles:
/// the end of the first texture row, the whole rows after it, and the start of the last row.
fn write_rows(
    list: &mut DrawList,
    texture: u32,
    rows: TextureRows,
    source: u32,
) -> Result<(), RecordError> {
    let end = rows.first + rows.count;
    let (mut item, mut at) = (rows.first, source);
    while item < end {
        let column = item % rows.per_row;
        let (width, height) = if column == 0 && end - item >= rows.per_row {
            (rows.per_row, (end - item) / rows.per_row)
        } else {
            ((rows.per_row - column).min(end - item), 1)
        };
        let items = width * height;
        list.push(
            Op::WriteTexture,
            &[
                texture,
                column * rows.texels,
                item / rows.per_row,
                width * rows.texels,
                height,
                at,
                items * rows.bytes,
            ],
        )?;
        item += items;
        at += items * rows.bytes;
    }
    Ok(())
}

/// The rows to create a data texture with when it must hold `needed`: room to grow, so a slowly
/// growing scene rarely recreates it, but never past `limit`.
fn grown_rows(needed: u32, limit: u32) -> u32 {
    needed.saturating_add(needed / 2).min(limit).max(needed)
}
