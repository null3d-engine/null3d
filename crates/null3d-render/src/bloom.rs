//! Bloom: light that spreads from the brightest parts of the scene, through a chain of mip levels,
//! as Call of Duty: Advanced Warfare, Bevy and Filament spread it. The render graph's bloom passes
//! run between the scene passes and the final pass (see [`crate::frame_graph`]):
//!
//! 1. Steps down: the first reads the scene color, limits it to what a 16-bit float holds, keeps
//!    what passes the threshold, and takes a 13-tap filter with a Karis average into the base
//!    level. Each later step takes the same filter, without the average, from the level above
//!    into a level of half its size.
//! 2. Steps up: from the smallest level back to the base, each step reads the level below with a
//!    3x3 tent and blends it over its own level by the level's mix, through premultiplied
//!    blending into the same target. So the base level ends with every level's light in it, each
//!    level holding its share of the glow.
//! 3. The final pass reads the base level once and mixes, adds or screens it into the scene color
//!    before the output transform.
//!
//! The levels have the canvas's shape and a fixed number of texels on its short side, so the glow
//! keeps its size as a share of the screen at any pixel ratio, render scale or orientation. The
//! reference chain has [`LEVELS`] levels from [`MAX_SIZE`] texels down to 1. Each level takes a
//! share of the glow, its weight, and a frame draws only the levels up to the last one with a
//! weight: the default weights reach the level of 4 texels, a quarter of the short side. A smaller
//! base drops the narrowest levels and keeps the widest, so the glow keeps its size: its finest
//! detail folds into the base level, with the shares of the levels it drops. The quality setting
//! sets the base, which is never more than half the canvas's short side.
//!
//! The governor's step halves the base during play with no new GPU object: every level draws into
//! a corner of half its target, and the steps of the last level do not run. A new render scale
//! changes only where the first step reads the scene color. The steps' settings live in one
//! uniform buffer, a block of 256 bytes per step and one for the final pass. A frame writes and
//! uploads it only when a setting, the canvas, the render scale or the governor's step changed.
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

/// The levels of the reference chain, whose base has [`MAX_SIZE`] texels on the short side and
/// whose last level has 1.
pub const LEVELS: usize = 10;

/// Texels on the short side of the reference chain's base level.
pub const MAX_SIZE: u32 = 512;

/// The fewest texels on the base's short side that the quality settings give it.
pub const MIN_SIZE: u32 = 4;

/// The format of the chain's levels: 16-bit floats, whatever the scene color's format. Each level
/// is written twice, by its step down and its step up, from levels that were written the same way.
/// In the scene color's smaller float format the rounding of those writes adds up, so the glow
/// loses light, most in blue, which has the fewest bits (D-21).
pub(crate) const FORMAT: u32 = null3d_gpu::drawlist::format::RGBA16_FLOAT;

/// The most steps of the chain: a step down into each level, then a step up into each but the
/// last.
pub(crate) const STEPS: usize = 2 * LEVELS - 1;

/// The kinds of step that `bloom.wgsl` draws: the first step down, a later step down, a step up.
const MODE_FIRST_DOWN: u32 = 0;
const MODE_DOWN: u32 = 1;
const MODE_UP: u32 = 2;

/// Bytes between two steps' blocks in the uniform buffer: the offset alignment that bind groups
/// need for a buffer range.
const BLOCK: usize = 256;

/// Where the final pass's block starts in the uniform buffer.
pub(crate) const FINAL_OFFSET: u32 = (STEPS * BLOCK) as u32;

/// Bytes of the uniform buffer: every step's block, then the final pass's.
const BUFFER_BYTES: usize = STEPS * BLOCK + std::mem::size_of::<FinalBlock>();

/// Each reference level's share of the glow by default, narrowest first: the shares of Bevy's
/// natural preset over its 8 levels, whose steps up keep 0.72, 0.74, then 0.745 of the light from
/// below. The two widest levels take none, so they do not draw.
pub const DEFAULT_WEIGHTS: [f32; LEVELS] = [
    0.28, 0.1872, 0.1359, 0.1012, 0.0754, 0.0562, 0.0419, 0.1223, 0.0, 0.0,
];

