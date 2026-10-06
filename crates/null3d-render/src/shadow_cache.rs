//! The copy of a far shadow cascade's cache layer into its layer of the shadow map (see
//! [`crate::shadows`]).
//!
//! While far cascades cache, each one's shadow pass starts with one triangle over its layer, which
//! writes each texel's depth from the same texel of its cache layer, and then draws its moving
//! casters over that depth. The pipeline reads no vertex buffer, and the draw's first vertex names
//! the cache layer, so the copy needs no buffer of its own. Its one bind group binds the cache,
//! which the shader reads as unfilterable floats with `textureLoad` on every GPU path. A draw that
//! writes depth works on WebGL2 too, where the draw lists copy no depth texture. The bind group
//! follows the cache: the builder makes it again whenever the render graph makes its textures
//! again.

use null3d_gpu::drawlist::{DrawList, Op, layout as bind_layout, resource_kind, template};

use crate::frame::RecordError;
use crate::pipelines::{DepthBias, DrawKey, PipelineCache};
use crate::shadows::TARGETS;

/// What the copy asks of its pipeline: the copy's template, which reads no vertex buffer. It keeps
/// the depth test of the shadow passes, which the layer's cleared depth always passes where the
/// cache holds a caster, and which leaves the cleared depth where it holds none.
const RESTORE_DRAW: DrawKey = DrawKey {
    template: template::SHADOW_RESTORE,
    permutation: 0,
    vertex_format: 0,
    state: 0,
    bias: DepthBias::NONE,
};

/// The copy's pipeline and the cache that its bind group binds.
#[derive(Debug, Default)]
pub(crate) struct ShadowRestore {
    /// The id of the pipeline, from the builder's pipeline cache, or 0 while no cascade caches.
    pipeline: u32,
    /// The texture that the bind group binds, or `None` before it binds one.
    bound: Option<u32>,
}

impl ShadowRestore {
    /// Asks `pipelines` for the copy's pipeline while far cascades `cache`. A builder asks before
    /// it records the pipelines that its frame creates, so the list creates this one with the
    /// others, at its start.
    pub(crate) fn request_pipeline(&mut self, cache: bool, pipelines: &mut PipelineCache) {
        self.pipeline = if cache {
            pipelines.id(RESTORE_DRAW.in_pass(TARGETS))
        } else {
            0
        };
    }

    /// Records the bind group `group` of the cache texture `cache`, when the group does not bind it
    /// yet, or when the render graph made its textures again (`remade`). Without a cache it records
    /// nothing.
    pub(crate) fn bind(
        &mut self,
        list: &mut DrawList,
        group: u32,
        cache: Option<u32>,
        remade: bool,
    ) -> Result<(), RecordError> {
        let Some(texture) = cache else {
            self.bound = None;
            return Ok(());
        };
        if self.bound == Some(texture) && !remade {
            return Ok(());
        }
        list.push(
            Op::CreateBindGroup,
            &[
                group,
                bind_layout::SHADOW_RESTORE,
                1,
                0,
                resource_kind::TEXTURE,
                texture,
                0,
                0,
            ],
        )?;
        self.bound = Some(texture);
        Ok(())
    }

    /// Records the copy of cache layer `layer` with the bind group `group`, inside the render pass
    /// that the cascade's shadow pass began, before its moving casters.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        group: u32,
        layer: u32,
    ) -> Result<(), RecordError> {
        debug_assert!(self.pipeline != 0, "the copy asks for its pipeline first");
        list.push(Op::SetPipeline, &[self.pipeline])?;
        list.push(Op::SetBindGroup, &[0, group, 0])?;
        list.push(Op::Draw, &[3, 1, layer * 3, 0])?;
        Ok(())
    }

    /// Forgets the bind group, so the next frame records it again, after the thread that draws
    /// replaced the GPU.
    pub(crate) fn forget_gpu(&mut self) {
        self.bound = None;
    }
}
