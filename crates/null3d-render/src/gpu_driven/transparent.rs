//! The transparent passes: one per view, which draws the view's blended rows back to front. The
//! job workers cull and sort the rows (see [`crate::sorted`]), and each frame writes one compacted
//! instance per visible row, in sorted order, into the view's sorted instance buffer: the three
//! rows of its world matrix moved by its cell's offset from the camera, then its ids, as the
//! culling shader writes the opaque ones. Instance data reaches vertex shaders only through
//! vertex buffers, so each draw binds its slice of that buffer at vertex slot 1, and its first
//! instance stays 0.

use std::collections::TryReserveError;

use null3d_core::instances::BatchTable;
use null3d_core::jobs::JobSystem;
use null3d_core::scene::SceneStorage;
use null3d_core::shared::SharedMut;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, index_format, sizes};

use super::ids;
use crate::frame::{MeshBuffers, RecordError, SceneSettings, UploadArena, grown_size, put_u32};
use crate::sorted::{SortedLayout, SortedSource, SortedView};
use crate::view::{ViewFrame, ViewId};

/// The group index of the maps' bind group in the mesh pipelines that sample a map.
const TEXTURES_GROUP: u32 = 1;
/// Rows from which the job workers write the instances too.
const PARALLEL_ROWS: usize = 8192;
/// Rows per chunk of that write.
const ROWS_PER_CHUNK: u32 = 2048;
/// Words that one draw of a sorted run records at most, beside those of its mesh's parts: its
/// pipeline, its maps' bind group and its slice of the instances.
const RUN_WORDS: usize = 2 + 4 + 5;
/// Words that each part of a run's mesh records at most: its page's buffers and its draw.
const PART_WORDS: usize = 5 + 5 + 6;
/// Words that each view's pass records besides its draws: its frame group.
const PASS_WORDS: usize = 4;

/// Each view's sorted rows and instance buffer.
#[derive(Debug, Default)]
pub(super) struct Transparent {
    views: Vec<SortedView>,
    /// Bytes of each view's instance buffer, 0 before it exists.
    buffers: Vec<u32>,
}

impl Transparent {
    /// The most words that the transparent passes of `views` views can record.
    pub(super) fn words_bound(layout: &SortedLayout, views: usize) -> usize {
        let per_draw = RUN_WORDS + PART_WORDS * layout.most_parts() as usize;
        views * (PASS_WORDS + layout.draws_room() as usize * per_draw)
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
                *made = grown_size(needed, u32::MAX);
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids::sorted(ViewId::from_index(index)),
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
            layout.sort(jobs, frame.as_ref(), scene, batches, parity, view);
        }
    }

    /// Writes a view's sorted instances into its buffer, from a copy in the frame's arena.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        layout: &SortedLayout,
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
                let material = layout.buckets[row.bucket as usize].material - 1;
                // SAFETY: each row writes only its own 64 bytes.
                let out = unsafe { rows.slice(k as usize * stride, stride) };
                for (r, values) in matrix.as_chunks::<4>().0.iter().enumerate() {
                    for (c, &value) in values.iter().enumerate() {
                        let value = if c == 3 { value + offset[r] } else { value };
                        put_u32(out, r * 4 + c, value.to_bits());
                    }
                }
                put_u32(out, 12, material);
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
            &[ids::sorted(view), 0, at, (items.len() * stride) as u32],
        )?;
        Ok(())
    }

    /// Records a view's transparent pass inside the render pass that the render graph began: each
    /// run of sorted rows that share a bucket, with one instanced draw per part of the bucket's
    /// mesh, from its slice of the view's sorted instances.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &SortedLayout,
        settings: &SceneSettings,
        meshes: &MeshBuffers,
    ) -> Result<(), RecordError> {
        let draws = self.views[view.index()].draws();
        if draws.is_empty() {
            return Ok(());
        }
        let stride = sizes::INSTANCE_STRIDE;
        list.push(Op::SetBindGroup, &[0, ids::frame_group(view), 0])?;
        let (mut pipeline, mut textures, mut page) = (None, 0, None);
        let storage = settings.meshes();
        for draw in draws {
            let bucket = layout.buckets[draw.bucket as usize];
            if pipeline != Some(bucket.pipeline) {
                list.push(Op::SetPipeline, &[bucket.pipeline])?;
                pipeline = Some(bucket.pipeline);
            }
            if bucket.textures != 0 && bucket.textures != textures {
                list.push(Op::SetBindGroup, &[TEXTURES_GROUP, bucket.textures, 0])?;
                textures = bucket.textures;
            }
            list.push(
                Op::SetVertexBuffer,
                &[
                    1,
                    ids::sorted(view),
                    draw.first * stride,
                    draw.count * stride,
                ],
            )?;
            let mesh = storage
                .mesh(bucket.mesh - 1)
                .expect("buckets name known meshes");
            for part in storage.parts(mesh) {
                if page != Some(part.page) {
                    let (vertices, indices) = meshes.ids(part.page);
                    list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                    list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
                    page = Some(part.page);
                }
                list.push(
                    Op::DrawIndexed,
                    &[
                        part.index_count,
                        draw.count,
                        part.first_index,
                        part.base_vertex,
                        0,
                    ],
                )?;
            }
        }
        Ok(())
    }

    /// Forgets the instance buffers, after the thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.buffers.fill(0);
    }
}
