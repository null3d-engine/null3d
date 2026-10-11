//! Temporal anti-aliasing, a prototype (M2-EX18, D-129). Each frame moves the camera's projection
//! by a different fraction of a pixel, so over a few frames each pixel sees several places within
//! itself. A resolve step then blends the frame into a history of earlier frames, which it reads
//! where each pixel's surface was in the frame before, and limits that history to the colors of
//! the pixel's neighbors in this frame, so moving and uncovered surfaces do not leave trails.
//!
//! # The steps
//!
//! The render graph declares three steps after the camera's transparent pass and before the
//! custom effects (see [`crate::frame_graph`]):
//!
//! 1. The resolve reads the scene's color and depth and the history, and writes the blend into a
//!    frame target that the rest of the chain reads in place of the scene's color.
//! 2. A keep step copies that target into one of two kept targets, which hold the history from
//!    frame to frame, for the next frame. Frames of even and odd numbers take turns: each frame
//!    reads the target that the frame before it wrote and writes the other, and the keep step into
//!    the target it reads does not draw. A frame drawn again, as a capture draws it, then reads and
//!    writes the same targets and leaves the same history.
//!
//! The resolve finds where each pixel's surface lay in the last frame from its depth alone: the
//! position that the depth gives, seen by the last frame's camera. That follows every move of the
//! camera, but not objects that move or bend on their own, such as swaying grass. There the
//! neighborhood limit keeps trails short.
//!
//! # The sequence
//!
//! The offsets follow the Halton sequence of bases 2 and 3, eight frames long, as Unreal Engine's
//! does, so every frame of eight spreads its sample evenly within the pixel.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, state_flags, template,
};

use crate::bloom::bytes_of;
use crate::camera::{Mat4, invert, multiply};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps: the resolve and the keep step into each of the two histories.
pub(crate) const STEPS: usize = 3;

/// The format of the resolve's target and of the history: HDR color, as the scene color holds it.
pub(crate) const FORMAT: u32 = format::RGBA16_FLOAT;

/// The frames of the sequence of offsets.
pub const SEQUENCE: u32 = 8;

/// Bytes of the uniform buffer: the resolve's block.
const BLOCK: usize = 256;

/// How temporal anti-aliasing blends.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Taa {
    /// The share of the history in each pixel's new color, from 0 to just below 1. Higher values
    /// smooth more and leave longer trails.
    pub feedback: f32,
    /// The history's filter: true for a Catmull-Rom filter, which keeps the image sharp as it
    /// moves; false for a linear filter, which blurs a little with each frame of motion.
    pub sharp_history: bool,
    /// True to move the projection by the sequence's offsets. False keeps it still, so the
    /// resolve only blends frames, for measuring what the offsets add.
    pub jitter: bool,
    /// True to read one depth sample per pixel, the pixel's own first, in place of the nearest of
    /// every sample of its 3 x 3 neighbors.
    pub light_depth: bool,
}

impl Default for Taa {
    fn default() -> Self {
        Self {
            feedback: 0.9,
            sharp_history: true,
            jitter: true,
            light_depth: false,
        }
    }
}

/// Element `index` of the Halton sequence of base `base`, from 0 to 1.
fn halton(mut index: u32, base: u32) -> f32 {
    let mut result = 0.0;
    let mut fraction = 1.0;
    while index > 0 {
        fraction /= base as f32;
        result += fraction * (index % base) as f32;
        index /= base;
    }
    result
}

/// The camera's offset in frame `frame`, in pixels from -0.5 to 0.5 along x and y: the Halton
/// sequence of bases 2 and 3 from its second element, which repeats every [`SEQUENCE`] frames.
pub fn jitter(frame: u32) -> [f32; 2] {
    let index = frame % SEQUENCE + 1;
    [halton(index, 2) - 0.5, halton(index, 3) - 0.5]
}

/// `view_proj` moved by `pixels` across a target of `size` pixels: clip space's x and y shift by
/// two pixels' share of the target per pixel, times w, so every point moves by the same part of a
/// pixel.
pub fn jittered(view_proj: &Mat4, pixels: [f32; 2], size: (u32, u32)) -> Mat4 {
    let shift = [
        2.0 * pixels[0] / size.0.max(1) as f32,
        2.0 * pixels[1] / size.1.max(1) as f32,
    ];
    let mut m = *view_proj;
    for column in 0..4 {
        let w = m[column * 4 + 3];
        m[column * 4] += shift[0] * w;
        m[column * 4 + 1] += shift[1] * w;
    }
    m
}

/// What the last frame's camera saw: its view-projection matrix without the offset, for positions
/// relative to it, and its place in the world.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LastView {
    pub(crate) view_proj: Mat4,
    pub(crate) at: [f64; 3],
}

