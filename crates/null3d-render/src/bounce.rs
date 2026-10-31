//! Screen-space bounce light: one bounce of the indirect diffuse light that the camera's own view
//! showed in the frame before, which the camera's opaque pass mixes into the ambient light in place
//! of the environment's diffuse light. The render graph's steps run in the screen texture's block,
//! after ambient occlusion's steps and before the opaque pass (see [`crate::frame_graph`]), on
//! ambient occlusion's grid:
//!
//! 1. The trace takes each texel's surface position and normal, which ambient occlusion's depth
//!    copy and horizon step give it, and samples a disk of screen texels around it. A sample whose
//!    surface lies in the texel's hemisphere, within the reach, takes the color that the frame
//!    before showed there, from the copy that transmission and reflections read too, weighted by
//!    the cosine of its direction. The texel writes the mean light times pi, and the share of the
//!    disk that found a surface. The light is in `crates/null3d-shaders/wgsl/bounce.wgsl`.
//! 2. The denoise blurs that light over a disk of taps that keeps to each texel's own surface, by
//!    each tap's distance from its plane and its normal, as ambient occlusion's denoise does.
//!
//! The denoise writes the light into the second layer of the screen texture, which the opaque pass
//! reads beside the occlusion (`null3d::gtao`). Screen-space reflections' trace target holds a
//! second layer too, because either target can be the screen texture that the opaque pass binds.
//!
//! Every step reads a target that another step wrote, never its own. The settings live in one
//! uniform buffer, uploaded only when a setting, the camera's lens, the canvas or the render scale
//! changed. A new render scale makes no GPU object: the steps draw a corner of their targets, as
//! the render scale's passes do. WebGL2 counts rows from the bottom, and its shader builds turn
//! rows around.
//!
//! The feature draws only while the scene color is HDR: the copy that its samples read holds the
//! display's color on the 8-bit path, which is no radiance to bounce.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps: the trace, then the denoise.
pub(crate) const STEPS: usize = 2;

/// The format of the steps' targets: the bounce light in rgb and its share in alpha.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The size of the steps' targets, and the screen texture's: half the render size, of which a
/// lower scale draws a corner.
pub(crate) const SIZE: Size = crate::ao::SIZE;

/// The most samples that one texel gathers.
pub const MAX_RAYS: u32 = 16;

/// The most distance from a texel that a sample's surface lights it, in meters.
pub const MAX_DISTANCE: f32 = 20.0;

/// How near the texel's own surface a sample must be to send nothing, in meters.
const BIAS: f32 = 0.05;

/// The radius of the disk of screen texels that each texel gathers, in texels of the steps. It is
/// wide enough that a wall beside the surface shows its upper part, which is where its light is.
const GATHER_RADIUS: f32 = 64.0;

/// The share of the screen over which the light fades toward its edges.
const EDGE_FADE: f32 = 0.1;

/// The denoise's radius in texels of the steps, and the share of a tap's weight that its depth
/// keeps: ambient occlusion's denoise values, which keep light on its own surface.
const DENOISE_RADIUS: f32 = 4.0;
const DEPTH_TOLERANCE: f32 = 0.03;
/// The power that a tap's normal alignment is raised to: stronger than the occlusion's, so light
/// does not bend around a corner.
const NORMAL_POWER: f32 = 16.0;

/// Bytes of the steps' block, the alignment of a buffer binding's offset and size.
const BLOCK_STRIDE: u32 = 256;
const BLOCK_BYTES: u32 = 208;

/// Screen-space bounce light's settings, which the sketch's quality settings give.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounce {
    /// The samples that each texel gathers, from 1 to [`MAX_RAYS`].
    pub rays: u32,
    /// The most distance from a texel that a sample's surface lights it, in meters.
    pub max_distance: f32,
    /// From 0 to 1: the share of the ambient light that the bounce light takes.
    pub intensity: f32,
}

