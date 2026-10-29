//! Order-independent transparency from a store of four depth moments (decision record D-261), the
//! layer that blends the surfaces whose material blends whatever order they draw in.
//!
//! # The passes
//!
//! While the quality setting turns the layer on and some blended surface draws, the camera's view
//! declares these passes after its transparent pass:
//!
//! 1. The moment pass draws the surfaces into one target of 16-bit floats, with the scene's depth
//!    as a depth target that it tests against and never writes. No weight touches the sums, so the
//!    order of the draws does not matter: each fragment adds its optical depth's total, then that
//!    total times its warped depth, its square and its cube. A scene of one sample lends its own
//!    depth; a multisampled scene's pass creates a depth target of one sample, and its first draw
//!    copies the first sample of each pixel's depth into it.
//! 2. The colour pass draws the same surfaces again into a second target of 16-bit floats. Each
//!    fragment reads the moments at its own pixel and joins the sum weighted by the transmittance
//!    that the fit gives at its depth, times the share it covers.
//! 3. The composite reads both targets, one texel per pixel, works out from the moments the share
//!    that shows through, and blends the summed colour over the scene colour by the share that the
//!    layer covers.
//! 4. Three steps of SMAA 1x smooth the layer's edges under the share that its moments cover: the
//!    first marks the edges, the second finds their ends and their areas from two lookup tables
//!    that the layer makes at its first use, and the last mixes each pixel with the neighbour that
//!    its weights name. The scene color keeps MSAA's samples for opaque geometry, which the layer's
//!    own targets cannot have.
//!
//! Views other than the camera's, devices that cannot draw into 16-bit float targets, and frames
//! before the layer's pipelines are built draw such surfaces back to front in their transparent
//! pass, as surfaces of normal blending.

use null3d_gpu::drawlist::{
    DrawList, Op, address, compare, format, layout as bind_layout, resource_kind, state_flags,
    template, texture_usage, view,
};

use crate::frame::{LINEAR_LEVEL, RecordError, UploadArena, clamp_sampler};

pub(crate) mod tables;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The binding of the moment store in the frame group of the colour builds. It is free in the
/// frame's bindings, where the copy of the opaque color sits at 15. The shader composer keeps every
/// module's globals, so the refraction module's own texture holds 15 in every build, and a moment
/// build that used 15 would collide with it (decision record D-261).
pub(crate) const STORE_BINDING: u32 = 19;
/// The format of the moment store: four 16-bit floats, which add.
pub(crate) const STORE_FORMAT: u32 = format::RGBA16_FLOAT;
/// The format of the colour sum: four 16-bit floats, which add.
pub(crate) const COLOUR_FORMAT: u32 = format::RGBA16_FLOAT;
/// The format of the anti-aliasing step's edge marks: four 8-bit channels, two of which carry the
/// edges.
pub(crate) const EDGES_FORMAT: u32 = format::RGBA8_UNORM;
/// The format of the anti-aliasing step's blending weights.
pub(crate) const WEIGHTS_FORMAT: u32 = format::RGBA8_UNORM;

/// The GPU objects of the layer, which the frame builder's id ranges set: the bind groups of its
/// steps, its sampler, and the two lookup tables.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MomentIds {
    /// The first of the layer's bind groups.
    pub(crate) first_group: u32,
    /// The linear sampler of the anti-aliasing's lookup tables and of its images.
    pub(crate) sampler: u32,
    /// The area table's texture.
    pub(crate) area: u32,
    /// The search table's texture.
    pub(crate) search: u32,
}

impl MomentIds {
    /// Bind groups that the layer takes from [`MomentIds::first_group`] on: the composite, the
    /// depth copy, then the anti-aliasing's three steps.
    pub(crate) const GROUPS: u32 = 5;
}

/// A pipeline id with the key it was asked for.
type Asked = (u32, PipelineKey);

/// The layer's steps, with their pipelines and bind groups.
#[derive(Debug)]
pub(crate) struct MomentLayer {
    ids: MomentIds,
    composite: Option<Asked>,
    depth: Option<Asked>,
    edges: Option<Asked>,
    blend: Option<Asked>,
    resolve: Option<Asked>,
    /// The textures of the moment store and the colour sum that the composite reads, or zeros
    /// before it has a group.
    composite_bound: (u32, u32),
    /// The depth that the copy reads, or 0 before it has a group.
    depth_bound: u32,
    /// The scene color and the moment store that the first anti-aliasing step reads.
    edges_bound: (u32, u32),
    /// The edge marks that the second anti-aliasing step reads.
    blend_bound: u32,
    /// The scene color and the blending weights that the last anti-aliasing step reads.
    resolve_bound: (u32, u32),
    /// True once the two lookup tables and their sampler are made.
    tables_made: bool,
}

