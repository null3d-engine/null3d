//! The opaque passes: one scene pass per view, which draws every bucket with visible instances
//! from the view's index list, with one draw per part of the bucket's mesh. Each draw has a record
//! in a uniform block: the start of its bucket's slice of the index list, its material and its
//! data texture. The draws of one pipeline and one vertex page sit next to each other, so one
//! multi-draw call draws a whole run of them where the device has `WEBGL_multi_draw`, and the
//! shader reads the record of `gl_DrawID`. Without the extension, each draw binds its own record.
//!
//! Each view has a ring of frame uniforms and a ring of draw records, whose slots move on only
//! when the frame writes new data, as the index list textures' slots do. A frame uniform's slot
//! also holds the offset from the view's camera to each cell in use, which the vertex shader adds
//! to an instance's matrix, so it draws positions relative to the camera.
//!
//! The shadow passes draw the same way, from the casters' layout: one [`Opaque`] records the
//! views of cameras, and another the shadow cascades, whose frame groups bind no shadow map.
//!
//! With the depth prepass, a camera view's depth prepass replays the same calls first, with each
//! draw's prepass pipeline, and leaves out the draws that have none. It binds the same frame group,
//! index list, draw records and instance textures as the opaque pass after it, so both passes place
//! every vertex from the same data.

use null3d_core::cells::MAX_CELLS;
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, index_format, layout as bind_layout, resource_kind, sizes,
};

use super::data::{RING, RingSlot};
use super::ids;
use super::layout::{Draw, Layout, MULTI_DRAW_BLOCK_BYTES, run_end};
use crate::frame::{
    CELL_OFFSET_BYTES, CellOffsets, MeshBuffers, RecordError, UploadArena, grown_size, put_u32,
};
use crate::frame_data::FrameUniform;
use crate::view::{ViewFrame, ViewId};

/// Where a frame's slot in a view's ring of frame uniforms holds the offset from the camera to
/// each cell: after the uniform block, aligned for binding.
const OFFSETS_AT: u32 = sizes::FRAME_UNIFORM_BYTES.next_multiple_of(OFFSET_ALIGNMENT);
/// Bytes of the offsets from the camera to the cells, as the vertex shader's block holds them.
pub(super) const OFFSETS_BYTES: u32 = MAX_CELLS * CELL_OFFSET_BYTES;
/// Bytes of one frame's slot in a view's ring of frame uniforms: the uniform block, then the
/// offsets.
const FRAME_SLOT_BYTES: u32 = OFFSETS_AT + OFFSETS_BYTES;
/// The group index of the maps' bind group in the mesh pipelines that sample a map, after the
/// groups of the draw records and the data textures.
const TEXTURES_GROUP: u32 = 3;

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
#[derive(Debug, Default)]
struct ViewDraws {
    /// The frame uniform's slot, and the block and the cell offsets the ring last received.
    uniform: RingSlot,
    uploaded: FrameUniform,
    offsets_uploaded: CellOffsets,
    /// Bytes of the draw record buffer, 0 before it exists.
    draws_bytes: u32,
    /// The slots of the frame being recorded.
    slots: FrameSlots,
}

/// What a view's pass draws with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Shading {
    /// Each draw's own pipeline, with the view's frame group of the light textures' ring slot.
    Lit { light_slot: u32 },
    /// Each draw's pipeline of the depth prepass, with the same frame group as `Lit`. Draws
    /// without one are left out.
    Prepass { light_slot: u32 },
    /// Each draw's own pipeline, which draws depth alone, with the single frame group of a shadow
    /// cascade's or a shadow tile's view.
    Depth,
}

/// Each view's rings, and how the device draws many buckets. The views are of one kind, in order
/// from the first: the views of cameras, or the shadow cascades.
#[derive(Debug)]
pub(super) struct Opaque {
    /// The first view, whose rings are the first of `views`.
    first: ViewId,
    views: Vec<ViewDraws>,
    /// True when the device has `WEBGL_multi_draw`.
    multi_draw: bool,
}

/// What a view's frame draws from: the view's values and cell offsets, the slots that the
/// streamed ring and the view's index list took, and where each bucket's slice of the view's index
/// list starts.
#[derive(Clone, Copy, Debug)]
pub(super) struct ViewUpload<'a> {
    pub(super) frame: u32,
    pub(super) values: &'a ViewFrame,
    pub(super) offsets: &'a CellOffsets,
    pub(super) streamed: u32,
    pub(super) listed: u32,
    /// True when the index list differs from the one the slot held, so the draw records do too.
    pub(super) new_list: bool,
    /// The start of each bucket's entries, and last the total, as the culling output lists them.
    pub(super) starts: &'a [u32],
}

