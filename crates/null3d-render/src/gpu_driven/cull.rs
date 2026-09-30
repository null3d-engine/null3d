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

use null3d_core::cells::MAX_CELLS;
use null3d_core::scene::SceneStorage;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, sizes, template,
};

use super::ids;
use super::layout::Layout;
use crate::frame::{
    CELL_OFFSET_BYTES, CellOffsets, RecordError, UploadArena, grown_size, words_as_bytes,
};
use crate::view::{ViewFrame, ViewId};

/// Bytes of the culling planes: six planes, the source count, the view's layer mask and padding.
const CULL_PLANES_BYTES: u32 = 112;
/// The word of the culling parameters that holds the source count, and the one after it, the
/// view's layer mask.
const SOURCES_WORD: usize = 24;
const LAYERS_WORD: usize = 25;
/// Bytes of the culling parameters: the planes, then the offset from the camera to each cell.
pub(super) const CULL_PARAMS_BYTES: u32 = CULL_PLANES_BYTES + MAX_CELLS * CELL_OFFSET_BYTES;
/// Bytes of one indexed indirect draw.
pub(super) const INDIRECT_BYTES: u32 = sizes::INDIRECT_WORDS * 4;
/// The buffers of the culling pass's bind group.
const CULL_BINDINGS: usize = 7;
/// Words of the culling pass's bind group entries: three for the group, five per buffer.
const CULL_GROUP_WORDS: usize = 3 + CULL_BINDINGS * 5;

/// A view's culling buffers that grow with the layout: their sizes, 0 before they exist.
#[derive(Clone, Copy, Debug, Default)]
struct ViewBuffers {
    visible: u32,
    indirect: u32,
}

/// The culling passes' GPU objects, and each view's buffers.
#[derive(Debug, Default)]
pub(super) struct Culling {
    /// Each view's buffers by view id, or `None` for a view whose buffers do not exist.
    views: Vec<Option<ViewBuffers>>,
    /// The offsets from the camera of the view being uploaded to each cell in use.
    offsets: CellOffsets,
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
            list.push(Op::CreateBindGroup, &entries)?;
        }
        Ok(())
    }

    /// Uploads a view's culling parameters: its frustum's planes, the source count, its layer mask,
    /// and the offset from its camera to each cell in use in `scene`. Resets its indirect draws' instance counts
    /// to zero.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        frame: &ViewFrame,
        layout: &Layout,
        scene: &SceneStorage,
    ) -> Result<(), RecordError> {
        let mut params = [0u32; (CULL_PLANES_BYTES / 4) as usize];
        for (plane, out) in frame.frustum.planes().iter().zip(params.chunks_mut(4)) {
            for (value, word) in plane.iter().zip(out) {
                *word = value.to_bits();
            }
        }
        params[SOURCES_WORD] = layout.sources;
        params[LAYERS_WORD] = frame.layers;
        self.offsets.update(scene, &frame.camera);
        // The planes fill whole words, so the arena lays the offsets right after them, as the
        // parameters hold them, and one write carries both.
        let (at, planes) = arena.push(words_as_bytes(&params))?;
        let (_, offsets) = arena.push(self.offsets.as_bytes())?;
        list.push(
            Op::WriteBuffer,
            &[ids::cull_params(view), 0, at, planes + offsets],
        )?;
        if !layout.draws.is_empty() {
            let (at, bytes) = arena.push(words_as_bytes(&layout.indirect_template))?;
            list.push(Op::WriteBuffer, &[ids::indirect(view), 0, at, bytes])?;
        }
        Ok(())
    }

    /// Records a view's culling dispatch, or nothing when no bucket draws.
    pub(super) fn record(
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
    ) -> Result<(), RecordError> {
        if layout.buckets.is_empty() {
            return Ok(());
        }
        list.push(Op::SetComputePipeline, &[ids::CULL])?;
        list.push(Op::SetBindGroup, &[0, ids::cull_group(view), 0])?;
        let groups = layout.sources.div_ceil(sizes::CULL_WORKGROUP_SIZE);
        list.push(Op::Dispatch, &[groups, 1, 1])?;
        Ok(())
    }

    /// Forgets every view's buffers, so each is made again, after the thread that draws replaced
    /// the GPU.
    pub(super) fn forget_gpu(&mut self) {
        self.views.clear();
    }
}
