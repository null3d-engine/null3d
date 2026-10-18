//! Screen-space reflections: what the screen showed along each opaque surface's mirror direction,
//! in place of the environment's reflection, for wet streets, polished floors and metal. The render
//! graph's steps run between the depth prepass and the camera's opaque pass (see
//! [`crate::frame_graph`]), on the grid of the screen texture that ambient occlusion shares:
//!
//! 1. Ambient occlusion's depth step copies one texel of the prepass's depth per texel of the grid.
//!    It runs while either feature draws, and the copy is the depth pyramid's first level.
//! 2. Six reduce steps make the pyramid's other levels, each from the one below it: a texel keeps
//!    the nearest depth of the 2 x 2 texels under it. They are six targets of the graph, each half
//!    the size of the one before, rather than one mip chain, so both GPU paths draw them as plain
//!    full-screen passes.
//! 3. The trace marches each texel's mirror ray through the pyramid, as AMD's FidelityFX SSSR
//!    does, and writes the ray's length to its hit, or 0 for a miss, into z of the screen texture.
//!    It writes no occlusion, the texel's depth and no contact shadow into the other channels.
//!    Ambient occlusion's denoise, which runs after it while ambient occlusion draws, writes those
//!    and copies z through.
//!
//! The camera's opaque pass then casts each pixel's own reflected ray, along its shading normal,
//! for the length of the hits around it, and reads last frame's opaque color where the ray ends
//! (`null3d::ssr`). The color comes from the copy that transmission samples (see
//! [`crate::transmission`]): while reflections draw, the copy is a kept target, made in every
//! frame, which the opaque pass reads as the frame before left it. A matrix in the frame's values
//! takes a point from this frame's camera into the frame before's view. A roughness's cone over the
//! ray's length picks the copy's mip level, which blurs rough reflections without the noise of
//! random rays.
//!
//! Every step reads a target that another step wrote, never its own. The settings live in one
//! uniform buffer, a block of 256 bytes for each reduce step and one for the trace, uploaded only
//! when a setting, the camera's lens, the canvas, the render scale or the grid's scale changed.

use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template,
};

use crate::bloom::bytes_of;
use crate::camera::{Mat4, multiply};
use crate::frame::{RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The pyramid's levels above its first, ambient occlusion's depth copy. A cell of the coarsest
/// covers 64 texels of the grid each way.
pub(crate) const LEVELS: usize = 6;

/// The steps: a reduce step for each level, then the trace.
pub(crate) const STEPS: usize = LEVELS + 1;

/// The format of the pyramid's levels: the depth in one float, as ambient occlusion's copy holds it.
pub(crate) const LEVEL_FORMAT: u32 = format::R32_FLOAT;

/// The format of the trace's target, which the opaque pass reads as the screen texture when
/// ambient occlusion draws none: the screen texture's format.
pub(crate) const TRACE_FORMAT: u32 = format::RGBA16_FLOAT;

/// The size of the trace's target: the screen texture's, half the render size, of which a lower
/// scale draws a corner.
pub(crate) const TRACE_SIZE: Size = crate::ao::SIZE;

/// The size of level `level` of the pyramid, from 1: half the size of the level below it.
pub(crate) const fn level_size(level: usize) -> Size {
    Size::Halved(level as u8 + 1)
}

/// The share of the screen over which reflections fade toward its edges.
const EDGE_FADE: f32 = 0.1;

/// The most steps of the trace's march, which the quality settings lower.
pub const MAX_STEPS: u32 = 128;

/// The most steps of the trace's march before the quality settings set them.
pub const DEFAULT_STEPS: u32 = 48;

/// Bytes of each step's block in the uniform buffer, the alignment of a buffer binding's offset.
const BLOCK_STRIDE: u32 = 256;

/// How screen-space reflections look, with the meanings of three.js's `SSRPass`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ssr {
    /// From 0 to 1: how much of the environment's reflection the screen's reflection replaces
    /// where it hits, three.js's `opacity`.
    pub intensity: f32,
    /// The most distance that a reflected ray travels, in world units. Reflections fade out over
    /// its last fifth.
    pub max_distance: f32,
    /// How far behind a surface on the screen a ray may pass and still hit it, in world units.
    pub thickness: f32,
    /// The most roughness that reflects: rougher surfaces keep the environment's reflection. They
    /// fade out from 70% of it.
    pub max_roughness: f32,
}

impl Default for Ssr {
    fn default() -> Self {
        Self {
            intensity: 1.0,
            max_distance: 100.0,
            thickness: 0.5,
            max_roughness: 0.5,
        }
    }
}

/// A reduce step's block, as `ssr.wgsl` lays out its `Level` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct LevelBlock {
    finer: [f32; 4],
}

