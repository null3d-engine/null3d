//! Compute passes of the render graph: the sketch's WGSL, run as a compute pipeline that fills the
//! whole target of a view of its own (see [`crate::view::Compute`]). The target is a storage
//! texture, and the render graph keeps it from frame to frame. Materials, effects and other passes
//! sample it in the same frame, and the graph orders the pass before every one that reads it.
//!
//! A pass binds its block of the uniform buffer and its target in group 0, then its own textures
//! in group 1, as a custom effect does. Its block holds what an effect's block holds, so a shader
//! reads the render size, the target size, the clock, the camera and its own values.
//!
//! Each view's block uploads only when it changed, and each view's bind group is made again only
//! when what it binds changed, so passes that stay still record only their dispatches.
//!
//! Only WebGPU records these passes. WebGL2 has no compute shaders, so a page that draws there
//! runs a full-screen pass in place of each compute pass, or runs none.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::effects::{BLOCK, BLOCK_BYTES, Block, IDENTITY};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::view::{Compute, MAX_VIEWS};

/// The GPU objects of the compute passes, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ComputePassIds {
    /// The uniform buffer of every view's block.
    pub(crate) buffer: u32,
    /// Group 0 of each view's pass, from this id on, by the view's place.
    pub(crate) first_group: u32,
    /// The compute pipeline of each view's pass, from this id on, by the view's place.
    pub(crate) first_pipeline: u32,
}

/// Bytes of the uniform buffer: a block for each view.
const BUFFER_BYTES: usize = MAX_VIEWS * BLOCK;

/// The bind group layout of a compute pass's group 0 for the target format `target`, or for a pass
/// that writes the two buffers of an instance draw.
pub(crate) const fn layout_of(target: u32, buffers: bool) -> u32 {
    if buffers {
        return bind_layout::COMPUTE_INSTANCE_BUFFERS;
    }
    match target {
        format::R32_FLOAT => bind_layout::COMPUTE_R32_FLOAT,
        format::RGBA8_UNORM => bind_layout::COMPUTE_RGBA8_UNORM,
        _ => bind_layout::COMPUTE_RGBA16_FLOAT,
    }
}

/// The bit of a compute pipeline's format code that says the pass samples textures at group 1.
/// The GPU side reads the bit and gives the pipeline the materials' maps layout as well as its
/// target's layout.
pub(crate) const PIPELINE_MAPS_BIT: u32 = 1 << 8;

/// The format code that a compute pass's pipeline names for its bind group layouts: 0 for a pass
/// that fills an instance draw's two buffers, and its target's format otherwise. A pass that keeps
/// the default format writes rgba16float, which a code of 0 would also name, so the default is
/// written out. A pass that samples textures sets the maps bit, since its pipeline takes the maps
/// layout at group 1 and a pass without maps binds nothing there.
pub(crate) const fn pipeline_format(format: u32, buffers: bool, maps: bool) -> u32 {
    let base = if buffers {
        0
    } else if format == 0 {
        format::RGBA16_FLOAT
    } else {
        format
    };
    if maps { base | PIPELINE_MAPS_BIT } else { base }
}

/// What a compute pass's group 0 binds: the target's texture, the layout of its group 0 and the
/// target's size in texels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bound {
    target: u32,
    layout: u32,
    drawn: (u32, u32),
}

/// The passes' GPU objects and what the GPU holds of them, by view place.
#[derive(Debug)]
pub(crate) struct ComputePasses {
    ids: ComputePassIds,
    created: bool,
    /// The template that each view's pipeline was made for.
    pipelines: [Option<u32>; MAX_VIEWS],
    /// The block that each view's part of the buffer holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_VIEWS],
    /// What each view's group 0 binds, or `None` before the group exists.
    bound: [Option<Bound>; MAX_VIEWS],
}

impl ComputePasses {
    /// Bytes a frame may copy into its arena: every view's block.
    pub(crate) const UPLOAD_BYTES: usize = MAX_VIEWS * BLOCK_BYTES;

    /// The passes, with GPU objects from `ids`.
    pub(crate) fn new(ids: ComputePassIds) -> Self {
        Self {
            ids,
            created: false,
            pipelines: [None; MAX_VIEWS],
            uploaded: [None; MAX_VIEWS],
            bound: [None; MAX_VIEWS],
        }
    }

