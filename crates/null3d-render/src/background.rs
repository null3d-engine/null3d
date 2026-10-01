//! Texture backgrounds: a texture that the camera's view draws behind every object, as three.js
//! draws a texture in `scene.background`.
//!
//! The texture covers the whole view and stretches to its size, with its first row at the bottom,
//! as it sits on a plane. It draws first in the camera's opaque pass, as one triangle over the
//! whole target with no depth test and no depth write, so every object draws over it. Its color
//! goes into the scene color like an object's, so exposure and tone mapping change it too.
//!
//! The draw binds the bind group of the texture's array and sampler, as materials bind their
//! maps, and names the texture's layer by its first vertex: the shader reads the layer as its
//! vertex index divided by three. So the pass needs no buffer and no uniform of its own. The
//! pipeline exists from the frame after the sketch sets the texture, so it builds while the
//! texture loads. Until the texture's texels are on the GPU, and once the texture is destroyed,
//! the pass draws nothing, and the view shows the background color.

use null3d_gpu::drawlist::{DrawList, Op, state_flags, template};

use crate::frame::{RecordError, SceneSettings, bind_frame_group};
use crate::pipelines::{DepthBias, DrawKey, PassTargets, PipelineCache};

/// What the background asks of its pipeline: the background's template, which reads no vertex
/// buffer, drawn over whatever the depth target holds.
const BACKGROUND_DRAW: DrawKey = DrawKey {
    template: template::BACKGROUND,
    permutation: 0,
    vertex_format: 0,
    state: state_flags::NO_DEPTH_TEST,
    bias: DepthBias::NONE,
};

/// The index at which the draw binds the texture's group, after the frame's group.
const TEXTURE_GROUP: u32 = 1;

/// The draw of one frame's background.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Draw {
    pipeline: u32,
    /// The bind group of the texture's array and sampler.
    group: u32,
    /// The texture's layer in its array.
    layer: u32,
}

/// The background's pipeline and the draw of the frame being recorded.
#[derive(Debug, Default)]
pub(crate) struct BackgroundPass {
    /// The id of the pipeline, from the builder's pipeline cache, or 0 without a texture.
    pipeline: u32,
    draw: Option<Draw>,
}

impl BackgroundPass {
    /// Asks `pipelines` for the pipeline of the scene's background texture, which draws into the
    /// scene's `targets`, while the texture lives. A builder asks before it records the pipelines
    /// that its frame creates, so the list creates this one with the others, at its start.
    pub(crate) fn request_pipeline(
        &mut self,
        settings: &SceneSettings,
        pipelines: &mut PipelineCache,
        targets: PassTargets,
    ) {
        self.pipeline = if settings.textures().is_live(settings.background_texture()) {
            pipelines.id(BACKGROUND_DRAW.in_pass(targets.tone_map_only()))
        } else {
            0
        };
    }

    /// Finds the frame's draw once the frame recorded its texture work: the texture's group and
    /// layer, when its texels are on the GPU.
    pub(crate) fn prepare(&mut self, settings: &SceneSettings) {
        let (texture, textures) = (settings.background_texture(), settings.textures());
        self.draw = match (self.pipeline, textures.ready_layer(texture)) {
            (0, _) | (_, None) => None,
            (pipeline, Some(layer)) => textures.group_id(texture).map(|group| Draw {
                pipeline,
                group,
                layer,
            }),
        };
    }

    /// Records the background inside the render pass that the camera's opaque pass began, before
    /// its objects: one triangle, with the view's frame group `frame_group` bound at the dynamic
    /// offsets `offsets` as the opaque pass binds it. It records nothing without a texture whose
    /// texels are on the GPU.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        frame_group: u32,
        offsets: &[u32],
    ) -> Result<(), RecordError> {
        let Some(draw) = self.draw else {
            return Ok(());
        };
        list.push(Op::SetPipeline, &[draw.pipeline])?;
        bind_frame_group(list, frame_group, offsets)?;
        list.push(Op::SetBindGroup, &[TEXTURE_GROUP, draw.group, 0])?;
        list.push(Op::Draw, &[3, 1, draw.layer * 3, 0])?;
        Ok(())
    }
}
