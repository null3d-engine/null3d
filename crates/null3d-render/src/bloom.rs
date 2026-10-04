//! Bloom: light that spreads from the brightest parts of the scene, as three.js's UnrealBloomPass
//! spreads it. The render graph's bloom passes run between the scene passes and the final pass,
//! each a full-screen step at a fraction of the render size (see [`crate::frame_graph`]):
//!
//! 1. The bright pass reads the scene color at half size, with a linear filter, and keeps the
//!    pixels whose luminance reaches the threshold.
//! 2. Each of five levels blurs the level before it, the first the bright pass, with a Gaussian:
//!    across into one target, then down into another. Each level has half the size of the level
//!    before it, and a wider kernel, so the levels spread the light ever further.
//! 3. The final pass reads every level with a linear filter and adds their weighted sum to the
//!    scene color before the output transform, as three.js's composite and blend steps do.
//!
//! Every step reads a target that another step wrote, never its own, so no draw samples a texture
//! that it draws into. The kernels, the merged pairs of taps and the weights are three.js's, so a
//! port that keeps its strength, radius and threshold keeps its look. The number of taps is a
//! uniform value: a sample divisor spreads each kernel over that many times fewer filtered reads,
//! and changes no pipeline.
//!
//! The steps' settings live in one uniform buffer, a block of 256 bytes per step and one for the
//! final pass. A frame uploads it only when a setting, the canvas or the render scale changed, and
//! a new render scale makes no GPU object: the blocks clamp each read inside the drawn corner.
//!
//! WebGPU draws a corner into the first rows of its target. WebGL2 counts rows from the bottom and
//! draws a corner into the last ones, at the top, so its blocks place each corner there.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, layout as bind_layout,
    resource_kind, state_flags, template,
};

use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// Bloom's levels: blurred copies of the bright pass, each at half the size of the one before.
pub const LEVELS: usize = 5;

/// The steps of the chain before the final pass: the bright pass, then two blurs per level.
pub(crate) const STEPS: usize = 1 + 2 * LEVELS;

/// Each level's kernel, as three.js's UnrealBloomPass sizes it: the taps on one side of the
/// center, the center included. The Gaussian's sigma is a third of it.
const KERNELS: [u32; LEVELS] = [6, 10, 14, 18, 22];

/// Each level's weight before the radius moves it, three.js's `bloomFactors`.
const FACTORS: [f32; LEVELS] = [1.0, 0.8, 0.6, 0.4, 0.2];

/// The most pairs of taps on each side of a blur's center: the widest kernel's, merged in pairs.
const MAX_PAIRS: u32 = KERNELS[LEVELS - 1] / 2;

/// The largest sample divisor: each blur reads at least a quarter of three.js's taps.
pub const MAX_SAMPLE_DIVISOR: u32 = 4;

/// The soft edge of the bright pass's threshold, in luminance, as three.js's `smoothWidth`.
const KNEE: f32 = 0.01;

/// Bytes between two steps' blocks in the uniform buffer: the offset alignment that bind groups
/// need for a buffer range.
const BLOCK: usize = 256;

/// Where the final pass's block starts in the uniform buffer.
pub(crate) const FINAL_OFFSET: u32 = (STEPS * BLOCK) as u32;

/// Bytes of the uniform buffer: every step's block, then the final pass's.
const BUFFER_BYTES: usize = STEPS * BLOCK + std::mem::size_of::<FinalBlock>();

/// How bloom looks, with three.js's UnrealBloomPass's meanings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bloom {
    /// How bright the glow is: the sum of the levels' weights scales with it.
    pub strength: f32,
    /// From 0 to 1: how far the glow spreads, by moving weight from the narrow levels to the wide.
    pub radius: f32,
    /// The luminance from which a pixel glows, in linear color before the exposure.
    pub threshold: f32,
}

impl Default for Bloom {
    fn default() -> Self {
        Self {
            strength: 1.0,
            radius: 0.5,
            threshold: 1.0,
        }
    }
}

impl Bloom {
    /// Each level's weight in the final pass: three.js's factor, moved toward its mirror by the
    /// radius, times three times the strength.
    pub fn level_weights(self) -> [f32; LEVELS] {
        FACTORS.map(|factor| {
            let mirror = 1.2 - factor;
            3.0 * self.strength * (factor + (mirror - factor) * self.radius)
        })
    }
}