impl Default for Bounce {
    fn default() -> Self {
        Self {
            rays: 4,
            max_distance: MAX_DISTANCE,
            // The screen's disk over-represents what stands beside a texel, so the light takes a
            // share of the ambient light rather than all of it.
            intensity: 0.75,
        }
    }
}

/// The steps' block, as `bounce.wgsl` lays out its `Settings` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    projection: Mat4,
    inverse_projection: Mat4,
    corners: [f32; 4],
    extents: [f32; 4],
    ray: [f32; 4],
    shape: [f32; 4],
    copy: [f32; 4],
}

/// The GPU objects of screen-space bounce light, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BounceIds {
    /// The uniform buffer of the steps' settings.
    pub(crate) buffer: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The textures that each step reads at bindings 1 to 3: the depth copy, the horizon step's
/// target, and the color copy for the trace or the traced light for the denoise.
pub(crate) type StepSources = [[u32; 3]; STEPS];

/// The pipeline of a step: one triangle into its target.
const fn pipeline(step: usize) -> PipelineKey {
    let template = if step == 0 {
        template::BOUNCE_TRACE
    } else {
        template::BOUNCE_DENOISE
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format: FORMAT,
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// What a frame of the steps draws with, which the frame builder gives each frame while the bounce
/// light draws.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BounceFrame {
    pub(crate) bounce: Bounce,
    /// The camera's projection and its inverse.
    pub(crate) projection: (Mat4, Mat4),
}

impl BounceFrame {
    /// The most samples that the block takes, clamped to what the shader reads.
    fn rays(self) -> u32 {
        self.bounce.rays.clamp(1, MAX_RAYS)
    }
}

/// Screen-space bounce light's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct BouncePass {
    ids: BounceIds,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    uploaded: Option<[Block; STEPS]>,
    /// The textures that each step's bind group reads, or zeros before the groups exist.
    bound: StepSources,
}

impl BouncePass {
    /// The steps, with GPU objects from `ids`.
    pub(crate) fn new(ids: BounceIds) -> Self {
        Self {
            ids,
            pipelines: [None; STEPS],
            created: false,
            uploaded: None,
            bound: [[0; 3]; STEPS],
        }
    }

    /// Bytes a frame may copy into its arena: the steps' blocks.
    pub(crate) const UPLOAD_BYTES: usize = (BLOCK_STRIDE * STEPS as u32) as usize;

    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step)));
            }
        }
    }

    /// Makes the buffer when the GPU lacks it, uploads the settings when they changed, and binds
    /// each step to its `sources` when its group is new or the frame made the plan's textures
    /// again. `corner` is the screen texture's drawn corner.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        frame: &BounceFrame,
        canvas: (u32, u32),
        scale: RenderScale,
        corner: (u32, u32),
        sources: &StepSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BLOCK_STRIDE * STEPS as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            self.created = true;
        }
        let blocks = blocks(frame, canvas, scale, corner);
        if self.uploaded != Some(blocks) {
            for (step, block) in blocks.iter().enumerate() {
                let (at, bytes) = arena.push(bytes_of(block))?;
                list.push(
                    Op::WriteBuffer,
                    &[ids.buffer, step as u32 * BLOCK_STRIDE, at, bytes],
                )?;
            }
            self.uploaded = Some(blocks);
        }
        if !textures_made && self.bound == *sources {
            return Ok(());
        }
        for (step, &textures) in sources.iter().enumerate() {
            let offset = step as u32 * BLOCK_STRIDE;
            let mut words = [0; 23];
            words[..3].copy_from_slice(&[ids.first_group + step as u32, bind_layout::BOUNCE, 4]);
            words[3..8].copy_from_slice(&[
                0,
                resource_kind::BUFFER,
                ids.buffer,
                offset,
                BLOCK_BYTES,
            ]);
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
        }
        self.bound = *sources;
        Ok(())
    }

    /// Records step `step` inside the render pass that the render graph began into its target, over
    /// the corner `(width, height)`.
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
        self.bound = [[0; 3]; STEPS];
    }
}

