//! Outlines around the objects that a sketch outlines, as three.js's OutlinePass draws them. The
//! render graph's outline passes run after the scene passes, and the final pass adds their result
//! (see [`crate::frame_graph`]):
//!
//! 1. The mask pass draws the outlined objects from the camera's view into a mask of the render
//!    size (see [`crate::view::ViewId::OUTLINE`]). Its depth target is the scene's depth, which it
//!    tests but never writes. Each object draws twice: once with no depth test, which marks every
//!    part of it in the red channel, and once with the test, which marks the parts that nothing
//!    hides in the green channel. The mask has the scene's samples, and resolves into a texture of
//!    one sample.
//! 2. The edge step reads the mask at half size, at the places where three.js's half-size copy of
//!    its mask has its texel centers, so the copy needs no pass of its own. Where the red channel
//!    changes, it writes the edge's color times the change, and the change as alpha: the visible
//!    color where some neighbor shows a part that nothing hides, else the hidden color.
//! 3. A separable Gaussian blur across and then down widens the edges at half size, with a kernel
//!    as wide as the thickness. A second blur at a quarter of the size, with three.js's fixed
//!    kernel, gives the glow.
//! 4. The final pass reads the mask and both blurred levels with a linear filter. Outside the
//!    outlined objects it adds the edges and the glow to the scene color before the output
//!    transform, as three.js's additive blend of its overlay adds them to its linear color.
//!
//! The blurs draw with bloom's steps (see [`crate::bloom`]). Every step reads a target that another
//! step wrote, never its own. The steps' settings live in one uniform buffer, a block of 256 bytes
//! per step, which a frame uploads only when a setting, the canvas or the render scale changed, so a
//! new render scale makes no GPU object.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    permutation, resource_kind, state_flags, template,
};

use crate::bloom::{self, BLOCK, StepBlock, Taps, bytes_of, corner_block};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::output::SceneColor;
use crate::pipelines::{DepthBias, DrawKey, PipelineCache, PipelineKey};

/// The steps after the mask pass: the edge step, then the thickness's blur across and down, then
/// the glow's blur across and down.
pub const STEPS: usize = 5;

/// The steps whose targets the final pass reads: the thickness's blur down, and the glow's.
pub(crate) const LEVEL_STEPS: [usize; 2] = [2, 4];

/// The format of the mask: coverage in red, and the parts that nothing hides in green.
pub const MASK_FORMAT: u32 = format::RGBA8_UNORM;

/// Taps on each side of the center of three.js's outline blurs (its `MAX_EDGE_THICKNESS` and
/// `MAX_EDGE_GLOW`).
const BLUR_TAPS: u32 = 4;

/// The kernel radius of the glow's blur, which three.js fixes at its `MAX_EDGE_GLOW`.
const GLOW_RADIUS: f32 = 4.0;

/// Bytes of the uniform buffer: a block for each step.
const BUFFER_BYTES: usize = STEPS * BLOCK;

/// How outlines look, with three.js's OutlinePass's meanings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Outline {
    /// The linear color of the edges of the parts that nothing hides (`visibleEdgeColor`).
    pub color: [f32; 3],
    /// The linear color of the edges of the hidden parts (`hiddenEdgeColor`). Black draws none.
    pub hidden_color: [f32; 3],
    /// How bright the edges are (`edgeStrength`).
    pub strength: f32,
    /// How wide the edges spread, as the radius of their blur in pixels of half the render size
    /// (`edgeThickness`).
    pub thickness: f32,
    /// How much of the wide glow joins the edges (`edgeGlow`).
    pub glow: f32,
}

impl Default for Outline {
    /// three.js's defaults.
    fn default() -> Self {
        Self {
            color: [1.0; 3],
            hidden_color: [0.1, 0.04, 0.02],
            strength: 3.0,
            thickness: 1.0,
            glow: 0.0,
        }
    }
}

/// The taps of three.js's outline blur of kernel radius `radius`: [`BLUR_TAPS`] taps on each side,
/// spread evenly out to the radius in pixels of the target, each weighted by a Gaussian with
/// sigma half the radius, and the weights divided by their sum. A radius of 0 blurs nothing.
pub(crate) fn blur_taps(radius: f32) -> Taps {
    let (mut offsets, mut weights) = ([0.0; 12], [0.0; 12]);
    if radius <= 0.0 {
        return (1.0, 0, offsets, weights);
    }
    let sigma = radius / 2.0;
    let pdf = |x: f32| 0.39894 * (-0.5 * x * x / (sigma * sigma)).exp() / sigma;
    let mut sum = pdf(0.0);
    for tap in 0..BLUR_TAPS as usize {
        let x = radius * (tap + 1) as f32 / BLUR_TAPS as f32;
        offsets[tap] = x;
        weights[tap] = pdf(x);
        sum += 2.0 * weights[tap];
    }
    for weight in &mut weights[..BLUR_TAPS as usize] {
        *weight /= sum;
    }
    (pdf(0.0) / sum, BLUR_TAPS, offsets, weights)
}

