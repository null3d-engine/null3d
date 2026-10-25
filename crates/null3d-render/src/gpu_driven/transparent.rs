//! The transparent passes: one per view, which draws the view's blended rows back to front. The
//! job workers cull and sort the rows (see [`crate::sorted`]), and each frame writes one compacted
//! instance per visible row, in sorted order, into the view's sorted instance buffer: the three
//! rows of its world matrix moved by its cell's offset from the camera, then its ids, as the
//! culling shader writes the opaque ones: its material, the first joint of its skin, and its source,
//! where the vertex shaders of rows with row values find them. Instance data reaches vertex shaders only through
//! vertex buffers, so each draw binds its slice of that buffer at vertex slot 1, and its first
//! instance stays 0.
//!
//! The decal pass draws the camera view's decals the same way, from a layout and an instance
//! buffer of its own, with the group of the scene's depth after each bucket's maps.

use std::collections::TryReserveError;

use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::SceneStorage;
use null3d_core::shared::SharedMut;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, index_format, sizes};

use super::ids;
use super::skin::{DrawGroups, SkinnedPart, Skinning};
use crate::frame::{MeshBuffers, RecordError, SceneSettings, UploadArena, grown_size_any, put_u32};
use crate::particles::ParticlePass;
use crate::sorted::{SortedLayout, SortedRows, SortedSource, SortedView};
use crate::view::{ViewFrame, ViewId};

/// Rows from which the job workers write the instances too.
const PARALLEL_ROWS: usize = 8192;
/// Rows per chunk of that write.
const ROWS_PER_CHUNK: u32 = 2048;
/// Each view's sorted rows and instance buffer.
#[derive(Debug)]
pub(super) struct Transparent {
    views: Vec<SortedView>,
    /// Bytes of each view's instance buffer, 0 before it exists.
    buffers: Vec<u32>,
    /// The id of the first view's instance buffer. The other views' follow it.
    first_buffer: u32,
}

impl Default for Transparent {
    fn default() -> Self {
        Self::with_buffers(ids::sorted(ViewId::CAMERA))
    }
}

impl Transparent {
    /// The passes of views whose instance buffers take ids from `first_buffer` on.
    pub(super) fn with_buffers(first_buffer: u32) -> Self {
        Self {
            views: Vec::new(),
            buffers: Vec::new(),
            first_buffer,
        }
    }

    /// The id of a view's instance buffer.
    fn buffer(&self, view: ViewId) -> u32 {
        self.first_buffer + view.index() as u32
    }

    /// The most bytes that one frame's instances take in its arena.
    pub(super) fn upload_bound(layout: &SortedLayout, views: usize) -> usize {
        views * layout.rows() as usize * sizes::INSTANCE_STRIDE as usize
    }

    /// Gives each of `views` views its output, with room for the layout's rows and draws.
    pub(super) fn reserve(
        &mut self,
        layout: &SortedLayout,
        views: usize,
    ) -> Result<(), TryReserveError> {
        if self.views.len() < views {
            self.views.try_reserve(views - self.views.len())?;
            self.views.resize_with(views, SortedView::default);
            self.buffers.resize(views, 0);
        }
        for view in &mut self.views {
            layout.reserve_view(view)?;
        }
        Ok(())
    }

