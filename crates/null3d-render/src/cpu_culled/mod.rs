//! The WebGL2 frame builder. WebGL2 has no compute shaders, so the job workers cull every object
//! and instance on the CPU, view by view. Each view's frame lists its visible objects, bucket by
//! bucket, in an index list, and the view's opaque pass draws each bucket's slice of the list with
//! instanced draws: many draws in one call where the device has `WEBGL_multi_draw`, one call per
//! draw elsewhere.
//!
//! # Sources and data textures
//!
//! Every scene slot and every row of every instance batch is a source, and each source's world
//! matrix is three texels of a float data texture. The resident texture holds the scene's slots
//! and the rows of static batches, and each frame writes only the rows that changed. The streamed
//! texture holds the rows of dynamic batches, which change every frame, so each frame writes them
//! whole into the next of three textures, never into one the GPU may still read for an earlier
//! frame. Every view reads these textures, and has its own ring of three index list textures.
//!
//! # Buckets and passes
//!
//! A bucket is one pipeline, mesh, material and data texture, and culling lists its visible
//! sources in its slice of the index list. A pipeline is one shading and one vertex format. A
//! bucket has one draw per part of its mesh, and every draw of a bucket draws the bucket's slice.
//! Buckets change only with the scene's structure, as on WebGPU. Showing or hiding an object, or
//! changing a batch's active count, needs no rebuild: culling skips hidden objects and stops at
//! each batch's active count.
//!
//! Each part has a module: `layout` keeps the sources, buckets and clusters, `data` the data
//! textures and their rings, `cull` culls each view on the job workers, and `opaque` records the
//! opaque passes. The debug lines pass, which both builders share, is [`crate::debug_lines`]. The
//! render graph ([`crate::frame_graph`]) orders the passes and begins their render passes.
//!
//! # Cells
//!
//! World matrices are relative to their grid cells' centers (see [`null3d_core::cells`]). Each
//! index list entry holds its row, or its cluster, with the row's cell index above it. Each frame
//! uploads, for each view, the offset from the view's camera to each cell in use beside the view's
//! frame constants, and the vertex shader adds an instance's offset to its matrix, so it draws
//! positions relative to the camera. When only the cameras move, static matrices stay in the
//! resident texture, and each view uploads its constants, its offsets and, when it changed, its
//! index list.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. Each frame parity keeps its own culling
//! output, because the render worker replays a frame's list while the next frame culls, and the
//! list uploads the index list straight from that output. Only the first frames after the scene
//! grows, or gains a view, allocate.

mod cull;
mod data;
mod layout;
mod opaque;

use std::collections::TryReserveError;

use null3d_core::cells::CELL_SHIFT;
use null3d_core::culling::BucketedCull;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{DrawList, Op, format, permutation, sizes, texture_usage, view};

use crate::debug_lines::LinesPass;
use crate::dfg;
use crate::frame::{
    FrameBuilder, FrameInput, MaterialStorage, MeshBuffers, ParityLists, RecordError,
    SceneSettings, UploadArena, drawn_rows,
};
use crate::frame_graph::{FrameGraph, Role};
use crate::graph::RenderGraph;
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MeshStorage, Packing};
use crate::pipelines::{PassTargets, PipelineCache};
use crate::textures::{TextureIds, TextureStore};
use crate::view::{ViewFrame, ViewId};
use cull::Culling;
use data::{RingSlot, SharedTextures, matrices_of, write_matrices};
use layout::{Clusters, Layout};
use opaque::{OFFSETS_BYTES, Opaque, ViewUpload};

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own.
mod ids {
    use super::data::RING;
    use crate::view::{MAX_VIEWS, ViewId};

    /// Each view's buffers: its ring of frame uniforms, then its draw records, from
    /// `VIEW_BUFFERS + 2 * view`.
    const VIEW_BUFFERS: u32 = 1;

    pub const fn frame(view: ViewId) -> u32 {
        VIEW_BUFFERS + 2 * view.index() as u32
    }
    pub const fn draws(view: ViewId) -> u32 {
        frame(view) + 1
    }

    /// The vertices of the debug lines.
    pub const LINES: u32 = VIEW_BUFFERS + 2 * MAX_VIEWS as u32;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = LINES + 1;

    pub const RESIDENT: u32 = 1;
    /// The ring of streamed textures, one per ring slot.
    pub const STREAMED: u32 = 2;
    /// The rows of static batches in cluster order.
    pub const CLUSTERS: u32 = STREAMED + RING;
    /// Each view's ring of index list textures, one per ring slot, from
    /// `VIEW_TEXTURES + RING * view`.
    const VIEW_TEXTURES: u32 = CLUSTERS + 1;