/// How the glow meets the scene color in the final pass.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Blend {
    /// The scene color moves toward the glow by the intensity, from 0 to 1, which keeps the
    /// image's light, as Bevy's default does.
    #[default]
    Mix,
    /// The glow, times the intensity, adds to the scene color, as three.js's bloom adds.
    Add,
    /// The glow, times the intensity, screens the scene color, as pmndrs's SCREEN blend does:
    /// `a + b - min(a * b, 1)`.
    Screen,
}

impl Blend {
    /// The blend of its code: 0 mixes, 1 adds, 2 screens.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Mix),
            1 => Some(Self::Add),
            2 => Some(Self::Screen),
            _ => None,
        }
    }

    /// The code that `final.wgsl` reads.
    const fn code(self) -> f32 {
        match self {
            Self::Mix => 0.0,
            Self::Add => 1.0,
            Self::Screen => 2.0,
        }
    }
}

/// How bloom looks.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bloom {
    /// The glow's weight in the blend: its share from 0 to 1 when it mixes, else its factor.
    pub intensity: f32,
    /// The luminance from which a pixel glows, in linear color before the exposure. At 0 every
    /// pixel glows.
    pub threshold: f32,
    /// The width of the threshold's soft edge, in luminance.
    pub knee: f32,
    /// How the glow meets the scene color.
    pub blend: Blend,
    /// Each reference level's share of the glow, narrowest first. They need not sum to 1: the
    /// chain divides them by their sum.
    pub weights: [f32; LEVELS],
}

impl Default for Bloom {
    fn default() -> Self {
        Self {
            intensity: 0.15,
            threshold: 0.0,
            knee: 0.1,
            blend: Blend::Mix,
            weights: DEFAULT_WEIGHTS,
        }
    }
}

impl Bloom {
    /// The levels that a chain whose base is reference level `offset` draws, of the `available`
    /// ones: those up to the last level with a weight above 0, and at least the base.
    fn drawn_levels(&self, offset: usize, available: usize) -> usize {
        let last = self
            .weights
            .iter()
            .rposition(|&w| w.is_finite() && w > 0.0)
            .unwrap_or(0);
        (last.saturating_sub(offset) + 1).clamp(1, available.max(1))
    }

    /// The mix of each step up of a chain whose base is reference level `offset`, so that each
    /// level holds its share of the glow. The base takes the shares of the reference levels it
    /// folds in. A step up into level `k` keeps `1 - mix` of level `k`'s own light, and the rest
    /// comes from the levels below.
    fn mixes(&self, offset: usize) -> [f32; LEVELS] {
        let weights = self
            .weights
            .map(|w| if w.is_finite() { w.max(0.0) } else { 0.0 });
        let sum: f32 = weights.iter().sum();
        let mut shares = [0.0; LEVELS];
        if sum > 0.0 {
            for (reference, weight) in weights.iter().enumerate() {
                shares[reference.saturating_sub(offset)] += weight / sum;
            }
        } else {
            shares[0] = 1.0;
        }
        let mut mixes = [0.0; LEVELS];
        let mut rest = 1.0f32;
        for (mix, share) in mixes.iter_mut().zip(shares) {
            *mix = if rest > 1e-6 {
                (1.0 - share / rest).clamp(0.0, 1.0)
            } else {
                0.0
            };
            rest *= *mix;
        }
        mixes
    }
}

/// The levels a chain declares for a base of `size` texels on the short side: the reference
/// chain's, less one for each halving of [`MAX_SIZE`] down to `size`.
pub fn declared_levels(size: u32) -> usize {
    let size = size.clamp(MIN_SIZE, MAX_SIZE);
    LEVELS - (MAX_SIZE / size).ilog2() as usize
}

