//! Ambient occlusion: how much of the sky each surface sees, as three.js's GTAOPass finds it, which
//! the camera's opaque pass multiplies its ambient light by. The render graph's ambient occlusion
//! passes run between the depth prepass and the opaque pass (see [`crate::frame_graph`]), each a
//! full-screen step into a target of half the render size:
//!
//! 1. The depth step copies one texel of the prepass's depth per pixel: sample 0 of a multisampled
//!    target. The opaque pass draws the same depth, so the occlusion lines up with its surfaces.
//! 2. The horizon step is three.js's GTAO: it rebuilds each surface's normal from the depth around
//!    it, and searches a few slices around the view for the horizons that hide the sky.
//! 3. The denoise step is three.js's Poisson denoise: it blurs the occlusion over a disk of taps
//!    that keeps to the pixel's own surface, and writes it beside the depth.
//!
//! The opaque pass then reads the four texels around each pixel, weighted by how close their depth
//! lies to the pixel's own (`null3d::gtao`). It darkens only the ambient light, the light that
//! comes from all around, where three.js's pass darkens the finished image, direct light included.
//!
//! Every step reads a target that another step wrote, never its own. The settings live in one
//! uniform block that every step reads, uploaded only when a setting, the camera's lens, the
//! canvas, the render scale or the occlusion's scale changed. A new scale makes no GPU object: the
//! steps draw a corner of their targets, as the render scale's passes do. WebGL2 counts rows from
//! the bottom, and its shader builds turn rows around.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::bloom::bytes_of;
use crate::camera::Mat4;
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps before the opaque pass: the depth copy, the horizon search and the denoise.
pub(crate) const STEPS: usize = 3;

/// The format of each step's target: the depth copy in one float, then the occlusion with the
/// normal, then the occlusion with the depth.
pub(crate) const FORMATS: [u32; STEPS] = [
    format::R32_FLOAT,
    format::RGBA16_FLOAT,
    format::RGBA16_FLOAT,
];

/// The size of the steps' targets. A lower occlusion scale draws a corner of them.
pub(crate) const SIZE: Size = Size::HALF;

/// The largest occlusion scale: the targets' size, half the render size each way.
pub const MAX_SCALE: f32 = 0.5;

/// three.js's PoissonDenoise settings in GTAOPass: the luma, depth and normal phi, and the disk's
/// radius in pixels of the scene.
const DENOISE: [f32; 4] = [10.0, 2.0, 3.0, 8.0];

/// How ambient occlusion looks, with three.js's GTAOPass's meanings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ao {
    /// How far from a surface the search for the horizons reaches, in world units.
    pub radius: f32,
    /// How far in front of a surface, along the view, an occluder still counts, in world units.
    pub thickness: f32,
    /// How the search's steps spread over the radius: above 1 they gather near the surface.
    pub distance_exponent: f32,
    /// From 0 to 1: how much less the farther steps count.
    pub distance_falloff: f32,
    /// The power that the occlusion is raised to: above 1 darkens it.
    pub scale: f32,
    /// The samples of the horizon search: under 30 they take 3 slices, else 5.
    pub samples: u32,
    /// From 0 to 1: how much of the occlusion reaches the ambient light.
    pub intensity: f32,
}

impl Default for Ao {
    fn default() -> Self {
        Self {
            radius: 0.25,
            thickness: 1.0,
            distance_exponent: 1.0,
            distance_falloff: 1.0,
            scale: 1.0,
            samples: 16,
            intensity: 1.0,
        }
    }
}

impl Ao {
    /// The slices around the view and the steps along each, as three.js splits its samples.
    pub fn slices_and_steps(self) -> (u32, u32) {
        let samples = self.samples.max(1);
        let slices = if samples < 30 { 3 } else { 5 };
        (slices, samples.div_ceil(slices))
    }
}

/// The steps' block, as `ao.wgsl` lays out its `Settings` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Block {
    projection: Mat4,
    inverse_projection: Mat4,
    corners: [f32; 4],
    extents: [f32; 4],
    horizon: [f32; 4],
    shape: [f32; 4],
    denoise: [f32; 4],
}

/// Bytes of the uniform buffer.
const BLOCK_BYTES: usize = std::mem::size_of::<Block>();

/// The drawn corner of the steps' targets: the render size times the occlusion scale, rounded up,
/// at least one pixel each way.
pub(crate) fn corner(canvas: (u32, u32), scale: RenderScale, ao_scale: f32) -> (u32, u32) {
    let (width, height) = Size::Full.viewport(canvas, scale);
    let ao_scale = ao_scale.clamp(0.0, MAX_SCALE);
    let side = |pixels: u32| ((pixels as f32 * ao_scale).ceil() as u32).clamp(1, pixels.max(1));
    (side(width), side(height))
}

