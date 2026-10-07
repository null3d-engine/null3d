//! The transparent passes: one per view, which draws the view's blended rows back to front. The
//! job workers cull and sort the rows while they cull the view (see [`super::cull`]), and the
//! sorted rows' entries follow the opaque entries in the view's index list. Each run of sorted
//! rows that share a bucket draws with one instanced draw per part of its bucket's mesh, for each
//! of the bucket's passes, whose draw record names the run's slice of the index list. A run's
//! back faces and front faces draw from the same records.
//!
//! Neighboring draws that share a pipeline, a map group and a vertex page go out in one call:
//! one multi-draw call of up to a block of records where the device has `WEBGL_multi_draw`, or one
//! call per draw elsewhere. A call's records start at an aligned place after the opaque records in
//! the view's ring slot of draw records.

use std::collections::TryReserveError;

use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{DrawList, Op, index_format, sizes};

use super::layout::{MULTI_DRAW_BLOCK_BYTES, RESIDENT};
use crate::frame::{MeshBuffers, RecordError, SceneSettings, UploadArena, put_u32};
use crate::sorted::{SortedLayout, SortedView};

/// The group index of the maps' bind group in the mesh pipelines that sample a map.
const TEXTURES_GROUP: u32 = 3;
/// One draw of a part of a sorted run's mesh.
#[derive(Clone, Copy, Debug, Default)]
struct PartDraw {
    /// The start of its run's slice of the index list.
    start: u32,
    instances: u32,
    index_count: u32,
    first_index: u32,
    material: u32,
    /// The data texture its instances come from.
    group: u32,
}

/// One call: `count` part draws from `first` on, which share a pipeline, a maps group and a
/// vertex page, with their records at `records` in the ring slot's transparent part.
#[derive(Clone, Copy, Debug, Default)]
struct Call {
    pipeline: u32,
    textures: u32,
    page: u32,
    first: u32,
    count: u32,
    records: u32,
    /// The call draws the same parts with the same records as a call before it, with another
    /// pipeline: a run's front faces after its back faces. It writes no records of its own, and no
    /// later draw joins it.
    repeat: bool,
}

/// A view's draws of the frame.
#[derive(Debug, Default)]
struct ViewDraws {
    parts: Vec<PartDraw>,
    calls: Vec<Call>,
}

/// Each view's draws of the transparent pass, and how the device draws many at once.
#[derive(Debug)]
pub(super) struct Transparent {
    views: Vec<ViewDraws>,
    multi_draw: bool,
}

impl Transparent {
    pub(super) fn new(multi_draw: bool) -> Self {
        Self {
            views: Vec::new(),
            multi_draw,
        }
    }

    /// The most part draws that one view's frame makes.
    fn most_parts(layout: &SortedLayout) -> usize {
        layout.draws_room() as usize * layout.most_parts() as usize
    }

    /// Bytes of draw records that one view's frame takes at most: an aligned place for each call,
    /// and for multi-draw calls room to bind a whole block from the last one.
    pub(super) fn records_bound(layout: &SortedLayout, multi_draw: bool) -> u32 {
        let draws = Self::most_parts(layout) as u32;
        if draws == 0 {
            return 0;
        }
        let tail = if multi_draw {
            MULTI_DRAW_BLOCK_BYTES - OFFSET_ALIGNMENT
        } else {
            0
        };
        draws * OFFSET_ALIGNMENT + tail
    }

    /// The most bytes that one frame copies into its arena for the passes: the records, and each
    /// multi-draw call's three arrays.
    pub(super) fn upload_bound(layout: &SortedLayout, views: usize, multi_draw: bool) -> usize {
        let arrays = if multi_draw { 12 } else { 0 };
        views
            * (Self::records_bound(layout, multi_draw) as usize + Self::most_parts(layout) * arrays)
    }

    /// Gives each of `views` views room for the layout's draws.
    pub(super) fn reserve(
        &mut self,
        layout: &SortedLayout,
        views: usize,
    ) -> Result<(), TryReserveError> {
        if self.views.len() < views {
            self.views.try_reserve(views - self.views.len())?;
            self.views.resize_with(views, ViewDraws::default);
        }
        let most = Self::most_parts(layout);
        for view in &mut self.views {
            view.parts
                .try_reserve(most.saturating_sub(view.parts.len()))?;
            view.calls
                .try_reserve(most.saturating_sub(view.calls.len()))?;
        }
        Ok(())
    }