/// The trace's block, as `ssr.wgsl` lays out its `Trace` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct TraceBlock {
    projection: Mat4,
    inverse_projection: Mat4,
    corners: [f32; 4],
    ray: [f32; 4],
}

/// Bytes of the uniform buffer: a block for each step.
const BUFFER_BYTES: u32 = BLOCK_STRIDE * STEPS as u32;

/// Every step's block, as the frame writes them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Blocks {
    levels: [LevelBlock; LEVELS],
    trace: TraceBlock,
}

/// The drawn corner of the grid's level `level`, from 0, the screen texture's corner: the corner
/// below it halved, rounded up.
pub(crate) fn level_corner(grid: (u32, u32), level: usize) -> (u32, u32) {
    let by = 1u32 << level;
    (grid.0.div_ceil(by).max(1), grid.1.div_ceil(by).max(1))
}

/// The GPU objects of screen-space reflections, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct SsrIds {
    /// The uniform buffer of the steps' settings.
    pub(crate) buffer: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the pyramid's levels from the first, ambient occlusion's
/// depth copy, to the coarsest.
pub(crate) type StepSources = [u32; LEVELS + 1];

/// The pipeline of step `step`: a reduce step below [`LEVELS`], then the trace.
const fn pipeline(step: usize) -> PipelineKey {
    let (template, color_format) = if step < LEVELS {
        (template::SSR_REDUCE, LEVEL_FORMAT)
    } else {
        (template::SSR_TRACE, TRACE_FORMAT)
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

/// What a frame of the trace draws with, which the frame builder gives each frame while
/// reflections draw.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TraceFrame {
    pub(crate) ssr: Ssr,
    /// The camera's projection and its inverse.
    pub(crate) projection: (Mat4, Mat4),
    /// True for an orthographic camera.
    pub(crate) orthographic: bool,
    /// The most steps of the march.
    pub(crate) steps: u32,
}

/// Screen-space reflections' GPU objects, their settings and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct SsrPass {
    ids: SsrIds,
    pipelines: [Option<u32>; 2],
    created: bool,
    uploaded: Option<Blocks>,
    /// The textures that the steps' bind groups read, or zeros before the groups exist.
    bound: StepSources,
}

impl SsrPass {
    /// The steps, with GPU objects from `ids`.
    pub(crate) fn new(ids: SsrIds) -> Self {
        Self {
            ids,
            pipelines: [None; 2],
            created: false,
            uploaded: None,
            bound: [0; LEVELS + 1],
        }
    }

    /// Bytes a frame may copy into its arena: the whole uniform buffer.
    pub(crate) const UPLOAD_BYTES: usize = BUFFER_BYTES as usize;

    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (kind, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(kind * LEVELS)));
            }
        }
    }

    /// Makes the buffer when the GPU lacks it, uploads the settings when they changed, and binds
    /// the steps to `sources` when their groups are new or the frame made the plan's textures
    /// again. `grid` is the screen texture's drawn corner.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        frame: &TraceFrame,
        canvas: (u32, u32),
        scale: RenderScale,
        grid: (u32, u32),
        sources: &StepSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[ids.buffer, BUFFER_BYTES, usage::UNIFORM | usage::COPY_DST],
            )?;
            self.created = true;
        }
        let blocks = blocks(frame, canvas, scale, grid);
        if self.uploaded != Some(blocks) {
            for (step, level) in blocks.levels.iter().enumerate() {
                let (at, bytes) = arena.push(bytes_of(level))?;
                list.push(
                    Op::WriteBuffer,
                    &[ids.buffer, step as u32 * BLOCK_STRIDE, at, bytes],
                )?;
            }
            let (at, bytes) = arena.push(bytes_of(&blocks.trace))?;
            list.push(
                Op::WriteBuffer,
                &[ids.buffer, LEVELS as u32 * BLOCK_STRIDE, at, bytes],
            )?;
            self.uploaded = Some(blocks);
        }
        if !textures_made && self.bound == *sources {
            return Ok(());
        }
        for (step, &source) in sources[..LEVELS].iter().enumerate() {
            let offset = step as u32 * BLOCK_STRIDE;
            let block = std::mem::size_of::<LevelBlock>() as u32;
            list.push(
                Op::CreateBindGroup,
                &[
                    ids.first_group + step as u32,
                    bind_layout::SSR_REDUCE,
                    2,
                    0,
                    resource_kind::BUFFER,
                    ids.buffer,
                    offset,
                    block,
                    1,
                    resource_kind::TEXTURE,
                    source,
                    0,
                    0,
                ],
            )?;
        }
        let mut words = [0u32; 3 + 5 * (LEVELS + 2)];
        words[..3].copy_from_slice(&[
            ids.first_group + LEVELS as u32,
            bind_layout::SSR_TRACE,
            (LEVELS + 2) as u32,
        ]);
        words[3..8].copy_from_slice(&[
            0,
            resource_kind::BUFFER,
            ids.buffer,
            LEVELS as u32 * BLOCK_STRIDE,
            std::mem::size_of::<TraceBlock>() as u32,
        ]);
        for (level, &texture) in sources.iter().enumerate() {
            let at = 8 + 5 * level;
            words[at..at + 5].copy_from_slice(&[
                level as u32 + 1,
                resource_kind::TEXTURE,
                texture,
                0,
                0,
            ]);
        }
        list.push(Op::CreateBindGroup, &words)?;
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
        let kind = usize::from(step >= LEVELS);
        let pipeline = self.pipelines[kind].expect("the steps ask for their pipelines first");
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
        self.bound = [0; LEVELS + 1];
    }
}