/// The size of level `level` of a chain whose base has `size` texels on the short side.
pub(crate) fn level_size(size: u32, level: usize) -> Size {
    Size::ShortSide {
        texels: size.clamp(MIN_SIZE, MAX_SIZE) as u16,
        halvings: level as u8,
    }
}

/// The chain's base size, which the quality setting sets, and the governor's halvings of it, which
/// draw each level into a corner of its target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ChainFrame {
    /// Texels on the base's short side, which the quality setting sets.
    pub(crate) size: u32,
    /// The governor's halvings of the base: each draws every level into a corner of half its
    /// target, and drops the last level.
    pub(crate) halvings: u32,
}

impl Default for ChainFrame {
    fn default() -> Self {
        Self {
            size: MAX_SIZE,
            halvings: 0,
        }
    }
}

impl ChainFrame {
    /// The reference level that the frame's base draws for a canvas of `canvas` pixels, and the
    /// levels it has from there: the declared levels, less one for each halving of the base that
    /// half the canvas's short side needs, and less the governor's halvings. At least the base.
    pub(crate) fn levels(self, canvas: (u32, u32)) -> (usize, usize) {
        let size = self.size.clamp(MIN_SIZE, MAX_SIZE);
        let fitted = Size::short_side(size as u16, canvas);
        let canvas_halvings = (size / fitted.max(1)).ilog2() as usize;
        let available = declared_levels(size)
            .saturating_sub(canvas_halvings + self.halvings as usize)
            .max(1);
        (LEVELS - available, available)
    }
}

/// The level that step `step` of a chain of `levels` declared levels draws into, the level it
/// reads (`None` for the scene color), and whether it steps up.
fn chain_step(step: usize, levels: usize) -> (usize, Option<usize>, bool) {
    if step < levels {
        (step, step.checked_sub(1), false)
    } else {
        let level = 2 * levels - 2 - step;
        (level, Some(level + 1), true)
    }
}

/// True when step `step` of a chain of `levels` declared levels draws in a frame that draws
/// `active` levels: the steps down into those levels, and the steps up into each but the last.
pub(crate) fn step_draws(step: usize, levels: usize, active: usize) -> bool {
    let (level, _, up) = chain_step(step, levels);
    if up {
        level + 1 < active
    } else {
        level < active
    }
}

/// One step's block, as `bloom.wgsl` lays out its `Step` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct StepBlock {
    scale: [f32; 4],
    origin: [f32; 4],
    bounds: [f32; 4],
    threshold: f32,
    knee: f32,
    mode: u32,
    mix: f32,
}

const _: () = assert!(std::mem::size_of::<StepBlock>() <= BLOCK);

/// The final pass's block, as `final.wgsl` lays out its `Bloom` struct: the base level's drawn
/// corner in texels, the intensity, and the blend's code.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct FinalBlock {
    glow: [f32; 4],
}

/// The rows before the drawn corner of a texture of `extent` rows whose corner has `corner` rows:
/// none on WebGPU, and the rows below it on WebGL2, which counts rows from the bottom and draws a
/// corner into its top rows.
const fn rows_before(extent: u32, corner: u32, rows_from_bottom: bool) -> u32 {
    if rows_from_bottom { extent - corner } else { 0 }
}

/// A texture's size and the corner that a frame draws into it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Area {
    extent: (u32, u32),
    corner: (u32, u32),
}

/// Where the chain's textures and corners lie in one frame.
#[derive(Clone, Copy, Debug)]
struct Layout {
    canvas: (u32, u32),
    scale: RenderScale,
    size: u32,
    halvings: u32,
}

impl Layout {
    /// The area of level `level`: its target, and the corner of the governor's halvings.
    fn level(self, level: usize) -> Area {
        let base = level_size(self.size, 0).extent(self.canvas);
        let halve = |times: usize| {
            let by = 1u32 << times.min(31);
            (base.0.div_ceil(by), base.1.div_ceil(by))
        };
        Area {
            extent: halve(level),
            corner: halve(level + self.halvings as usize),
        }
    }