/// One step's block, as `bloom.wgsl` lays out its `Step` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct StepBlock {
    scale: [f32; 4],
    origin: [f32; 4],
    bounds: [f32; 4],
    center: f32,
    pairs: u32,
    threshold: f32,
    knee: f32,
    offsets: [f32; 12],
    weights: [f32; 12],
}

const _: () = assert!(std::mem::size_of::<StepBlock>() <= BLOCK);
const _: () = assert!(MAX_PAIRS as usize <= 12);

/// The final pass's block, as `final.wgsl` lays out its `Bloom` struct: the levels' weights.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct FinalBlock {
    weights: [f32; 8],
}

/// A Gaussian blur's taps on each side of its center: three.js's coefficients for a kernel of
/// `kernel` taps with sigma a third of it, merged in pairs as three.js merges them, into
/// `divisor` times fewer filtered reads per side, rounded up. Each read sits at the weighted mean
/// of the texels it merges and carries their sum, so a linear filter reads two neighbors in one tap
/// exactly. Fewer reads merge more texels each. Returns the center's weight, the number of reads
/// per side, and each read's offset and weight.
pub(crate) fn kernel(kernel: u32, divisor: u32) -> (f32, u32, [f32; 12], [f32; 12]) {
    let sigma = kernel as f32 / 3.0;
    let coefficient = |i: u32| {
        let i = i as f32;
        0.39894 * (-0.5 * i * i / (sigma * sigma)).exp() / sigma
    };
    let side = kernel - 1;
    let reads = side.div_ceil(2).div_ceil(divisor.max(1));
    let per_read = side.div_ceil(reads);
    let (mut offsets, mut weights) = ([0.0; 12], [0.0; 12]);
    let mut pairs = 0;
    let mut first = 1;
    while first <= side {
        let last = (first + per_read - 1).min(side);
        let (mut sum, mut moment) = (0.0, 0.0);
        for i in first..=last {
            sum += coefficient(i);
            moment += i as f32 * coefficient(i);
        }
        offsets[pairs] = moment / sum;
        weights[pairs] = sum;
        pairs += 1;
        first = last + 1;
    }
    (coefficient(0), pairs as u32, offsets, weights)
}

/// The size of the target that step `step` draws into.
pub(crate) fn step_size(step: usize) -> Size {
    if step == 0 {
        Size::HALF
    } else {
        Size::Halved(step.div_ceil(2) as u8)
    }
}

/// The size of the texture that step `step` reads: the scene color for the bright pass, else the
/// step before it.
fn source_size(step: usize) -> Size {
    if step == 0 {
        Size::Full
    } else {
        step_size(step - 1)
    }
}

/// The level whose kernel step `step` blurs with, or `None` for the bright pass.
fn level_of(step: usize) -> Option<usize> {
    (step > 0).then(|| (step - 1) / 2)
}

/// The rows before the drawn corner of a texture of `extent` rows whose corner has `corner` rows:
/// none on WebGPU, and the rows below it on WebGL2, which counts rows from the bottom and draws a
/// corner into its top rows.
const fn rows_before(extent: u32, corner: u32, rows_from_bottom: bool) -> u32 {
    if rows_from_bottom { extent - corner } else { 0 }
}

/// The block of step `step` for a canvas of `canvas` pixels at render scale `scale`, with rows
/// counted from the bottom on WebGL2 (`rows_from_bottom`).
fn step_block(
    step: usize,
    canvas: (u32, u32),
    scale: RenderScale,
    bloom: Bloom,
    divisor: u32,
    rows_from_bottom: bool,
) -> StepBlock {
    let (source, target) = (source_size(step), step_size(step));
    let corner = source.viewport(canvas, scale);
    let extent = source.extent(canvas);
    let drawn = target.viewport(canvas, scale);
    let per_pixel = [
        corner.0 as f32 / (drawn.0 as f32 * extent.0 as f32),
        corner.1 as f32 / (drawn.1 as f32 * extent.1 as f32),
    ];
    // A pixel's place in the target's corner maps onto the source's corner.
    let source_rows = rows_before(extent.1, corner.1, rows_from_bottom) as f32;
    let target_rows = rows_before(target.extent(canvas).1, drawn.1, rows_from_bottom) as f32;
    let origin = [
        0.0,
        source_rows / extent.1 as f32 - target_rows * per_pixel[1],
        0.0,
        0.0,
    ];
    let bounds = [
        0.5 / extent.0 as f32,
        (source_rows + 0.5) / extent.1 as f32,
        (corner.0 as f32 - 0.5) / extent.0 as f32,
        (source_rows + corner.1 as f32 - 0.5) / extent.1 as f32,
    ];
    match level_of(step) {
        None => StepBlock {
            scale: [per_pixel[0], per_pixel[1], 0.0, 0.0],
            origin,
            bounds,
            center: 1.0,
            pairs: 0,
            threshold: bloom.threshold,
            knee: KNEE,
            ..StepBlock::default()
        },
        Some(level) => {
            let (center, pairs, offsets, weights) = kernel(KERNELS[level], divisor);
            let across = step % 2 == 1;
            let direction = if across {
                [per_pixel[0], 0.0]
            } else {
                [0.0, per_pixel[1]]
            };
            StepBlock {
                scale: [per_pixel[0], per_pixel[1], direction[0], direction[1]],
                origin,
                bounds,
                center,
                pairs,
                // Every pixel passes: luminance is never below 0.
                threshold: -1.0,
                knee: 1.0,
                offsets,
                weights,
            }
        }
    }
}