/// The steps' blocks for a canvas of `canvas` pixels at render scale `scale`, on a grid whose drawn
/// corner is `grid`.
fn blocks(frame: &TraceFrame, canvas: (u32, u32), scale: RenderScale, grid: (u32, u32)) -> Blocks {
    let render = Size::Full.viewport(canvas, scale);
    let mut levels = [LevelBlock::default(); LEVELS];
    for (index, level) in levels.iter_mut().enumerate() {
        let finer = level_corner(grid, index);
        let own = level_size(index + 1).extent(canvas);
        level.finer = [finer.0 as f32, finer.1 as f32, own.1 as f32, 0.0];
    }
    let (projection, inverse_projection) = frame.projection;
    let ssr = frame.ssr;
    Blocks {
        levels,
        trace: TraceBlock {
            projection,
            inverse_projection,
            corners: [
                render.0 as f32,
                render.1 as f32,
                grid.0 as f32,
                grid.1 as f32,
            ],
            ray: [
                ssr.max_distance.max(0.0),
                ssr.thickness.max(0.0),
                frame.steps.clamp(1, MAX_STEPS) as f32,
                f32::from(u8::from(frame.orthographic)),
            ],
        },
    }
}

/// The camera's view in the frame that made the color copy which the next frame's reflections
/// read.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LastView {
    /// The view-projection matrix for positions relative to the camera.
    pub(crate) view_proj: Mat4,
    /// The camera's position in the world.
    pub(crate) eye: [f64; 3],
    /// The drawn corner of the copy, in pixels.
    pub(crate) drawn: (u32, u32),
}