/// The size of the target that step `step` draws into: half the render size for the edges and
/// their blur, a quarter for the glow's.
pub(crate) fn step_size(step: usize) -> Size {
    if step < 3 { Size::HALF } else { Size::QUARTER }
}

/// The size of the texture that step `step` reads: the mask for the edge step, else the target
/// of the step before it.
fn source_size(step: usize) -> Size {
    if step == 0 {
        Size::Full
    } else {
        step_size(step - 1)
    }
}

/// The format of the edge and blur targets: half floats, as three.js's, where the scene draws HDR
/// color, and 8 bits where the device may have no float target.
pub(crate) const fn target_format(scene_color: SceneColor) -> u32 {
    if scene_color.is_hdr() {
        format::RGBA16_FLOAT
    } else {
        format::RGBA8_UNORM
    }
}

/// The edge step's block, as `outline_edge.wgsl` lays out its `Edge` struct: how a pixel maps onto
/// the mask, then both edge colors.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct EdgeBlock {
    scale: [f32; 4],
    origin: [f32; 4],
    bounds: [f32; 4],
    color: [f32; 4],
    hidden_color: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<EdgeBlock>() <= BLOCK);

/// The depth bias of the mask's draw of the parts that nothing hides, toward the camera: it lets a
/// surface pass the depth test against the depth that the scene passes drew for it.
const VISIBLE_BIAS: DepthBias = DepthBias {
    constant: 4,
    slope_bits: 0x3f80_0000,
};

/// The keys of the two pipelines that draw an outlined pair, which draws with `pipeline`, into the
/// mask: every part with no depth test, then the parts that nothing hides, nudged toward the
/// camera so that its own surface passes. Both draw both faces and write no depth, as three.js
/// draws its mask with both faces. The mask template places the vertices as the depth template
/// does.
pub(crate) const fn mask_keys(pipeline: DrawKey) -> (DrawKey, DrawKey) {
    let every = DrawKey {
        template: template::OUTLINE_MASK,
        permutation: 0,
        vertex_format: pipeline.vertex_format,
        state: state_flags::CULL_NONE | state_flags::NO_DEPTH_TEST,
        bias: DepthBias::NONE,
    };
    let visible = DrawKey {
        permutation: permutation::OUTLINE_VISIBLE,
        state: state_flags::CULL_NONE | state_flags::NO_DEPTH_WRITE,
        bias: VISIBLE_BIAS,
        ..every
    };
    (every, visible)
}

/// The GPU objects of the outline steps, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct OutlineIds {
    /// The uniform buffer of every step's settings.
    pub(crate) buffer: u32,
    /// The linear sampler that every step reads with.
    pub(crate) sampler: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The pipeline of the edge step: one triangle into a target of `format`.
const fn edge_pipeline(format: u32) -> PipelineKey {
    PipelineKey {
        template: template::OUTLINE_EDGE,
        ..bloom::pipeline(format)
    }
}

/// The outline steps' GPU objects, their settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct OutlinePass {
    ids: OutlineIds,
    /// The format of the edge and blur targets.
    format: u32,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    /// The edge step's pipeline, then the blurs'.
    pipelines: Option<(u32, u32)>,
    created: bool,
    /// The uniform buffer's contents for this frame, and what the GPU holds.
    staged: [u8; BUFFER_BYTES],
    uploaded: Option<[u8; BUFFER_BYTES]>,
    /// The texture that each step's bind group reads, or 0 before the group exists.
    bound: [u32; STEPS],
}

