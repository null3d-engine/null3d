//! Full-screen passes of the render graph: the sketch's WGSL, built as a custom effect's (see
//! [`crate::effects`]), drawn as one triangle over the whole target of a view of its own (see
//! [`crate::view::Fullscreen`]). The render graph keeps the target from frame to frame, and
//! materials and effects sample it as they sample a scene pass's.
//!
//! A pass reads an input image: the scene color as the camera's passes leave it, the outline mask,
//! or a blank texel. It can read the scene's depth, and textures of its own, which bind in a
//! second bind group as an effect's do. Its block holds what an effect's holds, with the size of
//! its own target in the last vector, which tells the shader that it draws a pass texture: the
//! image's bottom row first, as materials sample it, on both paths.
//!
//! Each view's block of the uniform buffer uploads only when it changed, and each view's bind
//! group is made again only when what it reads changed, so passes that stay still record only
//! their draws.

use null3d_gpu::drawlist::{DrawList, Op, format, layout as bind_layout, permutation, state_flags};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::effects::{
    BLOCK, BLOCK_BYTES, Block, IDENTITY, create_effect_group, create_shared_objects, create_texel,
};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};
use crate::view::{Fullscreen, MAX_VIEWS};

/// Bytes of the uniform buffer: a block for each view.
const BUFFER_BYTES: usize = MAX_VIEWS * BLOCK;

/// The GPU objects of the full-screen passes, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FullscreenIds {
    /// The uniform buffer of every view's block.
    pub(crate) buffer: u32,
    /// The linear sampler that passes read their input with, which clamps at the edges.
    pub(crate) sampler: u32,
    /// The bind group of each view, from this id on, by the view's place.
    pub(crate) first_group: u32,
    /// The texel that a pass without an input image reads.
    pub(crate) blank_color: u32,
    /// The texel that a pass which reads no depth binds in its place.
    pub(crate) blank_depth: u32,
}

/// What a pass reads this frame: its input image and its depth, as textures of the draw list.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct PassInputs {
    pub(crate) color: u32,
    pub(crate) depth: u32,
}