/// The frame uniform's occlusion values for the camera's view: the strength, the scene target's
/// height, and the steps' texels per scene pixel across and down.
pub(crate) fn frame_values(
    ao: Ao,
    canvas: (u32, u32),
    scale: RenderScale,
    ao_scale: f32,
) -> [f32; 4] {
    let render = Size::Full.viewport(canvas, scale);
    let drawn = corner(canvas, scale, ao_scale);
    [
        ao.intensity.max(f32::MIN_POSITIVE),
        canvas.1.max(1) as f32,
        drawn.0 as f32 / render.0.max(1) as f32,
        drawn.1 as f32 / render.1.max(1) as f32,
    ]
}

/// The GPU objects of ambient occlusion, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct AoIds {
    /// The uniform buffer of the steps' settings.
    pub(crate) buffer: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The texture that each step reads at binding 1, and at binding 2. The horizon step reads only
/// the first, and binds it at both.
pub(crate) type StepSources = [[u32; 2]; STEPS];

/// The pipeline of a step: one triangle into its target.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let template = match step {
        0 if multisampled => template::AO_DEPTH_MS,
        0 => template::AO_DEPTH,
        1 => template::AO,
        _ => template::AO_DENOISE,
    };
    PipelineKey {
        template,
        permutation: 0,
        vertex_format: 0,
        color_format: FORMATS[step],
        depth_format: format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// Ambient occlusion's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct AoPass {
    ids: AoIds,
    /// True when the scene's depth target is multisampled, so the depth step reads sample 0.
    multisampled: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged: Block,
    uploaded: Option<Block>,
    /// The textures that each step's bind group reads, or zeros before the group exists.
    bound: StepSources,
}

impl AoPass {
    /// Ambient occlusion's steps, with GPU objects from `ids`, for a scene depth of `samples`.
    pub(crate) fn new(ids: AoIds, samples: u32) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            pipelines: [None; STEPS],
            created: false,
            staged: Block::default(),
            uploaded: None,
            bound: [[0; 2]; STEPS],
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BLOCK_BYTES;

    /// Asks `pipelines` for the steps' pipelines, once.
    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step, self.multisampled)));
            }
        }
    }

    /// Makes the buffer when the GPU lacks it, uploads the settings when they changed, and binds
    /// each step to its `sources` when its group is new or the frame made the plan's textures
    /// again. `projection` is the camera's projection matrix and `inverse` its inverse.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        ao: Ao,
        (projection, inverse): (Mat4, Mat4),
        canvas: (u32, u32),
        scale: RenderScale,
        ao_scale: f32,
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
        self.staged = block(ao, projection, inverse, canvas, scale, ao_scale);
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
            let buffer = [0, resource_kind::BUFFER, ids.buffer, 0, BLOCK_BYTES as u32];
            if step == 0 {
                let layout = if self.multisampled {
                    bind_layout::AO_DEPTH_MS
                } else {
                    bind_layout::AO_DEPTH
                };
                let mut words = [0; 13];
                words[..3].copy_from_slice(&[group, layout, 2]);
                words[3..8].copy_from_slice(&buffer);
                words[8..].copy_from_slice(&[1, resource_kind::TEXTURE, textures[0], 0, 0]);
                list.push(Op::CreateBindGroup, &words)?;
            } else {
                let mut words = [0; 18];
                words[..3].copy_from_slice(&[group, bind_layout::AO, 3]);
                words[3..8].copy_from_slice(&buffer);
                words[8..13].copy_from_slice(&[1, resource_kind::TEXTURE, textures[0], 0, 0]);
                words[13..].copy_from_slice(&[2, resource_kind::TEXTURE, textures[1], 0, 0]);
                list.push(Op::CreateBindGroup, &words)?;
            }
            self.bound[step] = textures;
        }
        Ok(())
    }

    /// Records step `step` inside the render pass that the render graph began into its target,
    /// over the corner that the occlusion scale draws.
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

/// Records the creation of the texture that frame groups bind in place of ambient occlusion's
/// while it draws no frame: one texel, which no shader reads, as the frame's strength is 0 then.
pub(crate) fn create_blank(list: &mut DrawList, id: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            id,
            1,
            1,
            1,
            FORMATS[STEPS - 1],
            null3d_gpu::drawlist::texture_usage::TEXTURE_BINDING,
            1,
            1,
            null3d_gpu::drawlist::view::D2,
        ],
    )?;
    Ok(())
}

