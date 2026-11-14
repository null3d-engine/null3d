//! The light clusters' depth reduction: one compute dispatch per camera view, after its opaque
//! pass, that reads the view's depth and writes the nearest and farthest depths it sampled into
//! one small buffer. The next frame's light clustering fits its slices to them, so a cluster covers
//! a smaller part of the view's depth and lists fewer lights.
//!
//! The depth is read as a float texture: one sample per pixel, or a multisampled target whose
//! sample 0 the reduction reads. The engine's ambient occlusion has the same two builds.
//!
//! The reduction covers blocks of [`BLOCK`] texels each way, one block for each thread. Its
//! dispatch reads the block counts from a small uniform block of the camera view's, which one
//! upload writes when the render size changes. The pass costs one dispatch and one bind group per
//! view. Its output, the nearest and farthest reversed depth, is one buffer that the next frame's
//! light clustering reads, and the frame zeroes before this dispatch fills it.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, template,
};

use super::ids;
use crate::frame::{RecordError, UploadArena, words_as_bytes};
use crate::view::{MAX_VIEWS, ViewId};

/// Bytes of the blocks' uniform block: the blocks across and up, then two zeros.
const PARAMS_BYTES: u32 = 16;
/// Threads per workgroup, each one block.
const WORKGROUP_SIZE: u32 = 64;
/// The texels each way that one thread's block holds.
const BLOCK: u32 = 4;

/// What the pass holds for one camera view.
#[derive(Clone, Copy, Debug, Default)]
struct ViewFit {
    /// True once the view's uniform buffer exists.
    made: bool,
    /// The depth target that the view's bind group names, or 0 before one is made.
    bound_depth: u32,
    /// The blocks across and up that the uniform holds, or zero before the first upload.
    blocks: (u32, u32),
}

/// The light clusters' depth reduction, one group and buffer for each camera view.
#[derive(Debug, Default)]
pub(super) struct LightDepths {
    views: [ViewFit; MAX_VIEWS],
    /// True once the pass's two pipelines exist.
    pipelines: bool,
    /// True once the reduction's buffer exists.
    buffer: bool,
}

impl LightDepths {
    /// Records the creation of the pass's pipelines: for a depth target of one sample, and for a
    /// multisampled one. Returns true when it recorded them.
    pub(super) fn create_pipelines(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        if self.pipelines {
            return Ok(false);
        }
        for (id, template) in [
            (ids::LIGHT_DEPTH_CLEAR, template::LIGHT_DEPTH_CLEAR),
            (ids::LIGHT_DEPTH_CLEAR_MS, template::LIGHT_DEPTH_CLEAR_MS),
            (ids::LIGHT_DEPTH, template::LIGHT_DEPTH),
            (ids::LIGHT_DEPTH_MS, template::LIGHT_DEPTH_MS),
        ] {
            list.push(Op::CreateComputePipeline, &[id, template, 0])?;
        }
        self.pipelines = true;
        Ok(true)
    }

    /// Records the reduction's buffer, which the light clusters' groups bind too: two words, the
    /// nearest and the farthest depth. After the frame's pipelines, whose creations come first.
    pub(super) fn create_buffer(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        if self.buffer {
            return Ok(());
        }
        list.push(Op::CreateBuffer, &[ids::LIGHT_REDUCTION, 8, usage::STORAGE])?;
        self.buffer = true;
        Ok(())
    }