/// The matrix that takes a point of this frame's clip space to the last frame's, both without the
/// camera's offsets: the inverse of this frame's matrix, the move from this camera's place to the
/// last one's, then the last view's matrix. The history holds each pixel's color around its
/// center, so a pixel's center reprojects without the offset that its own sample took; with the
/// offset, a still camera would read the history half a pixel away in a new direction each frame,
/// and the history would blur. `None` when this frame's matrix has no inverse.
pub(crate) fn reprojection(view_proj: &Mat4, at: [f64; 3], last: &LastView) -> Option<Mat4> {
    let inverse = invert(view_proj)?;
    let mut moved = [0.0f32; 16];
    moved[0] = 1.0;
    moved[5] = 1.0;
    moved[10] = 1.0;
    moved[15] = 1.0;
    for k in 0..3 {
        moved[12 + k] = (at[k] - last.at[k]) as f32;
    }
    Some(multiply(&last.view_proj, &multiply(&moved, &inverse)))
}

/// What a frame's resolve draws with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TaaFrame {
    pub taa: Taa,
    /// From this frame's clip space to the last frame's: see [`reprojection`].
    pub reproject: Mat4,
    /// True when the history holds nothing of use, as in the first frame: the resolve writes this
    /// frame's color alone.
    pub reset: bool,
    /// The history that this frame writes, 0 or 1, from its number: it reads the other.
    pub parity: u8,
}

/// The resolve's block, as `taa.wgsl` lays out its `Settings` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Default)]
struct Block {
    reproject: [f32; 16],
    /// The targets' size in texels, then one texel in texture coordinates.
    extent: [f32; 4],
    /// The drawn corner's size in pixels, its first row, and 1 where rows count from the bottom.
    corner: [f32; 4],
    /// The history's share, 1 to drop the history, 1 for the Catmull-Rom filter, and 1 to read one
    /// depth sample per pixel.
    params: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<Block>() <= BLOCK);

/// The GPU objects of temporal anti-aliasing, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TaaIds {
    /// The uniform buffer of the resolve's block.
    pub(crate) buffer: u32,
    /// The linear sampler that reads the history.
    pub(crate) sampler: u32,
    /// The bind group of each step, from this id on.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the scene's color and depth, the two histories, and the
/// resolve's target.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TaaSources {
    pub(crate) color: u32,
    pub(crate) depth: u32,
    pub(crate) histories: [u32; 2],
    pub(crate) resolved: u32,
}

/// The pipeline of step `step`: one triangle into its target.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let template = match step {
        0 if multisampled => template::TAA_RESOLVE_MS,
        0 => template::TAA_RESOLVE,
        _ => template::TAA_KEEP,
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

/// What a frame's block depends on. The frame writes it again only when one changes.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Staged {
    canvas: (u32, u32),
    scale: RenderScale,
    frame: TaaFrame,
}

/// Temporal anti-aliasing's GPU objects, and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct TaaPass {
    ids: TaaIds,
    /// True when the scene's depth target is multisampled, so the resolve reads its samples.
    multisampled: bool,
    /// True on WebGL2, which counts rows from the bottom.
    rows_from_bottom: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged_for: Option<Staged>,
    bound: Option<TaaSources>,
    /// The history that the frame being recorded writes.
    parity: u8,
}

