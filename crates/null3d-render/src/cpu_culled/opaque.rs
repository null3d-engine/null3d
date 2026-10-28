//! The opaque passes: one scene pass per view, which draws every bucket with visible instances
//! from the view's index list, with one draw per part of the bucket's mesh. Each draw has a record
//! in a uniform block: the start of its bucket's slice of the index list, its material and its
//! data texture. The draws of one pipeline and one vertex page sit next to each other, so one
//! multi-draw call draws a whole run of them where the device has `WEBGL_multi_draw`, and the
//! shader reads the record of `gl_DrawID`, from a texture copy of the block that the WebGL2 backend
//! makes. Without the extension, each draw binds its own record.
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

use super::DECAL_DEPTH_INDEX;
use super::data::{RING, RingSlot};
use super::ids;
use super::layout::{Draw, Layout, MULTI_DRAW_BLOCK_BYTES, run_end};
use crate::environment;
use crate::frame::{
    CELL_OFFSET_BYTES, CellOffsets, MeshBuffers, RecordError, UploadArena, grown_size_any, put_u32,
};
use crate::frame_data::FrameUniform;
use crate::probe_grid;
use crate::transmission;
use crate::view::{ViewFrame, ViewId};

/// The first binding of the instance group's row values textures, after the textures of
/// skinned and morphed meshes: the resident rows', then the streamed rows'.
const ROW_VALUES_BINDING: u32 = 8;
/// The binding of the table of object ranges in the frame group, where WebGL2's mesh shaders
/// declare it.
pub(super) const OBJECT_RANGES_BINDING: u32 = 8;
/// Where a frame's slot in a view's ring of frame uniforms holds the offset from the camera to
/// each cell: after the uniform block, aligned for binding.
pub(super) const OFFSETS_AT: u32 = sizes::FRAME_UNIFORM_BYTES.next_multiple_of(OFFSET_ALIGNMENT);
/// Bytes of the offsets from the camera to the cells, as the vertex shader's block holds them.
pub(super) const OFFSETS_BYTES: u32 = MAX_CELLS * CELL_OFFSET_BYTES;
/// Bytes of one frame's slot in a view's ring of frame uniforms: the uniform block, then the
/// offsets.
const FRAME_SLOT_BYTES: u32 = OFFSETS_AT + OFFSETS_BYTES;
/// The group index of the maps' bind group in the mesh pipelines that sample a map, after the
/// groups of the draw records and the data textures.
const TEXTURES_GROUP: u32 = 3;

/// The textures that a camera view's frame groups bind for the surfaces they light: the shadow
/// map of the main directional light, the shadow atlas of point and spot lights, the texture of
/// ambient occlusion, the environment's cube texture, or the blank one, and the first light data
/// texture of the ring that the groups bind, one per ring slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct LitTextures {
    pub(super) shadow_map: u32,
    pub(super) atlas: u32,
    pub(super) occlusion: u32,
    pub(super) environment: u32,
    pub(super) probe_grid: u32,
    pub(super) lights: u32,
    /// The copy of the opaque color that surfaces which let light through sample: the camera's,
    /// or a blank texel for other views.
    pub(super) transmission: u32,
    /// The reflection probes' texture array, or the blank one.
    pub(super) probes: u32,
}

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
    /// Each draw's own pipeline, which reads no lights, with the single frame group of a shadow
    /// cascade's or the outline mask's view.
    Depth,
    /// Each caster's pipeline for the shadow atlas, with the single frame group of a shadow tile's
    /// view.
    Tile,
    /// Each draw's pipeline for GPU picking's id target, with the camera view's frame group.
    Pick,
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
    /// True when nothing outside the frame's list changed, so the view draws from the uniform slot
    /// of its frame's parity: the frames of one parity then record the same slots, and the still
    /// comparison can match them. A page that turns the accumulation off never holds.
    pub(super) hold_uniforms: bool,
    pub(super) values: &'a ViewFrame,
    pub(super) offsets: &'a CellOffsets,
    pub(super) streamed: u32,
    pub(super) listed: u32,
    /// True when the index list differs from the one the slot held, so the draw records do too.
    pub(super) new_list: bool,
    /// The start of each bucket's entries, and last the total, as the culling output lists them.
    pub(super) starts: &'a [u32],
    /// The patch runs that the view's trees draw, by cluster bucket.
    pub(super) patches: PatchView<'a>,
}