    /// Turns a view's sorted runs into draws, one per part of each run's mesh, and groups them
    /// into calls. `first_entry` is where the sorted rows start in the view's index list.
    pub(super) fn prepare(
        &mut self,
        view: usize,
        sorted: &SortedView,
        layout: &SortedLayout,
        settings: &SceneSettings,
        first_entry: u32,
    ) {
        let state = &mut self.views[view];
        state.parts.clear();
        state.calls.clear();
        let per_call = if self.multi_draw {
            sizes::MULTI_DRAW_RECORDS
        } else {
            1
        };
        let storage = settings.meshes();
        let mut records = 0;
        for run in sorted.draws() {
            let bucket = layout.buckets[run.bucket as usize];
            let mesh = storage
                .mesh(bucket.mesh - 1)
                .expect("buckets name known meshes");
            // A run that draws its back faces, then its front faces, starts calls of its own, so
            // its front faces can draw the same parts with the same records.
            let first_call = state.calls.len();
            let mut alone = bucket.back != 0;
            let pipeline = if bucket.back != 0 {
                bucket.back
            } else {
                bucket.pipeline
            };
            for part in storage.parts(mesh) {
                let joins = !alone
                    && state.calls.last().is_some_and(|call| {
                        call.pipeline == pipeline
                            && !call.repeat
                            && call.textures == bucket.textures
                            && call.page == part.page
                            && call.count < per_call
                    });
                alone = false;
                if joins {
                    if let Some(call) = state.calls.last_mut() {
                        call.count += 1;
                    }
                } else {
                    if let Some(call) = state.calls.last() {
                        records = call.records
                            + (call.count * sizes::DRAW_RECORD_BYTES)
                                .next_multiple_of(OFFSET_ALIGNMENT);
                    }
                    state.calls.push(Call {
                        pipeline,
                        textures: bucket.textures,
                        page: part.page,
                        first: state.parts.len() as u32,
                        count: 1,
                        records,
                        repeat: false,
                    });
                }
                state.parts.push(PartDraw {
                    start: first_entry + run.first,
                    instances: run.count,
                    index_count: part.index_count,
                    first_index: part.first_index,
                    material: bucket.material - 1,
                    // Only scene objects are skinned, and their rows are resident.
                    group: bucket.skinned_slot().map_or(bucket.group, |_| RESIDENT),
                });
            }
            if bucket.back != 0 {
                for k in first_call..state.calls.len() {
                    let back = state.calls[k];
                    state.calls.push(Call {
                        pipeline: bucket.pipeline,
                        repeat: true,
                        ..back
                    });
                }
            }
        }
    }

    /// Writes a view's draw records into the ring slot at `slot`, from its transparent part at
    /// `records_at` on: each draw's start in the index list, its material, its data texture and a
    /// shift of 0, as each index list entry names one row.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: usize,
        buffer: u32,
        at: u32,
    ) -> Result<(), RecordError> {
        let state = &self.views[view];
        let Some(last) = state.calls.last() else {
            return Ok(());
        };
        let bytes = last.records + last.count * sizes::DRAW_RECORD_BYTES;
        let (from, records) = arena.push_zeroed(bytes as usize)?;
        for call in state.calls.iter().filter(|call| !call.repeat) {
            let parts = &state.parts[call.first as usize..][..call.count as usize];
            for (k, part) in parts.iter().enumerate() {
                let word = call.records as usize / 4 + k * 4;
                put_u32(records, word, part.start);
                put_u32(records, word + 1, part.material);
                put_u32(records, word + 2, part.group);
                put_u32(records, word + 3, 0);
            }
        }
        let padded = bytes.next_multiple_of(4);
        list.push(Op::WriteBuffer, &[buffer, at, from, padded])?;
        Ok(())
    }

    /// Records a view's transparent pass inside the render pass that the render graph began.
    /// `groups` sets the frame's and the instances' bind groups; `records_at` is the dynamic
    /// offset of the transparent part of the view's ring slot of draw records.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: usize,
        draws_group: u32,
        records_at: u32,
        meshes: &MeshBuffers,
        groups: impl FnOnce(&mut DrawList) -> Result<(), RecordError>,
    ) -> Result<(), RecordError> {
        let state = &self.views[view];
        if state.calls.is_empty() {
            return Ok(());
        }
        groups(list)?;
        let (mut pipeline, mut textures, mut page) = (None, 0, None);
        for call in &state.calls {
            if pipeline != Some(call.pipeline) {
                list.push(Op::SetPipeline, &[call.pipeline])?;
                pipeline = Some(call.pipeline);
            }
            if call.textures != 0 && call.textures != textures {
                list.push(Op::SetBindGroup, &[TEXTURES_GROUP, call.textures, 0])?;
                textures = call.textures;
            }
            if page != Some(call.page) {
                let (vertices, indices) = meshes.ids(call.page);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
                page = Some(call.page);
            }
            list.push(
                Op::SetBindGroup,
                &[1, draws_group, 1, records_at + call.records],
            )?;
            let parts = &state.parts[call.first as usize..][..call.count as usize];
            if self.multi_draw {
                let n = parts.len();
                let (counts_at, counts) = arena.push_zeroed(n * 4)?;
                for (k, part) in parts.iter().enumerate() {
                    put_u32(counts, k, part.index_count);
                }
                let (offsets_at, offsets) = arena.push_zeroed(n * 4)?;
                for (k, part) in parts.iter().enumerate() {
                    put_u32(offsets, k, part.first_index * 2);
                }
                let (instances_at, instances) = arena.push_zeroed(n * 4)?;
                for (k, part) in parts.iter().enumerate() {
                    put_u32(instances, k, part.instances);
                }
                list.push(
                    Op::MultiDrawIndexed,
                    &[n as u32, counts_at, offsets_at, instances_at],
                )?;
            } else {
                for part in parts {
                    list.push(
                        Op::DrawIndexed,
                        &[part.index_count, part.instances, part.first_index, 0, 0],
                    )?;
                }
            }
        }
        Ok(())
    }
}
