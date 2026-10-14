//! Weighted blended transparency, the method of McGuire and Bavoil (2013) that three.js's
//! `OITPassNode` draws: surfaces whose material blends with the `weighted` blending draw in any
//! order, and their colors meet by a weighted average.
//!
//! # The passes
//!
//! While some such surface draws, the camera's view declares three passes after its transparent
//! pass (see [`crate::frame_graph`]):
//!
//! 1. The weighted pass draws the surfaces into two targets of one sample, with the scene's depth
//!    as a depth target that it tests against and never writes. A scene of one sample lends its
//!    own depth. A multisampled scene's pass creates a depth target of one sample, and its first
//!    draw copies the first sample of each pixel's depth into it, as the transparent pass leaves
//!    it. The first target, in 16-bit floats,
//!    sums each fragment's premultiplied color and its alpha, times a weight that falls with its
//!    distance (equation 9 of the paper, as three.js weighs it). The second, one 16-bit float,
//!    sums `-log2(1 - alpha)`. Both add, so the order of the draws does not matter, and both
//!    targets blend the same way, as compatibility mode requires.
//! 2. The composite reads both, one texel per pixel, and blends their average color over the
//!    scene color by the share that the layer covers: one minus two to the power of minus the
//!    second sum, which equals one minus the product of `1 - alpha`.
//!
//! Each weighted surface keeps the pipeline of its normal blending too. Views other than the
//! camera's, devices that cannot draw into 16-bit float targets, and frames before the weighted
//! pipelines are built draw such surfaces back to front in their transparent pass, as surfaces of
//! normal blending.

use null3d_gpu::drawlist::{
    DrawList, Op, format, layout as bind_layout, resource_kind, state_flags, template,
};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The format of the weighted color sum: four 16-bit floats, which add.
pub(crate) const SUM_FORMAT: u32 = format::RGBA16_FLOAT;
/// The format of the coverage sum: one 16-bit float, which adds.
pub(crate) const COVER_FORMAT: u32 = format::R16_FLOAT;

/// The GPU objects of the layer, which the frame builder's id ranges set: the composite's bind
/// group, then the depth copy's.
#[derive(Clone, Copy, Debug)]
pub(crate) struct WeightedIds {
    pub(crate) first_group: u32,
}

impl WeightedIds {
    /// Bind groups that the layer takes from [`WeightedIds::first_group`] on.
    pub(crate) const GROUPS: u32 = 2;
}

/// A pipeline id with the key it was asked for.
type Asked = (u32, PipelineKey);

/// The composite and the depth copy, with their pipelines and bind groups.
#[derive(Debug)]
pub(crate) struct WeightedLayer {
    ids: WeightedIds,
    composite: Option<Asked>,
    depth: Option<Asked>,
    /// The textures that the composite's group reads, or zeros before it has a group.
    bound: (u32, u32),
    /// The depth that the copy's group reads, or 0 before it has a group.
    depth_bound: u32,
}

impl WeightedLayer {
    /// The layer, with GPU objects from `ids`.
    pub(crate) fn new(ids: WeightedIds) -> Self {
        Self {
            ids,
            composite: None,
            depth: None,
            bound: (0, 0),
            depth_bound: 0,
        }
    }

    /// Asks `pipelines` for the composite's pipeline into a scene color of `color_format` with
    /// `samples` samples, and returns its id.
    pub(crate) fn request_composite(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
        samples: u32,
    ) -> u32 {
        let key = PipelineKey {
            template: template::WEIGHTED_COMPOSITE,
            permutation: 0,
            vertex_format: 0,
            color_format,
            depth_format: format::NONE,
            samples,
            state: state_flags::CULL_NONE | state_flags::BLEND_NORMAL,
            bias: DepthBias::NONE,
        };
        request(&mut self.composite, pipelines, key)
    }

    /// Asks `pipelines` for the depth copy's pipeline into a depth target of `depth_format`, and
    /// returns its id. It draws first in the weighted pass, whose two color targets it names and
    /// leaves alone.
    pub(crate) fn request_depth(
        &mut self,
        pipelines: &mut PipelineCache,
        depth_format: u32,
    ) -> u32 {
        let key = PipelineKey {
            template: template::WEIGHTED_DEPTH,
            permutation: 0,
            vertex_format: 0,
            color_format: SUM_FORMAT,
            depth_format,
            samples: 1,
            state: state_flags::CULL_NONE | state_flags::NO_COLOR_WRITE,
            bias: DepthBias::NONE,
        };
        request(&mut self.depth, pipelines, key)
    }

    /// Binds the composite to the draw list's textures of the two sums, when its group is new,
    /// they moved, or the frame made the plan's textures again.
    pub(crate) fn prepare_composite(
        &mut self,
        list: &mut DrawList,
        sum: u32,
        cover: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.bound == (sum, cover) {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group,
                bind_layout::WEIGHTED_COMPOSITE,
                2,
                0,
                resource_kind::TEXTURE,
                sum,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                cover,
                0,
                0,
            ],
        )?;
        self.bound = (sum, cover);
        Ok(())
    }

    /// Binds the depth copy to `depth`, the draw list's texture of the multisampled scene depth,
    /// as above. On WebGPU (`multisampled_layout`) the group reads it as a multisampled texture;
    /// WebGL2's backend binds a copy of one sample in its place, as it binds a copy of a view's
    /// image.
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
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group + 1,
                layout,
                1,
                0,
                resource_kind::TEXTURE,
                depth,
                0,
                0,
            ],
        )?;
        self.depth_bound = depth;
        Ok(())
    }

    /// Records the composite inside the render pass that the render graph began into the scene
    /// color.
    pub(crate) fn record_composite(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.composite, self.ids.first_group)
    }

    /// Records the depth copy inside the weighted pass's render pass, before its surfaces.
    pub(crate) fn record_depth(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.depth, self.ids.first_group + 1)
    }

    /// Forgets the bind groups, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.bound = (0, 0);
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
        let mut layer = WeightedLayer::new(WeightedIds { first_group: 7 });
        let first = layer.request_composite(&mut pipelines, format::RG11B10_UFLOAT, 4);
        assert_eq!(
            layer.request_composite(&mut pipelines, format::RG11B10_UFLOAT, 4),
            first
        );
        let other = layer.request_composite(&mut pipelines, format::CANVAS, 4);
        assert_ne!(other, first);
        let depth = layer.request_depth(&mut pipelines, format::DEPTH32_FLOAT);
        assert_ne!(depth, other);
    }

    #[test]
    fn groups_are_made_again_only_when_their_textures_change() {
        let mut list = DrawList::with_capacity(64);
        let mut layer = WeightedLayer::new(WeightedIds { first_group: 7 });
        layer.prepare_composite(&mut list, 3, 4, false).unwrap();
        layer.prepare_composite(&mut list, 3, 4, false).unwrap();
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
                (7, bind_layout::WEIGHTED_COMPOSITE),
                (8, bind_layout::WEIGHTED_DEPTH_MS)
            ]
        );
        layer.prepare_composite(&mut list, 3, 4, true).unwrap();
        assert_eq!(
            null3d_gpu::drawlist::decode(list.words())
                .filter(|c| c.as_ref().unwrap().op == Op::CreateBindGroup)
                .count(),
            3
        );
    }
}