/// A view's chosen patch ranges by cluster bucket: each cluster's runs of its tree's index list,
/// as a first index and a count.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PatchView<'a> {
    /// Each cluster bucket's first run, then one past the last.
    starts: &'a [u32],
    runs: &'a [[u32; 2]],
}

impl<'a> PatchView<'a> {
    /// A view that draws no tree.
    pub(super) const NONE: Self = Self {
        starts: &[],
        runs: &[],
    };

    /// The runs of each cluster bucket, from `starts`.
    pub(super) const fn new(starts: &'a [u32], runs: &'a [[u32; 2]]) -> Self {
        Self { starts, runs }
    }

    /// Cluster `cluster`'s chosen runs.
    fn of(&self, cluster: u32) -> &'a [[u32; 2]] {
        let at = cluster as usize;
        let first = self.starts.get(at).copied().unwrap_or(0) as usize;
        let end = self.starts.get(at + 1).copied().unwrap_or(first as u32) as usize;
        self.runs.get(first..end).unwrap_or(&[])
    }
}

/// One draw call of a frame: draws `from..to` of the run that starts at draw `run`, `drawn` of
/// them with visible instances. A call that draws a tree draws the patch runs at `patches` of the
/// one draw at `from`, in place of that draw's whole index list.
#[derive(Clone, Copy, Debug)]
struct Call {
    run: usize,
    from: usize,
    to: usize,
    drawn: u32,
    patches: Option<(usize, usize)>,
}

/// Calls `f` with each draw call of a frame and its number, in draw order: per run of draws that
/// share a pipeline and a vertex page, one multi-draw call per block of drawn draws, or one call
/// per drawn draw. A draw of a tree takes a call for each block of its chosen patch runs. Draws
/// with no visible instances draw nothing.
fn for_each_call(
    draws: &[Draw],
    visible: &dyn Fn(usize) -> u32,
    patches: PatchView<'_>,
    multi: bool,
    mut f: impl FnMut(u32, Call) -> Result<(), RecordError>,
) -> Result<(), RecordError> {
    let per_call = if multi {
        sizes::MULTI_DRAW_RECORDS as usize
    } else {
        1
    };
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
            if let Some(cluster) = draws[b].cluster {
                let runs = patches.of(cluster);
                let mut at = 0;
                while at < runs.len() {
                    let to = (at + per_call).min(runs.len());
                    f(
                        index,
                        Call {
                            run: start,
                            from: b,
                            to: b + 1,
                            drawn: (to - at) as u32,
                            patches: Some((at, to)),
                        },
                    )?;
                    index += 1;
                    at = to;
                }
                b += 1;
                continue;
            }
            let from = b;
            let mut drawn = 0;
            while b < end && drawn < per_call as u32 && draws[b].cluster.is_none() {
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
                    patches: None,
                },
            )?;
            index += 1;
        }
        start = end;
    }
    Ok(())
}

/// The visible instances of each draw, by its place in `draws`: the entries of its bucket's slice
/// of the index list, where the slice of bucket `b` starts at `starts[b]`, two words each in a
/// fade bucket.
fn visible_in<'a>(draws: &'a [Draw], starts: &'a [u32]) -> impl Fn(usize) -> u32 + 'a {
    move |d| {
        let b = draws[d].bucket as usize;
        let words = starts[b + 1] - starts[b];
        if draws[d].pairs { words / 2 } else { words }
    }
}