/// Writes screen-space reflections' values into the camera's frame values: from `last`, the view
/// that made the copy which this frame reads, or none when there is no such view and the frame
/// draws no reflections. `eye` is this frame's camera position in the world.
pub(crate) fn write_frame_values(
    uniform: &mut FrameUniform,
    ssr: Option<Ssr>,
    last: Option<&LastView>,
    eye: [f64; 3],
) {
    let (Some(ssr), Some(last)) = (ssr, last) else {
        uniform.reflection = [0.0; 4];
        return;
    };
    // A position relative to this camera lies at that offset plus the camera's move since, from
    // the last camera.
    let moved: [f32; 3] = std::array::from_fn(|k| (eye[k] - last.eye[k]) as f32);
    let mut translation = [0.0; 16];
    translation[0] = 1.0;
    translation[5] = 1.0;
    translation[10] = 1.0;
    translation[15] = 1.0;
    translation[12..15].copy_from_slice(&moved);
    uniform.reflection_reprojection = multiply(&last.view_proj, &translation);
    uniform.reflection = [
        ssr.intensity.clamp(0.0, 1.0),
        ssr.max_roughness.clamp(0.0, 1.0),
        ssr.max_distance.max(1e-3),
        EDGE_FADE,
    ];
    // The length of the matrix's y row over x, y and z is the projection's y scale, which a view's
    // rotation keeps: pixels per world unit at a distance of one unit, times half the height.
    let row = |m: &Mat4| (m[1] * m[1] + m[5] * m[5] + m[9] * m[9]).sqrt();
    uniform.reflection_corner = [
        last.drawn.0 as f32,
        last.drawn.1 as f32,
        row(&last.view_proj) * last.drawn.1 as f32 * 0.5,
        0.0,
    ];
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::perspective_reversed;

    fn trace_frame() -> TraceFrame {
        let projection = perspective_reversed(1.0, 16.0 / 9.0, 0.1, 100.0);
        TraceFrame {
            ssr: Ssr::default(),
            projection: (projection, crate::camera::invert(&projection).unwrap()),
            orthographic: false,
            steps: 32,
        }
    }

    #[test]
    fn each_level_halves_the_corner_below_it_rounding_up() {
        assert_eq!(level_corner((160, 91), 0), (160, 91));
        assert_eq!(level_corner((160, 91), 1), (80, 46));
        assert_eq!(level_corner((160, 91), 6), (3, 2));
        // Each level's corner fits its target for any render scale and grid scale.
        let canvas = (321, 181);
        for thousandths in [250, 500, 750, 1000] {
            let scale = RenderScale::from_thousandths(thousandths);
            for share in [0.25, 0.5] {
                let grid = crate::ao::corner(canvas, scale, share);
                for level in 1..=LEVELS {
                    let corner = level_corner(grid, level);
                    let extent = level_size(level).extent(canvas);
                    assert!(corner.0 <= extent.0 && corner.1 <= extent.1);
                }
            }
        }
    }

    #[test]
    fn the_steps_bind_once_and_a_new_scale_only_uploads() {
        let ids = SsrIds {
            buffer: 1,
            first_group: 2,
        };
        let mut pass = SsrPass::new(ids);
        let mut pipelines = PipelineCache::default();
        pass.request_pipelines(&mut pipelines);
        assert_eq!(pass.pipeline_ids().count(), 2);
        let mut list = DrawList::with_capacity(4096);
        let mut arena = UploadArena::default();
        let sources = [7, 8, 9, 10, 11, 12, 13];
        let frame = trace_frame();
        let mut prepare = |pass: &mut SsrPass, list: &mut DrawList, grid| {
            list.clear();
            arena.reset(SsrPass::UPLOAD_BYTES);
            pass.prepare(
                list,
                &mut arena,
                &frame,
                (320, 180),
                RenderScale::FULL,
                grid,
                &sources,
                false,
            )
            .unwrap();
            null3d_gpu::drawlist::decode(list.words())
                .map(|c| c.unwrap().op)
                .collect::<Vec<_>>()
        };
        let ops = prepare(&mut pass, &mut list, (160, 90));
        let groups = ops.iter().filter(|&&op| op == Op::CreateBindGroup).count();
        assert_eq!(groups, STEPS);
        assert!(prepare(&mut pass, &mut list, (160, 90)).is_empty());
        let ops = prepare(&mut pass, &mut list, (80, 45));
        assert!(ops.iter().all(|&op| op == Op::WriteBuffer));
    }

    #[test]
    fn the_reprojection_takes_the_cameras_move_into_the_last_view() {
        let view_proj = perspective_reversed(1.0, 1.0, 0.1, 100.0);
        let last = LastView {
            view_proj,
            eye: [10.0, 0.0, 0.0],
            drawn: (200, 100),
        };
        let mut uniform = FrameUniform::default();
        write_frame_values(
            &mut uniform,
            Some(Ssr::default()),
            Some(&last),
            [11.0, 0.0, 0.0],
        );
        // A point 1 unit ahead of this camera lies 1 unit to the right of the last camera.
        let m = uniform.reflection_reprojection;
        let p = [0.0f32, 0.0, -1.0, 1.0];
        let clip: [f32; 4] =
            std::array::from_fn(|row| (0..4).map(|k| m[k * 4 + row] * p[k]).sum::<f32>());
        let expected: [f32; 4] = {
            let q = [1.0f32, 0.0, -1.0, 1.0];
            std::array::from_fn(|row| (0..4).map(|k| view_proj[k * 4 + row] * q[k]).sum::<f32>())
        };
        for k in 0..4 {
            assert!((clip[k] - expected[k]).abs() < 1e-5);
        }
        assert_eq!(uniform.reflection[0], 1.0);
        assert_eq!(uniform.reflection_corner[..2], [200.0, 100.0]);
        write_frame_values(&mut uniform, Some(Ssr::default()), None, [0.0; 3]);
        assert_eq!(
            uniform.reflection, [0.0; 4],
            "no last view draws no reflections"
        );
    }

    #[test]
    fn the_shader_lays_out_the_blocks_as_the_core_writes_them() {
        let source = include_str!("../../null3d-shaders/wgsl/ssr.wgsl");
        let mut at = 0;
        for field in [
            "projection: mat4x4f,",
            "inverse_projection: mat4x4f,",
            "corners: vec4f,",
            "ray: vec4f,",
        ] {
            let found = source[at..].find(field).map(|k| k + at);
            assert!(found.is_some(), "ssr.wgsl lacks {field} in order");
            at = found.unwrap();
        }
        assert_eq!(std::mem::size_of::<TraceBlock>(), 160);
        assert_eq!(std::mem::size_of::<LevelBlock>(), 16);
        let globals = include_str!("../../null3d-shaders/wgsl/lib/globals.wgsl");
        let mut at = globals.find("hemisphere_z: vec4f,").unwrap();
        for field in [
            "reflection_reprojection: mat4x4f,",
            "reflection: vec4f,",
            "reflection_corner: vec4f,",
        ] {
            let found = globals[at..].find(field).map(|k| k + at);
            assert!(found.is_some(), "globals.wgsl lacks {field} in order");
            at = found.unwrap();
        }
    }
}
