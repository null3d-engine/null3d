//! The camera's one-sample layer: blended surfaces whose material asks for it draw back to front
//! at one sample per pixel, instead of into the multisampled scene color, and a composite blends
//! the result over the scene. Surfaces that overlap many times, such as Gaussian splats, then
//! blend once per pixel where MSAA would blend them once per sample.
//!
//! # The passes
//!
//! While some such surface draws and the scene has more than one sample, the camera's view
//! declares two passes around its transparent pass (see [`crate::frame_graph`]):
//!
//! 1. The layer's pass, after the copy of the scene depth and before the transparent pass. It
//!    draws into a color target of one sample, which starts as transparent black: 16-bit floats on
//!    the HDR path, and the scene color's own 8-bit format on the 8-bit path, whose surfaces blend
//!    display color as they would in the scene. Its depth target has one sample too, and its first
//!    draw copies the first sample of each pixel's opaque depth into it, so the surfaces test
//!    against the opaque scene and write no depth. The surfaces draw with the same shader builds
//!    as in the transparent pass: only the sample count and the targets of their pipelines differ.
//! 2. The composite, after the transparent pass and in its render pass, so the multisampled
//!    targets load and store once for both. It reads the layer one texel per pixel and returns
//!    it, and the normal blending puts its premultiplied color over the scene color.
//!
//! The layer composites over every surface of the camera's transparent pass, so a surface of the
//! transparent pass behind it shows in front. Views other than the camera's, scenes of one sample,
//! devices that cannot draw into its 16-bit float target, and frames before its pipelines are
//! built draw such surfaces back to front in their transparent pass.

use null3d_gpu::drawlist::{
    DrawList, Op, format, layout as bind_layout, resource_kind, state_flags, template,
};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The format of the layer on the HDR path: four 16-bit floats, which blend.
pub(crate) const HDR_FORMAT: u32 = format::RGBA16_FLOAT;

/// The GPU objects of the layer, which the frame builder's id ranges set: the composite's bind
/// group, then the depth copy's.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SingleIds {
    pub(crate) first_group: u32,
}

impl SingleIds {
    /// Bind groups that the layer takes from [`SingleIds::first_group`] on.
    pub(crate) const GROUPS: u32 = 2;
}

/// A pipeline id with the key it was asked for.
type Asked = (u32, PipelineKey);

/// The composite and the depth copy, with their pipelines and bind groups.
#[derive(Debug)]
pub(crate) struct SingleLayer {
    ids: SingleIds,
    composite: Option<Asked>,
    depth: Option<Asked>,
    /// The layer's texture that the composite's group reads, or 0 before it has a group.
    bound: u32,
    /// The depth that the copy's group reads, or 0 before it has a group.
    depth_bound: u32,
}

impl SingleLayer {
    /// The layer, with GPU objects from `ids`.
    pub(crate) fn new(ids: SingleIds) -> Self {
        Self {
            ids,
            composite: None,
            depth: None,
            bound: 0,
            depth_bound: 0,
        }
    }

    /// Asks `pipelines` for the composite's pipeline, and returns its id. It draws in the camera's
    /// transparent render pass, into a scene color of `color_format` with `samples` samples and the
    /// scene's depth of `depth_format`, which it neither tests nor writes.
    pub(crate) fn request_composite(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
        depth_format: u32,
        samples: u32,
    ) -> u32 {
        let key = PipelineKey {
            template: template::SINGLE_COMPOSITE,
            permutation: 0,
            vertex_format: 0,
            color_format,
            depth_format,
            samples,
            state: state_flags::CULL_NONE
                | state_flags::BLEND_NORMAL
                | state_flags::NO_DEPTH_TEST
                | state_flags::NO_DEPTH_WRITE,
            bias: DepthBias::NONE,
        };
        request(&mut self.composite, pipelines, key)
    }

    /// Asks `pipelines` for the depth copy's pipeline into a depth target of `depth_format`, and
    /// returns its id. It draws first in the layer's pass, whose color target of `color_format`
    /// it names and leaves alone.
    pub(crate) fn request_depth(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
        depth_format: u32,
    ) -> u32 {
        let key = PipelineKey {
            template: template::SINGLE_DEPTH,
            permutation: 0,
            vertex_format: 0,
            color_format,
            depth_format,
            samples: 1,
            state: state_flags::CULL_NONE | state_flags::NO_COLOR_WRITE,
            bias: DepthBias::NONE,
        };
        request(&mut self.depth, pipelines, key)
    }

    /// Binds the composite to the draw list's texture of the layer, when its group is new, the
    /// texture moved, or the frame made the plan's textures again.
    pub(crate) fn prepare_composite(
        &mut self,
        list: &mut DrawList,
        layer: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.bound == layer {
            return Ok(());
        }
        bind(list, self.ids.first_group, bind_layout::VIEW_COPY, layer)?;
        self.bound = layer;
        Ok(())
    }