impl MomentLayer {
    /// The layer, with GPU objects from `ids`.
    pub(crate) fn new(ids: MomentIds) -> Self {
        Self {
            ids,
            composite: None,
            depth: None,
            edges: None,
            blend: None,
            resolve: None,
            composite_bound: (0, 0),
            depth_bound: 0,
            edges_bound: (0, 0),
            blend_bound: 0,
            resolve_bound: (0, 0),
            tables_made: false,
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
            template: template::MOMENT_COMPOSITE,
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
    /// returns its id. It draws first in the moment pass, whose moment target it names and leaves
    /// alone.
    pub(crate) fn request_depth(
        &mut self,
        pipelines: &mut PipelineCache,
        depth_format: u32,
    ) -> u32 {
        let key = PipelineKey {
            template: template::MOMENT_DEPTH,
            permutation: 0,
            vertex_format: 0,
            color_format: STORE_FORMAT,
            depth_format,
            samples: 1,
            state: state_flags::CULL_NONE | state_flags::NO_COLOR_WRITE,
            bias: DepthBias::NONE,
        };
        request(&mut self.depth, pipelines, key)
    }

    /// Asks `pipelines` for the anti-aliasing's three steps, and returns whether all their
    /// pipelines are built. The last step writes a target of `color_format`.
    pub(crate) fn request_aliasing(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
    ) -> (u32, u32, u32) {
        let edges = PipelineKey {
            template: template::MOMENT_SMAA_EDGES,
            permutation: 0,
            vertex_format: 0,
            color_format: EDGES_FORMAT,
            depth_format: format::NONE,
            samples: 1,
            state: state_flags::CULL_NONE,
            bias: DepthBias::NONE,
        };
        let blend = PipelineKey {
            template: template::MOMENT_SMAA_BLEND,
            color_format: WEIGHTS_FORMAT,
            ..edges
        };
        let resolve = PipelineKey {
            template: template::MOMENT_SMAA_RESOLVE,
            color_format,
            ..edges
        };
        (
            request(&mut self.edges, pipelines, edges),
            request(&mut self.blend, pipelines, blend),
            request(&mut self.resolve, pipelines, resolve),
        )
    }

    /// Binds the composite to the textures of the moment store and the colour sum, when its group
    /// is new, they moved, or the frame made the plan's textures again.
    pub(crate) fn prepare_composite(
        &mut self,
        list: &mut DrawList,
        store: u32,
        colour: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.composite_bound == (store, colour) {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group,
                bind_layout::MOMENT_COMPOSITE,
                2,
                0,
                resource_kind::TEXTURE,
                store,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                colour,
                0,
                0,
            ],
        )?;
        self.composite_bound = (store, colour);
        Ok(())
    }

    /// Binds the depth copy to `depth`, the draw list's texture of the multisampled scene depth,
    /// as the weighted layer's copy binds its own.
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
            bind_layout::MOMENT_DEPTH_MS
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

    /// Binds the anti-aliasing's first step to the scene color and the moment store.
    pub(crate) fn prepare_edges(
        &mut self,
        list: &mut DrawList,
        scene: u32,
        store: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.edges_bound == (scene, store) {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group + 2,
                bind_layout::MOMENT_SMAA_EDGES,
                2,
                0,
                resource_kind::TEXTURE,
                scene,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                store,
                0,
                0,
            ],
        )?;
        self.edges_bound = (scene, store);
        Ok(())
    }