    pub const fn visible(view: ViewId) -> u32 {
        VIEW_TEXTURES + RING * view.index() as u32
    }

    /// The material table: one row of texels per material.
    pub const MATERIALS: u32 = VIEW_TEXTURES + RING * MAX_VIEWS as u32;
    /// three.js's table of the split-sum terms of specular light.
    pub const DFG: u32 = MATERIALS + 1;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = DFG + 1;
    /// The texture arrays of materials' maps, after every id the render graph can take.
    pub const TEXTURE_ARRAYS: u32 = TARGETS + 256;
    /// The samplers of materials' maps, the only samplers the builder makes.
    pub const SAMPLERS: u32 = 1;

    /// Each view's bind groups: the frame group, the draw record group, then the groups of its
    /// instance textures, one per pair of ring slots.
    const GROUPS_PER_VIEW: u32 = 2 + RING * RING;

    pub const fn frame_group(view: ViewId) -> u32 {
        1 + GROUPS_PER_VIEW * view.index() as u32
    }
    pub const fn draws_group(view: ViewId) -> u32 {
        frame_group(view) + 1
    }
    /// The textures of each pair of ring slots: the streamed texture's and the view's index
    /// list's, at `instances_group(view) + streamed * RING + listed`.
    pub const fn instances_group(view: ViewId) -> u32 {
        frame_group(view) + 2
    }
    /// The bind groups of materials' maps, after every view's groups.
    pub const TEXTURE_GROUPS: u32 = 1 + GROUPS_PER_VIEW * MAX_VIEWS as u32;
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
/// each texture group, and the index list, must fit one texture, and an index list entry holds a
/// source below its cell index, in [`MAX_SOURCE_BITS`] bits.
pub const fn max_sources(max_texture_size: u32) -> u32 {
    let by_texture = sizes::MATRICES_PER_TEXTURE_ROW.saturating_mul(max_texture_size);
    if by_texture < 1 << MAX_SOURCE_BITS {
        by_texture
    } else {
        1 << MAX_SOURCE_BITS
    }
}

/// Bits of a source in an index list entry: those below the cell index.
pub const MAX_SOURCE_BITS: u32 = CELL_SHIFT;

/// Records one draw list per frame for the WebGL2 path.
pub struct CpuCulledRenderer {
    config: CpuCulledConfig,
    settings: SceneSettings,
    lists: ParityLists,
    graph: FrameGraph,
    layout: Layout,
    clusters: Clusters,
    culling: Culling,
    opaque: Opaque,
    lines: LinesPass,
    /// The vertex pages' vertex and index buffers.
    meshes: MeshBuffers,
    pipelines: PipelineCache,
    textures: SharedTextures,
    /// The slot of the streamed textures, which every view reads.
    streamed_slot: RingSlot,
    created: bool,
    /// True from the creation of three.js's table of specular terms until a frame uploads it.
    dfg_pending: bool,
}

impl CpuCulledRenderer {
    pub fn new(config: CpuCulledConfig) -> Self {
        assert!(
            config.max_materials <= sizes::MAX_MATERIALS,
            "the material texture holds {} materials",
            sizes::MAX_MATERIALS
        );
        let textures = TextureStore::new(
            TextureIds {
                first_texture: ids::TEXTURE_ARRAYS,
                first_sampler: ids::SAMPLERS,
                first_group: ids::TEXTURE_GROUPS,
            },
            config
                .max_texture_size
                .min(BUDGET[Limit::TextureDimension2D as usize]),
        );
        Self {
            config,
            settings: SceneSettings::new(
                MeshStorage::new(Packing::Pages),
                config.max_materials,
                textures,
            ),
            lists: ParityLists::new(config.draw_list_words),
            graph: FrameGraph::new(config.samples, false, ids::TARGETS),
            layout: Layout::default(),
            clusters: Clusters::default(),
            culling: Culling::default(),
            opaque: Opaque::new(config.multi_draw),
            lines: LinesPass::new(ids::LINES),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            textures: SharedTextures::default(),
            streamed_slot: RingSlot::default(),
            created: false,
            dfg_pending: false,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// The culling output of a frame's parity for a view: its visible sources, bucket by bucket.
    pub fn culled(&self, frame: u32, view: ViewId) -> &BucketedCull {
        self.culling.culled(frame, view)
    }

    /// A view's values in the frame that culled last, or `None` when the view had no camera.
    pub fn view_frame(&self, view: ViewId) -> Option<&ViewFrame> {
        self.culling.frame(view)
    }

    /// What the scene's render pipelines draw into, in the shader variant that reads the draw's
    /// index where the device has multi-draw.
    fn scene_targets(&self) -> PassTargets {
        let targets = self.graph.scene_targets();
        let draw_index = if self.config.multi_draw {
            permutation::DRAW_INDEX
        } else {
            0
        };
        PassTargets {
            permutation: targets.permutation | draw_index,
            ..targets
        }
    }

    /// Assigns every source to a data texture and a bucket, then makes room for the new layout:
    /// the clusters, the culling runs and every view's output, and the upload arenas.
    fn rebuild_layout(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        let limit = FrameBuilder::max_sources(self);
        let targets = self.scene_targets();
        self.layout.rebuild(
            &self.settings,
            &mut self.pipelines,
            targets,
            input,
            limit,
            self.config.multi_draw,
        )?;
        let room = self.layout.room;
        let out_of_memory = |_: TryReserveError| RecordError::OutOfMemory {
            bytes: room.rows.saturating_mul(8),
        };
        self.clusters
            .prepare(input.batches, &self.layout)
            .map_err(out_of_memory)?;
        let views = self.settings.views().len();
        self.culling.reserve(room, views).map_err(out_of_memory)?;
        // Room for every static batch's cluster order, so a batch coming to rest later uploads
        // its clusters without growing the arena.
        let bound = self.upload_bound_without_clusters() + self.layout.cluster_rows as usize * 4;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound).map_err(out_of_memory)?;
        }
        self.layout.built = true;
        self.layout.built_in = input.frame;
        Ok(())
    }