    /// Makes each view's instance buffer big enough for the layout's rows, with room to grow. A
    /// scene with no blended rows needs none.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        layout: &SortedLayout,
        views: usize,
    ) -> Result<(), RecordError> {
        if layout.rows() == 0 {
            return Ok(());
        }
        let needed = layout.rows() * sizes::INSTANCE_STRIDE;
        for (index, made) in self.buffers.iter_mut().enumerate().take(views) {
            if *made < needed {
                *made = grown_size_any(needed);
                list.push(
                    Op::CreateBuffer,
                    &[
                        self.first_buffer + index as u32,
                        *made,
                        usage::VERTEX | usage::COPY_DST,
                    ],
                )?;
            }
        }
        Ok(())
    }

    /// Culls and sorts each view's rows for the frame, on the calling thread and the job workers.
    /// `frames` holds each view's values, or `None` for a view with no camera.
    pub(super) fn sort(
        &mut self,
        jobs: &JobSystem,
        layout: &SortedLayout,
        frames: &[Option<ViewFrame>],
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
    ) {
        for (view, frame) in self.views.iter_mut().zip(frames) {
            layout.sort(jobs, frame.as_ref(), None, scene, batches, parity, view);
        }
    }

    /// Writes a view's sorted instances into its buffer, from a copy in the frame's arena. A
    /// skinned object's instance names the first joint of its skin beside its material, for the
    /// vertex shaders that skin.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        layout: &SortedLayout,
        skinning: &Skinning,
        jobs: &JobSystem,
        scene: &SceneStorage,
        batches: &BatchTable,
        parity: usize,
    ) -> Result<(), RecordError> {
        let sorted = &self.views[view.index()];
        let items = sorted.items();
        if items.is_empty() {
            return Ok(());
        }
        let stride = sizes::INSTANCE_STRIDE as usize;
        let (at, bytes) = arena.push_zeroed(items.len() * stride)?;
        let offsets = sorted.offsets().as_slice();
        let scene_matrices = scene.world(parity).matrices();
        let rows = SharedMut::new(bytes);
        let write = |range: std::ops::Range<u32>| {
            for k in range {
                let row = layout.row(items[k as usize], batches);
                let matrix = match row.source {
                    SortedSource::Scene(slot) => {
                        &scene_matrices[slot as usize * MATRIX_FLOATS..][..MATRIX_FLOATS]
                    }
                    SortedSource::Batch(id, r) => {
                        let batch = batches.get(id).expect("the layout names live batches");
                        &batch.world(parity).matrices()[r as usize * MATRIX_FLOATS..]
                            [..MATRIX_FLOATS]
                    }
                };
                let offset = offsets[row.cell as usize];
                let bucket = layout.buckets[row.bucket as usize];
                let material = bucket.material - 1;
                let first_joint = bucket
                    .skinned_slot()
                    .and_then(|slot| skinning.object(slot))
                    .map_or(0, |object| object.joint_base);
                // SAFETY: each row writes only its own 64 bytes.
                let out = unsafe { rows.slice(k as usize * stride, stride) };
                for (r, values) in matrix.as_chunks::<4>().0.iter().enumerate() {
                    for (c, &value) in values.iter().enumerate() {
                        let value = if c == 3 { value + offset[r] } else { value };
                        put_u32(out, r * 4 + c, value.to_bits());
                    }
                }
                put_u32(out, 12, material);
                put_u32(out, 13, first_joint);
                put_u32(out, 14, row.place);
            }
        };
        let count = items.len() as u32;
        if items.len() >= PARALLEL_ROWS {
            jobs.parallel_for(count, ROWS_PER_CHUNK, &|range, _| write(range));
        } else {
            write(0..count);
        }
        list.push(
            Op::WriteBuffer,
            &[self.buffer(view), 0, at, (items.len() * stride) as u32],
        )?;
        Ok(())
    }

    /// Records a view's transparent pass inside the render pass that the render graph began: each
    /// run of sorted rows that share a bucket, with one instanced draw per part of the bucket's
    /// mesh for each of the bucket's passes, from its slice of the view's sorted instances. A skinned object's bucket draws its
    /// regions of skinned vertices, or with the vertex shaders that skin, binds the joint texture.
    /// It leaves out the objects whose maps show a target that the view does not read. `rows`
    /// picks the buckets that draw, and their pipelines: those of the transparent pass, or of the
    /// camera's weighted layer. The draws bind group `frame` at 0, the view's frame group, or the
    /// decal pass's own. Each draw binds group `scene` for a bucket whose material reads the
    /// scene's depth, and group `last` where it is not 0, after its bucket's groups, as decals bind
    /// the scene's depth.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        rows: SortedRows,
        layout: &SortedLayout,
        skinning: &Skinning,
        settings: &SceneSettings,
        meshes: &MeshBuffers,
        frame: u32,
        last: u32,
        scene: u32,
        particles: &ParticlePass,
    ) -> Result<(), RecordError> {
        let draws = self.views[view.index()].draws();
        if draws.is_empty() {
            return Ok(());
        }
        let stride = sizes::INSTANCE_STRIDE;
        list.push(Op::SetBindGroup, &[0, frame, 0])?;
        let mut pipeline = None;
        let (mut vertices, mut indices) = (None, None);
        let mut groups = DrawGroups::default();
        let storage = settings.meshes();
        // A view leaves out the objects whose maps show a target that it does not read.
        let hidden_targets = settings.hidden_targets(view);
        let textures = settings.textures();
        for draw in draws {
            let bucket = layout.buckets[draw.bucket as usize];
            if rows.passes(&bucket).next().is_none() {
                continue;
            }
            if hidden_targets != 0
                && bucket.textures != 0
                && textures.group_pass_views(bucket.textures) & hidden_targets != 0
            {
                continue;
            }
            // A particle system draws its records with its own groups, which every later draw
            // sets again.
            if let Some(system) = bucket.particle_system() {
                if particles.record(list, view, system, bucket.pipeline, bucket.textures)? {
                    pipeline = None;
                    vertices = None;
                    groups = DrawGroups::default();
                }
                continue;
            }
            // A vertex draw makes its vertices and its copies from its two counts, so it sets no
            // vertex buffer and no index buffer. The next mesh draw binds its own.
            if let Some(id) = bucket.vertex_draw() {
                let (count, instances) = settings.vertex_draws().counts(id);
                if count > 0 && instances > 0 {
                    if pipeline != Some(bucket.pipeline) {
                        list.push(Op::SetPipeline, &[bucket.pipeline])?;
                        pipeline = Some(bucket.pipeline);
                    }
                    list.push(Op::Draw, &[count, instances, 0, 0])?;
                    vertices = None;
                    indices = None;
                }
                continue;
            }
            let skinned = bucket.skinned_slot();
            let skins = skinned.is_some_and(|slot| skinning.skins_in_vertex_shader(slot));
            // A bucket whose material reads the scene's depth binds the group that its pass chose:
            // the copy of the camera's opaque depth in the camera's transparent pass, or the blank
            // texel anywhere the copy does not exist yet.
            let scene = if bucket.scene_depth { scene } else { 0 };
            groups.set(list, bucket.textures, scene, skins, last)?;
            let regions = skinned.and_then(|slot| skinning.parts_of(slot));
            list.push(
                Op::SetVertexBuffer,
                &[
                    1,
                    self.buffer(view),
                    draw.first * stride,
                    draw.count * stride,
                ],
            )?;
            let mesh = storage
                .mesh(bucket.mesh - 1)
                .expect("buckets name known meshes");
            for pass in rows.passes(&bucket) {
                if pipeline != Some(pass) {
                    list.push(Op::SetPipeline, &[pass])?;
                    pipeline = Some(pass);
                }
                for (k, part) in storage.parts(mesh, bucket.lines).iter().enumerate() {
                    let (page_vertices, page_indices) = meshes.ids(part.page);
                    // A skinned part draws its region of skinned vertices with its page's indices.
                    let region = regions.and_then(|regions| regions.get(k));
                    let source = region.map_or((page_vertices, 0), SkinnedPart::vertices);
                    if vertices != Some(source) {
                        list.push(Op::SetVertexBuffer, &[0, source.0, source.1, 0])?;
                        vertices = Some(source);
                    }
                    if indices != Some(page_indices) {
                        list.push(
                            Op::SetIndexBuffer,
                            &[page_indices, index_format::UINT16, 0, 0],
                        )?;
                        indices = Some(page_indices);
                    }
                    let base_vertex = if region.is_some() {
                        0
                    } else {
                        part.base_vertex
                    };
                    list.push(
                        Op::DrawIndexed,
                        &[
                            part.index_count,
                            draw.count,
                            part.first_index,
                            base_vertex,
                            0,
                        ],
                    )?;
                }
            }
        }
        Ok(())
    }

    /// Forgets the instance buffers, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.buffers.fill(0);
    }
}