    /// Binds the anti-aliasing's second step to the edge marks and the two lookup tables.
    pub(crate) fn prepare_blend(
        &mut self,
        list: &mut DrawList,
        edges: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.blend_bound == edges {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group + 3,
                bind_layout::MOMENT_SMAA_BLEND,
                4,
                0,
                resource_kind::TEXTURE,
                edges,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                self.ids.area,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                self.ids.search,
                0,
                0,
                1,
                resource_kind::SAMPLER,
                self.ids.sampler,
                0,
                0,
            ],
        )?;
        self.blend_bound = edges;
        Ok(())
    }

    /// Binds the anti-aliasing's last step to the scene color and the blending weights.
    pub(crate) fn prepare_resolve(
        &mut self,
        list: &mut DrawList,
        scene: u32,
        weights: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.resolve_bound == (scene, weights) {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                self.ids.first_group + 4,
                bind_layout::MOMENT_SMAA_RESOLVE,
                3,
                0,
                resource_kind::TEXTURE,
                scene,
                0,
                0,
                1,
                resource_kind::TEXTURE,
                weights,
                0,
                0,
                1,
                resource_kind::SAMPLER,
                self.ids.sampler,
                0,
                0,
            ],
        )?;
        self.resolve_bound = (scene, weights);
        Ok(())
    }

    /// Makes the two lookup tables and the sampler that reads them, once, from the bytes that the
    /// tables' generator gives. The tables are small enough to build in a frame, and the record
    /// holds the cost that the build measured.
    pub(crate) fn prepare_tables(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<(), RecordError> {
        if self.tables_made {
            return Ok(());
        }
        clamp_sampler(
            list,
            self.ids.sampler,
            address::CLAMP_TO_EDGE,
            LINEAR_LEVEL,
            0.0,
            compare::NONE,
        )?;
        upload(
            list,
            arena,
            self.ids.area,
            tables::AREA_WIDTH,
            tables::AREA_HEIGHT,
            tables::areas(),
        )?;
        upload(
            list,
            arena,
            self.ids.search,
            tables::SEARCH_WIDTH,
            tables::SEARCH_HEIGHT,
            tables::searches(),
        )?;
        self.tables_made = true;
        Ok(())
    }

    /// Records the composite inside the render pass that the render graph began into the scene
    /// color.
    pub(crate) fn record_composite(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.composite, self.ids.first_group)
    }

    /// Records the depth copy inside the moment pass's render pass, before its surfaces.
    pub(crate) fn record_depth(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.depth, self.ids.first_group + 1)
    }

    /// Records the anti-aliasing's first step inside its render pass.
    pub(crate) fn record_edges(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.edges, self.ids.first_group + 2)
    }

    /// Records the anti-aliasing's second step inside its render pass.
    pub(crate) fn record_blend(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.blend, self.ids.first_group + 3)
    }

    /// Records the anti-aliasing's last step inside its render pass.
    pub(crate) fn record_resolve(&self, list: &mut DrawList) -> Result<(), RecordError> {
        record(list, self.resolve, self.ids.first_group + 4)
    }

    /// Forgets the bind groups, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again, but the
    /// tables are textures of that GPU, so the next frame makes them again too.
    pub(crate) fn reset_gpu(&mut self) {
        self.composite_bound = (0, 0);
        self.depth_bound = 0;
        self.edges_bound = (0, 0);
        self.blend_bound = 0;
        self.resolve_bound = (0, 0);
        self.tables_made = false;
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

/// Records the creation of a texture of `width` by `height` texels with `texels`, and its upload.
fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    texture: u32,
    width: u32,
    height: u32,
    texels: Vec<u8>,
) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            texture,
            width,
            height,
            1,
            format::RGBA8_UNORM,
            texture_usage::TEXTURE_BINDING,
            1,
            1,
            view::D2,
        ],
    )?;
    let (at, bytes) = arena.push_zeroed(texels.len())?;
    bytes.copy_from_slice(&texels);
    list.push(
        Op::WriteTexture,
        &[
            texture,
            0,
            0,
            0,
            0,
            width,
            height,
            1,
            at,
            texels.len() as u32,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_steps_take_their_groups_in_order() {
        assert_eq!(MomentIds::GROUPS, 5);
    }

    #[test]
    fn the_tables_are_made_once() {
        let mut list = DrawList::with_capacity(256);
        let mut arena = UploadArena::default();
        arena.reset((tables::AREA_WIDTH * tables::AREA_HEIGHT * 4) as usize + 4096);
        let mut layer = MomentLayer::new(MomentIds {
            first_group: 7,
            sampler: 3,
            area: 11,
            search: 12,
        });
        layer.prepare_tables(&mut list, &mut arena).unwrap();
        let made = null3d_gpu::drawlist::decode(list.words())
            .filter(|c| c.as_ref().unwrap().op == Op::CreateTexture)
            .count();
        assert_eq!(made, 2);
        layer.prepare_tables(&mut list, &mut arena).unwrap();
        let made = null3d_gpu::drawlist::decode(list.words())
            .filter(|c| c.as_ref().unwrap().op == Op::CreateTexture)
            .count();
        assert_eq!(made, 2, "the second frame makes no table again");
    }
}