/// The steps' block for a canvas of `canvas` pixels at render scale `scale`.
fn block(
    ao: Ao,
    projection: Mat4,
    inverse: Mat4,
    canvas: (u32, u32),
    scale: RenderScale,
    ao_scale: f32,
) -> Block {
    let render = Size::Full.viewport(canvas, scale);
    let drawn = corner(canvas, scale, ao_scale);
    let extent = SIZE.extent(canvas);
    let (slices, steps) = ao.slices_and_steps();
    let [luma, depth, normal, radius] = DENOISE;
    Block {
        projection,
        inverse_projection: inverse,
        corners: [
            render.0 as f32,
            render.1 as f32,
            drawn.0 as f32,
            drawn.1 as f32,
        ],
        extents: [
            canvas.0.max(1) as f32,
            canvas.1.max(1) as f32,
            extent.0 as f32,
            extent.1 as f32,
        ],
        horizon: [
            ao.radius,
            ao.thickness,
            ao.distance_exponent,
            ao.distance_falloff,
        ],
        shape: [ao.scale, slices as f32, steps as f32, 0.0],
        // The disk's radius in texels of the steps, from three.js's in pixels of the scene.
        denoise: [
            luma,
            depth,
            normal,
            radius * drawn.0 as f32 / render.0.max(1) as f32,
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_split_into_slices_and_steps_as_three_js_splits_them() {
        let split = |samples| {
            Ao {
                samples,
                ..Ao::default()
            }
            .slices_and_steps()
        };
        assert_eq!(split(16), (3, 6));
        assert_eq!(split(8), (3, 3));
        assert_eq!(split(32), (5, 7));
        assert_eq!(split(0), (3, 1));
    }

    #[test]
    fn the_corner_is_the_render_size_times_the_scale_rounded_up() {
        let canvas = (320, 181);
        assert_eq!(corner(canvas, RenderScale::FULL, 0.5), (160, 91));
        assert_eq!(corner(canvas, RenderScale::FULL, 0.25), (80, 46));
        let half = RenderScale::from_thousandths(500);
        assert_eq!(corner(canvas, half, 0.5), (80, 46));
        // The corner always fits the targets of half the canvas's size.
        let extent = SIZE.extent(canvas);
        for thousandths in [250, 500, 750, 1000] {
            let drawn = corner(canvas, RenderScale::from_thousandths(thousandths), 0.5);
            assert!(drawn.0 <= extent.0 && drawn.1 <= extent.1);
        }
        let values = frame_values(Ao::default(), canvas, RenderScale::FULL, 0.5);
        assert_eq!(values, [1.0, 181.0, 0.5, 91.0 / 181.0]);
    }

    #[test]
    fn a_new_scale_uploads_new_settings_and_makes_no_object() {
        let ids = AoIds {
            buffer: 1,
            first_group: 2,
        };
        let mut pass = AoPass::new(ids, 4);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [[7, 7], [8, 8], [8, 9]];
        let lens = (Mat4::default(), Mat4::default());
        let mut frame = |pass: &mut AoPass, list: &mut DrawList, scale, ao_scale| {
            list.clear();
            arena.reset(AoPass::UPLOAD_BYTES);
            pass.prepare(
                list,
                &mut arena,
                Ao::default(),
                lens,
                (320, 180),
                scale,
                ao_scale,
                &sources,
                false,
            )
            .unwrap();
        };
        frame(&mut pass, &mut list, RenderScale::FULL, 0.5);
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(
            ops.iter().filter(|&&op| op == Op::CreateBindGroup).count(),
            STEPS
        );
        frame(&mut pass, &mut list, RenderScale::FULL, 0.5);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        for (scale, ao_scale) in [
            (RenderScale::from_thousandths(700), 0.5),
            (RenderScale::FULL, 0.25),
        ] {
            frame(&mut pass, &mut list, scale, ao_scale);
            let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
                .map(|c| c.unwrap().op)
                .collect();
            assert_eq!(
                ops,
                [Op::WriteBuffer],
                "a new scale only uploads the settings"
            );
        }
    }

    #[test]
    fn the_shader_lays_out_the_block_as_the_core_writes_it() {
        let source = include_str!("../../null3d-shaders/wgsl/ao.wgsl");
        let fields = [
            "projection: mat4x4f,",
            "inverse_projection: mat4x4f,",
            "corners: vec4f,",
            "extents: vec4f,",
            "horizon: vec4f,",
            "shape: vec4f,",
            "denoise: vec4f,",
        ];
        let mut at = 0;
        for field in fields {
            let found = source[at..].find(field).map(|k| k + at);
            assert!(found.is_some(), "ao.wgsl lacks {field} in order");
            at = found.unwrap();
        }
        assert_eq!(BLOCK_BYTES, 208);
    }
}