    /// Gives each view that has none yet its culling output, with room for the layout. A view
    /// added after the frame culled draws nothing until the next frame culls it.
    fn add_culled_views(&mut self) -> Result<(), RecordError> {
        let views = self.settings.views().len();
        if self.culling.views() < views {
            let room = self.layout.room;
            self.culling
                .add_views(room, views)
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: room.rows.saturating_mul(8),
                })?;
        }
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the material table, three.js's table of specular terms, each view's frame
    /// uniform, draw records and
    /// multi-draw arrays, and the cluster orders not uploaded yet.
    fn upload_bound(&self) -> usize {
        self.upload_bound_without_clusters() + self.clusters.pending_bytes(&self.layout)
    }

    /// [`Self::upload_bound`] without the cluster orders.
    fn upload_bound_without_clusters(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials =
            self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 + dfg::BYTES;
        let per_view = (sizes::FRAME_UNIFORM_BYTES + OFFSETS_BYTES) as usize
            + self.layout.draws_slot_bytes as usize
            + self.layout.draws.len() * 12;
        meshes + materials + self.settings.views().len() * per_view
    }

    /// Records the creation of the material table, a data texture with one row of texels for each
    /// material it holds, and of three.js's table of specular terms.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        list.push(
            Op::CreateTexture,
            &[
                ids::MATERIALS,
                MATERIAL_TEXELS,
                self.config.max_materials.max(1),
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        dfg::create(list, ids::DFG)?;
        self.dfg_pending = true;
        self.created = true;
        Ok(())
    }