    /// Makes the buffer when the GPU lacks it, records the pipeline of the pass at view place
    /// `place` when its template changed, uploads its block when it changed, and binds it to its
    /// target in `target` when the group is new or the frame made the plan's textures again
    /// (`textures_made`). `drawn` is the pass's target size in texels, `canvas` the canvas's size
    /// and `scale` the render scale, `clock` the sketch time and the seconds since the frame
    /// before, and `inverse_projection` the inverse of the camera's projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (place, pass, target): (usize, &Compute, u32),
        drawn: (u32, u32),
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        if self.pipelines[place] != Some(pass.template) {
            list.push(
                Op::CreateComputePipeline,
                &[
                    ids.first_pipeline + place as u32,
                    pass.template,
                    pipeline_format(pass.format, pass.buffers.is_some(), pass.maps.any()),
                ],
            )?;
            self.pipelines[place] = Some(pass.template);
        }
        let render = Size::Full.viewport(canvas, scale);
        let (width, height) = (drawn.0.max(1) as f32, drawn.1.max(1) as f32);
        let block = Block {
            size: [
                render.0 as f32,
                render.1 as f32,
                canvas.0.max(1) as f32,
                canvas.1.max(1) as f32,
            ],
            clock: [clock[0], clock[1], 0.0, 0.0],
            inverse_projection: inverse_projection.unwrap_or(IDENTITY),
            values: pass.values,
            drawn: [width, height, height, 1.0],
            bloom: [0.0; 4],
        };
        if self.uploaded[place] != Some(block) {
            let (at, bytes) = arena.push(bytes_of(&block))?;
            let offset = (place * BLOCK) as u32;
            list.push(Op::WriteBuffer, &[ids.buffer, offset, at, bytes])?;
            self.uploaded[place] = Some(block);
        }
        let layout = layout_of(pass.format, pass.buffers.is_some());
        let bound = Bound {
            target,
            layout,
            drawn,
        };
        if !textures_made && self.bound[place] == Some(bound) {
            return Ok(());
        }
        match pass.buffers {
            // Group 0 of a pass that writes an instance draw: the pass's block, the draw's count
            // word and its per-instance rows.
            Some(buffers) => {
                let words = [
                    ids.first_group + place as u32,
                    layout,
                    3,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    (place * BLOCK) as u32,
                    BLOCK_BYTES as u32,
                    1,
                    resource_kind::BUFFER,
                    buffers.counts,
                    0,
                    crate::feature_instances::COUNT_BYTES,
                    2,
                    resource_kind::BUFFER,
                    buffers.instances,
                    0,
                    buffers.instances_bytes,
                ];
                list.push(Op::CreateBindGroup, &words)?;
            }
            // Group 0: the pass's block, then the storage texture that it fills.
            None => {
                let words = [
                    ids.first_group + place as u32,
                    layout,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    (place * BLOCK) as u32,
                    BLOCK_BYTES as u32,
                    1,
                    resource_kind::TEXTURE,
                    target,
                    0,
                    0,
                ];
                list.push(Op::CreateBindGroup, &words)?;
            }
        }
        self.bound[place] = Some(bound);
        Ok(())
    }

    /// Records the dispatch of the pass at view place `place` inside the compute pass that the
    /// render graph began. A pass without a pipeline or a bind group dispatches nothing, and its
    /// target keeps its last image.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        place: usize,
        pass: &Compute,
        drawn: (u32, u32),
    ) -> Result<(), RecordError> {
        if self.pipelines[place] != Some(pass.template) || self.bound[place].is_none() {
            return Ok(());
        }
        if pass.maps.any() {
            if pass.maps.group == 0 {
                return Ok(());
            }
            list.push(Op::SetBindGroup, &[1, pass.maps.group, 0])?;
        }
        list.push(
            Op::SetComputePipeline,
            &[self.ids.first_pipeline + place as u32],
        )?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + place as u32, 0],
        )?;
        let [x, y, z] = pass.workgroups(drawn);
        list.push(Op::Dispatch, &[x, y, z])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.pipelines = [None; MAX_VIEWS];
        self.uploaded = [None; MAX_VIEWS];
        self.bound = [None; MAX_VIEWS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pass_that_fills_buffers_takes_the_buffer_layout() {
        // A texture pass takes the layout of its target's format, and a pass that fills an
        // instance draw takes the buffer layout whatever its format field says.
        assert_eq!(
            layout_of(format::RGBA16_FLOAT, false),
            bind_layout::COMPUTE_RGBA16_FLOAT
        );
        assert_eq!(
            layout_of(format::R32_FLOAT, false),
            bind_layout::COMPUTE_R32_FLOAT
        );
        assert_eq!(
            layout_of(format::RGBA8_UNORM, false),
            bind_layout::COMPUTE_RGBA8_UNORM
        );
        assert_eq!(layout_of(0, true), bind_layout::COMPUTE_INSTANCE_BUFFERS);
        assert_eq!(
            layout_of(format::RGBA16_FLOAT, true),
            bind_layout::COMPUTE_INSTANCE_BUFFERS
        );
    }

    #[test]
    fn a_texture_pass_pipeline_names_its_format() {
        // The GPU side reads a format code of 0 as the instance buffers' layout, so a pass that
        // writes a texture names its format, and the default rgba16float as well.
        assert_eq!(pipeline_format(0, false, false), format::RGBA16_FLOAT);
        assert_eq!(
            pipeline_format(format::R32_FLOAT, false, false),
            format::R32_FLOAT
        );
        assert_eq!(
            pipeline_format(format::RGBA8_UNORM, false, false),
            format::RGBA8_UNORM
        );
        assert_eq!(pipeline_format(0, true, false), 0);
        assert_eq!(pipeline_format(format::RGBA16_FLOAT, true, false), 0);
    }

    #[test]
    fn a_pass_that_samples_textures_sets_the_maps_bit() {
        // A pass that samples textures takes the maps layout at group 1, and one without maps
        // binds nothing there, so its pipeline takes group 0 alone.
        assert_eq!(
            pipeline_format(format::RGBA16_FLOAT, false, true),
            format::RGBA16_FLOAT | PIPELINE_MAPS_BIT
        );
        assert_eq!(
            pipeline_format(0, true, true),
            PIPELINE_MAPS_BIT,
            "a pass that fills buffers and samples textures still takes the buffer layout"
        );
    }
}
