//! Temporal anti-aliasing, a prototype (M3-A11, D-206). Each frame moves the camera's projection by
//! a different fraction of a pixel, so over a few frames each pixel sees several places within
//! itself. A resolve step then blends the frame into a history of earlier frames, which it reads
//! where each pixel's surface was in the frame before, and limits that history to the colors of
//! the pixel's neighbors in this frame, so moving and uncovered surfaces do not leave trails.
//!
//! # The steps
//!
//! The render graph declares the steps around the scene's passes (see [`crate::frame_graph`]):
//!
//! 1. A copy of the scene's color after the opaque pass, before any blended surface draws over it.
//!    The resolve compares it with the composited color, where this frame's transparency mask
//!    comes from.
//! 2. The resolve reads the scene's color and depth, the motion target, the opaque-only copy and
//!    both histories, and writes the blend into a frame target that the rest of the chain reads in
//!    place of the scene's color.
//! 3. A copy step copies that target into the history that the frame after reads. Frames of even
//!    and odd numbers take turns: each frame reads the target that the frame before it wrote and
//!    writes the other, and the copy into the target it reads does not draw. A frame drawn again,
//!    as a capture draws it, then reads and writes the same targets and leaves the same history.
//!
//! The resolve finds where each pixel's surface lay in the last frame from two parts: the motion
//! target gives the surface's own move, the grass's wind among it, and the pixel's depth and the
//! last frame's camera give the camera's part. The offsets follow the Halton sequence of bases 2
//! and 3, eight frames long, as Unreal Engine's does.
//!
//! The phone path reads one depth sample where the scene's depth is multisampled, samples the
//! history with four taps, and skips the transparency mask and the brightness weighting. It keeps
//! the same pipelines, so turning it on builds nothing of its own.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, state_flags, template,
};

use crate::bloom::bytes_of;
use crate::camera::{Mat4, invert, multiply};
use crate::frame::{RecordError, UploadArena};
use crate::graph::{RenderScale, Size};
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};

/// The steps: the opaque-only copy, the resolve, and the copy into each history.
pub(crate) const STEPS: usize = 4;

/// The step of the opaque-only copy.
pub(crate) const OPAQUE_STEP: usize = 0;
/// The step of the resolve.
pub(crate) const RESOLVE_STEP: usize = 1;
/// The step of the copy into the history of parity 0, and the one for parity 1.
pub(crate) const COPY_STEPS: [usize; 2] = [2, 3];

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
    /// True to move the projection by the sequence's offsets. False keeps it still, so the
    /// resolve only blends frames, for measuring what the offsets add.
    pub jitter: bool,
    /// True for the phone path, which reads one depth sample, samples the history with four taps,
    /// and skips the transparency mask and the brightness weighting.
    pub phone: bool,
    /// The transparency signals that lower the history: see [`Reactive`].
    pub reactive: Reactive,
}

/// The signals that tell the resolve where a blended surface moved, as bits: 1 reads the scene's
/// alpha, where the canvas shows through, and 2 compares the composited color with the opaque-only
/// copy, which finds a blended surface over an opaque one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reactive(pub u8);

impl Reactive {
    /// Every signal on.
    pub const ALL: Self = Self(3);
    /// The bits as the block holds them.
    const fn code(self) -> f32 {
        (self.0 & 3) as f32
    }
}

impl Default for Reactive {
    fn default() -> Self {
        Self::ALL
    }
}