    /// The scene color's area: the canvas, and the corner of the render scale.
    fn scene(self) -> Area {
        Area {
            extent: Size::Full.extent(self.canvas),
            corner: Size::Full.viewport(self.canvas, self.scale),
        }
    }
}

/// The block of step `step` of a chain of `levels` declared levels, whose base is reference
/// level `offset`, for the frame's `layout`, with rows counted from the bottom on WebGL2
/// (`rows_from_bottom`).
fn step_block(
    step: usize,
    levels: usize,
    bloom: &Bloom,
    mixes: &[f32; LEVELS],
    layout: Layout,
    rows_from_bottom: bool,
) -> StepBlock {
    let (level, source_level, up) = chain_step(step, levels);
    let source = source_level.map_or(layout.scene(), |l| layout.level(l));
    let target = layout.level(level);
    let (extent, corner, drawn) = (source.extent, source.corner, target.corner);
    let per_pixel = [
        corner.0 as f32 / (drawn.0 as f32 * extent.0 as f32),
        corner.1 as f32 / (drawn.1 as f32 * extent.1 as f32),
    ];
    // A pixel's place in the target's corner maps onto the source's corner.
    let source_rows = rows_before(extent.1, corner.1, rows_from_bottom) as f32;
    let target_rows = rows_before(target.extent.1, drawn.1, rows_from_bottom) as f32;
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
    // A step down spaces its taps by half a pixel of its target: a source texel where the source
    // has twice the target's size. A step up spaces its tent by a texel of its source.
    let spacing = if up {
        [1.0 / extent.0 as f32, 1.0 / extent.1 as f32]
    } else {
        [0.5 * per_pixel[0], 0.5 * per_pixel[1]]
    };
    let first = source_level.is_none();
    StepBlock {
        scale: [per_pixel[0], per_pixel[1], spacing[0], spacing[1]],
        origin,
        bounds,
        threshold: if first { bloom.threshold.max(0.0) } else { 0.0 },
        knee: bloom.knee.max(0.0),
        mode: if up {
            MODE_UP
        } else if first {
            MODE_FIRST_DOWN
        } else {
            MODE_DOWN
        },
        mix: if up { mixes[level] } else { 0.0 },
    }
}

/// Texture reads per pixel of the canvas, counted over every step and the final pass's read, for
/// `bloom` on a canvas of `canvas` pixels, with a base of `size` texels halved `halvings` times:
/// the measure that D-21 compares methods by. The second number counts the reads of the steps
/// up's blending, which reads each target once.
pub fn texels_per_pixel(bloom: &Bloom, canvas: (u32, u32), size: u32, halvings: u32) -> (f64, f64) {
    let frame = ChainFrame { size, halvings };
    let layout = Layout {
        canvas,
        scale: RenderScale::FULL,
        size,
        halvings,
    };
    let (offset, available) = frame.levels(canvas);
    let active = bloom.drawn_levels(offset, available);
    let canvas_pixels = f64::from(canvas.0.max(1)) * f64::from(canvas.1.max(1));
    let (mut reads, mut blends) = (0.0, 0.0);
    for level in 0..active {
        let (w, h) = layout.level(level).corner;
        let pixels = f64::from(w) * f64::from(h);
        reads += 13.0 * pixels;
        if level + 1 < active {
            reads += 9.0 * pixels;
            blends += pixels;
        }
    }
    (reads / canvas_pixels + 1.0, blends / canvas_pixels)
}

/// The GPU objects of bloom, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct BloomIds {
    /// The uniform buffer of every step's settings and the final pass's.
    pub(crate) buffer: u32,
    /// The linear sampler that every step and the final pass read with.
    pub(crate) sampler: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The pipeline of the steps: one triangle into a target of bloom's format. The steps up blend