/// The pipeline of a pass: one triangle into a target of `format` with one sample.
const fn pipeline(template: u32, format: u32, multisampled: bool) -> PipelineKey {
    PipelineKey {
        template,
        permutation: if multisampled {
            permutation::DEPTH_MULTISAMPLED
        } else {
            0
        },
        vertex_format: 0,
        color_format: format,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The passes' GPU objects and what the GPU holds of them, by view place.
#[derive(Debug)]
pub(crate) struct FullscreenPasses {
    ids: FullscreenIds,
    /// True when the scene's depth is multisampled and the shaders read it as such: on WebGPU
    /// with MSAA.
    multisampled_depth: bool,
    /// The format of the passes' targets.
    format: u32,
    /// Each view's pipeline, with the template and depth read it was asked for.
    pipelines: [Option<(u32, bool, u32)>; MAX_VIEWS],
    created: bool,
    /// The block that each view's part of the buffer holds, or `None` before its upload.
    uploaded: [Option<Block>; MAX_VIEWS],
    /// What each view's bind group reads, with its layout, or `None` before the group exists.
    bound: [Option<(PassInputs, u32)>; MAX_VIEWS],
}

impl FullscreenPasses {
    /// Bytes a frame may copy into its arena: every view's block.
    pub(crate) const UPLOAD_BYTES: usize = MAX_VIEWS * BLOCK_BYTES;

    /// The passes, with GPU objects from `ids`, drawing into targets of `format`, whose depth reads
    /// are multisampled when `multisampled_depth` says.
    pub(crate) fn new(ids: FullscreenIds, format: u32, multisampled_depth: bool) -> Self {
        Self {
            ids,
            multisampled_depth,
            format,
            pipelines: [None; MAX_VIEWS],
            created: false,
            uploaded: [None; MAX_VIEWS],
            bound: [None; MAX_VIEWS],
        }
    }

    /// True when `pass` reads its depth from a multisampled texture.
    fn reads_multisampled(&self, pass: &Fullscreen) -> bool {
        self.multisampled_depth && pass.depth
    }

    /// Asks `pipelines` for the pipeline of the pass at view place `place`, when its template or
    /// its depth read changed.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        place: usize,
        pass: &Fullscreen,
    ) {
        let multisampled = self.reads_multisampled(pass);
        let slot = &mut self.pipelines[place];
        if !matches!(*slot, Some((t, ms, _)) if t == pass.template && ms == multisampled) {
            let id = pipelines.id(pipeline(pass.template, self.format, multisampled));
            *slot = Some((pass.template, multisampled, id));
        }
    }

    /// The output's sizes that the last block of the pass at view place `place` gave its shader.
    #[cfg(test)]
    pub(crate) fn drawn(&self, place: usize) -> Option<[f32; 4]> {
        self.uploaded[place].map(|block| block.drawn)
    }

    /// Makes the buffer, the sampler and the blank texels when the GPU lacks them, uploads the
    /// block of the pass at view place `place` when it changed, and binds the pass to `inputs`
    /// when its group is new or the frame made the plan's textures again (`textures_made`).
    /// `drawn` is the pass's target size in texels, `canvas` the canvas's size and `scale` the
    /// render scale, which place the input image, `clock` the sketch time and the seconds since
    /// the frame before, and `inverse_projection` the inverse of the camera's projection.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (place, pass, inputs): (usize, &Fullscreen, PassInputs),
        drawn: (u32, u32),
        (canvas, scale): ((u32, u32), RenderScale),
        clock: [f32; 2],
        inverse_projection: Option<Mat4>,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            create_objects(list, ids)?;
            self.created = true;
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
        };
        if self.uploaded[place] != Some(block) {
            let (at, bytes) = arena.push(bytes_of(&block))?;
            let offset = (place * BLOCK) as u32;
            list.push(Op::WriteBuffer, &[ids.buffer, offset, at, bytes])?;
            self.uploaded[place] = Some(block);
        }
        let inputs = PassInputs {
            color: if inputs.color == 0 {
                ids.blank_color
            } else {
                inputs.color
            },
            depth: if pass.depth && inputs.depth != 0 {
                inputs.depth
            } else {
                ids.blank_depth
            },
        };
        let layout = if self.reads_multisampled(pass) {
            bind_layout::EFFECT_DEPTH_MS
        } else {
            bind_layout::EFFECT
        };
        if !textures_made && self.bound[place] == Some((inputs, layout)) {
            return Ok(());
        }
        create_effect_group(
            list,
            (ids.first_group + place as u32, layout),
            (ids.buffer, (place * BLOCK) as u32, BLOCK_BYTES as u32),
            (inputs.color, ids.sampler, inputs.depth),
        )?;
        self.bound[place] = Some((inputs, layout));
        Ok(())
    }

    /// Records the pass at view place `place` inside the render pass that the render graph began
    /// into its target. A pass whose textures have no bind group yet, or that has no pipeline,
    /// draws nothing, and its target keeps its last image.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        place: usize,
        pass: &Fullscreen,
    ) -> Result<(), RecordError> {
        let Some((_, _, pipeline)) = self.pipelines[place] else {
            return Ok(());
        };
        if pass.maps.any() {
            if pass.maps.group == 0 {
                return Ok(());
            }
            list.push(Op::SetBindGroup, &[1, pass.maps.group, 0])?;
        }
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + place as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = [None; MAX_VIEWS];
        self.bound = [None; MAX_VIEWS];
    }
}

/// Records the creation of the uniform buffer, the linear sampler, which clamps at the edges, and
/// the blank color and depth texels.
fn create_objects(list: &mut DrawList, ids: FullscreenIds) -> Result<(), RecordError> {
    create_shared_objects(list, (ids.buffer, BUFFER_BYTES), ids.sampler)?;
    create_texel(list, ids.blank_color, format::RGBA16_FLOAT)?;
    create_texel(list, ids.blank_depth, format::R32_FLOAT)
}
