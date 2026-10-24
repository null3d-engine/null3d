//! Screen-space bounce light: one bounce of indirect diffuse light from what the camera sees, at a
//! fraction of the render size, added to the scene's lit color before the effects and the tone
//! mapping. The render graph's steps run after the scene's passes and before the custom effects
//! (see [`crate::frame_graph`]):
//!
//! 1. The gather step traces a few short rays from each texel's surface, toward the hemisphere
//!    around its normal, through the scene depth. A ray that passes behind a surface within a
//!    thickness takes that surface's color. Each texel's rays turn by a hash of its place, so the
//!    noise spreads over the screen and does not line up.
//! 2. The denoise step blurs each texel over its neighbours, keeping to the pixel's own surface by
//!    their distances, as ambient occlusion's denoise does. The blur removes the rays' noise
//!    without smearing one object's bounce onto another.
//! 3. The add step draws at the render size: it adds the gathered light, weighted by each pixel's
//!    own color as its albedo, to the scene's lit color. The result feeds the custom effects, the
//!    volumetric fog, depth of field, bloom, the grading and the tone mapping, so it acts on light
//!    rather than tinting the finished picture.
//!
//! The gather reads the depth as the depth prepass leaves it, so the bounce turns the prepass on
//! while it draws, as ambient occlusion and the reflections do. WebGL2 has no multisampled
//! textures: its backend gives the gather a copy of one depth sample. Every step reads a target
//! that another step wrote, never its own. The settings live in one uniform block that every step
//! reads, uploaded only when a setting, the camera's lens, the canvas, the render scale or the
//! bounce's scale changed.
//!
//! A view that stays still draws the same rays, so a sketch's still-camera accumulation averages
//! the noise of the half-size gather with the rest of the image. The rays are not jittered from
//! frame to frame, because a held frame must draw the same picture every time.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps: the gather, the denoise and the add.
pub(crate) const STEPS: usize = 3;

/// The format of the gather's and the denoise's targets: color with the distance in the fourth
/// value, which tells the denoise which texels belong to the same surface.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The size of the gather's and the denoise's targets. A lower bounce scale draws a corner of them.
pub(crate) const SIZE: Size = Size::HALF;

/// The largest bounce scale: the targets' size, half the render size each way.
pub const MAX_SCALE: f32 = 0.5;

/// The most steps of a ray's march, which the quality settings lower.
pub const MAX_STEPS: u32 = 24;

/// The steps of a ray's march before the quality settings set them.
pub const DEFAULT_STEPS: u32 = 12;

/// How a bounce looks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounce {
    /// From 0 to 1: the share of the gathered light that reaches the scene's color.
    pub intensity: f32,
    /// The farthest that a ray travels, in world units. The light fades over the last third.
    pub distance: f32,
    /// How far behind a surface a ray may pass and still take its color, in world units.
    pub thickness: f32,
}

impl Default for Bounce {
    fn default() -> Self {
        Self {
            intensity: 1.0,
            distance: 12.0,
            thickness: 1.0,
        }
    }
}

/// What the bounce draws with in one frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct BounceFrame {
    /// How the bounce looks.
    pub(crate) settings: Bounce,
    /// The camera's projection matrix and its inverse.
    pub(crate) projection: (Mat4, Mat4),
    /// The steps of each of a ray's march.
    pub(crate) steps: u32,
}

/// The GPU objects that the steps take.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BounceIds {
    /// The uniform buffer of the steps' settings.
    pub(crate) buffer: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The two textures that each step binds: the first holds the depth for the gather and the bounce
/// light for the other steps, and the second the scene color for the gather, the gather's target
/// for the denoise and the lit color for the add.
pub(crate) type StepSources = [[u32; 2]; STEPS];

/// The steps' block, as `bounce.wgsl` lays out its `Settings` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    inverse_projection: Mat4,
    projection: Mat4,
    /// xy: the scene's drawn corner in pixels, the render size. zw: the steps' drawn corner.
    corners: [f32; 4],
    /// xy: the scene targets' extent, the canvas. zw: the steps' targets' extent.
    extents: [f32; 4],
    /// x: the farthest that a ray travels. y: the steps of each march. z: the light's share.
    /// w: how far behind a surface a ray may pass.
    ray: [f32; 4],
}

/// Bytes of the uniform buffer.
const BLOCK_BYTES: usize = std::mem::size_of::<Block>();