/// over their target, premultiplied by the step's mix.
const fn pipeline(format: u32, blend: bool) -> PipelineKey {
    PipelineKey {
        template: template::BLOOM,
        permutation: 0,
        vertex_format: 0,
        color_format: format,
        depth_format: null3d_gpu::drawlist::format::NONE,
        samples: 1,
        state: if blend {
            state_flags::CULL_NONE | state_flags::BLEND_NORMAL
        } else {
            state_flags::CULL_NONE
        },
        bias: DepthBias::NONE,
    }
}

/// What a frame's settings depend on. The frame writes them again only when one changes.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Staged {
    canvas: (u32, u32),
    scale: RenderScale,
    frame: ChainFrame,
    bloom: Bloom,
}

/// Bloom's GPU objects, its settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct BloomPass {
    ids: BloomIds,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    /// The levels declared, which the base's size sets.
    levels: usize,
    /// The pipelines of the steps down and of the steps up.
    pipelines: Option<(u32, u32)>,
    created: bool,
    /// The uniform buffer's contents, and the inputs they were written for, which the GPU holds.
    staged: [u8; BUFFER_BYTES],
    staged_for: Option<Staged>,
    /// The levels that the frame draws.
    active: usize,
    /// The corner that each step draws into.
    corners: [(u32, u32); STEPS],
    /// The texture that each step's bind group reads, or 0 before the group exists.
    bound: [u32; STEPS],
}

impl BloomPass {
    /// Bloom's passes for a base of `size` texels on the short side, with GPU objects from `ids`,
    /// on WebGL2 with `rows_from_bottom`.
    pub(crate) fn new(ids: BloomIds, size: u32, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            rows_from_bottom,
            levels: declared_levels(size),
            pipelines: None,
            created: false,
            staged: [0; BUFFER_BYTES],
            staged_for: None,
            active: 0,
            corners: [(1, 1); STEPS],
            bound: [0; STEPS],
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BUFFER_BYTES;

    /// The levels declared.
    pub(crate) fn levels(&self) -> usize {
        self.levels
    }

    /// The steps declared: a step down into each level, then a step up into each but the last.
    pub(crate) fn steps(&self) -> usize {
        2 * self.levels - 1
    }

    /// True when step `step` draws in this frame.
    pub(crate) fn draws(&self, step: usize) -> bool {
        step_draws(step, self.levels, self.active)
    }

    /// Asks `pipelines` for the pipelines of the steps down and up, once, and returns their ids.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) -> (u32, u32) {
        *self.pipelines.get_or_insert_with(|| {
            (
                pipelines.id(pipeline(FORMAT, false)),
                pipelines.id(pipeline(FORMAT, true)),
            )
        })
    }

