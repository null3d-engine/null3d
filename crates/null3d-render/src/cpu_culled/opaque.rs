//! The opaque passes: one scene pass per view, which draws every bucket with visible instances
//! from the view's index list. Each draw has a record in a uniform block: the start of its slice of
//! the index list, its material and its data texture. The buckets of one pipeline and one vertex
//! page sit next to each other, so one multi-draw call draws a whole run of them where the device
//! has `WEBGL_multi_draw`, and the shader reads the record of `gl_DrawID`. Without the extension,
//! each bucket has a draw that binds its own record.
//!
//! Each view has a ring of frame uniforms and a ring of draw records, whose slots move on only
//! when the frame writes new data, as the index list textures' slots do.

use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, permutation,
    resource_kind, sizes, template,
};

use super::data::{RING, RingSlot};
use super::ids;
use super::layout::{Bucket, Layout, MULTI_DRAW_BLOCK_BYTES, run_end};
use crate::frame::{RecordError, UploadArena, grown_size, put_u32};
use crate::frame_data::FrameUniform;
use crate::frame_graph::SceneTargets;
use crate::materials::Shading;
use crate::view::{ViewFrame, ViewId};

/// Bytes of one frame's slot in a view's ring of frame uniforms: the uniform block, aligned for
/// binding.
const FRAME_SLOT_BYTES: u32 = OFFSET_ALIGNMENT;

/// The ring slots a view's frame draws from.
#[derive(Clone, Copy, Debug, Default)]
struct FrameSlots {
    /// The frame uniform's slot.
    uniform: u32,
    /// The streamed texture's slot, which every view shares.
    streamed: u32,
    /// The index list texture's and the draw records' slot.
    listed: u32,
}

/// A view's ring of frame uniforms and its draw record buffer.
#[derive(Clone, Copy, Debug, Default)]
struct ViewDraws {
    /// The frame uniform's slot, and the block the ring last received.
    uniform: RingSlot,
    uploaded: FrameUniform,
    /// Bytes of the draw record buffer, 0 before it exists.
    draws_bytes: u32,
    /// The slots of the frame being recorded.
    slots: FrameSlots,
}

/// Each view's rings, and how the device draws many buckets.
#[derive(Debug)]
pub(super) struct Opaque {
    views: Vec<ViewDraws>,
    /// True when the device has `WEBGL_multi_draw`.
    multi_draw: bool,
}

/// What a view's frame draws from: the view's values, the slots that the streamed ring and the
/// view's index list took, and where each bucket's slice of the view's index list starts.
#[derive(Clone, Copy, Debug)]
pub(super) struct ViewUpload<'a> {
    pub(super) frame: u32,
    pub(super) values: &'a ViewFrame,
    pub(super) streamed: u32,
    pub(super) listed: u32,
    /// True when the index list differs from the one the slot held, so the draw records do too.
    pub(super) new_list: bool,
    /// The start of each bucket's entries, and last the total, as the culling output lists them.
    pub(super) starts: &'a [u32],
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

/// Bytes that one call's records take in the ring slot: a block for a multi-draw call, one aligned
/// record for a single draw.
fn record_stride(multi_draw: bool) -> u32 {
    if multi_draw {
        MULTI_DRAW_BLOCK_BYTES
    } else {
        OFFSET_ALIGNMENT
    }
}

impl Opaque {
    /// No view's rings yet, for a device that has `WEBGL_multi_draw` or not.
    pub(super) fn new(multi_draw: bool) -> Self {
        Self {
            views: Vec::new(),
            multi_draw,
        }
    }

    /// Records the creation of the render pipelines, which draw into the scene's color and depth
    /// targets, in the shader variant that reads the draw's index where the device has
    /// multi-draw.
    pub(super) fn create_pipelines(
        &self,
        list: &mut DrawList,
        targets: SceneTargets,
    ) -> Result<(), RecordError> {
        let bits = if self.multi_draw {
            permutation::DRAW_INDEX
        } else {
            0
        };
        targets.create_pipeline(list, ids::LIT, template::INSTANCED_LIT, bits)?;
        targets.create_pipeline(list, ids::UNLIT, template::INSTANCED_UNLIT, bits)
    }

    /// The number of views whose rings exist.
    pub(super) fn views(&self) -> usize {
        self.views.len()
    }

