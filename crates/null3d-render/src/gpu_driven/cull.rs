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
//! A view's planes are relative to its camera. The offset from its camera to each cell in use goes
//! into the view's row of the cell offsets texture, and its parameters name the row. The shader
//! adds a source's offset to its matrix before it tests the source, and copies the moved matrix
//! into the compacted instance buffer, so the vertex shader draws positions relative to the view's
//! camera. Each thread reads its own cell's texel: a table in the uniform parameters gave every
//! thread of a group one thread's entry on the Galaxy S25 (Adreno 830).
//!
//! When the scene's sources lie in more than one grid cell, the CPU first finds the cells whose
//! still sources a view can see (see [`crate::cells`]). The view's parameters then hold the runs of
//! the cell order that it culls: the visible cells' runs and the moving sources' run. Its dispatch
//! covers those runs alone, and each workgroup finds its run and reads its sources' places from
//! the cell order. Otherwise the dispatch covers every source in place.

use null3d_core::cells::MAX_CELLS;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, sizes,
    template, texture_usage, view,
};

use super::ids;
use super::layout::Layout;
use crate::cells::{CellCulling, CellMask};
use crate::frame::{CellOffsets, RecordError, UploadArena, grown_size, words_as_bytes};
use crate::view::{MAX_VIEW_IDS, ViewFrame, ViewId};

/// Bytes of the culling planes: six planes, the source count, the view's layer mask, the count of
/// runs of the cell order, and the view's row of the cell offsets texture.
const CULL_PLANES_BYTES: u32 = 112;
/// The words of the culling planes that hold the source count, the view's layer mask, the count
/// of runs and the view's row of offsets.
const SOURCES_WORD: usize = 24;
const LAYERS_WORD: usize = 25;
const RANGES_WORD: usize = 26;
const OFFSETS_ROW_WORD: usize = 27;
/// Where the runs of the cell order start in the culling parameters: after the planes.
const RANGES_OFFSET: u32 = CULL_PLANES_BYTES;
/// Bytes of one run of the cell order: its first position, its end, its first workgroup, and
/// padding.
const RANGE_BYTES: u32 = 16;
/// Bytes of the culling parameters: the planes, then the runs of the cell order.
pub(super) const CULL_PARAMS_BYTES: u32 = RANGES_OFFSET + sizes::MAX_CULL_RANGES * RANGE_BYTES;
/// Bytes of one indexed indirect draw.
pub(super) const INDIRECT_BYTES: u32 = sizes::INDIRECT_WORDS * 4;
/// The buffers of the culling pass's bind group, one per binding, then the cell offsets texture.
const CULL_BINDINGS: usize = 9;
/// Words of the culling pass's bind group entries: three for the group, five per entry.
const CULL_GROUP_WORDS: usize = 3 + CULL_BINDINGS * 5;

// Runs of the cell order that follow each other join, so a view's runs are at most one per pair
// of cells, and one for the moving sources.
const _: () = assert!(sizes::MAX_CULL_RANGES == MAX_CELLS / 2 + 1);

/// A view's culling buffers that grow with the layout: their sizes, 0 before they exist. And the
/// workgroups of its culling dispatch in the frame being recorded.
/// Also the runs of the cell order that it culls in that frame, as its parameters hold them.
#[derive(Clone, Debug)]
struct ViewBuffers {
    visible: u32,
    indirect: u32,
    groups: u32,
    ranges: Vec<[u32; 4]>,
    range_count: usize,
}

