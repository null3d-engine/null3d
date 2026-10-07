//! The culling passes: one compute dispatch per view. Each thread tests one source's bounding
//! sphere against the view's frustum, appends a visible source to its bucket's slice of the view's
//! compacted instance buffer, and counts it in each of the bucket's indirect draws, which the
//! view's bundle then draws. Every view reads the same sources, and writes buffers of its own. The
//! views of cameras read the scene layout's bucket tables, and the shadow cascades' views read the
//! casters' layout's.
//!
//! A view's parameters also hold its layer mask, and the shader skips a source whose layer mask
//! shares no bit with it.
//!
//! A view's planes are relative to its camera, and its parameters also hold the offset from its
//! camera to each cell in use. The shader adds a source's offset to its matrix before it tests the
//! source, and copies the moved matrix into the compacted instance buffer, so the vertex shader
//! draws positions relative to the view's camera.
//!
//! A bucket whose pipelines read their instances by index (see
//! [`super::RendererConfig::index_instances`]) gets no copy: the shader writes each visible
//! source's index into the bucket's slice, after the copies in the same buffer, so culling binds
//! no storage buffer more. The view's index group then gives those pipelines' vertex shaders the
//! view's culling parameters, for the cells' offsets, the scene's matrices, and the bucket tables
//! of the layout that the view draws. It binds the same buffers as the culling group, so it is made
//! again whenever that group is.
//!
//! When the scene's sources lie in more than one grid cell, the CPU first finds the cells whose
//! still sources a view can see (see [`crate::cells`]). The view's parameters then hold the runs of
//! the cell order that it culls: the visible cells' runs and the moving sources' run. Its dispatch
//! covers those runs alone, and each workgroup finds its run and reads its sources' places from
//! the cell order. Otherwise the dispatch covers every source in place.
//!
//! A camera view that culls in two phases against its depth pyramid (see [`super::pyramid`])
//! binds its pyramid as the group's last buffer, where other views bind a placeholder, and keeps
//! its history, a word for each source, after its indirect draws in their buffer. In a frame
//! without marked occluders it culls once, with the plain culling pipeline, into the second set
//! of indirect draws. Its first dispatch keeps only the sources that
//! showed in its last frame, in the first set of indirect draws, which its occluders' pass draws.
//! Its late dispatch, after the pyramid, tests every source against the pyramid, writes the
//! history, and counts the visible sources in a second set of indirect draws, after the first,
//! which its opaque pass draws. Its parameters hold what the late dispatch reads: the
//! view-projection matrix, the render size and the pyramid's levels.

use null3d_core::cells::MAX_CELLS;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use super::ids;
use super::layout::Layout;
use super::pyramid::Levels;
use crate::cells::{CellCulling, CellMask};
use crate::frame::{
    CELL_OFFSET_BYTES, CellOffsets, RecordError, UploadArena, grown_size, words_as_bytes,
};
use crate::view::{ViewFrame, ViewId};

/// Bytes of the culling planes: six planes, the source count, the view's layer mask, the count of
/// runs of the cell order, and padding.
const CULL_PLANES_BYTES: u32 = 112;
/// The words of the culling planes that hold the source count, the view's layer mask and the
/// count of runs.
const SOURCES_WORD: usize = 24;
const LAYERS_WORD: usize = 25;
const RANGES_WORD: usize = 26;
/// Where the runs of the cell order start in the culling parameters: after the offset from the
/// camera to each cell.
const RANGES_OFFSET: u32 = CULL_PLANES_BYTES + MAX_CELLS * CELL_OFFSET_BYTES;
/// Bytes of one run of the cell order: its first position, its end, its first workgroup, and
/// padding.
const RANGE_BYTES: u32 = 16;
/// Where the occlusion phases' values start in the culling parameters: after the runs of the cell
/// order.
const OCCLUSION_OFFSET: u32 = RANGES_OFFSET + sizes::MAX_CULL_RANGES * RANGE_BYTES;
/// Words of the occlusion phases' values: the view-projection matrix, the render size, the
/// pyramid's levels, the first set's draws, where the history starts and an occluder's least span.
/// The shader works out each level's shape from the render size.
const OCCLUSION_WORDS: usize = 16 + 4 + 4;
/// Bytes of the culling parameters: the planes, the offset from the camera to each cell, the runs
/// of the cell order, then the occlusion phases' values.
pub(super) const CULL_PARAMS_BYTES: u32 = OCCLUSION_OFFSET + sizes::CULL_OCCLUSION_BYTES;