    /// Creates the ring of frame uniforms of each view from the first one without it up to
    /// `views`, with the group that binds it and the material table.
    pub(super) fn add_views(
        &mut self,
        list: &mut DrawList,
        views: usize,
    ) -> Result<(), RecordError> {
        let material_bytes = sizes::MAX_MATERIALS * crate::materials::MATERIAL_FLOATS as u32 * 4;
        while self.views.len() < views {
            let view = ViewId::from_index(self.views.len());
            list.push(
                Op::CreateBuffer,
                &[
                    ids::frame(view),
                    RING * FRAME_SLOT_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            list.push(
                Op::CreateBindGroup,
                &[
                    ids::frame_group(view),
                    bind_layout::FRAME,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids::frame(view),
                    0,
                    sizes::FRAME_UNIFORM_BYTES,
                    1,
                    resource_kind::BUFFER,
                    ids::MATERIALS,
                    0,
                    material_bytes,
                ],
            )?;
            self.views.push(ViewDraws::default());
        }
        Ok(())
    }

    /// Makes a view's draw record buffer big enough for the layout, with the group that binds
    /// one block or record of it, and binds the view's instance textures again when one of them
    /// is new (`textures_remade`).
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        textures_remade: bool,
    ) -> Result<(), RecordError> {
        if textures_remade {
            for streamed in 0..RING {
                for listed in 0..RING {
                    list.push(
                        Op::CreateBindGroup,
                        &[
                            ids::instances_group(view) + streamed * RING + listed,
                            bind_layout::INSTANCES,
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
                            ids::visible(view) + listed,
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
        let state = &mut self.views[view.index()];
        let draws_bytes = RING * layout.draws_slot_bytes;
        if state.draws_bytes < draws_bytes {
            state.draws_bytes = grown_size(draws_bytes, u32::MAX);
            list.push(
                Op::CreateBuffer,
                &[
                    ids::draws(view),
                    state.draws_bytes,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            let block = if self.multi_draw {
                MULTI_DRAW_BLOCK_BYTES
            } else {
                sizes::DRAW_RECORD_BYTES
            };
            list.push(
                Op::CreateBindGroup,
                &[
                    ids::draws_group(view),
                    bind_layout::DRAWS,
                    1,
                    0,
                    resource_kind::BUFFER,
                    ids::draws(view),
                    0,
                    block,
                ],
            )?;
        }
        Ok(())
    }

    /// Takes a view's ring slots for the frame. Writes its frame uniform into the next slot when
    /// it changed, and its draw records when its index list is new: each drawn bucket's slice of
    /// the list.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        frame: ViewUpload<'_>,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let state = &mut self.views[view.index()];
        let uniform = frame.values.uniform;
        let new_uniform = !state.uniform.holds_any() || uniform != state.uploaded;
        state.slots = FrameSlots {
            uniform: state.uniform.take(frame.frame, new_uniform),
            streamed: frame.streamed,
            listed: frame.listed,
        };
        if new_uniform {
            let (at, bytes) = arena.push(uniform.as_bytes())?;
            let offset = state.slots.uniform * FRAME_SLOT_BYTES;
            list.push(Op::WriteBuffer, &[ids::frame(view), offset, at, bytes])?;
            state.uploaded = uniform;
        }
        if !frame.new_list {
            return Ok(());
        }
        let (buckets, starts, multi_draw) = (&layout.buckets, frame.starts, self.multi_draw);
        let visible = |b: usize| starts[b + 1] - starts[b];
        let stride = record_stride(multi_draw);
        let mut calls = 0;
        for_each_call(buckets, &visible, multi_draw, |_, _| {
            calls += 1;
            Ok(())
        })?;
        if calls == 0 {
            return Ok(());
        }
        let (at, records) = arena.push_zeroed((calls * stride) as usize)?;
        for_each_call(buckets, &visible, multi_draw, |index, call| {
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
        let slot = frame.listed * layout.draws_slot_bytes;
        list.push(
            Op::WriteBuffer,
            &[ids::draws(view), slot, at, calls * stride],
        )?;
        Ok(())
    }

    /// Records a view's opaque pass inside the render pass that the render graph began: every
    /// bucket with visible instances, where the index list of bucket `b` starts at `starts[b]`,
    /// from the ring slots that [`Opaque::upload`] took.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        starts: &[u32],
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let slots = self.views[view.index()].slots;
        let (buckets, multi_draw) = (&layout.buckets, self.multi_draw);
        let visible = |b: usize| starts[b + 1] - starts[b];
        let stride = record_stride(multi_draw);
        let slot = slots.listed * layout.draws_slot_bytes;
        list.push(
            Op::SetBindGroup,
            &[
                0,
                ids::frame_group(view),
                1,
                slots.uniform * FRAME_SLOT_BYTES,
            ],
        )?;
        let instances = ids::instances_group(view) + slots.streamed * RING + slots.listed;
        list.push(Op::SetBindGroup, &[2, instances, 0])?;
        let mut pipeline = None;
        let mut run = usize::MAX;
        for_each_call(buckets, &visible, multi_draw, |index, call| {
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
                let (vertices, indices) = ids::page(first.page);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
            }
            list.push(
                Op::SetBindGroup,
                &[1, ids::draws_group(view), 1, slot + index * stride],
            )?;
            let drawn = (call.from..call.to).filter(|&b| visible(b) > 0);
            if multi_draw {
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
        })
    }

    /// Forgets every view's rings, so each is made again, after the thread that draws replaced
    /// the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.views.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cpu_culled::layout::RESIDENT;

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
}