impl Default for ViewBuffers {
    fn default() -> Self {
        Self {
            visible: 0,
            indirect: 0,
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
    /// True once the cell offsets texture exists.
    offsets_made: bool,
}

/// Records the creation of the culling pipeline.
pub(super) fn create_pipeline(list: &mut DrawList) -> Result<(), RecordError> {
    list.push(Op::CreateComputePipeline, &[ids::CULL, template::CULL, 0])?;
    Ok(())
}

impl Culling {
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
        if !self.offsets_made {
            list.push(
                Op::CreateTexture,
                &[
                    ids::CELL_OFFSETS,
                    MAX_CELLS,
                    MAX_VIEW_IDS as u32,
                    1,
                    format::RGBA32_FLOAT,
                    texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                    1,
                    1,
                    view::D2,
                ],
            )?;
            self.offsets_made = true;
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
    /// one of its own, or one of the layouts' (`shared_recreated`). The group binds the layout's
    /// bucket tables beside the scene's matrices and layer table.
    pub(super) fn apply(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        shared_recreated: bool,
        binding_bytes: u32,
    ) -> Result<(), RecordError> {
        let buffers = self.views[view.index()]
            .as_mut()
            .expect("a view's buffers exist before it culls");
        let draws = layout.draws.len() as u32;
        let needed = [
            (
                ids::visible(view),
                &mut buffers.visible,
                layout.drawable().max(1) * sizes::INSTANCE_STRIDE,
                usage::VERTEX | usage::STORAGE,
            ),
            (
                ids::indirect(view),
                &mut buffers.indirect,
                draws.max(1) * INDIRECT_BYTES,
                usage::INDIRECT | usage::STORAGE | usage::COPY_DST,
            ),
        ];
        let mut recreated = shared_recreated;
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
            for (binding, buffer) in [
                ids::cull_params(view),
                ids::MATRICES,
                bucket_table,
                bucket_records,
                ids::visible(view),
                ids::indirect(view),
                ids::SOURCE_LAYERS,
                ids::ORDER,
            ]
            .into_iter()
            .enumerate()
            {
                let at = 3 + binding * 5;
                entries[at..at + 5].copy_from_slice(&[
                    binding as u32,
                    resource_kind::BUFFER,
                    buffer,
                    0,
                    0,
                ]);
            }
            let at = 3 + (CULL_BINDINGS - 1) * 5;
            entries[at..at + 5].copy_from_slice(&[
                CULL_BINDINGS as u32 - 1,
                resource_kind::TEXTURE,
                ids::CELL_OFFSETS,
                0,
                0,
            ]);
            list.push(Op::CreateBindGroup, &entries)?;
        }
        Ok(())
    }

    /// Uploads a view's culling parameters: its frustum's planes, the source count, its layer
    /// mask, the offset from its camera to each cell in use in `scene`, and, while `cells` culls by
    /// cell, the runs of the cell order of the cells it can see. `sources` is the scene's layout,
    /// whose sources and cell order every view culls, and `drawn` the layout whose buckets the
    /// view draws. Resets its indirect draws' instance counts to zero, and notes the workgroups of
    /// its dispatch.
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
        params[OFFSETS_ROW_WORD] = view.index() as u32;
        (buffers.groups, buffers.range_count) = (groups, ranges);
        let (at, planes) = arena.push(words_as_bytes(&params))?;
        let params_id = ids::cull_params(view);
        list.push(Op::WriteBuffer, &[params_id, 0, at, planes])?;
        let cells = self.offsets.as_slice().len() as u32;
        if cells > 0 {
            let (at, bytes) = arena.push(self.offsets.as_bytes())?;
            list.push(
                Op::WriteTexture,
                &[
                    ids::CELL_OFFSETS,
                    0,
                    0,
                    view.index() as u32,
                    0,
                    cells,
                    1,
                    1,
                    at,
                    bytes,
                ],
            )?;
        }
        if ranges > 0 {
            let words = buffers.ranges[..ranges].as_flattened();
            let (at, bytes) = arena.push(words_as_bytes(words))?;
            list.push(Op::WriteBuffer, &[params_id, RANGES_OFFSET, at, bytes])?;
        }
        if !drawn.draws.is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(&drawn.indirect_template))?;
            list.push(Op::WriteBuffer, &[ids::indirect(view), 0, at, bytes])?;
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

    /// Records a view's culling dispatch, or nothing when no bucket draws or no source is in a
    /// cell the view can see.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        let groups = self.views[view.index()]
            .as_ref()
            .map_or(0, |buffers| buffers.groups);
        if layout.buckets.is_empty() || groups == 0 {
            return Ok(());
        }
        list.push(Op::SetComputePipeline, &[ids::CULL])?;
        list.push(Op::SetBindGroup, &[0, ids::cull_group(view), 0])?;
        list.push(Op::Dispatch, &[groups, 1, 1])?;
        Ok(())
    }

    /// Forgets every view's buffers, so each is made again, after the thread that draws replaced
    /// the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.views.clear();
        self.offsets_made = false;
    }
}
