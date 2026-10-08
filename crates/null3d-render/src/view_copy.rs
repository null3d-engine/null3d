//! The copy of a view's image into the target that materials sample, on WebGPU.
//!
//! Materials sample a texture with v = 0 at its first row, which holds the bottom of an image, as
//! three.js's render targets do on WebGL. WebGL2 draws a view's rows into its target in that
//! order, so the view draws into its target directly. WebGPU draws the top row first, so there a
//! view draws into an image of its own, and one full-screen pass copies the image into the target
//! with its rows turned around. The copy reads one texel per pixel of the target. Turning the rows
//! around in every shader that samples a map would cost every material a test per sample, and
//! drawing the view upside down would turn its triangles' winding around, which every pipeline
//! that draws it fixes.

use null3d_gpu::drawlist::template;
use null3d_gpu::drawlist::{
    DrawList, Op, format, layout as bind_layout, resource_kind, state_flags,
};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};
use crate::view::MAX_VIEWS;

/// The GPU objects of the copies, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ViewCopyIds {
    /// The bind group of the copy of the view at each place, from this id on.
    pub(crate) first_group: u32,
}

/// The copies of the views' images, with their pipeline and bind groups.
#[derive(Debug)]
pub(crate) struct ViewCopies {
    ids: ViewCopyIds,
    /// The copy's pipeline, for targets of the format and the permutation it was asked for.
    pipeline: Option<(u32, u32, u32)>,
    /// The image that the bind group of each view's copy reads, or 0 before it has a group.
    bound: [u32; MAX_VIEWS],
}

impl ViewCopies {
    /// The copies, with GPU objects from `ids`.
    pub(crate) fn new(ids: ViewCopyIds) -> Self {
        Self {
            ids,
            pipeline: None,
            bound: [0; MAX_VIEWS],
        }
    }

    /// Asks `pipelines` for the copy's pipeline into targets of `color_format`, and returns its
    /// id. The TONE_MAP bit of `permutation` builds the copy that decodes display color.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
        permutation: u32,
    ) -> u32 {
        match self.pipeline {
            Some((id, format, bits)) if format == color_format && bits == permutation => id,
            _ => {
                let id = pipelines.id(PipelineKey {
                    template: template::VIEW_COPY,
                    permutation,
                    vertex_format: 0,
                    color_format,
                    depth_format: format::NONE,
                    samples: 1,
                    state: state_flags::CULL_NONE,
                    bias: DepthBias::NONE,
                });
                self.pipeline = Some((id, color_format, permutation));
                id
            }
        }
    }

    /// Binds the copy of the view at `place` to its image, the draw list's texture `image`, when
    /// its group is new, its image moved, or the frame made the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        place: usize,
        image: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.bound[place] == image {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group + place as u32,
                bind_layout::VIEW_COPY,
                1,
                0,
                resource_kind::TEXTURE,
                image,
                0,
                0,
            ],
        )?;
        self.bound[place] = image;
        Ok(())
    }

    /// Records the copy of the view at `place` inside the render pass that the render graph began
    /// into its target.
    pub(crate) fn record(&self, list: &mut DrawList, place: usize) -> Result<(), RecordError> {
        let Some((pipeline, ..)) = self.pipeline else {
            return Ok(());
        };
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + place as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the bind groups, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.bound = [0; MAX_VIEWS];
    }
}