/// The pipeline of a step: one triangle into its target. The add step draws into the scene color's
/// format, which `add` gives.
const fn pipeline(step: usize, multisampled: bool, add: u32) -> PipelineKey {
    let template = match step {
        0 if multisampled => template::BOUNCE_GATHER_MS,
        0 => template::BOUNCE_GATHER,
        1 => template::BOUNCE_DENOISE,
        _ => template::BOUNCE_ADD,
    };
    let color_format = match step {
        2 => add,
        _ => FORMAT,
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// The drawn corner of the steps' targets: the render size times the bounce scale, rounded up, at
/// least one pixel each way.
pub(crate) fn corner(canvas: (u32, u32), scale: RenderScale, bounce_scale: f32) -> (u32, u32) {
    let (width, height) = Size::Full.viewport(canvas, scale);
    let bounce_scale = bounce_scale.clamp(0.0, MAX_SCALE);
    let side = |pixels: u32| ((pixels as f32 * bounce_scale).ceil() as u32).clamp(1, pixels.max(1));
    (side(width), side(height))
}

/// The steps' settings for a frame: `bounce`'s values, the camera's projection matrix and its
/// inverse, the canvas, the render scale, the bounce's scale and the steps of each march.
fn block(
    bounce: Bounce,
    (projection, inverse): (Mat4, Mat4),
    canvas: (u32, u32),
    scale: RenderScale,
    bounce_scale: f32,
    steps: u32,
) -> Block {
    let (width, height) = Size::Full.viewport(canvas, scale);
    let (corner_width, corner_height) = corner(canvas, scale, bounce_scale);
    let extent = SIZE.extent(canvas);
    let canvas = (canvas.0.max(1), canvas.1.max(1));
    Block {
        inverse_projection: inverse,
        projection,
        corners: [
            width as f32,
            height as f32,
            corner_width as f32,
            corner_height as f32,
        ],
        extents: [
            canvas.0 as f32,
            canvas.1 as f32,
            extent.0 as f32,
            extent.1 as f32,
        ],
        ray: [
            bounce.distance.max(0.01),
            steps.clamp(1, MAX_STEPS) as f32,
            bounce.intensity.clamp(0.0, 1.0),
            bounce.thickness.max(0.001),
        ],
    }
}

/// Screen-space bounce light's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct BouncePass {
    ids: BounceIds,
    /// True when the scene's depth target is multisampled, so the gather reads sample 0.
    multisampled: bool,
    /// The scene color's format, which the add step draws into.
    add_format: u32,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged: Block,
    uploaded: Option<Block>,
    /// The textures that each step's bind group reads, or zeros before the group exists.
    bound: StepSources,
}

impl BouncePass {
    /// The steps, with GPU objects from `ids`, for a scene depth of `samples` and a scene color of
    /// `add_format`.
    pub(crate) fn new(ids: BounceIds, samples: u32, add_format: u32) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            add_format,
            pipelines: [None; STEPS],
            created: false,
            staged: Block::default(),
            uploaded: None,
            bound: [[0; 2]; STEPS],
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BLOCK_BYTES;

    /// The ids of the steps' pipelines, once the pass asked for them.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step, self.multisampled, self.add_format)));
            }
        }
    }

    /// Makes the buffer when the GPU lacks it, uploads the settings when they changed, and binds
    /// each step to its `sources` when its group is new or the frame made the plan's textures
    /// again.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        bounce: Bounce,
        (projection, inverse): (Mat4, Mat4),
        canvas: (u32, u32),
        scale: RenderScale,
        bounce_scale: f32,
        steps: u32,
        sources: &StepSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BLOCK_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        self.staged = block(
            bounce,
            (projection, inverse),
            canvas,
            scale,
            bounce_scale,
            steps,
        );
        if self.uploaded != Some(self.staged) {
            let (at, bytes) = arena.push(bytes_of(&self.staged))?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.uploaded = Some(self.staged);
        }
        for (step, &textures) in sources.iter().enumerate() {
            if !textures_made && self.bound[step] == textures {
                continue;
            }
            let group = ids.first_group + step as u32;
            let layout = if step == 0 && self.multisampled {
                bind_layout::BOUNCE_MS
            } else {
                bind_layout::BOUNCE
            };
            let buffer = [0, resource_kind::BUFFER, ids.buffer, 0, BLOCK_BYTES as u32];
            let mut words = [0; 18];
            words[..3].copy_from_slice(&[group, layout, 3]);
            words[3..8].copy_from_slice(&buffer);
            for (binding, &texture) in textures.iter().enumerate() {
                let at = 8 + 5 * binding;
                words[at..at + 5].copy_from_slice(&[
                    binding as u32 + 1,
                    resource_kind::TEXTURE,
                    texture,
                    0,
                    0,
                ]);
            }
            list.push(Op::CreateBindGroup, &words)?;
            self.bound[step] = textures;
        }
        Ok(())
    }

    /// Records step `step` inside the render pass that the render graph began into its target,
    /// over the corner that the bounce scale draws.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        step: usize,
        (width, height): (u32, u32),
    ) -> Result<(), RecordError> {
        let pipeline = self.pipelines[step].expect("the steps ask for their pipelines first");
        list.push(
            Op::SetViewport,
            &[0, 0, width, height, 0f32.to_bits(), 1f32.to_bits()],
        )?;
        list.push(Op::SetScissor, &[0, 0, width, height])?;
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + step as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = [[0; 2]; STEPS];
    }
}