impl OutlinePass {
    /// The outline steps for a scene that draws into `scene_color`, with GPU objects from `ids`,
    /// on WebGL2 with `rows_from_bottom`.
    pub(crate) fn new(ids: OutlineIds, scene_color: SceneColor, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            format: target_format(scene_color),
            rows_from_bottom,
            pipelines: None,
            created: false,
            staged: [0; BUFFER_BYTES],
            uploaded: None,
            bound: [0; STEPS],
        }
    }

    /// The same steps for a scene that draws into `scene_color` from the next frame on. The GPU
    /// objects stay, and the pipelines are asked for again.
    pub(crate) fn set_scene_color(&mut self, scene_color: SceneColor) {
        self.format = target_format(scene_color);
        self.pipelines = None;
        self.bound = [0; STEPS];
    }

    /// The format of the edge and blur targets.
    pub(crate) fn format(&self) -> u32 {
        self.format
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BUFFER_BYTES;

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        if self.pipelines.is_none() {
            self.pipelines = Some((
                pipelines.id(edge_pipeline(self.format)),
                pipelines.id(bloom::pipeline(self.format)),
            ));
        }
    }

    /// Makes the buffer and the sampler when the GPU lacks them, uploads the settings for
    /// `outline` when they changed, and binds each step to `sources[step]`, the texture it reads,
    /// when the group is new or the frame made the plan's textures again.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        canvas: (u32, u32),
        scale: RenderScale,
        outline: Outline,
        sources: &[u32; STEPS],
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[
                    ids.buffer,
                    BUFFER_BYTES as u32,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            list.push(
                Op::CreateSampler,
                &[
                    ids.sampler,
                    address::CLAMP_TO_EDGE,
                    address::CLAMP_TO_EDGE,
                    address::CLAMP_TO_EDGE,
                    filter::LINEAR,
                    filter::LINEAR,
                    filter::NEAREST,
                    0f32.to_bits(),
                    0f32.to_bits(),
                    compare::NONE,
                    1,
                ],
            )?;
            self.created = true;
        }
        self.stage(canvas, scale, outline);
        if self.uploaded.as_ref() != Some(&self.staged) {
            let (at, bytes) = arena.push(&self.staged)?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.uploaded = Some(self.staged);
        }
        for (step, &source) in sources.iter().enumerate() {
            if textures_made || self.bound[step] != source {
                let block = if step == 0 {
                    std::mem::size_of::<EdgeBlock>()
                } else {
                    std::mem::size_of::<StepBlock>()
                };
                list.push(
                    Op::CreateBindGroup,
                    &[
                        ids.first_group + step as u32,
                        bind_layout::BLOOM,
                        3,
                        0,
                        resource_kind::BUFFER,
                        ids.buffer,
                        (step * BLOCK) as u32,
                        block as u32,
                        1,
                        resource_kind::TEXTURE,
                        source,
                        0,
                        0,
                        2,
                        resource_kind::SAMPLER,
                        ids.sampler,
                        0,
                        0,
                    ],
                )?;
                self.bound[step] = source;
            }
        }
        Ok(())
    }

    /// Writes every block of the uniform buffer into the staging copy.
    fn stage(&mut self, canvas: (u32, u32), scale: RenderScale, outline: Outline) {
        let rows = self.rows_from_bottom;
        let corner = corner_block(source_size(0), step_size(0), canvas, scale, rows);
        let [r, g, b] = outline.color;
        let [hr, hg, hb] = outline.hidden_color;
        let edge = EdgeBlock {
            scale: corner.scale,
            origin: corner.origin,
            bounds: corner.bounds,
            color: [r, g, b, 0.0],
            hidden_color: [hr, hg, hb, 0.0],
        };
        self.staged[..std::mem::size_of::<EdgeBlock>()].copy_from_slice(bytes_of(&edge));
        for step in 1..STEPS {
            let radius = if step < 3 {
                outline.thickness
            } else {
                GLOW_RADIUS
            };
            let block = corner_block(source_size(step), step_size(step), canvas, scale, rows)
                .blur(step % 2 == 1, blur_taps(radius));
            self.staged[step * BLOCK..][..std::mem::size_of::<StepBlock>()]
                .copy_from_slice(bytes_of(&block));
        }
    }

    /// Records step `step` inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let (edge, blur) = self
            .pipelines
            .expect("the outline steps ask for their pipelines before they record");
        let pipeline = if step == 0 { edge } else { blur };
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
        self.bound = [0; STEPS];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// three.js's separable blur in OutlinePass, as its fragment shader computes it: the weight of
    /// each tap, the center first, divided by their sum.
    fn three(kernel_radius: f32) -> Vec<(f32, f32)> {
        let sigma = kernel_radius as f64 / 2.0;
        let pdf = |x: f64| 0.39894 * (-0.5 * x * x / (sigma * sigma)).exp() / sigma;
        let mut taps = vec![(0.0, pdf(0.0))];
        let mut sum = pdf(0.0);
        for i in 1..=4 {
            let x = kernel_radius as f64 * i as f64 / 4.0;
            taps.push((x, pdf(x)));
            sum += 2.0 * pdf(x);
        }
        taps.into_iter()
            .map(|(x, w)| (x as f32, (w / sum) as f32))
            .collect()
    }

    #[test]
    fn the_blurs_take_three_js_taps() {
        for radius in [1.0, 2.5, 4.0] {
            let (center, pairs, offsets, weights) = blur_taps(radius);
            let taps = three(radius);
            assert!((center - taps[0].1).abs() < 1e-6);
            assert_eq!(pairs, 4);
            for k in 0..4 {
                assert!((offsets[k] - taps[k + 1].0).abs() < 1e-6);
                assert!((weights[k] - taps[k + 1].1).abs() < 1e-6);
            }
            let sum = center + 2.0 * weights[..4].iter().sum::<f32>();
            assert!(
                (sum - 1.0).abs() < 1e-5,
                "the weights keep the edge's light"
            );
        }
        assert_eq!(blur_taps(0.0).1, 0, "no thickness blurs nothing");
    }

    #[test]
    fn the_steps_halve_then_quarter_and_read_the_step_before() {
        assert_eq!(source_size(0), Size::Full);
        for step in 0..3 {
            assert_eq!(step_size(step), Size::HALF);
        }
        assert_eq!((step_size(3), step_size(4)), (Size::QUARTER, Size::QUARTER));
        assert_eq!(source_size(3), Size::HALF);
        assert_eq!(LEVEL_STEPS.map(step_size), [Size::HALF, Size::QUARTER]);
    }

    #[test]
    fn the_edge_step_reads_the_mask_where_three_js_copy_has_its_texel_centers() {
        let mut pass = OutlinePass::new(
            OutlineIds {
                buffer: 1,
                sampler: 2,
                first_group: 3,
            },
            SceneColor::from_format(format::RGBA16_FLOAT),
            false,
        );
        pass.stage((320, 180), RenderScale::FULL, Outline::default());
        let edge: EdgeBlock =
            unsafe { std::ptr::read_unaligned(pass.staged.as_ptr().cast::<EdgeBlock>()) };
        // Pixel 0's center, half a pixel in, lands between the mask's first two texels.
        let first = 0.5 * edge.scale[0] + edge.origin[0];
        assert!((first * 320.0 - 1.0).abs() < 1e-5);
        assert_eq!(edge.color, [1.0, 1.0, 1.0, 0.0]);
        assert_eq!(edge.hidden_color, [0.1, 0.04, 0.02, 0.0]);
    }

    #[test]
    fn a_new_scale_uploads_new_settings_and_makes_no_object() {
        let ids = OutlineIds {
            buffer: 1,
            sampler: 2,
            first_group: 3,
        };
        let scene = SceneColor::from_format(format::RGBA16_FLOAT);
        let mut pass = OutlinePass::new(ids, scene, false);
        pass.request_pipelines(&mut PipelineCache::default());
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [7; STEPS];
        let mut frame = |pass: &mut OutlinePass, list: &mut DrawList, scale| {
            list.clear();
            arena.reset(OutlinePass::UPLOAD_BYTES);
            let outline = Outline::default();
            pass.prepare(
                list,
                &mut arena,
                (320, 180),
                scale,
                outline,
                &sources,
                false,
            )
            .unwrap();
        };
        frame(&mut pass, &mut list, RenderScale::FULL);
        let groups = null3d_gpu::drawlist::decode(list.words())
            .filter(|c| c.unwrap().op == Op::CreateBindGroup)
            .count();
        assert_eq!(groups, STEPS);
        frame(&mut pass, &mut list, RenderScale::FULL);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        frame(&mut pass, &mut list, RenderScale::from_thousandths(600));
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(ops, [Op::WriteBuffer]);
    }

    #[test]
    fn the_mask_draws_every_part_then_the_parts_that_nothing_hides() {
        let pair = DrawKey {
            template: template::INSTANCED_LIT,
            permutation: permutation::ALPHA_MASK,
            vertex_format: 5,
            state: state_flags::BLEND_NORMAL,
            bias: DepthBias::from_polygon_offset(1.0, 1.0),
        };
        let (every, visible) = mask_keys(pair);
        assert_eq!(every.vertex_format, 5);
        assert_eq!(every.permutation, 0);
        assert_ne!(every.state & state_flags::NO_DEPTH_TEST, 0);
        assert_eq!(visible.permutation, permutation::OUTLINE_VISIBLE);
        assert_eq!(visible.state & state_flags::NO_DEPTH_TEST, 0);
        assert_ne!(visible.state & state_flags::NO_DEPTH_WRITE, 0);
        assert!(visible.bias.constant > 0, "toward the camera");
        assert_eq!(f32::from_bits(visible.bias.slope_bits), 1.0);
    }

    #[test]
    fn the_edge_shader_lays_out_its_block_as_the_core_writes_it() {
        let edge = include_str!("../../null3d-shaders/wgsl/outline_edge.wgsl");
        let fields: Vec<&str> = edge
            .lines()
            .skip_while(|line| *line != "struct Edge {")
            .take_while(|line| *line != "}")
            .filter(|line| line.ends_with("vec4f,"))
            .map(str::trim)
            .collect();
        assert_eq!(
            fields,
            [
                "scale: vec4f,",
                "origin: vec4f,",
                "bounds: vec4f,",
                "color: vec4f,",
                "hidden_color: vec4f,"
            ]
        );
        assert_eq!(std::mem::size_of::<EdgeBlock>(), 80);
    }
}