/// One draw call of a frame: draws `from..to` of the run that starts at draw `run`, `drawn` of
/// them with visible instances.
#[derive(Clone, Copy, Debug)]
struct Call {
    run: usize,
    from: usize,
    to: usize,
    drawn: u32,
}

/// Calls `f` with each draw call of a frame and its number, in draw order: per run of draws that
/// share a pipeline and a vertex page, one multi-draw call per block of drawn draws, or one call
/// per drawn draw. Draws with no visible instances draw nothing.
fn for_each_call(
    draws: &[Draw],
    visible: &dyn Fn(usize) -> u32,
    multi: bool,
    mut f: impl FnMut(u32, Call) -> Result<(), RecordError>,
) -> Result<(), RecordError> {
    let per_call = if multi { sizes::MULTI_DRAW_RECORDS } else { 1 };
    let mut index = 0;
    let mut start = 0;
    while start < draws.len() {
        let end = run_end(draws, start);
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

/// The visible instances of each draw, by its place in `draws`: the entries of its bucket's slice
/// of the index list, where the slice of bucket `b` starts at `starts[b]`.
fn visible_in<'a>(draws: &'a [Draw], starts: &'a [u32]) -> impl Fn(usize) -> u32 + 'a {
    move |d| {
        let b = draws[d].bucket as usize;
        starts[b + 1] - starts[b]
    }
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
    /// No view's rings yet, for views from `first` on, on a device that has `WEBGL_multi_draw` or
    /// not.
    pub(super) fn new(first: ViewId, multi_draw: bool) -> Self {
        Self {
            first,
            views: Vec::new(),
            multi_draw,
        }
    }

    /// The place of a view's rings in `views`.
    fn slot(&self, view: ViewId) -> usize {
        view.index() - self.first.index()
    }

    /// The number of views whose rings exist.
    pub(super) fn views(&self) -> usize {
        self.views.len()
    }

    /// Where a view's frame group reads the frame uniform and the cell offsets of the frame being
    /// recorded: the dynamic offset of the ring slot that [`Opaque::upload`] took for them.
    pub(super) fn frame_slot(&self, view: ViewId) -> u32 {
        self.views[self.slot(view)].slots.uniform * FRAME_SLOT_BYTES
    }

    /// Creates the ring of frame uniforms of each view from the first one without it up to
    /// `views` of them. Each new view then needs its frame groups ([`Opaque::bind_frame`]).
    pub(super) fn add_views(
        &mut self,
        list: &mut DrawList,
        views: usize,
    ) -> Result<(), RecordError> {
        while self.views.len() < views {
            let view = ViewId::from_index(self.first.index() + self.views.len());
            list.push(
                Op::CreateBuffer,
                &[
                    ids::frame(view),
                    RING * FRAME_SLOT_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.views.push(ViewDraws::default());
        }
        Ok(())
    }

    /// Records the creation of a view's frame groups, which bind its uniform block, its cell
    /// offsets and the material table's texture. A camera's view has one group for each slot of
    /// the light textures' ring. Each also binds three.js's table of the split-sum terms of
    /// specular light, the shadow map of `shadow_maps` with the comparison sampler and the
    /// cascades' uniform block that read it, the slot's light grid and light records, and the
    /// shadow atlas of `shadow_maps` with the tiles' uniform block. A shadow cascade's or a shadow
    /// tile's view has one group, which binds no shadow map, so no pass reads the texture it draws
    /// into.
    pub(super) fn bind_frame(
        list: &mut DrawList,
        view: ViewId,
        shadow_maps: Option<(u32, u32)>,
    ) -> Result<(), RecordError> {
        // The frame's slot offset moves the uniform block and the cell offsets together, and
        // the backend gives dynamic offsets to a group's buffers in their order here.
        let frame = ids::frame(view);
        let common = [
            0,
            resource_kind::BUFFER,
            frame,
            0,
            sizes::FRAME_UNIFORM_BYTES,
            2,
            resource_kind::BUFFER,
            frame,
            OFFSETS_AT,
            OFFSETS_BYTES,
            1,
            resource_kind::TEXTURE,
            ids::MATERIALS,
            0,
            0,
        ];
        let group = ids::frame_group(view);
        let Some((map, atlas)) = shadow_maps else {
            let mut words = [0; 18];
            words[..3].copy_from_slice(&[group, bind_layout::DEPTH, 3]);
            words[3..].copy_from_slice(&common);
            list.push(Op::CreateBindGroup, &words)?;
            return Ok(());
        };
        let mut words = [0; 58];
        words[3..18].copy_from_slice(&common);
        words[18..48].copy_from_slice(&[
            3,
            resource_kind::TEXTURE,
            ids::DFG,
            0,
            0,
            4,
            resource_kind::TEXTURE,
            map,
            0,
            0,
            5,
            resource_kind::SAMPLER,
            ids::SHADOW_SAMPLER,
            0,
            0,
            6,
            resource_kind::BUFFER,
            ids::SHADOWS,
            0,
            sizes::SHADOW_UNIFORM_BYTES,
            9,
            resource_kind::TEXTURE,
            atlas,
            0,
            0,
            10,
            resource_kind::BUFFER,
            ids::SHADOW_TILES,
            0,
            sizes::SHADOW_TILES_UNIFORM_BYTES,
        ]);
        for slot in 0..RING {
            words[..3].copy_from_slice(&[group + slot, bind_layout::FRAME, 11]);
            words[48..].copy_from_slice(&[
                7,
                resource_kind::TEXTURE,
                ids::LIGHT_GRID + slot,
                0,
                0,
                8,
                resource_kind::TEXTURE,
                ids::LIGHTS + slot,
                0,
                0,
            ]);
            list.push(Op::CreateBindGroup, &words)?;
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
        let slot = self.slot(view);
        let state = &mut self.views[slot];
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

    /// Takes a view's ring slots for the frame. Writes its frame uniform and cell offsets into the
    /// next slot when either changed, and its draw records when its index list is new: for each
    /// drawn draw, its bucket's slice of the list.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        frame: ViewUpload<'_>,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let slot = self.slot(view);
        let state = &mut self.views[slot];
        let uniform = frame.values.uniform;
        let new_uniform = !state.uniform.holds_any()
            || uniform != state.uploaded
            || frame.offsets.as_slice() != state.offsets_uploaded.as_slice();
        state.slots = FrameSlots {
            uniform: state.uniform.take(frame.frame, new_uniform),
            streamed: frame.streamed,
            listed: frame.listed,
        };
        if new_uniform {
            let slot = state.slots.uniform * FRAME_SLOT_BYTES;
            let (at, bytes) = arena.push(uniform.as_bytes())?;
            list.push(Op::WriteBuffer, &[ids::frame(view), slot, at, bytes])?;
            let (at, bytes) = arena.push(frame.offsets.as_bytes())?;
            list.push(
                Op::WriteBuffer,
                &[ids::frame(view), slot + OFFSETS_AT, at, bytes],
            )?;
            state.uploaded = uniform;
            state.offsets_uploaded.copy_from(frame.offsets);
        }
        if !frame.new_list {
            return Ok(());
        }
        let (buckets, draws) = (&layout.buckets, &layout.draws);
        let (starts, multi_draw) = (frame.starts, self.multi_draw);
        let visible = visible_in(draws, starts);
        let stride = record_stride(multi_draw);
        let mut calls = 0;
        for_each_call(draws, &visible, multi_draw, |_, _| {
            calls += 1;
            Ok(())
        })?;
        if calls == 0 {
            return Ok(());
        }
        let (at, records) = arena.push_zeroed((calls * stride) as usize)?;
        for_each_call(draws, &visible, multi_draw, |index, call| {
            let drawn = (call.from..call.to).filter(|&d| visible(d) > 0);
            for (r, d) in drawn.enumerate() {
                let b = draws[d].bucket as usize;
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

    /// Binds a view's frame group, with the light textures of the ring slot `light_slot`, and its
    /// instance textures for the frame being recorded, as the view's scene passes draw from them.
    pub(super) fn bind_view(
        &self,
        list: &mut DrawList,
        view: ViewId,
        light_slot: u32,
    ) -> Result<(), RecordError> {
        let slots = self.views[self.slot(view)].slots;
        let frame_slot = self.frame_slot(view);
        let group = ids::frame_group(view) + light_slot;
        list.push(Op::SetBindGroup, &[0, group, 2, frame_slot, frame_slot])?;
        let instances = ids::instances_group(view) + slots.streamed * RING + slots.listed;
        list.push(Op::SetBindGroup, &[2, instances, 0])?;
        Ok(())
    }

    /// Where the transparent pass's draw records start in the buffer of a view's draw records,
    /// for the frame being recorded.
    pub(super) fn sorted_records_at(&self, view: ViewId, layout: &Layout) -> u32 {
        self.views[self.slot(view)].slots.listed * layout.draws_slot_bytes
            + layout.sorted_records_at
    }

    /// Records a view's pass inside the render pass that the render graph began, with `shading`:
    /// every draw whose bucket has visible instances, where the index list of bucket `b` starts at
    /// `starts[b]`, from its mesh page's buffers in `meshes`, and the ring slots that
    /// [`Opaque::upload`] took.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        starts: &[u32],
        layout: &Layout,
        meshes: &MeshBuffers,
        shading: Shading,
    ) -> Result<(), RecordError> {
        let slots = self.views[self.slot(view)].slots;
        let (buckets, draws, multi_draw) = (&layout.buckets, &layout.draws, self.multi_draw);
        let visible = visible_in(draws, starts);
        let shift = |d: usize| buckets[draws[d].bucket as usize].shift;
        let stride = record_stride(multi_draw);
        let slot = slots.listed * layout.draws_slot_bytes;
        let (light_slot, prepass) = match shading {
            Shading::Lit { light_slot } => (light_slot, false),
            Shading::Prepass { light_slot } => (light_slot, true),
            Shading::Depth => (0, false),
        };
        self.bind_view(list, view, light_slot)?;
        let mut pipeline = None;
        let mut textures = 0;
        let mut run = usize::MAX;
        for_each_call(draws, &visible, multi_draw, |index, call| {
            let first = draws[call.run];
            let id = if prepass {
                first.prepass
            } else {
                first.pipeline
            };
            if id == 0 {
                return Ok(());
            }
            if call.run != run {
                run = call.run;
                if pipeline != Some(id) {
                    list.push(Op::SetPipeline, &[id])?;
                    pipeline = Some(id);
                }
                // The prepass's programs sample no maps.
                if !prepass && first.textures != 0 && first.textures != textures {
                    list.push(Op::SetBindGroup, &[TEXTURES_GROUP, first.textures, 0])?;
                    textures = first.textures;
                }
                let (vertices, indices) = meshes.ids(first.page);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
            }
            list.push(
                Op::SetBindGroup,
                &[1, ids::draws_group(view), 1, slot + index * stride],
            )?;
            let drawn = (call.from..call.to).filter(|&d| visible(d) > 0);
            if multi_draw {
                let n = call.drawn as usize;
                let (counts_at, counts) = arena.push_zeroed(n * 4)?;
                for (k, d) in drawn.clone().enumerate() {
                    put_u32(counts, k, draws[d].index_count);
                }
                let (offsets_at, offsets) = arena.push_zeroed(n * 4)?;
                for (k, d) in drawn.clone().enumerate() {
                    put_u32(offsets, k, draws[d].first_index * 2);
                }
                let (instances_at, instances) = arena.push_zeroed(n * 4)?;
                for (k, d) in drawn.enumerate() {
                    put_u32(instances, k, visible(d) << shift(d));
                }
                list.push(
                    Op::MultiDrawIndexed,
                    &[call.drawn, counts_at, offsets_at, instances_at],
                )?;
            } else {
                for d in drawn {
                    let draw = draws[d];
                    let instances = visible(d) << shift(d);
                    list.push(
                        Op::DrawIndexed,
                        &[draw.index_count, instances, draw.first_index, 0, 0],
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

    /// A draw of pipeline `pipeline` from vertex page `page`.
    fn draw(pipeline: u32, page: u32) -> Draw {
        Draw {
            pipeline,
            prepass: 0,
            textures: 0,
            page,
            bucket: 0,
            index_count: 36,
            first_index: 0,
        }
    }

    fn calls(draws: &[Draw], visible: &[u32], multi: bool) -> Vec<(u32, usize, usize, usize, u32)> {
        let mut out = Vec::new();
        for_each_call(draws, &|d| visible[d], multi, |index, call| {
            out.push((index, call.run, call.from, call.to, call.drawn));
            Ok(())
        })
        .unwrap();
        out
    }

    #[test]
    fn calls_follow_runs_of_pipeline_and_page_and_skip_empty_draws() {
        let draws = [draw(1, 0), draw(1, 0), draw(1, 1), draw(2, 1), draw(2, 1)];
        let visible = [4, 0, 2, 0, 7];
        // One multi-draw call per run with drawn draws; the empty run draws nothing.
        assert_eq!(
            calls(&draws, &visible, true),
            vec![(0, 0, 0, 2, 1), (1, 2, 2, 3, 1), (2, 3, 4, 5, 1)]
        );
        // One call per drawn draw.
        assert_eq!(
            calls(&draws, &visible, false),
            vec![(0, 0, 0, 1, 1), (1, 2, 2, 3, 1), (2, 3, 4, 5, 1)]
        );
        assert!(calls(&draws, &[0; 5], true).is_empty());
    }

    #[test]
    fn a_run_longer_than_one_block_splits_into_calls() {
        let per_call = sizes::MULTI_DRAW_RECORDS as usize;
        let draws = vec![draw(1, 0); per_call + 3];
        let visible = vec![1; per_call + 3];
        let found = calls(&draws, &visible, true);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0], (0, 0, 0, per_call, per_call as u32));
        assert_eq!(found[1], (1, 0, per_call, per_call + 3, 3));
    }
}