    /// Makes a view's uniform buffer, and its bind group over the view's depth target and the
    /// reduction, when they are new or name another depth.
    pub(super) fn prepare(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        depth: u32,
        multisampled: bool,
        remade: bool,
    ) -> Result<(), RecordError> {
        let fit = &mut self.views[view.index()];
        if !fit.made {
            list.push(
                Op::CreateBuffer,
                &[
                    ids::light_depth_params(view),
                    PARAMS_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            fit.made = true;
        }
        if fit.bound_depth == depth && !remade {
            return Ok(());
        }
        let entry = |binding: u32, kind: u32, id: u32, size: u32| [binding, kind, id, 0, size];
        let entries = [
            entry(
                0,
                resource_kind::BUFFER,
                ids::light_depth_params(view),
                PARAMS_BYTES,
            ),
            entry(1, resource_kind::BUFFER, ids::LIGHT_REDUCTION, 0),
            entry(2, resource_kind::TEXTURE, depth, 0),
        ];
        let layout = if multisampled {
            bind_layout::LIGHT_DEPTH_MS
        } else {
            bind_layout::LIGHT_DEPTH
        };
        let mut words = [0u32; 3 + 5 * 3];
        words[..3].copy_from_slice(&[ids::light_depth_group(view), layout, 3]);
        words[3..].copy_from_slice(entries.as_flattened());
        list.push(Op::CreateBindGroup, &words)?;
        fit.bound_depth = depth;
        Ok(())
    }

    /// Writes a view's block counts for a render size, when they changed.
    pub(super) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        view: ViewId,
        render: (u32, u32),
    ) -> Result<(), RecordError> {
        let fit = &mut self.views[view.index()];
        let blocks = (render.0.div_ceil(BLOCK), render.1.div_ceil(BLOCK));
        if fit.blocks == blocks {
            return Ok(());
        }
        let (at, bytes) = arena.push(words_as_bytes(&[blocks.0, blocks.1, 0, 0]))?;
        list.push(
            Op::WriteBuffer,
            &[ids::light_depth_params(view), 0, at, bytes],
        )?;
        fit.blocks = blocks;
        Ok(())
    }

    /// Records the dispatch that reduces a view's depth, when its blocks are known.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        multisampled: bool,
    ) -> Result<(), RecordError> {
        let fit = &self.views[view.index()];
        if fit.blocks == (0, 0) || fit.bound_depth == 0 {
            return Ok(());
        }
        let (clear, reduce) = if multisampled {
            (ids::LIGHT_DEPTH_CLEAR_MS, ids::LIGHT_DEPTH_MS)
        } else {
            (ids::LIGHT_DEPTH_CLEAR, ids::LIGHT_DEPTH)
        };
        list.push(Op::SetBindGroup, &[0, ids::light_depth_group(view), 0, 0])?;
        list.push(Op::SetComputePipeline, &[clear])?;
        list.push(Op::Dispatch, &[1, 1, 1])?;
        list.push(Op::SetComputePipeline, &[reduce])?;
        list.push(
            Op::Dispatch,
            &[fit.blocks.0.div_ceil(WORKGROUP_SIZE), fit.blocks.1, 1],
        )?;
        Ok(())
    }

    /// Bytes that one frame may copy into its arena for every view's block counts.
    pub(super) const UPLOAD_BYTES: usize = PARAMS_BYTES as usize * MAX_VIEWS;

    /// Forgets every GPU object, after the thread that draws replaced the GPU: the pipelines, the
    /// reduction, and each view's uniform buffer and group.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A replaced GPU forgets each uniform buffer and group, so the frame that follows makes them
    /// again instead of binding a buffer that the new device lacks.
    #[test]
    fn a_new_gpu_makes_every_buffer_again() {
        let mut depths = LightDepths::default();
        let mut list = DrawList::with_capacity(128);
        depths.create_buffer(&mut list).unwrap();
        depths
            .prepare(&mut list, ViewId::CAMERA, 7, false, false)
            .unwrap();
        let camera = &depths.views[ViewId::CAMERA.index()];
        assert!(depths.buffer && camera.made && camera.bound_depth == 7);
        depths.forget_gpu();
        assert!(!depths.buffer && !depths.pipelines);
        assert!(!depths.views[ViewId::CAMERA.index()].made);
        depths.create_buffer(&mut list).unwrap();
        assert!(depths.buffer);
    }
}
