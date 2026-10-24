//! The camera-relative conversion of a feature-instance draw's rows (D-229). The API takes world
//! matrices, and the engine's vertex shaders read an instance matrix relative to the view's
//! camera, as the culling shader's compacted rows are. One compute dispatch for each draw in each
//! frame subtracts the camera's world position from the translation of each live row, into a
//! buffer that the draw reads. The page and the add-on's compute keep filling the world rows, so
//! a camera that moves costs no upload.
//!
//! A frame without a feature-instance draw records nothing here: it makes no buffer, no pipeline
//! and no dispatch. A frame with one pays one compute pass, one dispatch for each draw, and one
//! write of the camera's position when the camera moved.
//!
//! The conversion runs after every compute step and before the first render step, which is the
//! place the render graph reserves for a buffer that a compute pass writes and a later pass reads
//! (see [`crate::frame_graph`]).

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, layout as bind_layout, resource_kind, template,
};

use crate::feature_instances::{COUNT_BYTES, FeatureInstanceTable, INSTANCE_BYTES};
use crate::frame::{RecordError, UploadArena, floats_as_bytes};

use super::ids;

/// Bytes of the conversion's block: the camera's absolute world position.
const BLOCK_BYTES: u32 = 16;

/// The conversion shader's workgroup size: one invocation for each instance's row.
const WORKGROUP: u32 = 64;

/// What one draw's group binds, as the ids of its three buffers and the bytes of its rows. A group
/// is made again when the draw's capacity changed, which changes the rows' bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bound {
    counts: u32,
    world: u32,
    relative: u32,
    bytes: u32,
}

/// The conversion's GPU objects and what the GPU holds of them.
#[derive(Debug, Default)]
pub(super) struct FeatureRows {
    /// True when the frame made the conversion's pipeline.
    made: bool,
    /// The camera that the block holds, or `None` before the block's buffer or its upload.
    uploaded: Option<[f32; 4]>,
    /// What each draw's group binds, by id from 1, or `None` before the group exists.
    bound: Vec<Option<Bound>>,
}

impl FeatureRows {
    /// Bytes a frame may copy into its arena for the conversion: the camera's position.
    pub(super) const UPLOAD_BYTES: usize = BLOCK_BYTES as usize;

    /// Records the conversion's pipeline when the frame first holds a feature-instance draw. It is
    /// one of the frame's first commands, so the thread that draws builds it before it replays the
    /// rest. Returns true when the frame created it.
    pub(super) fn request_pipeline(
        &mut self,
        list: &mut DrawList,
        table: &FeatureInstanceTable,
    ) -> Result<bool, RecordError> {
        if self.made || table.is_empty() {
            return Ok(false);
        }
        list.push(
            Op::CreateComputePipeline,
            &[ids::FEATURE_ROWS, template::FEATURE_ROWS, 0],
        )?;
        self.made = true;
        Ok(true)
    }

    /// Makes the conversion's block when the frame first holds a feature-instance draw, uploads
    /// the camera's world position when it moved, and binds each draw's group. The buffers of the
    /// draws exist before this runs (see [`super::GpuDrivenRenderer`]).
    pub(super) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        table: &FeatureInstanceTable,
        camera: [f32; 4],
    ) -> Result<(), RecordError> {
        if table.is_empty() {
            return Ok(());
        }
        if self.uploaded.is_none() {
            list.push(
                Op::CreateBuffer,
                &[
                    ids::FEATURE_ROWS_BLOCK,
                    BLOCK_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
        }
        if self.uploaded != Some(camera) {
            let (at, bytes) = arena.push(floats_as_bytes(&camera))?;
            list.push(Op::WriteBuffer, &[ids::FEATURE_ROWS_BLOCK, 0, at, bytes])?;
            self.uploaded = Some(camera);
        }
        for (id, (_, capacity, _)) in table.iter() {
            let bound = Bound {
                counts: ids::feature_count(id),
                world: ids::feature_instances(id),
                relative: ids::feature_relative(id),
                bytes: capacity * INSTANCE_BYTES,
            };
            let at = id as usize - 1;
            if self.bound.len() <= at {
                self.bound.resize(at + 1, None);
            }
            if self.bound[at] == Some(bound) {
                continue;
            }
            let words = [
                ids::feature_rows_group(id),
                bind_layout::FEATURE_ROWS,
                4,
                0,
                resource_kind::BUFFER,
                ids::FEATURE_ROWS_BLOCK,
                0,
                BLOCK_BYTES,
                1,
                resource_kind::BUFFER,
                bound.counts,
                0,
                COUNT_BYTES,
                2,
                resource_kind::BUFFER,
                bound.world,
                0,
                bound.bytes,
                3,
                resource_kind::BUFFER,
                bound.relative,
                0,
                bound.bytes,
            ];
            list.push(Op::CreateBindGroup, &words)?;
            self.bound[at] = Some(bound);
        }
        Ok(())
    }

    /// Records the conversion's dispatches in one compute pass, once the graph reaches the first
    /// render step: one dispatch for each live draw, over its whole capacity, which its count word
    /// bounds inside the shader.
    pub(super) fn record(
        &self,
        list: &mut DrawList,
        table: &FeatureInstanceTable,
    ) -> Result<(), RecordError> {
        if !self.made {
            return Ok(());
        }
        let mut begun = false;
        for (id, (_, capacity, _)) in table.iter() {
            let at = id as usize - 1;
            if self.bound.get(at).copied().flatten().is_none() {
                continue;
            }
            if !begun {
                list.push(Op::BeginComputePass, &[])?;
                list.push(Op::SetComputePipeline, &[ids::FEATURE_ROWS])?;
                begun = true;
            }
            list.push(Op::SetBindGroup, &[0, ids::feature_rows_group(id), 0])?;
            list.push(Op::Dispatch, &[capacity.div_ceil(WORKGROUP), 1, 1])?;
        }
        if begun {
            list.push(Op::EndComputePass, &[])?;
        }
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU.
    pub(super) fn reset_gpu(&mut self) {
        self.made = false;
        self.uploaded = None;
        self.bound.clear();
    }
}