impl Default for Taa {
    fn default() -> Self {
        Self {
            feedback: 0.9,
            jitter: true,
            phone: false,
            reactive: Reactive::ALL,
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

/// The matrix that takes a point of this frame's clip space, from the projection with its offset,
/// to the last frame's clip space without its offset: the inverse of this frame's matrix, the
/// move from this camera's place to the last one's, then the last view's matrix. `None` when this
/// frame's matrix has no inverse.
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
    /// The render size in pixels.
    pub size: (u32, u32),
    /// The camera's projection, whose terms turn a depth value into a distance.
    pub projection: Mat4,
    /// This frame's sub-pixel jitter in clip space, which the resolve takes off the pixel's own
    /// place before it reprojects.
    pub jitter: [f32; 2],
    /// The last frame's sub-pixel jitter in clip space. The history's pixels hold the surfaces
    /// that the last frame's offset put there, so the resolve moves its sample by that offset.
    pub last_jitter: [f32; 2],
    /// From this frame's clip space to the last frame's: see [`reprojection`].
    pub reproject: Mat4,
    /// This frame's exposure over the last frame's, which the history takes before the blend.
    pub exposure_ratio: f32,
    /// True when the history holds nothing of use, as in the first frames after the resolve turns
    /// on: the resolve writes this frame's color alone.
    pub reset: bool,
    /// The history that this frame writes, 0 or 1, from its number: it reads the other.
    pub parity: u8,
}

/// The resolve's block, as `taa.wgsl` lays out its `Block` struct.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct Block {
    reproject: [f32; 16],
    /// xy: the drawn corner's size in pixels. zw: its reciprocal.
    size: [f32; 4],
    /// The projection's terms that give a distance from a depth value: x * depth + y over
    /// z * depth + w.
    depth: [f32; 4],
    /// This frame's jitter in clip space.
    jitter: [f32; 4],
    /// The last frame's jitter in clip space, which moves the history's sample.
    last_jitter: [f32; 4],
    /// x: the share of the history that a pixel keeps. y: 1 while the histories hold no frame. z:
    /// this frame's exposure over the last frame's. w: unused.
    settings: [f32; 4],
    /// x: 1 while the frame writes the second history target, so it reads the first. yz: the scale
    /// from the drawn corner's texture coordinates into the history target's. w: 1 on the phone
    /// path.
    parity: [f32; 4],
    /// x: the transparency signals to read, as [`Reactive`]'s bits. y: 1 while the opaque-only copy
    /// is bound. zw: unused.
    reactive: [f32; 4],
}

const _: () = assert!(std::mem::size_of::<Block>() <= BLOCK);

/// The GPU objects of temporal anti-aliasing, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TaaIds {
    /// The uniform buffer of the resolve's block.
    pub(crate) buffer: u32,
    /// The linear sampler that reads the history.
    pub(crate) sampler: u32,
    /// The bind groups from this id on: the resolve's, the history copy's, and the opaque-only
    /// copy's.
    pub(crate) first_group: u32,
}

/// The textures that the steps read: the scene's color, depth and motion, the two histories, the
/// resolve's target, and the copy of the scene's color after the opaque pass.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TaaSources {
    pub(crate) color: u32,
    pub(crate) depth: u32,
    pub(crate) motion: u32,
    pub(crate) histories: [u32; 2],
    pub(crate) resolved: u32,
    /// The scene's color, which the opaque-only copy reads after the opaque pass. It differs from
    /// `color` when the subsurface blur drew between the two.
    pub(crate) scene: u32,
    /// The copy of the scene's color after the opaque pass, which the resolve reads where a blended
    /// surface may have changed the color.
    pub(crate) opaque: u32,
}