const _: () = assert!(OCCLUSION_WORDS as u32 * 4 == sizes::CULL_OCCLUSION_BYTES);
/// Bytes of one indexed indirect draw.
pub(super) const INDIRECT_BYTES: u32 = sizes::INDIRECT_WORDS * 4;
/// The buffers of the culling pass's bind group, one per binding: the last is the depth pyramid.
/// Eight storage buffers is what every device allows a shader stage, so the history shares the
/// indirect draws' buffer.
const CULL_BINDINGS: usize = 9;
/// Words of the culling pass's bind group entries: three for the group, five per buffer.
const CULL_GROUP_WORDS: usize = 3 + CULL_BINDINGS * 5;
/// Bytes of the placeholder that views without a pyramid bind in its place.
const NO_PYRAMID_BYTES: u32 = 16;

// Runs of the cell order that follow each other join, so a view's runs are at most one per pair
// of cells, and one for the moving sources.
const _: () = assert!(sizes::MAX_CULL_RANGES == MAX_CELLS / 2 + 1);

/// A view's culling buffers that grow with the layout: their sizes, 0 before they exist. And the
/// workgroups of its culling dispatch in the frame being recorded.
/// Also the runs of the cell order that it culls in that frame, as its parameters hold them, and
/// whether it culls in two phases.
#[derive(Clone, Debug)]
struct ViewBuffers {
    visible: u32,
    indirect: u32,
    occlusion: bool,
    groups: u32,
    ranges: Vec<[u32; 4]>,
    range_count: usize,
}

impl Default for ViewBuffers {
    fn default() -> Self {
        Self {
            visible: 0,
            indirect: 0,
            occlusion: false,
            groups: 0,
            ranges: vec![[0; 4]; sizes::MAX_CULL_RANGES as usize],
            range_count: 0,
        }
    }
}

/// The culling passes' GPU objects, and each view's buffers.
#[derive(Debug, Default)]
pub(super) struct Culling {
    /// Each view's buffers by view id, or `None` for a view whose buffers do not exist.
    views: Vec<Option<ViewBuffers>>,
    /// The offsets from the camera of the view being uploaded to each cell in use.
    offsets: CellOffsets,
    /// True once the placeholder of views without a pyramid exists.
    placeholder: bool,
    /// True when each view has an index group, for the pipelines that read their instances by
    /// index.
    index_instances: bool,
}

/// The buffers of a view's index group, one per binding.
const INDEX_BINDINGS: usize = 4;

/// How a view's culling dispatch culls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Phase {
    /// Once, against the frustum alone: shadow views, views without occlusion culling, and frames
    /// without marked occluders, which count into the second set of indirect draws.
    Once,
    /// The first phase of occlusion culling: the occluders.
    Early,
    /// The second phase of occlusion culling: every source against the pyramid.
    Late,
}

/// Records the creation of the culling pipeline.
pub(super) fn create_pipeline(list: &mut DrawList) -> Result<(), RecordError> {
    list.push(Op::CreateComputePipeline, &[ids::CULL, template::CULL, 0])?;
    Ok(())
}

/// The part of the render size's larger side that an occluder's bounds span at least. Smaller
/// objects hide few others, and drawing their depth would cost more than it saves.
const OCCLUDER_SPAN_DIVISOR: u32 = 16;

/// The occlusion phases' values in a view's culling parameters: the view-projection matrix for
/// positions relative to its camera, the render size, the pyramid's levels, the first phase's
/// draws and the word of the indirect draws' buffer where the history starts, after both phases'
/// draws, and an occluder's least span.
fn occlusion_words(frame: &ViewFrame, levels: &Levels, draws: u32) -> [u32; OCCLUSION_WORDS] {
    let mut words = [0u32; OCCLUSION_WORDS];
    for (word, value) in words.iter_mut().zip(frame.uniform.view_proj) {
        *word = value.to_bits();
    }
    let (width, height) = levels.render;
    words[16] = (width as f32).to_bits();
    words[17] = (height as f32).to_bits();
    words[20] = levels.count;
    words[21] = draws;
    words[22] = 2 * draws * sizes::INDIRECT_WORDS;
    words[23] = width.max(height).div_ceil(OCCLUDER_SPAN_DIVISOR);
    words
}

impl Culling {
    /// The culling passes, with an index group for each view with `index_instances`.
    pub(super) fn new(index_instances: bool) -> Self {
        Self {
            index_instances,
            ..Self::default()
        }
    }

    /// True when a view culls in two phases.
    pub(super) fn occludes(&self, view: ViewId) -> bool {
        self.views
            .get(view.index())
            .is_some_and(|buffers| buffers.as_ref().is_some_and(|b| b.occlusion))
    }