    /// Binds the depth copy to `depth`, the draw list's texture of the multisampled scene depth,
    /// as above. On WebGPU (`multisampled_layout`) the group reads it as a multisampled texture;
    /// WebGL2's backend binds a copy of one sample in its place.
    pub(crate) fn prepare_depth(
        &mut self,
        list: &mut DrawList,
        depth: u32,
        multisampled_layout: bool,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.depth_bound == depth {
            return Ok(());
        }
        let layout = if multisampled_layout {
            bind_layout::WEIGHTED_DEPTH_MS
        } else {
            bind_layout::VIEW_COPY
        };
        bind(list, self.ids.first_group + 1, layout, depth)?;
        self.depth_bound = depth;
        Ok(())
    }

    /// Records the composite inside the camera's transparent render pass, after its surfaces.
    pub(crate) fn record_composite(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.composite, self.ids.first_group)
    }

    /// Records the depth copy inside the layer's render pass, before its surfaces.
    pub(crate) fn record_depth(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.depth, self.ids.first_group + 1)
    }

    /// Forgets the bind groups, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.bound = 0;
        self.depth_bound = 0;
    }
}

/// The id of the pipeline of `key`, which the cache searches for only when the key changed.
fn request(asked: &mut Option<Asked>, pipelines: &mut PipelineCache, key: PipelineKey) -> u32 {
    match *asked {
        Some((id, had)) if had == key => id,
        _ => {
            let id = pipelines.id(key);
            *asked = Some((id, key));
            id
        }
    }
}

/// Makes bind group `group` of `layout`, which reads `texture` at binding 0.
fn bind(list: &mut DrawList, group: u32, layout: u32, texture: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateBindGroup,
        &[group, layout, 1, 0, resource_kind::TEXTURE, texture, 0, 0],
    )?;
    Ok(())
}

/// Records one triangle over the render pass's target with the pipeline of `asked`, and the bind
/// group `group` at index 0.
fn record(list: &mut DrawList, asked: Option<Asked>, group: u32) -> Result<(), RecordError> {
    let Some((pipeline, ..)) = asked else {
        return Ok(());
    };
    list.push(Op::SetPipeline, &[pipeline])?;
    list.push(Op::SetBindGroup, &[0, group, 0])?;
    list.push(Op::Draw, &[3, 1, 0, 0])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipelines_are_asked_for_again_only_when_their_targets_change() {
        let mut pipelines = PipelineCache::default();
        let mut layer = SingleLayer::new(SingleIds { first_group: 7 });
        let depth = format::DEPTH32_FLOAT;
        let first = layer.request_composite(&mut pipelines, format::RG11B10_UFLOAT, depth, 4);
        assert_eq!(
            layer.request_composite(&mut pipelines, format::RG11B10_UFLOAT, depth, 4),
            first
        );
        let other = layer.request_composite(&mut pipelines, format::CANVAS, depth, 4);
        assert_ne!(other, first);
        let copy = layer.request_depth(&mut pipelines, HDR_FORMAT, depth);
        assert_ne!(copy, other);
        assert_eq!(layer.request_depth(&mut pipelines, HDR_FORMAT, depth), copy);
    }

    #[test]
    fn groups_are_made_again_only_when_their_textures_change() {
        let mut list = DrawList::with_capacity(64);
        let mut layer = SingleLayer::new(SingleIds { first_group: 7 });
        layer.prepare_composite(&mut list, 3, false).unwrap();
        layer.prepare_composite(&mut list, 3, false).unwrap();
        layer.prepare_depth(&mut list, 5, true, false).unwrap();
        layer.prepare_depth(&mut list, 5, true, false).unwrap();
        let groups: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(Result::unwrap)
            .filter(|c| c.op == Op::CreateBindGroup)
            .map(|c| (c.operands[0], c.operands[1]))
            .collect();
        assert_eq!(
            groups,
            [
                (7, bind_layout::VIEW_COPY),
                (8, bind_layout::WEIGHTED_DEPTH_MS)
            ]
        );
        layer.prepare_composite(&mut list, 3, true).unwrap();
        layer.prepare_depth(&mut list, 5, false, true).unwrap();
        let layouts: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(Result::unwrap)
            .filter(|c| c.op == Op::CreateBindGroup)
            .map(|c| c.operands[1])
            .collect();
        assert_eq!(layouts.len(), 4);
        assert_eq!(
            layouts[3],
            bind_layout::VIEW_COPY,
            "WebGL2 binds one sample"
        );
    }
}
