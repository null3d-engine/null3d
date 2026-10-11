//! Transmission: surfaces that let light through, as three.js's `transmission` does, for glass and
//! clear water. Filament's way: the camera's view copies the color of its opaque objects into a
//! texture with a whole chain of mip levels, and each such surface samples the copy behind it.
//!
//! # The passes
//!
//! While some mesh and material pair lets light through, the render graph declares the copy pass
//! after the camera's opaque pass and the debug lines. It reads the scene color as those passes
//! leave it (a multisampled one through its resolve), and draws it, one texel per pixel, into the
//! first level of its target. After the copy's render pass, the frame makes the target's other
//! levels from it, each from the one before with a linear filter ([`Op::GenerateMipmaps`]). The
//! camera's transparent pass then reads the target: pairs that let light through draw there, back
//! to front with the blended ones, so the copy holds what lies behind them and none of them.
//!
//! The target has the render size's texture, whose corner the frame draws into at a render scale
//! below 1. Its format is the scene color's on the HDR path. On the 8-bit path, where the scene
//! color holds display color, it is an sRGB texture, and the copy writes the decoded color, as the
//! copies of views' images do: the levels then average linear color, and materials read it.
//!
//! # How a surface reads it
//!
//! The frame group binds the target at binding 15, or a blank texel while no copy draws, and
//! the frame's values say which. The surface's shader follows three.js's
//! `getIBLVolumeRefraction`: the light leaves the volume after its thickness along the refracted
//! direction, and the shader samples the copy where that point lands on the screen, at a mip
//! level that the roughness sets. Views other than the camera's have no copy: there such
//! surfaces show the environment's light through them.

use null3d_gpu::drawlist::{
    DrawList, Op, format, layout as bind_layout, resource_kind, state_flags, template,
};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The binding of the copy in the frame group of scene pipelines, which the environment's
/// sampler reads.
pub(crate) const BINDING: u32 = 15;

/// The GPU objects of the copy, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TransmissionIds {
    /// The copy's bind group.
    pub(crate) group: u32,
    /// The texel that frame groups bind while no copy draws.
    pub(crate) blank: u32,
}

/// The copy of the camera's opaque color, with its pipeline and bind group.
#[derive(Debug)]
pub(crate) struct TransmissionCopy {
    ids: TransmissionIds,
    /// The copy's pipeline, for targets of the format and the permutation it was asked for.
    pipeline: Option<(u32, u32, u32)>,
    /// The texture that the bind group reads, or 0 before it has a group.
    bound: u32,
}

impl TransmissionCopy {
    /// The copy, with GPU objects from `ids`.
    pub(crate) fn new(ids: TransmissionIds) -> Self {
        Self {
            ids,
            pipeline: None,
            bound: 0,
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
                    template: template::TRANSMISSION_COPY,
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

    /// Binds the copy to `source`, the draw list's texture of the scene color that it reads, when
    /// its group is new, the source moved, or the frame made the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        source: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.bound == source {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.group,
                bind_layout::VIEW_COPY,
                1,
                0,
                resource_kind::TEXTURE,
                source,
                0,
                0,
            ],
        )?;
        self.bound = source;
        Ok(())
    }

    /// Records the copy inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let Some((pipeline, ..)) = self.pipeline else {
            return Ok(());
        };
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// The texel that frame groups bind while no copy draws.
    pub(crate) fn blank(&self) -> u32 {
        self.ids.blank
    }

    /// Forgets the bind group, so the next frame makes it again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.bound = 0;
    }
}

/// Records the creation of the texel that frame groups bind while no copy draws: a texture array
/// of one black texel in one layer, which samples as no light.
pub(crate) fn create_blank(list: &mut DrawList, id: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            id,
            1,
            1,
            1,
            format::RGBA8_UNORM,
            null3d_gpu::drawlist::texture_usage::TEXTURE_BINDING,
            1,
            1,
            null3d_gpu::drawlist::view::D2_ARRAY,
        ],
    )?;
    Ok(())
}