/// The GPU objects of bloom, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BloomIds {
    /// The uniform buffer of every step's settings and the final pass's weights.
    pub(crate) buffer: u32,
    /// The linear sampler that every step and the final pass read with.
    pub(crate) sampler: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The pipeline of the steps: one triangle into a target of bloom's format.
const fn pipeline(format: u32) -> PipelineKey {
    PipelineKey {
        template: template::BLOOM,
        permutation: 0,
        vertex_format: 0,
        color_format: format,
        depth_format: null3d_gpu::drawlist::format::NONE,
        samples: 1,
        state: state_flags::CULL_NONE,
        bias: DepthBias::NONE,
    }
}

/// Bloom's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct BloomPass {
    ids: BloomIds,
    /// The format of bloom's targets: the scene color's.
    format: u32,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    pipeline: Option<u32>,
    created: bool,
    /// The uniform buffer's contents for this frame, and what the GPU holds.
    staged: [u8; BUFFER_BYTES],
    uploaded: Option<[u8; BUFFER_BYTES]>,
    /// The texture that each step's bind group reads, or 0 before the group exists.
    bound: [u32; STEPS],
}

impl BloomPass {
    /// Bloom's passes for targets of `format`, with GPU objects from `ids`, on WebGL2 with
    /// `rows_from_bottom`.
    pub(crate) fn new(ids: BloomIds, format: u32, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            format,
            rows_from_bottom,
            pipeline: None,
            created: false,
            staged: [0; BUFFER_BYTES],
            uploaded: None,
            bound: [0; STEPS],
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BUFFER_BYTES;

    /// Asks `pipelines` for the steps' pipeline, once.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache) -> u32 {
        *self
            .pipeline
            .get_or_insert_with(|| pipelines.id(pipeline(self.format)))
    }