/// The steps' blocks for a canvas of `canvas` pixels at render scale `scale`, on the screen
/// texture's drawn corner `corner`. The trace and the denoise read the same block; each reads the
/// fields that its own step uses.
fn blocks(
    frame: &BounceFrame,
    canvas: (u32, u32),
    scale: RenderScale,
    corner: (u32, u32),
) -> [Block; STEPS] {
    let render = Size::Full.viewport(canvas, scale);
    let extent = SIZE.extent(canvas);
    let (projection, inverse_projection) = frame.projection;
    let block = Block {
        projection,
        inverse_projection,
        corners: [
            render.0 as f32,
            render.1 as f32,
            corner.0 as f32,
            corner.1 as f32,
        ],
        // The depth copy and the steps' targets have the target size, which a lower render scale
        // draws a corner of, so the rows that these values turn are the targets' own.
        extents: [
            extent.0 as f32,
            extent.1 as f32,
            extent.0 as f32,
            extent.1 as f32,
        ],
        ray: [
            frame.rays() as f32,
            GATHER_RADIUS,
            frame.bounce.max_distance.max(1e-3),
            BIAS,
        ],
        shape: [EDGE_FADE, DENOISE_RADIUS, DEPTH_TOLERANCE, NORMAL_POWER],
        copy: [
            canvas.0.max(1) as f32,
            canvas.1.max(1) as f32,
            render.0 as f32,
            render.1 as f32,
        ],
    };
    [block; STEPS]
}

/// Writes screen-space bounce light's values into the camera's frame values: the strength, 0 when
/// the view draws none, and the spare values that the shader leaves.
pub(crate) fn write_frame_values(
    uniform: &mut crate::frame_data::FrameUniform,
    bounce: Option<Bounce>,
) {
    uniform.bounce = [
        bounce.map_or(0.0, |bounce| bounce.intensity.clamp(0.0, 1.0)),
        0.0,
        0.0,
        0.0,
    ];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shader_lays_out_the_block_as_the_core_writes_it() {
        let source = include_str!("../../null3d-shaders/wgsl/bounce.wgsl");
        let mut at = 0;
        for field in [
            "projection: mat4x4f,",
            "inverse_projection: mat4x4f,",
            "corners: vec4f,",
            "extents: vec4f,",
            "ray: vec4f,",
            "shape: vec4f,",
            "copy: vec4f,",
        ] {
            let found = source[at..].find(field).map(|k| k + at);
            assert!(found.is_some(), "bounce.wgsl lacks {field} in order");
            at = found.unwrap();
        }
        assert_eq!(std::mem::size_of::<Block>(), BLOCK_BYTES as usize);
    }

    #[test]
    fn a_new_scale_uploads_new_settings_and_makes_no_object() {
        let ids = BounceIds {
            buffer: 1,
            first_group: 2,
        };
        let mut pass = BouncePass::new(ids);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [[7, 7, 7], [8, 9, 7]];
        let frame = BounceFrame {
            bounce: Bounce::default(),
            projection: (Mat4::default(), Mat4::default()),
        };
        let mut draw = |pass: &mut BouncePass, list: &mut DrawList, scale| {
            list.clear();
            arena
                .reset(BouncePass::UPLOAD_BYTES)
                .expect("room for the test's uploads");
            pass.prepare(
                list,
                &mut arena,
                &frame,
                (320, 180),
                scale,
                (160, 90),
                &sources,
                false,
            )
            .unwrap();
        };
        draw(&mut pass, &mut list, RenderScale::FULL);
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(
            ops.iter().filter(|&&op| op == Op::CreateBindGroup).count(),
            STEPS
        );
        draw(&mut pass, &mut list, RenderScale::FULL);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        draw(&mut pass, &mut list, RenderScale::from_thousandths(700));
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(
            ops,
            [Op::WriteBuffer, Op::WriteBuffer],
            "a new scale only uploads the settings"
        );
    }
}