    /// True when a view's culling buffers exist.
    pub(super) fn has_view(&self, view: ViewId) -> bool {
        self.views.get(view.index()).is_some_and(Option::is_some)
    }

    /// Creates a view's parameter buffer, unless it exists.
    pub(super) fn add_view(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
    ) -> Result<(), RecordError> {
        if self.has_view(view) {
            return Ok(());
        }
        if !self.placeholder {
            list.push(
                Op::CreateBuffer,
                &[ids::NO_PYRAMID, NO_PYRAMID_BYTES, usage::STORAGE],
            )?;
            self.placeholder = true;
        }
        list.push(
            Op::CreateBuffer,
            &[
                ids::cull_params(view),
                CULL_PARAMS_BYTES,
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        if self.views.len() <= view.index() {
            self.views.resize(view.index() + 1, None);
        }
        self.views[view.index()] = Some(ViewBuffers::default());
        Ok(())
    }

    /// Sizes a view's compacted instance and indirect buffers for the layout, at most
    /// `binding_bytes` each, and binds its culling group again when a buffer it binds is new:
    /// one of its own, or one that `shared_recreated` names, of the layouts or the pyramid. The
    /// group binds the layout's bucket tables beside the scene's matrices and layer table. With
    /// `occlusion`, the view culls in two phases: it has twice the indirect draws with its history
    /// after them, and a group of the occlusion layout, which binds its pyramid too.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        shared_recreated: bool,
        binding_bytes: u32,
        occlusion: bool,
    ) -> Result<(), RecordError> {
        let buffers = self.views[view.index()]
            .as_mut()
            .expect("a view's buffers exist before it culls");
        let (phases, history) = if occlusion {
            (2, layout.sources)
        } else {
            (1, 0)
        };
        let draws = layout.draws.len() as u32 * phases;
        let mut recreated = shared_recreated || buffers.occlusion != occlusion;
        buffers.occlusion = occlusion;
        let needed = [
            (
                ids::visible(view),
                &mut buffers.visible,
                layout.compacted_bytes(),
                usage::VERTEX | usage::STORAGE,
            ),
            (
                ids::indirect(view),
                &mut buffers.indirect,
                draws.max(1) * INDIRECT_BYTES + history * 4,
                usage::INDIRECT | usage::STORAGE | usage::COPY_DST,
            ),
        ];
        for (id, made, size, flags) in needed {
            if *made < size {
                *made = grown_size(size, binding_bytes);
                list.push(Op::CreateBuffer, &[id, *made, flags])?;
                recreated = true;
            }
        }
        if recreated {
            let mut entries = [0u32; CULL_GROUP_WORDS];
            entries[..3].copy_from_slice(&[
                ids::cull_group(view),
                bind_layout::CULL,
                CULL_BINDINGS as u32,
            ]);
            let (bucket_table, bucket_records) = layout.table_ids();
            let pyramid = if occlusion {
                ids::pyramid(view)
            } else {
                ids::NO_PYRAMID
            };
            let buffers = [
                ids::cull_params(view),
                ids::MATRICES,
                bucket_table,
                bucket_records,
                ids::visible(view),
                ids::indirect(view),
                ids::SOURCE_LAYERS,
                ids::ORDER,
                pyramid,
            ];
            for (binding, &buffer) in buffers.iter().enumerate() {
                let at = 3 + binding * 5;
                entries[at..at + 5].copy_from_slice(&[
                    binding as u32,
                    resource_kind::BUFFER,
                    buffer,
                    0,
                    0,
                ]);
            }
            list.push(Op::CreateBindGroup, &entries)?;
            if self.index_instances {
                let mut entries = [0u32; 3 + INDEX_BINDINGS * 5];
                entries[..3].copy_from_slice(&[
                    ids::index_group(view),
                    bind_layout::INSTANCE_INDEX,
                    INDEX_BINDINGS as u32,
                ]);
                let buffers = [
                    ids::cull_params(view),
                    ids::MATRICES,
                    bucket_table,
                    bucket_records,
                ];
                for (binding, buffer) in buffers.into_iter().enumerate() {
                    let at = 3 + binding * 5;
                    entries[at..at + 5].copy_from_slice(&[
                        binding as u32,
                        resource_kind::BUFFER,
                        buffer,
                        0,
                        0,
                    ]);
                }
                list.push(Op::CreateBindGroup, &entries)?;
            }
        }
        Ok(())
    }

    /// Uploads a view's culling parameters: its frustum's planes, the source count, its layer
    /// mask, the offset from its camera to each cell in use in `scene`, and, while `cells` culls by
    /// cell, the runs of the cell order of the cells it can see. `sources` is the scene's layout,
    /// whose sources and cell order every view culls, and `drawn` the layout whose buckets the
    /// view draws. Resets its indirect draws' instance counts to zero, and notes the workgroups of
    /// its dispatch. A view that culls in two phases gets `pyramid`'s levels too, the values its
    /// late dispatch reads, and both sets of its indirect draws reset.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        frame: &ViewFrame,
        sources: &Layout,
        drawn: &Layout,
        scene: &SceneStorage,
        cells: &CellCulling,
        pyramid: Option<&Levels>,
    ) -> Result<(), RecordError> {
        let mut params = [0u32; (CULL_PLANES_BYTES / 4) as usize];
        for (plane, out) in frame.frustum.planes().iter().zip(params.chunks_mut(4)) {
            for (value, word) in plane.iter().zip(out) {
                *word = value.to_bits();
            }
        }
        params[SOURCES_WORD] = sources.sources;
        params[LAYERS_WORD] = frame.layers;
        self.offsets.update(scene, &frame.camera);
        let buffers = self.views[view.index()]
            .as_mut()
            .expect("a view's buffers exist before it culls");
        let (ranges, groups) = if cells.active() {
            let visible: CellMask = cells.visible(&frame.frustum, self.offsets.as_slice());
            sources.ranges(&visible, &mut buffers.ranges)
        } else {
            (0, sources.sources.div_ceil(sizes::CULL_WORKGROUP_SIZE))
        };
        params[RANGES_WORD] = ranges as u32;
        (buffers.groups, buffers.range_count) = (groups, ranges);
        // The planes fill whole words, so the arena lays the offsets right after them, as the
        // parameters hold them, and one write carries both.
        let (at, planes) = arena.push(words_as_bytes(&params))?;
        let (_, offsets) = arena.push(self.offsets.as_bytes())?;
        let params_id = ids::cull_params(view);
        list.push(Op::WriteBuffer, &[params_id, 0, at, planes + offsets])?;
        if ranges > 0 {
            let words = buffers.ranges[..ranges].as_flattened();
            let (at, bytes) = arena.push(words_as_bytes(words))?;
            list.push(Op::WriteBuffer, &[params_id, RANGES_OFFSET, at, bytes])?;
        }
        if let (Some(levels), true) = (pyramid, buffers.occlusion) {
            let words = occlusion_words(frame, levels, drawn.draws.len() as u32);
            let (at, bytes) = arena.push(words_as_bytes(&words))?;
            list.push(Op::WriteBuffer, &[params_id, OCCLUSION_OFFSET, at, bytes])?;
        }
        if !drawn.draws.is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(&drawn.indirect_template))?;
            list.push(Op::WriteBuffer, &[ids::indirect(view), 0, at, bytes])?;
            if buffers.occlusion {
                list.push(Op::WriteBuffer, &[ids::indirect(view), bytes, at, bytes])?;
            }
        }
        Ok(())
    }

    /// The offsets from the camera of the view uploaded last to each cell in use.
    pub(super) fn offsets(&self) -> &CellOffsets {
        &self.offsets
    }

    /// The runs of the cell order that a view's culling pass covers in the last recorded frame,
    /// each its first position and its end, or `None` when it covers every source in place.
    pub(super) fn ranges(&self, view: ViewId) -> Option<impl Iterator<Item = (u32, u32)> + '_> {
        let buffers = self.views.get(view.index())?.as_ref()?;
        (buffers.range_count > 0 || buffers.groups == 0).then(|| {
            buffers.ranges[..buffers.range_count]
                .iter()
                .map(|&[start, end, _, _]| (start, end))
        })
    }

    /// Records a view's culling dispatch for `phase`, or nothing when no bucket draws or no
    /// source is in a cell the view can see.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        phase: Phase,
    ) -> Result<(), RecordError> {
        let groups = self.views[view.index()]
            .as_ref()
            .map_or(0, |buffers| buffers.groups);
        if layout.buckets.is_empty() || groups == 0 {
            return Ok(());
        }
        let pipeline = match phase {
            Phase::Once => ids::CULL,
            Phase::Early => ids::OCCLUSION_EARLY,
            Phase::Late => ids::OCCLUSION_LATE,
        };
        list.push(Op::SetComputePipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, ids::cull_group(view), 0])?;
        list.push(Op::Dispatch, &[groups, 1, 1])?;
        Ok(())
    }

    /// Forgets every view's buffers, so each is made again, after the thread that draws replaced
    /// the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.views.clear();
        self.placeholder = false;
    }
}