impl TaaPass {
    /// The steps, with GPU objects from `ids`, for a scene depth of `samples`, on WebGL2 with
    /// `rows_from_bottom`.
    pub(crate) fn new(ids: TaaIds, samples: u32, rows_from_bottom: bool) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            rows_from_bottom,
            pipelines: [None; STEPS],
            created: false,
            staged_for: None,
            bound: None,
            parity: 0,
        }
    }

    /// Bytes a frame may copy into its arena: the resolve's block.
    pub(crate) const UPLOAD_BYTES: usize = BLOCK;

    /// Asks `pipelines` for the steps' pipelines, once.
    pub(crate) fn request_pipelines(&mut self, pipelines: &mut PipelineCache) {
        for (step, slot) in self.pipelines.iter_mut().enumerate() {
            if slot.is_none() {
                *slot = Some(pipelines.id(pipeline(step, self.multisampled)));
            }
        }
    }

    /// The ids of the steps' pipelines that the pass asked for.
    pub(crate) fn pipeline_ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.pipelines.iter().flatten().copied()
    }

    /// Makes the buffer and the sampler when the GPU lacks them, writes and uploads the block for
    /// `frame` when an input changed, and binds the steps to `sources` when they changed or the
    /// frame made the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (canvas, scale): ((u32, u32), RenderScale),
        frame: TaaFrame,
        sources: TaaSources,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        let ids = self.ids;
        if !self.created {
            list.push(
                Op::CreateBuffer,
                &[ids.buffer, BLOCK as u32, usage::UNIFORM | usage::COPY_DST],
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
        self.parity = frame.parity;
        let inputs = Staged {
            canvas,
            scale,
            frame,
        };
        if self.staged_for != Some(inputs) {
            let block = self.block(inputs);
            let (at, bytes) = arena.push(bytes_of(&block))?;
            list.push(Op::WriteBuffer, &[ids.buffer, 0, at, bytes])?;
            self.staged_for = Some(inputs);
        }
        if textures_made || self.bound != Some(sources) {
            self.bind(list, sources)?;
            self.bound = Some(sources);
        }
        Ok(())
    }

    /// Records each step's bind groups: the resolve's two, which read the scene's color and depth
    /// and the history that the frames of each parity read, and the keep steps' one, which reads
    /// the resolve's target.
    fn bind(&self, list: &mut DrawList, sources: TaaSources) -> Result<(), RecordError> {
        let ids = self.ids;
        let layout = if self.multisampled {
            bind_layout::DOF_COMPOSITE_MS
        } else {
            bind_layout::DOF_COMPOSITE
        };
        let texture = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
        for parity in 0..2 {
            let entries = [
                [0, resource_kind::BUFFER, ids.buffer, 0, BLOCK as u32],
                texture(1, sources.color),
                [2, resource_kind::SAMPLER, ids.sampler, 0, 0],
                texture(3, sources.depth),
                texture(4, sources.histories[1 - parity]),
            ];
            let mut words = [0u32; 3 + 5 * 5];
            words[..3].copy_from_slice(&[
                ids.first_group + parity as u32,
                layout,
                entries.len() as u32,
            ]);
            for (place, entry) in entries.iter().enumerate() {
                words[3 + 5 * place..][..5].copy_from_slice(entry);
            }
            list.push(Op::CreateBindGroup, &words)?;
        }
        list.push(
            Op::CreateBindGroup,
            &[
                ids.first_group + 2,
                bind_layout::VIEW_COPY,
                1,
                0,
                resource_kind::TEXTURE,
                sources.resolved,
                0,
                0,
            ],
        )?;
        Ok(())
    }

    /// The resolve's block for `inputs`.
    fn block(&self, inputs: Staged) -> Block {
        let Staged {
            canvas,
            scale,
            frame,
        } = inputs;
        let extent = Size::Full.extent(canvas);
        let corner = Size::Full.viewport(canvas, scale);
        let first_row = if self.rows_from_bottom {
            extent.1 - corner.1
        } else {
            0
        };
        Block {
            reproject: frame.reproject,
            extent: [
                extent.0 as f32,
                extent.1 as f32,
                1.0 / extent.0.max(1) as f32,
                1.0 / extent.1.max(1) as f32,
            ],
            corner: [
                corner.0 as f32,
                corner.1 as f32,
                first_row as f32,
                if self.rows_from_bottom { 1.0 } else { 0.0 },
            ],
            params: [
                frame.taa.feedback.clamp(0.0, 0.99),
                if frame.reset { 1.0 } else { 0.0 },
                if frame.taa.sharp_history { 1.0 } else { 0.0 },
                if frame.taa.light_depth { 1.0 } else { 0.0 },
            ],
        }
    }

    /// Records step `step` inside the render pass that the render graph began into its target:
    /// the resolve with the group of the frame's parity, a keep step with the keep steps' group.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self.pipelines[step].expect("the steps ask for their pipelines first");
        let group = match step {
            0 => u32::from(self.parity),
            _ => 2,
        };
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.first_group + group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.staged_for = None;
        self.bound = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::perspective_reversed;

    #[test]
    fn the_offsets_stay_within_half_a_pixel_and_repeat_every_eight_frames() {
        let offsets: Vec<[f32; 2]> = (0..SEQUENCE).map(jitter).collect();
        for offset in &offsets {
            assert!(offset.iter().all(|v| v.abs() <= 0.5), "{offset:?}");
        }
        assert_eq!(jitter(3), jitter(3 + SEQUENCE));
        // The eight offsets are all different and balance near the pixel's center.
        let mean = offsets
            .iter()
            .fold([0.0; 2], |sum, o| [sum[0] + o[0], sum[1] + o[1]]);
        assert!(
            mean.iter().all(|v| (v / SEQUENCE as f32).abs() < 0.07),
            "{mean:?}"
        );
        assert_eq!(jitter(0), [0.0, 1.0 / 3.0 - 0.5]);
    }

    #[test]
    fn a_still_camera_reprojects_each_pixel_onto_itself_and_a_moved_one_follows_the_move() {
        let projection = perspective_reversed(1.0, 1.5, 0.1, 100.0);
        let last = LastView {
            view_proj: projection,
            at: [1.0, 2.0, 3.0],
        };
        let apply = |m: &Mat4, clip: [f32; 4]| {
            let out: Vec<f32> = (0..4)
                .map(|row| (0..4).map(|k| m[k * 4 + row] * clip[k]).sum())
                .collect();
            (out[0] / out[3], out[1] / out[3])
        };
        let clip = [0.2f32, -0.4, 0.5, 1.0];
        let (x, y) = apply(
            &reprojection(&projection, [1.0, 2.0, 3.0], &last).unwrap(),
            clip,
        );
        assert!((x - 0.2).abs() < 1e-5 && (y + 0.4).abs() < 1e-5, "{x} {y}");
        // A camera one unit to the right sees every point further left than it was.
        let (x, _) = apply(
            &reprojection(&projection, [2.0, 2.0, 3.0], &last).unwrap(),
            clip,
        );
        assert!(x > 0.2, "{x}");
    }
}