    /// Makes the data textures and each view's index list textures and draw records big enough
    /// for the layout, with room to grow, and binds each view's textures again when one is new:
    /// every view after a new layout, else only the views from `first_new` on. Returns true when
    /// the resident texture is new, so it needs every row again.
    fn size_resources(
        &mut self,
        list: &mut DrawList,
        first_new: usize,
        rebuilt: bool,
    ) -> Result<bool, RecordError> {
        let limit = self.config.max_texture_size;
        let remade = if rebuilt {
            self.textures.size(list, &self.layout, limit)?
        } else {
            Default::default()
        };
        let first = if rebuilt { 0 } else { first_new };
        for index in first..self.settings.views().len() {
            let view = ViewId::from_index(index);
            let listed = self.culling.size(list, view, &self.layout, limit)?;
            let new_view = index >= first_new;
            self.opaque
                .size(list, view, &self.layout, remade.any || listed || new_view)?;
        }
        Ok(remade.resident)
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

    /// Writes the active rows of every dynamic batch into the streamed texture of slot `streamed`.
    fn upload_streamed(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        streamed: u32,
    ) -> Result<(), RecordError> {
        let parity = input.parity();
        for slot in self.layout.batches.iter().filter(|slot| slot.dynamic) {
            let Ok(batch) = input.batches.get(slot.id) else {
                continue;
            };
            let active = batch.frame_active_count(parity);
            let matrices = matrices_of(batch.world(parity).matrices(), 0, active);
            write_matrices(list, ids::STREAMED + streamed, slot.base, matrices)?;
        }
        Ok(())
    }

    /// Records a frame into its parity's list and arena: the objects the GPU lacks, the uploads,
    /// then the passes of the render graph. Returns true when the frame rebuilt the draw tables.
    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        if self.culling.culled_frame() != input.frame {
            self.cull(input)?;
        }
        self.add_culled_views()?;
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph.sync_views(self.settings.views());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.prepare(list, input.canvas)?;
        let views = self.settings.views().len();
        let first_new = self.opaque.views();
        self.opaque.add_views(list, views)?;
        let rebuilt = self.layout.built_in == input.frame;
        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::DFG)?;
        }
        self.meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        self.pipelines.create_new(list)?;
        // Draws bind the maps' groups by id as they run, so a group made again needs nothing more.
        let table = MaterialStorage::Texture(ids::MATERIALS);
        self.settings
            .record_materials(list, arena, table, input.frame)?;
        let new_texture = if rebuilt || first_new < views {
            self.size_resources(list, first_new, rebuilt)?
        } else {
            false
        };
        self.upload_resident(list, input, rebuilt || new_texture)?;
        self.clusters.upload(list, arena, &self.layout)?;

        // The streamed ring moves to a new slot only for moving rows, and each view's rings only
        // for new data: a changed frame uniform, or an index list that differs from the previous
        // frame's.
        let frame = input.frame;
        let drawn = (0..views).any(|v| self.culling.frame(ViewId::from_index(v)).is_some());
        if drawn {
            let moving = self.has_moving_rows(input);
            let streamed = self.streamed_slot.take(frame, moving);
            if moving {
                self.upload_streamed(list, input, streamed)?;
            }
            for index in 0..views {
                let view = ViewId::from_index(index);
                let Some(values) = self.culling.frame(view).copied() else {
                    continue;
                };
                let (listed, new_list) = self.culling.upload(list, view, frame)?;
                let upload = ViewUpload {
                    frame,
                    values: &values,
                    offsets: self.culling.offsets(view),
                    streamed,
                    listed,
                    new_list,
                    starts: self.culling.culled(frame, view).bucket_starts(),
                };
                self.opaque
                    .upload(list, arena, view, upload, &self.layout)?;
            }
        }
        let camera = self.culling.frame(ViewId::CAMERA);
        self.lines.upload(
            list,
            arena,
            &input.lines,
            camera.map(|values| &values.camera),
            &mut self.pipelines,
            self.graph.scene_targets(),
        )?;

        let (culling, opaque, lines) = (&self.culling, &self.opaque, &self.lines);
        let (layout, meshes) = (&self.layout, &self.meshes);
        self.graph
            .record(list, self.settings.clear_color(), |list, role| match role {
                Role::Opaque(view) if culling.frame(view).is_some() => {
                    let starts = culling.culled(frame, view).bucket_starts();
                    opaque.record(list, arena, view, starts, layout, meshes)
                }
                Role::DebugLines => {
                    let slot = opaque.frame_slot(ViewId::CAMERA);
                    lines.record(list, ids::frame_group(ViewId::CAMERA), &[slot, slot])
                }
                _ => Ok(()),
            })?;
        Ok(rebuilt)
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
        self.culling.reserve_sources(sources)
    }

    fn cull(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        if input.structure_changed || !self.layout.built {
            self.rebuild_layout(input)?;
        }
        self.add_culled_views()?;
        self.culling
            .cull(input, &self.settings, &self.layout, &mut self.clusters);
        Ok(())
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame);
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena);
        result
    }

    fn visible_entries(&self, frame: u32) -> Option<u32> {
        Some(self.culling.visible_entries(frame))
    }

    fn reset_gpu(&mut self) {
        self.created = false;
        self.graph.reset_gpu();
        self.layout.built = false;
        self.meshes.forget();
        self.pipelines.forget();
        self.textures.forget_gpu();
        self.culling.forget_gpu();
        self.opaque.forget_gpu();
        self.lines.forget_gpu();
        self.streamed_slot.forget();
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }
}