    /// Makes the buffer and the sampler when the GPU lacks them, uploads the settings for the
    /// sample divisor `divisor` when they changed, and binds each step to `sources[step]`, the texture it reads, when the group is new
    /// or the frame made the plan's textures again.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        canvas: (u32, u32),
        scale: RenderScale,
        bloom: Bloom,
        divisor: u32,
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
        self.stage(canvas, scale, bloom, divisor);
        if self.uploaded.as_ref() != Some(&self.staged) {
            let (at, bytes) = arena.push(&self.staged)?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.uploaded = Some(self.staged);
        }
        for (step, &source) in sources.iter().enumerate() {
            if textures_made || self.bound[step] != source {
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
                        std::mem::size_of::<StepBlock>() as u32,
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
    fn stage(&mut self, canvas: (u32, u32), scale: RenderScale, bloom: Bloom, divisor: u32) {
        for step in 0..STEPS {
            let block = step_block(step, canvas, scale, bloom, divisor, self.rows_from_bottom);
            self.staged[step * BLOCK..][..std::mem::size_of::<StepBlock>()]
                .copy_from_slice(bytes_of(&block));
        }
        let weights = bloom.level_weights();
        let mut block = FinalBlock::default();
        block.weights[..LEVELS].copy_from_slice(&weights);
        self.staged[FINAL_OFFSET as usize..].copy_from_slice(bytes_of(&block));
    }

    /// Records step `step` inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self
            .pipeline
            .expect("bloom asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[0, self.ids.first_group + step as u32, 0],
        )?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// The uniform buffer and the sampler, which the final pass's group binds too.
    pub(crate) fn ids(&self) -> BloomIds {
        self.ids
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.uploaded = None;
        self.bound = [0; STEPS];
    }
}

/// A block's bytes: blocks are `repr(C)` and made of 4-byte fields only. Ambient occlusion's
/// block reads the same way.
pub(crate) fn bytes_of<T: Copy>(block: &T) -> &[u8] {
    // SAFETY: callers pass `repr(C)` blocks of 4-byte fields, which have no padding, so every
    // byte is initialized.
    unsafe {
        std::slice::from_raw_parts((block as *const T).cast::<u8>(), std::mem::size_of::<T>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// three.js's UnrealBloomPass's merged taps for a kernel, computed as its constructor does.
    fn three(kernel_radius: u32) -> (f32, Vec<f32>, Vec<f32>) {
        let sigma = kernel_radius as f64 / 3.0;
        let c: Vec<f64> = (0..kernel_radius)
            .map(|i| {
                let i = i as f64;
                0.39894 * (-0.5 * i * i / (sigma * sigma)).exp() / sigma
            })
            .collect();
        let (mut offsets, mut weights) = (Vec::new(), Vec::new());
        let mut i = 1;
        while i < kernel_radius as usize {
            let wa = c[i];
            let wb = if i + 1 < kernel_radius as usize {
                c[i + 1]
            } else {
                0.0
            };
            let w = wa + wb;
            offsets.push(((i as f64 * wa + (i + 1) as f64 * wb) / w) as f32);
            weights.push(w as f32);
            i += 2;
        }
        (c[0] as f32, offsets, weights)
    }

    #[test]
    fn every_level_takes_three_js_taps_at_full_samples() {
        for kernel_size in KERNELS {
            let (center, pairs, offsets, weights) = kernel(kernel_size, 1);
            let (three_center, three_offsets, three_weights) = three(kernel_size);
            assert!((center - three_center).abs() < 1e-6);
            assert_eq!(pairs as usize, three_offsets.len(), "kernel {kernel_size}");
            for k in 0..pairs as usize {
                assert!(
                    (offsets[k] - three_offsets[k]).abs() < 1e-4,
                    "kernel {kernel_size}"
                );
                assert!(
                    (weights[k] - three_weights[k]).abs() < 1e-6,
                    "kernel {kernel_size}"
                );
            }
        }
        assert_eq!(MAX_PAIRS, 11);
    }

    #[test]
    fn fewer_samples_keep_the_kernel_whole() {
        for kernel_size in KERNELS {
            let (center, full, _, full_weights) = kernel(kernel_size, 1);
            let full_sum: f32 = full_weights[..full as usize].iter().sum();
            for divisor in [2, 4] {
                let (c, pairs, offsets, weights) = kernel(kernel_size, divisor);
                assert_eq!(c, center);
                assert_eq!(pairs, full.div_ceil(divisor), "kernel {kernel_size}");
                let sum: f32 = weights[..pairs as usize].iter().sum();
                assert!(
                    (sum - full_sum).abs() < 1e-5,
                    "the reads carry every texel's weight"
                );
                // The mean distance of the reads, by weight, stays the kernel's, so the glow keeps
                // its width.
                let mean = |offsets: &[f32], weights: &[f32]| {
                    offsets.iter().zip(weights).map(|(o, w)| o * w).sum::<f32>()
                };
                let (_, _, full_offsets, _) = kernel(kernel_size, 1);
                let wide = mean(
                    &full_offsets[..full as usize],
                    &full_weights[..full as usize],
                );
                let narrow = mean(&offsets[..pairs as usize], &weights[..pairs as usize]);
                assert!((wide - narrow).abs() < 1e-3);
            }
        }
    }

    #[test]
    fn the_weights_follow_three_js_composite() {
        let bloom = Bloom {
            strength: 1.5,
            radius: 0.4,
            threshold: 0.85,
        };
        let weights = bloom.level_weights();
        let three = [1.0f32, 0.8, 0.6, 0.4, 0.2].map(|f| 3.0 * 1.5 * (f + ((1.2 - f) - f) * 0.4));
        assert_eq!(weights, three);
        // The weights add up to nine times the strength at any radius.
        for radius in [0.0, 0.5, 1.0] {
            let sum: f32 = Bloom { radius, ..bloom }.level_weights().iter().sum();
            assert!((sum - 9.0 * 1.5).abs() < 1e-4);
        }
    }

    #[test]
    fn each_step_halves_and_reads_the_one_before_inside_its_drawn_corner() {
        assert_eq!(step_size(0), Size::HALF);
        assert_eq!((step_size(1), step_size(2)), (Size::HALF, Size::HALF));
        assert_eq!(
            (step_size(9), step_size(10)),
            (Size::Halved(5), Size::Halved(5))
        );
        assert_eq!(source_size(3), Size::HALF);
        let canvas = (320, 180);
        let bloom = Bloom::default();
        // At the whole canvas, the bright pass reads two scene texels per pixel each way.
        let bright = step_block(0, canvas, RenderScale::FULL, bloom, 1, false);
        assert_eq!(bright.scale, [1.0 / 160.0, 1.0 / 90.0, 0.0, 0.0]);
        assert_eq!(
            bright.bounds,
            [0.5 / 320.0, 0.5 / 180.0, 319.5 / 320.0, 179.5 / 180.0]
        );
        assert_eq!((bright.threshold, bright.pairs), (1.0, 0));
        // At half scale, level 1's blur down reads only the drawn quarter of its source.
        let half = RenderScale::from_thousandths(500);
        let down = step_block(4, canvas, half, bloom, 1, false);
        assert_eq!(source_size(4), Size::QUARTER);
        // The source's corner is 40 x 23 of 80 x 45 texels, drawn into 40 x 23 pixels.
        assert_eq!(down.bounds[2], 39.5 / 80.0);
        assert_eq!(down.bounds[3], 22.5 / 45.0);
        assert_eq!(down.scale[2], 0.0);
        assert_eq!(down.scale[3], down.scale[1]);
        assert_eq!(down.pairs, 5);
        assert_eq!(down.origin, [0.0; 4]);
        // WebGL2 draws the same corners into the top rows: 22 rows lie below the source's corner,
        // and the target's corner of 23 of 45 rows starts at row 22.
        let gl = step_block(4, canvas, half, bloom, 1, true);
        assert_eq!(gl.bounds[1], 22.5 / 45.0);
        assert_eq!(gl.bounds[3], 44.5 / 45.0);
        let gl_place = |row: f32| row * gl.scale[1] + gl.origin[1];
        assert!(
            (gl_place(22.5) - 22.5 / 45.0).abs() < 1e-6,
            "row 0 of the corner reads row 0"
        );
    }

    #[test]
    fn a_new_scale_uploads_new_settings_and_makes_no_object() {
        let ids = BloomIds {
            buffer: 1,
            sampler: 2,
            first_group: 3,
        };
        let mut pass = BloomPass::new(ids, null3d_gpu::drawlist::format::RGBA16_FLOAT, false);
        let mut pipelines = PipelineCache::default();
        pass.request_pipeline(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [7; STEPS];
        let mut frame = |pass: &mut BloomPass, list: &mut DrawList, scale| {
            list.clear();
            arena.reset(BloomPass::UPLOAD_BYTES);
            pass.prepare(
                list,
                &mut arena,
                (320, 180),
                scale,
                Bloom::default(),
                1,
                &sources,
                false,
            )
            .unwrap();
        };
        frame(&mut pass, &mut list, RenderScale::FULL);
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(
            ops.iter().filter(|&&op| op == Op::CreateBindGroup).count(),
            STEPS
        );
        frame(&mut pass, &mut list, RenderScale::FULL);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        frame(&mut pass, &mut list, RenderScale::from_thousandths(700));
        let ops: Vec<_> = null3d_gpu::drawlist::decode(list.words())
            .map(|c| c.unwrap().op)
            .collect();
        assert_eq!(
            ops,
            [Op::WriteBuffer],
            "a new scale only uploads the settings"
        );
    }

    #[test]
    fn the_shaders_lay_out_the_blocks_as_the_core_writes_them() {
        let bloom = include_str!("../../null3d-shaders/wgsl/bloom.wgsl");
        for field in [
            "scale: vec4f,",
            "origin: vec4f,",
            "bounds: vec4f,",
            "center: f32,",
            "pairs: u32,",
            "threshold: f32,",
            "knee: f32,",
            "offsets: array<vec4f, 3>,",
            "weights: array<vec4f, 3>,",
        ] {
            assert!(bloom.contains(field), "bloom.wgsl lacks {field}");
        }
        assert_eq!(std::mem::size_of::<StepBlock>(), 160);
        let final_pass = include_str!("../../null3d-shaders/wgsl/final.wgsl");
        assert!(final_pass.contains("    weights: vec4f,\n    last: vec4f,\n"));
        assert_eq!(std::mem::size_of::<FinalBlock>(), 32);
    }
}