    /// Makes the buffer and the sampler when the GPU lacks them, writes and uploads the settings
    /// when an input changed, and binds each step to `sources[step]`, the texture it reads, when
    /// its group is new or the frame made the plan's textures again.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        canvas: (u32, u32),
        scale: RenderScale,
        frame: ChainFrame,
        bloom: Bloom,
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
        let inputs = Staged {
            canvas,
            scale,
            frame,
            bloom,
        };
        if self.staged_for != Some(inputs) {
            self.stage(inputs);
            let (at, bytes) = arena.push(&self.staged)?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.staged_for = Some(inputs);
        }
        for (step, &source) in sources.iter().enumerate().take(self.steps()) {
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

    /// Writes every block of the uniform buffer into the staging copy, and notes the levels that
    /// draw and each step's corner.
    fn stage(&mut self, inputs: Staged) {
        let Staged {
            canvas,
            scale,
            frame,
            bloom,
        } = inputs;
        let layout = Layout {
            canvas,
            scale,
            size: frame.size,
            halvings: frame.halvings,
        };
        let (offset, available) = frame.levels(canvas);
        self.active = bloom.drawn_levels(offset, available.min(self.levels));
        let mixes = bloom.mixes(offset);
        for step in 0..self.steps() {
            let block = step_block(
                step,
                self.levels,
                &bloom,
                &mixes,
                layout,
                self.rows_from_bottom,
            );
            self.staged[step * BLOCK..][..std::mem::size_of::<StepBlock>()]
                .copy_from_slice(bytes_of(&block));
            self.corners[step] = layout.level(chain_step(step, self.levels).0).corner;
        }
        let corner = layout.level(0).corner;
        let intensity = match bloom.blend {
            Blend::Mix => bloom.intensity.clamp(0.0, 1.0),
            Blend::Add | Blend::Screen => bloom.intensity.max(0.0),
        };
        let block = FinalBlock {
            glow: [
                corner.0 as f32,
                corner.1 as f32,
                intensity,
                bloom.blend.code(),
            ],
        };
        self.staged[FINAL_OFFSET as usize..].copy_from_slice(bytes_of(&block));
    }

    /// Records step `step` inside the render pass that the render graph began into its target:
    /// one triangle over the step's corner.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let (draw, blend) = self
            .pipelines
            .expect("bloom asks for its pipelines before it records");
        let up = chain_step(step, self.levels).2;
        let (width, height) = self.corners[step];
        list.push(
            Op::SetViewport,
            &[0, 0, width, height, 0f32.to_bits(), 1f32.to_bits()],
        )?;
        list.push(Op::SetScissor, &[0, 0, width, height])?;
        list.push(Op::SetPipeline, &[if up { blend } else { draw }])?;
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
    /// replaced the GPU. The pipelines keep their ids, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.staged_for = None;
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

    /// The shares of the glow that a chain's mixes give its levels.
    fn shares(mixes: &[f32; LEVELS], levels: usize) -> Vec<f32> {
        let mut rest = 1.0;
        (0..levels)
            .map(|level| {
                if level + 1 == levels {
                    rest
                } else {
                    let share = rest * (1.0 - mixes[level]);
                    rest *= mixes[level];
                    share
                }
            })
            .collect()
    }

    #[test]
    fn the_mixes_give_each_level_its_share_and_fold_the_dropped_levels_into_the_base() {
        let bloom = Bloom {
            weights: [1.0, 1.0, 2.0, 0.0, 0.0, 0.0, 0.0, 4.0, 0.0, 0.0],
            ..Bloom::default()
        };
        assert_eq!(bloom.drawn_levels(0, LEVELS), 8);
        let full = shares(&bloom.mixes(0), 8);
        let expected = [0.125, 0.125, 0.25, 0.0, 0.0, 0.0, 0.0, 0.5];
        for (got, want) in full.iter().zip(expected) {
            assert!((got - want).abs() < 1e-6, "{full:?}");
        }
        // A base two levels smaller holds the three narrowest levels' light.
        assert_eq!(bloom.drawn_levels(2, LEVELS - 2), 6);
        let folded = shares(&bloom.mixes(2), 6);
        let expected = [0.5, 0.0, 0.0, 0.0, 0.0, 0.5];
        for (got, want) in folded.iter().zip(expected) {
            assert!((got - want).abs() < 1e-6, "{folded:?}");
        }
        // The widest levels draw only with a weight.
        let wide = Bloom {
            weights: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            ..bloom
        };
        assert_eq!(wide.drawn_levels(0, LEVELS), LEVELS);
        assert_eq!(wide.drawn_levels(3, 4), 4);
        let default = shares(&Bloom::default().mixes(0), 8);
        assert!((default.iter().sum::<f32>() - 1.0).abs() < 1e-5);
        for (got, want) in default.iter().zip(DEFAULT_WEIGHTS) {
            assert!((got - want).abs() < 1e-3, "{default:?}");
        }
        // Weights of 0 put all the light in the base.
        let none = Bloom {
            weights: [0.0; LEVELS],
            ..Bloom::default()
        };
        assert_eq!(none.mixes(0)[0], 0.0);
    }

    #[test]
    fn the_base_keeps_the_glow_size_as_it_shrinks() {
        assert_eq!(declared_levels(512), 10);
        assert_eq!(declared_levels(256), 9);
        assert_eq!(declared_levels(128), 8);
        assert_eq!(declared_levels(64), 7);
        let canvas = (1920, 1080);
        // The last level has 1 texel on the short side, and the default's widest level 4, at every
        // size.
        for size in [512, 256, 128, 64] {
            let levels = declared_levels(size);
            assert_eq!(level_size(size, levels - 1).extent(canvas).1, 1, "{size}");
            let (offset, available) = ChainFrame { size, halvings: 0 }.levels(canvas);
            let drawn = Bloom::default().drawn_levels(offset, available);
            assert_eq!(level_size(size, drawn - 1).extent(canvas).1, 4, "{size}");
        }
        assert_eq!(level_size(512, 0).extent(canvas), (910, 512));
        // A portrait canvas takes its width as the short side.
        assert_eq!(level_size(128, 0).extent((540, 932)), (128, 221));
        // The base is never more than half the short side: 900 rows hold 256 texels, so the
        // chain drops its narrowest level.
        assert_eq!(level_size(512, 0).extent((1600, 900)), (455, 256));
        let frame = ChainFrame {
            size: 512,
            halvings: 0,
        };
        assert_eq!(frame.levels((1600, 900)), (1, 9));
        assert_eq!(frame.levels(canvas), (0, 10));
        let halved = ChainFrame {
            halvings: 1,
            ..frame
        };
        assert_eq!(halved.levels(canvas), (1, 9));
        assert_eq!(halved.levels((2, 2)), (9, 1));
    }

    #[test]
    fn the_steps_go_down_then_up_and_the_governor_drops_the_last_level() {
        assert_eq!(chain_step(0, 3), (0, None, false));
        assert_eq!(chain_step(2, 3), (2, Some(1), false));
        assert_eq!(chain_step(3, 3), (1, Some(2), true));
        assert_eq!(chain_step(4, 3), (0, Some(1), true));
        // With two of three levels, the step down into the last level and the step up from it
        // stay off.
        let draws: Vec<bool> = (0..5).map(|step| step_draws(step, 3, 2)).collect();
        assert_eq!(draws, [true, true, false, false, true]);
    }

    #[test]
    fn each_step_reads_its_source_inside_the_drawn_corners() {
        let bloom = Bloom::default();
        let canvas = (1920, 1080);
        let layout = Layout {
            canvas,
            scale: RenderScale::FULL,
            size: 512,
            halvings: 0,
        };
        let mixes = bloom.mixes(0);
        let first = step_block(0, 8, &bloom, &mixes, layout, false);
        assert_eq!(first.mode, MODE_FIRST_DOWN);
        assert_eq!(first.scale[1], 1.0 / 512.0);
        assert_eq!(first.bounds[3], 1079.5 / 1080.0);
        let half = Layout {
            scale: RenderScale::from_thousandths(500),
            ..layout
        };
        // At half scale the first step reads half as far into the scene color per pixel, and the
        // later steps read as they did.
        let first_half = step_block(0, 8, &bloom, &mixes, half, false);
        assert!((first_half.scale[1] * 2.0 - first.scale[1]).abs() < 1e-9);
        assert_eq!(
            step_block(3, 8, &bloom, &mixes, layout, true),
            step_block(3, 8, &bloom, &mixes, half, true)
        );
        let up = step_block(14, 8, &bloom, &mixes, layout, false);
        assert_eq!((up.mode, up.mix), (MODE_UP, mixes[0]));
        assert_eq!(up.scale[3], 1.0 / 256.0);
        // The governor's halving draws level 1 into 128 of its 256 rows, and reads level 0's
        // corner of 256 of its 512 rows.
        let governed = Layout {
            halvings: 1,
            ..layout
        };
        let down = step_block(1, 8, &bloom, &mixes, governed, false);
        assert_eq!(down.bounds[3], 255.5 / 512.0);
        assert_eq!(down.scale[1], 256.0 / (128.0 * 512.0));
        // WebGL2 draws the same corners into the top rows: level 1's corner starts at row 128 of
        // 256, and its first row reads between level 0's rows 256 and 257 of 512.
        let gl = step_block(1, 8, &bloom, &mixes, governed, true);
        let place = |row: f32| row * gl.scale[1] + gl.origin[1];
        assert!((place(128.5) - 257.0 / 512.0).abs() < 1e-6);
        assert_eq!(gl.bounds[1], 256.5 / 512.0);
    }

    #[test]
    fn the_chain_reads_fewer_texels_than_the_canvas_has() {
        let bloom = Bloom::default();
        let (reads, blends) = texels_per_pixel(&bloom, (1920, 1080), 512, 0);
        assert!(reads > 7.0 && reads < 8.0, "{reads}");
        assert!(blends < 0.4, "{blends}");
        let phone = texels_per_pixel(&bloom, (540, 932), 128, 0).0;
        assert!(phone < 3.0, "{phone}");
        assert!(texels_per_pixel(&bloom, (1920, 1080), 512, 1).0 < reads / 2.0);
    }

    #[test]
    fn a_new_scale_or_governor_step_only_uploads_the_settings() {
        let ids = BloomIds {
            buffer: 1,
            sampler: 2,
            first_group: 3,
        };
        let mut pass = BloomPass::new(ids, 512, false);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [7; STEPS];
        let mut frame = |pass: &mut BloomPass, list: &mut DrawList, scale, halvings| {
            list.clear();
            arena.reset(BloomPass::UPLOAD_BYTES);
            let chain = ChainFrame {
                size: 512,
                halvings,
            };
            pass.prepare(
                list,
                &mut arena,
                (1920, 1080),
                scale,
                chain,
                Bloom::default(),
                &sources,
                false,
            )
            .unwrap();
        };
        let ops = |list: &DrawList| -> Vec<Op> {
            null3d_gpu::drawlist::decode(list.words())
                .map(|c| c.unwrap().op)
                .collect()
        };
        frame(&mut pass, &mut list, RenderScale::FULL, 0);
        let first = ops(&list);
        assert_eq!(
            first
                .iter()
                .filter(|&&op| op == Op::CreateBindGroup)
                .count(),
            STEPS
        );
        frame(&mut pass, &mut list, RenderScale::FULL, 0);
        assert!(list.is_empty(), "nothing changed, so nothing records");
        frame(&mut pass, &mut list, RenderScale::from_thousandths(700), 0);
        assert_eq!(ops(&list), [Op::WriteBuffer], "a new scale only uploads");
        frame(&mut pass, &mut list, RenderScale::from_thousandths(700), 1);
        assert_eq!(
            ops(&list),
            [Op::WriteBuffer],
            "the governor's step only uploads"
        );
        // Of the 10 levels declared, the default weights draw 8, and the halving 7.
        assert!(!pass.draws(7) && !pass.draws(12) && pass.draws(13));
        assert_eq!(pass.corners[0], (455, 256));
    }

    #[test]
    fn the_shaders_lay_out_the_blocks_as_the_core_writes_them() {
        let bloom = include_str!("../../null3d-shaders/wgsl/bloom.wgsl");
        for field in [
            "scale: vec4f,",
            "origin: vec4f,",
            "bounds: vec4f,",
            "threshold: f32,",
            "knee: f32,",
            "mode: u32,",
            "mix: f32,",
        ] {
            assert!(bloom.contains(field), "bloom.wgsl lacks {field}");
        }
        assert_eq!(std::mem::size_of::<StepBlock>(), 64);
        let final_pass = include_str!("../../null3d-shaders/wgsl/final.wgsl");
        assert!(final_pass.contains("struct Bloom {\n    glow: vec4f,\n}"));
        assert_eq!(std::mem::size_of::<FinalBlock>(), 16);
    }
}