/// The pipeline of step `step`: the resolve, or a copy.
const fn pipeline(step: usize, multisampled: bool) -> PipelineKey {
    let template = match step {
        RESOLVE_STEP if multisampled => template::TAA_RESOLVE_MS,
        RESOLVE_STEP => template::TAA_RESOLVE,
        _ => template::TAA_COPY,
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
    frame: TaaFrame,
}

/// Temporal anti-aliasing's GPU objects, and what the GPU holds of them.
#[derive(Debug)]
pub(crate) struct TaaPass {
    ids: TaaIds,
    /// True when the scene's depth target is multisampled, so the resolve reads its samples.
    multisampled: bool,
    pipelines: [Option<u32>; STEPS],
    created: bool,
    staged_for: Option<Staged>,
    bound: Option<TaaSources>,
}

impl TaaPass {
    /// The steps, with GPU objects from `ids`, for a scene depth of `samples`.
    pub(crate) fn new(ids: TaaIds, samples: u32) -> Self {
        Self {
            ids,
            multisampled: samples > 1,
            pipelines: [None; STEPS],
            created: false,
            staged_for: None,
            bound: None,
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
        (canvas, _scale): ((u32, u32), RenderScale),
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
        let inputs = Staged { canvas, frame };
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

    /// Records the resolve's bind group, which reads the scene's color, depth and motion, the
    /// histories and the opaque-only copy, and the copy's, which reads the resolve's target. The
    /// opaque-only step reads the scene's color through a group of its own.
    fn bind(&self, list: &mut DrawList, sources: TaaSources) -> Result<(), RecordError> {
        let ids = self.ids;
        let layout = if self.multisampled {
            bind_layout::TAA_MS
        } else {
            bind_layout::TAA
        };
        let texture = |binding: u32, id: u32| [binding, resource_kind::TEXTURE, id, 0, 0];
        // The comparison is off while no blended surface draws, so the history's texture stands
        // in for the copy that the frame leaves out.
        let opaque = if sources.opaque == 0 {
            sources.histories[0]
        } else {
            sources.opaque
        };
        let entries = [
            [0, resource_kind::BUFFER, ids.buffer, 0, BLOCK as u32],
            texture(1, sources.color),
            texture(2, sources.depth),
            texture(3, sources.motion),
            texture(4, sources.histories[0]),
            texture(5, sources.histories[1]),
            [6, resource_kind::SAMPLER, ids.sampler, 0, 0],
            texture(7, opaque),
        ];
        let mut words = [0u32; 3 + 8 * 5];
        words[..3].copy_from_slice(&[ids.first_group, layout, entries.len() as u32]);
        for (place, entry) in entries.iter().enumerate() {
            words[3 + 5 * place..][..5].copy_from_slice(entry);
        }
        list.push(Op::CreateBindGroup, &words)?;
        let view_copy = |group: u32, id: u32| {
            [
                group,
                bind_layout::VIEW_COPY,
                1,
                0,
                resource_kind::TEXTURE,
                id,
                0,
                0,
            ]
        };
        list.push(
            Op::CreateBindGroup,
            &view_copy(ids.first_group + 1, sources.resolved),
        )?;
        if sources.opaque != 0 {
            list.push(
                Op::CreateBindGroup,
                &view_copy(ids.first_group + 2, sources.scene),
            )?;
        }
        Ok(())
    }

    /// The resolve's block for `inputs`.
    fn block(&self, inputs: Staged) -> Block {
        let Staged { canvas, frame, .. } = inputs;
        let extent = Size::Full.extent(canvas);
        let (width, height) = frame.size;
        let (width, height) = (width.max(1), height.max(1));
        let m = frame.projection;
        Block {
            reproject: frame.reproject,
            size: [
                width as f32,
                height as f32,
                1.0 / width as f32,
                1.0 / height as f32,
            ],
            depth: [-m[15], m[14], m[11], -m[10]],
            jitter: [frame.jitter[0], frame.jitter[1], 0.0, 0.0],
            last_jitter: [frame.last_jitter[0], frame.last_jitter[1], 0.0, 0.0],
            settings: [
                frame.taa.feedback.clamp(0.0, 0.99),
                if frame.reset { 1.0 } else { 0.0 },
                frame.exposure_ratio,
                0.0,
            ],
            parity: [
                f32::from(frame.parity & 1),
                width as f32 / extent.0.max(1) as f32,
                height as f32 / extent.1.max(1) as f32,
                if frame.taa.phone { 1.0 } else { 0.0 },
            ],
            // The opaque-only copy is always bound while the resolve draws.
            reactive: [frame.taa.reactive.code(), 1.0, 0.0, 0.0],
        }
    }

    /// Records step `step` inside the render pass that the render graph began into its target: the
    /// resolve with the resolve's bind group, and either copy with its own.
    pub(crate) fn record(&self, list: &mut DrawList, step: usize) -> Result<(), RecordError> {
        let pipeline = self.pipelines[step].expect("the steps ask for their pipelines first");
        let group = match step {
            OPAQUE_STEP => self.ids.first_group + 2,
            RESOLVE_STEP => self.ids.first_group,
            _ => self.ids.first_group + 1,
        };
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, group, 0])?;
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
    use crate::camera::{orthographic_reversed, perspective_reversed};

    /// The block's depth terms, as [`TaaPass::block`] gives them for a projection.
    fn depth_terms(projection: &Mat4) -> [f32; 4] {
        [
            -projection[15],
            projection[14],
            projection[11],
            -projection[10],
        ]
    }

    /// The distance that the block's terms give for a depth value.
    fn distance(terms: &[f32; 4], depth: f32) -> f32 {
        -((terms[0] * depth + terms[1]) / (terms[2] * depth + terms[3]))
    }

    #[test]
    fn the_depth_terms_give_the_distance_in_front_of_the_camera() {
        let perspective = perspective_reversed(1.0, 1.5, 0.1, 100.0);
        let orthographic = orthographic_reversed(-4.0, 4.0, -2.0, 2.0, 1.0, 10.0);
        for (projection, distances) in [
            (perspective, [0.1f32, 1.0, 50.0, 100.0].as_slice()),
            (orthographic, [1.0f32, 5.5, 7.75, 10.0].as_slice()),
        ] {
            let terms = depth_terms(&projection);
            for &expected in distances {
                let z = -expected;
                let clip_z = projection[10] * z + projection[14];
                let clip_w = projection[11] * z + projection[15];
                let given = distance(&terms, clip_z / clip_w);
                assert!(
                    (given - expected).abs() < 1e-3 * expected,
                    "{expected}: {given}"
                );
            }
        }
    }

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
    fn a_still_camera_reprojects_each_point_onto_itself_without_the_offset() {
        let projection = perspective_reversed(1.0, 1.5, 0.1, 100.0);
        let last = LastView {
            view_proj: projection,
            at: [1.0, 2.0, 3.0],
        };
        let m = reprojection(&projection, [1.0, 2.0, 3.0], &last).unwrap();
        // A point of this frame's clip space lands where the projection puts it.
        let clip = [0.2f32, -0.4, 0.5, 1.0];
        let out: Vec<f32> = (0..4)
            .map(|row| (0..4).map(|k| m[k * 4 + row] * clip[k]).sum())
            .collect();
        let (x, y) = (out[0] / out[3], out[1] / out[3]);
        assert!((x - clip[0]).abs() < 1e-4, "{x}");
        assert!((y - clip[1]).abs() < 1e-4, "{y}");
    }
}