/// Records one call's draws: a multi-draw call of its drawn draws where the device has
/// `WEBGL_multi_draw`, or one call per drawn draw, each with its visible instances, which a draw of
/// clusters draws `shift` times over. A call of a tree draws its chosen patch runs, each with the
/// draw's visible instances.
#[allow(clippy::too_many_arguments)]
fn draw_call(
    list: &mut DrawList,
    arena: &mut UploadArena,
    draws: &[Draw],
    visible: &dyn Fn(usize) -> u32,
    shift: &dyn Fn(usize) -> u32,
    patches: PatchView<'_>,
    call: Call,
    multi_draw: bool,
) -> Result<(), RecordError> {
    if multi_draw {
        let n = call.drawn as usize;
        // The arena gives each array as it is pushed, so the three are filled one after another.
        let (counts_at, counts) = arena.push_zeroed(n * 4)?;
        if let Some((from, to)) = call.patches {
            let cluster = draws[call.from].cluster.expect("a patch call draws a tree");
            for (k, run) in patches.of(cluster)[from..to].iter().enumerate() {
                put_u32(counts, k, run[1]);
            }
        } else {
            for (k, d) in (call.from..call.to).filter(|&d| visible(d) > 0).enumerate() {
                put_u32(counts, k, draws[d].index_count);
            }
        }
        let (offsets_at, offsets) = arena.push_zeroed(n * 4)?;
        if let Some((from, to)) = call.patches {
            let cluster = draws[call.from].cluster.expect("a patch call draws a tree");
            for (k, run) in patches.of(cluster)[from..to].iter().enumerate() {
                put_u32(offsets, k, run[0] * 2);
            }
        } else {
            for (k, d) in (call.from..call.to).filter(|&d| visible(d) > 0).enumerate() {
                put_u32(offsets, k, draws[d].first_index * 2);
            }
        }
        let (instances_at, instances) = arena.push_zeroed(n * 4)?;
        if let Some((from, to)) = call.patches {
            let d = call.from;
            let copies = visible(d) << shift(d);
            for k in 0..to - from {
                put_u32(instances, k, copies);
            }
        } else {
            for (k, d) in (call.from..call.to).filter(|&d| visible(d) > 0).enumerate() {
                put_u32(instances, k, visible(d) << shift(d));
            }
        }
        list.push(
            Op::MultiDrawIndexed,
            &[call.drawn, counts_at, offsets_at, instances_at],
        )?;
    } else if let Some((from, to)) = call.patches {
        let d = call.from;
        let cluster = draws[d].cluster.expect("a patch call draws a tree");
        let instances = visible(d) << shift(d);
        for run in &patches.of(cluster)[from..to] {
            list.push(Op::DrawIndexed, &[run[1], instances, run[0], 0, 0])?;
        }
    } else {
        for d in (call.from..call.to).filter(|&d| visible(d) > 0) {
            let draw = draws[d];
            let instances = visible(d) << shift(d);
            list.push(
                Op::DrawIndexed,
                &[draw.index_count, instances, draw.first_index, 0, 0],
            )?;
        }
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
    /// offsets, the material table's texture, which also holds three.js's table of the split-sum
    /// terms of specular light, and the table of object ranges. A camera's view has one group for
    /// each slot of the light textures' ring. Each also binds the shadow map of `lit` with the
    /// comparison sampler, the shadow settings block, which holds the cascades' settings beside the
    /// shadow tiles', the slot's texture of `lit`'s ring of light data textures, the shadow atlas
    /// of `lit`, the light probe grid's 3D texture, the texture of ambient occlusion, the
    /// environment's cube texture of `lit` with its sampler, the copy of the opaque color of
    /// `lit`, which the environment's sampler reads too, and the reflection probes' array of
    /// `lit`, which it reads as well, with the view's list of probes. A shadow cascade's or a
    /// shadow tile's view has one group, which binds no shadow map, so no pass reads the texture
    /// it draws into.
    pub(super) fn bind_frame(
        list: &mut DrawList,
        view: ViewId,
        lit: Option<LitTextures>,
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
            OBJECT_RANGES_BINDING,
            resource_kind::BUFFER,
            ids::OBJECT_RANGES,
            0,
            sizes::OBJECT_RANGE_BYTES,
        ];
        let group = ids::frame_group(view);
        // The lists hold a slot for each camera view. The skin pass has none of its own: it reads
        // the camera's list, as it reads the camera's light textures.
        let listed = if view.is_camera() {
            view.index()
        } else {
            ViewId::CAMERA.index()
        } as u32;
        let Some(LitTextures {
            shadow_map: map,
            atlas,
            occlusion,
            environment,
            probe_grid,
            lights,
            transmission: copy,
            probes,
        }) = lit
        else {
            let mut words = [0; 23];
            words[..3].copy_from_slice(&[group, bind_layout::DEPTH, 4]);
            words[3..].copy_from_slice(&common);
            list.push(Op::CreateBindGroup, &words)?;
            return Ok(());
        };
        let mut words = [0; 73 + environment::ENTRY_WORDS];
        words[3..23].copy_from_slice(&common);
        words[23..43].copy_from_slice(&[
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
            sizes::SHADOW_SETTINGS_BYTES,
            9,
            resource_kind::TEXTURE,
            atlas,
            0,
            0,
        ]);
        words[43..48].copy_from_slice(&probe_grid::entries(probe_grid));
        for slot in 0..RING {
            words[..3].copy_from_slice(&[group + slot, bind_layout::FRAME, 16]);
            words[48..53].copy_from_slice(&[7, resource_kind::TEXTURE, lights + slot, 0, 0]);
            words[53..58].copy_from_slice(&[11, resource_kind::TEXTURE, occlusion, 0, 0]);
            words[58..63].copy_from_slice(&[
                transmission::BINDING,
                resource_kind::TEXTURE,
                copy,
                0,
                0,
            ]);
            words[63..73].copy_from_slice(&[
                crate::probes::ARRAY_BINDING,
                resource_kind::TEXTURE,
                probes,
                0,
                0,
                crate::probes::LIST_BINDING_WEBGL2,
                resource_kind::BUFFER,
                ids::PROBE_LISTS,
                listed * crate::probes::LIST_STRIDE,
                crate::probes::LIST_BYTES,
            ]);
            words[73..]
                .copy_from_slice(&environment::entries(environment, ids::ENVIRONMENT_SAMPLER));
            list.push(Op::CreateBindGroup, &words)?;
        }
        Ok(())
    }

    /// Makes a view's draw record buffer big enough for the layout, with the group that binds
    /// one block or record of it, and binds the view's instance textures again when one of them
    /// is new (`textures_remade`): the resident and streamed textures, the index list, the cluster
    /// texture, and the row values textures beside the resident and the streamed ones. With
    /// `skins`, the joint texture, the texture of first joints and weights and the morph textures
    /// of deltas and weights, the instance groups bind them too, for the pipelines that skin and
    /// morph.
    pub(super) fn size(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        skins: Option<[u32; 4]>,
        textures_remade: bool,
    ) -> Result<(), RecordError> {
        if textures_remade {
            let [joints, first_joints, deltas, weights] = skins.unwrap_or_default();
            let entry = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
            // The streamed textures' and the index list's entries take each group's own slots.
            let skin_entries = [
                entry(4, joints),
                entry(5, first_joints),
                entry(6, deltas),
                entry(7, weights),
            ];
            let values = [
                entry(ROW_VALUES_BINDING, ids::RESIDENT_VALUES),
                entry(ROW_VALUES_BINDING + 1, 0),
            ];
            // The entries in binding order: the instance textures, the textures of skins and
            // morph targets where the groups bind them, then the row values textures.
            let skinned = if skins.is_some() {
                &skin_entries[..]
            } else {
                &[]
            };
            let mut words = [0u32; 3 + 5 * 10];
            let mut used = 3;
            for item in [
                entry(0, ids::RESIDENT),
                entry(1, 0),
                entry(2, 0),
                entry(3, ids::CLUSTERS),
            ]
            .iter()
            .chain(skinned)
            .chain(&values)
            {
                words[used..used + 5].copy_from_slice(item);
                used += 5;
            }
            words[1..3].copy_from_slice(&[bind_layout::INSTANCES, (used as u32 - 3) / 5]);
            // Where an entry's id lies among the words, by its place in the list.
            let id_of = |place: usize| 3 + place * 5 + 2;
            let streamed_values = (used - 3) / 5 - 1;
            for streamed in 0..RING {
                for listed in 0..RING {
                    words[0] = ids::instances_group(view) + streamed * RING + listed;
                    words[id_of(1)] = ids::STREAMED + streamed;
                    words[id_of(2)] = ids::visible(view) + listed;
                    words[id_of(streamed_values)] = ids::STREAMED_VALUES + streamed;
                    list.push(Op::CreateBindGroup, &words[..used])?;
                }
            }
        }
        let slot = self.slot(view);
        let state = &mut self.views[slot];
        let draws_bytes = RING * layout.draws_slot_bytes;
        if state.draws_bytes < draws_bytes {
            state.draws_bytes = grown_size_any(draws_bytes);
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
        // A still view takes the slot of its frame's parity, which a frame two before it used: the
        // uniform's parts outside the clock and the jitter are the same, so the older frame may
        // still read it while this one records. A moving view takes the ring's next slot.
        let slot = if frame.hold_uniforms {
            frame.frame & 1
        } else {
            state.uniform.take(frame.frame, new_uniform)
        };
        state.slots = FrameSlots {
            uniform: slot,
            streamed: frame.streamed,
            listed: frame.listed,
        };
        if new_uniform {
            let slot = state.slots.uniform * FRAME_SLOT_BYTES;
            let (at, bytes) =
                arena.push_masked(uniform.as_bytes(), &FrameUniform::volatile_ranges())?;
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
        let patches = frame.patches;
        let visible = visible_in(draws, starts);
        let stride = record_stride(multi_draw);
        let mut calls = 0;
        for_each_call(draws, &visible, patches, multi_draw, |_, _| {
            calls += 1;
            Ok(())
        })?;
        if calls == 0 {
            return Ok(());
        }
        let (at, records) = arena.push_zeroed((calls * stride) as usize)?;
        for_each_call(draws, &visible, patches, multi_draw, |index, call| {
            let mut r = 0;
            let write = |d: usize, r: usize, records: &mut [u8]| {
                let b = draws[d].bucket as usize;
                let word = (index * stride / 4) as usize + r * 4;
                put_u32(records, word, starts[b]);
                put_u32(records, word + 1, buckets[b].material - 1);
                put_u32(records, word + 2, buckets[b].group);
                put_u32(records, word + 3, buckets[b].shift);
            };
            if let Some((from, to)) = call.patches {
                for _ in from..to {
                    write(call.from, r, records);
                    r += 1;
                }
            } else {
                for d in (call.from..call.to).filter(|&d| visible(d) > 0) {
                    write(d, r, records);
                    r += 1;
                }
            }
            debug_assert_eq!(r, call.drawn as usize);
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
        scene: u32,
    ) -> Result<(), RecordError> {
        let slots = self.views[self.slot(view)].slots;
        let frame_slot = self.frame_slot(view);
        let group = ids::frame_group(view) + light_slot;
        list.push(Op::SetBindGroup, &[0, group, 2, frame_slot, frame_slot])?;
        let instances = ids::instances_group(view) + slots.streamed * RING + slots.listed;
        list.push(Op::SetBindGroup, &[2, instances, 0])?;
        // The scene's depth, which a custom material's surface function reads: group 4 sits after
        // the maps' group in its template.
        if scene != 0 {
            list.push(Op::SetBindGroup, &[DECAL_DEPTH_INDEX, scene, 0])?;
        }
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
    /// [`Opaque::upload`] took. It leaves out each draw whose maps' group `hidden` names: a group
    /// that binds a target that the view draws into, or one that it does not read.
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
        hidden: &dyn Fn(u32) -> bool,
        patches: PatchView<'_>,
        scene: u32,
    ) -> Result<(), RecordError> {
        let slots = self.views[self.slot(view)].slots;
        let (buckets, draws, multi_draw) = (&layout.buckets, &layout.draws, self.multi_draw);
        // The calls follow the draw records that `upload` wrote, call by call, so a call whose
        // maps' group is hidden keeps its place and draws nothing. Every draw of a run shares its
        // maps' group, so a call is hidden whole.
        let visible = visible_in(draws, starts);
        let shift = |d: usize| buckets[draws[d].bucket as usize].shift;
        let stride = record_stride(multi_draw);
        let slot = slots.listed * layout.draws_slot_bytes;
        // The prepass's pipelines and the tiles' pipelines both sit in each draw's second slot.
        let (light_slot, second, pick) = match shading {
            Shading::Lit { light_slot } => (light_slot, false, false),
            Shading::Prepass { light_slot } => (light_slot, true, false),
            Shading::Depth => (0, false, false),
            Shading::Tile => (0, true, false),
            Shading::Pick => (0, false, true),
        };
        self.bind_view(list, view, light_slot, scene)?;
        let mut pipeline = None;
        let mut textures = 0;
        let mut run = usize::MAX;
        // The cluster whose index buffer the pass has bound, or the page's when it is `None`. A
        // run can hold two trees, so the binding follows the tree and not only the kind of draw.
        let mut bound: Option<Option<u32>> = None;
        for_each_call(draws, &visible, patches, multi_draw, |index, call| {
            let first = draws[call.run];
            let id = if pick {
                first.pick
            } else if second {
                first.prepass
            } else {
                first.pipeline
            };
            let maps = if pick {
                first.pick_textures
            } else {
                first.textures
            };
            if id == 0 || (maps != 0 && hidden(maps)) {
                return Ok(());
            }
            // A draw of a tree draws the tree's own index list, so a call binds a tree's buffer
            // when its own tree or its run changes: the vertex page is the mesh's, and the index
            // buffer is the tree's.
            let drawing = draws[call.from];
            if call.run != run || bound != Some(drawing.cluster) {
                run = call.run;
                bound = Some(drawing.cluster);
                if pipeline != Some(id) {
                    list.push(Op::SetPipeline, &[id])?;
                    pipeline = Some(id);
                }
                // The prepass draws with each pipeline's own vertex shader, which can read the
                // material's textures, as a custom material's vertex offset may. A custom
                // material's pick build reads them too.
                if maps != 0 && maps != textures {
                    list.push(Op::SetBindGroup, &[TEXTURES_GROUP, maps, 0])?;
                    textures = maps;
                }
                let (vertices, indices) = match drawing.cluster {
                    Some(cluster) => {
                        let mesh = layout.cluster_buckets[cluster as usize].mesh;
                        (meshes.ids(drawing.page).0, ids::patch_index(mesh))
                    }
                    None => meshes.ids(drawing.page),
                };
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
            }
            list.push(
                Op::SetBindGroup,
                &[1, ids::draws_group(view), 1, slot + index * stride],
            )?;
            draw_call(
                list, arena, draws, &visible, &shift, patches, call, multi_draw,
            )
        })
    }

    /// Records the motion pass inside the render pass that the render graph began, from the camera
    /// view's index list, draw records and instance textures, as its opaque pass draws: each call
    /// of the opaque pass that draws a bucket that `moving` marks, with its draws' motion pipeline
    /// and the map that it reads, and the motion view's frame group `group` in place of the
    /// camera's.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record_motion(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        starts: &[u32],
        layout: &Layout,
        meshes: &MeshBuffers,
        group: u32,
        moving: &[bool],
        patches: PatchView<'_>,
    ) -> Result<(), RecordError> {
        let view = ViewId::CAMERA;
        let slots = self.views[self.slot(view)].slots;
        let (buckets, draws, multi_draw) = (&layout.buckets, &layout.draws, self.multi_draw);
        let visible = visible_in(draws, starts);
        let shift = |d: usize| buckets[draws[d].bucket as usize].shift;
        let stride = record_stride(multi_draw);
        let slot = slots.listed * layout.draws_slot_bytes;
        self.bind_view(list, view, 0, 0)?;
        let frame_slot = self.frame_slot(view);
        list.push(Op::SetBindGroup, &[0, group, 2, frame_slot, frame_slot])?;
        let mut pipeline = None;
        let mut textures = 0;
        let mut run = usize::MAX;
        // The draw records are numbered by the opaque pass's calls, which include a tree's calls
        // for each block of its ranges. The walk here passes the same patch view, so a tree's
        // calls keep their places, and it skips them by their own draw.
        for_each_call(draws, &visible, patches, multi_draw, |index, call| {
            let drawing = draws[call.from];
            let moves = (call.from..call.to)
                .any(|d| visible(d) > 0 && moving.get(draws[d].bucket as usize) == Some(&true));
            if drawing.motion == 0 || !moves {
                return Ok(());
            }
            if call.run != run {
                run = call.run;
                if pipeline != Some(drawing.motion) {
                    list.push(Op::SetPipeline, &[drawing.motion])?;
                    pipeline = Some(drawing.motion);
                }
                if drawing.motion_textures != 0 && drawing.motion_textures != textures {
                    list.push(
                        Op::SetBindGroup,
                        &[TEXTURES_GROUP, drawing.motion_textures, 0],
                    )?;
                    textures = drawing.motion_textures;
                }
                let (vertices, indices) = meshes.ids(drawing.page);
                list.push(Op::SetVertexBuffer, &[0, vertices, 0, 0])?;
                list.push(Op::SetIndexBuffer, &[indices, index_format::UINT16, 0, 0])?;
            }
            list.push(
                Op::SetBindGroup,
                &[1, ids::draws_group(view), 1, slot + index * stride],
            )?;
            draw_call(
                list, arena, draws, &visible, &shift, patches, call, multi_draw,
            )
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
    use super::super::layout::{Bucket, ClusterBucket};
    use super::*;

    /// A draw of pipeline `pipeline` from vertex page `page`.
    fn draw(pipeline: u32, page: u32) -> Draw {
        Draw {
            pipeline,
            prepass: 0,
            textures: 0,
            motion: 0,
            motion_textures: 0,
            page,
            bucket: 0,
            index_count: 36,
            first_index: 0,
            pairs: false,
            pick: 0,
            pick_textures: 0,
            holdout: false,
            cluster: None,
        }
    }

    fn calls(draws: &[Draw], visible: &[u32], multi: bool) -> Vec<(u32, usize, usize, usize, u32)> {
        let mut out = Vec::new();
        for_each_call(
            draws,
            &|d| visible[d],
            PatchView::NONE,
            multi,
            |index, call| {
                out.push((index, call.run, call.from, call.to, call.drawn));
                Ok(())
            },
        )
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
    fn a_tree_keeps_the_motion_pass_in_step_with_the_opaque_draw_records() {
        let mut opaque = Opaque::new(ViewId::CAMERA, true);
        opaque.views.push(ViewDraws::default());
        let mut layout = Layout::default();
        for moving in [false, true] {
            layout.buckets.push(Bucket {
                material: 1,
                mesh_key: 1,
                group: 0,
                shift: 0,
                moves: moving,
            });
        }
        let mut tree = draw(1, 0);
        tree.cluster = Some(0);
        tree.bucket = 0;
        let moving = Draw {
            motion: 7,
            bucket: 1,
            page: 1,
            ..draw(2, 1)
        };
        layout.draws.push(tree);
        layout.draws.push(moving);
        layout.cluster_buckets.push(ClusterBucket {
            bucket: 0,
            mesh: 1,
            object: 0,
        });
        // Each bucket lists its one source.
        let starts = [0, 1, 2];
        let runs = [[0, 3]];
        let patch_starts = [0, 1];
        let patches = PatchView::new(&patch_starts, &runs);
        let mut list = DrawList::with_capacity(1024);
        let mut arena = UploadArena::default();
        arena.reset(1 << 16);
        let meshes = MeshBuffers::new(100);
        opaque
            .record_motion(
                &mut list,
                &mut arena,
                &starts,
                &layout,
                &meshes,
                0,
                &[false, true],
                patches,
            )
            .unwrap();
        // The tree takes call 0, and the moving draw is call 1, as it is in the opaque pass.
        let (offsets, draws) = recorded(&list);
        assert_eq!(draws, 1);
        assert_eq!(offsets, vec![record_stride(true)]);
    }

    #[test]
    fn a_tree_draws_in_calls_of_the_most_ranges() {
        let mut tree = draw(1, 0);
        tree.cluster = Some(0);
        let draws = [draw(1, 0), tree];
        // The tree lists one source, as a cluster bucket does.
        let visible = [1, 1];
        let runs: Vec<[u32; 2]> = (0..300).map(|k| [k * 3, 3]).collect();
        let starts = [0, 300];
        let patches = PatchView::new(&starts, &runs);
        let mut out = Vec::new();
        for_each_call(&draws, &|d| visible[d], patches, true, |index, call| {
            out.push((index, call.from, call.drawn, call.patches));
            Ok(())
        })
        .unwrap();
        // The whole mesh's draw takes one call, then the tree's 300 ranges fill a call of 256 and
        // a second of 44. The tree's records share the draw's bucket.
        assert_eq!(
            out,
            vec![
                (0, 0, 1, None),
                (1, 1, 256, Some((0, 256))),
                (2, 1, 44, Some((256, 300))),
            ]
        );
        // The ranges count as records, not one record for the whole draw.
        assert_eq!(out.iter().map(|entry| entry.2).sum::<u32>(), 301);
    }

    /// The dynamic offsets of the draw records that a recorded pass binds, and its draw calls.
    fn recorded(list: &DrawList) -> (Vec<u32>, usize) {
        let (mut offsets, mut draws) = (Vec::new(), 0);
        for command in null3d_gpu::drawlist::decode(list.words()) {
            let command = command.unwrap();
            match command.op {
                Op::SetBindGroup if command.operands[0] == 1 => {
                    offsets.push(command.operands[3]);
                }
                Op::DrawIndexed | Op::MultiDrawIndexed => draws += 1,
                _ => {}
            }
        }
        (offsets, draws)
    }

    #[test]
    fn a_hidden_call_keeps_its_place_among_the_draw_records() {
        // A run whose maps show the view's own target, then a run without maps. The draw records
        // hold one record per call, the hidden call's first, as `upload` writes them.
        for multi_draw in [false, true] {
            let mut opaque = Opaque::new(ViewId::CAMERA, multi_draw);
            opaque.views.push(ViewDraws::default());
            let mut layout = Layout::default();
            for bucket in 0..2 {
                layout.buckets.push(Bucket {
                    material: 1,
                    mesh_key: 1,
                    group: 0,
                    shift: 0,
                    moves: false,
                });
                layout.draws.push(Draw {
                    textures: if bucket == 0 { 9 } else { 0 },
                    bucket,
                    ..draw(1 + bucket, 0)
                });
            }
            let mut list = DrawList::with_capacity(256);
            let mut arena = UploadArena::default();
            arena.reset(256);
            let shading = Shading::Lit { light_slot: 0 };
            let (meshes, starts) = (MeshBuffers::new(100), [0, 3, 5]);
            let hidden = |group: u32| group == 9;
            opaque
                .record(
                    &mut list,
                    &mut arena,
                    ViewId::CAMERA,
                    &starts,
                    &layout,
                    &meshes,
                    shading,
                    &hidden,
                    PatchView::NONE,
                    0,
                )
                .unwrap();
            let stride = record_stride(multi_draw);
            assert_eq!(
                recorded(&list),
                (vec![stride], 1),
                "multi-draw {multi_draw}"
            );
        }
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
