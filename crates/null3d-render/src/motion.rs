//! Motion vectors: how far each pixel's surface moved on the screen since the last frame, for the
//! passes that read it (decision record D-140). The render graph's motion pass draws the moving
//! objects from the motion view (see [`crate::view::ViewId::MOTION`]) into the motion target, with
//! the scene's depth as its depth target, which it tests but never writes:
//!
//! - The target holds two half floats per pixel: each surface's own motion beyond what the
//!   camera's move explains, in texture coordinates of the image across the render size, x to the
//!   right and y down. It clears to 0, so still surfaces need no draw.
//! - A reader adds the camera's part from the depth: the pixel's point, placed by its depth, moved
//!   into the last frame's clip space by [`MotionFrame::reproject`].
//! - Each moving vertex takes its place in this frame and in the last, from the last frame's world
//!   matrix, joints and morph weights, which the frame builders keep on the GPU while the motion
//!   pass draws. They keep two copies of each and use them in turn by frame parity: a frame reads
//!   the copy of the frame before it and writes its own, so a frame that draws again, as a capture
//!   draws it, draws the same motion.
//!
//! The motion pass and its culling are optional passes of the graph: they run only while another
//! pass reads the target. In development builds the motion debug view does, with a full-screen step
//! over the scene color ([`MotionView`]).

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    permutation, resource_kind, state_flags, template, texture_usage, view,
};

use crate::bloom::bytes_of;
use crate::camera::{Mat4, invert, multiply};
use crate::frame::{RecordError, UploadArena};
use crate::pipelines::{DepthBias, DrawKey, PipelineCache, PipelineKey};

/// The format of the motion target.
pub const FORMAT: u32 = format::RG16_FLOAT;

/// The identity matrix: no move between two frames.
pub(crate) const IDENTITY: Mat4 = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// The motion pass's values of a frame, as `null3d::motion`'s `MotionBlock` lays them out: the last
/// frame's view-projection matrix for positions relative to this frame's camera, the last frame's
/// clock as the frame uniform holds it, and the texel row where the WebGL2 builder's copy of the
/// last frame's joints holds its morph weights, padded to a whole `vec4`.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionBlock {
    pub last_view_proj: Mat4,
    pub last_clock: [f32; 4],
    pub last_weights_row: u32,
    pad: [u32; 3],
}

/// Bytes of the motion block.
pub(crate) const BLOCK_BYTES: u32 = std::mem::size_of::<MotionBlock>() as u32;

impl MotionBlock {
    /// The block with `row` as the first texel row of the last frame's morph weights.
    pub(crate) fn with_weights_row(self, row: u32) -> Self {
        Self {
            last_weights_row: row,
            ..self
        }
    }

    /// The block as bytes, for an upload.
    pub(crate) fn as_bytes(&self) -> &[u8] {
        bytes_of(self)
    }
}

/// What a frame's motion pass and the readers of its target know of the camera's move.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionFrame {
    pub block: MotionBlock,
    /// The matrix from this frame's clip space to the last frame's, which gives a pixel the
    /// camera's part of its motion from its depth.
    pub reproject: Mat4,
}

/// The camera's view in the frame recorded last: its view-projection matrix for positions relative
/// to it, its place in the world, and the frame's clock.
#[derive(Clone, Copy, Debug, PartialEq)]
struct LastView {
    view_proj: Mat4,
    at: [f64; 3],
    clock: [f32; 4],
}

/// The camera's view from frame to frame, which gives each frame its motion values.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct CameraHistory {
    last: Option<LastView>,
}

impl CameraHistory {
    /// The motion values of a frame whose camera draws with `view_proj` from `at` in the world, at
    /// the frame uniform's `clock`, and keeps them as the last view for the next frame. The first
    /// frame has no last view: it takes its own, so its camera did not move.
    pub(crate) fn advance(
        &mut self,
        view_proj: &Mat4,
        at: [f64; 3],
        clock: [f32; 4],
    ) -> MotionFrame {
        let last = self.last.unwrap_or(LastView {
            view_proj: *view_proj,
            at,
            clock,
        });
        self.last = Some(LastView {
            view_proj: *view_proj,
            at,
            clock,
        });
        let last_view_proj = last_view_proj(&last.view_proj, last.at, at);
        MotionFrame {
            block: MotionBlock {
                last_view_proj,
                last_clock: last.clock,
                last_weights_row: 0,
                pad: [0; 3],
            },
            reproject: reprojection(view_proj, &last_view_proj),
        }
    }

    /// Forgets the last view, so the next frame starts again from its own.
    pub(crate) fn forget(&mut self) {
        self.last = None;
    }
}

/// The last view's matrix for positions relative to a camera at `at`: a position relative to this
/// camera moves by the step from the last camera's place to this one, then the last view's matrix
/// takes it. The step is found in 64-bit floats, so it stays exact far from the origin.
pub(crate) fn last_view_proj(last: &Mat4, last_at: [f64; 3], at: [f64; 3]) -> Mat4 {
    let mut moved = IDENTITY;
    for k in 0..3 {
        moved[12 + k] = (at[k] - last_at[k]) as f32;
    }
    multiply(last, &moved)
}

/// The matrix from this frame's clip space, of `view_proj`, to the last frame's, of
/// `last_view_proj` for positions relative to this camera. A matrix without an inverse gives the
/// identity: no move.
pub(crate) fn reprojection(view_proj: &Mat4, last_view_proj: &Mat4) -> Mat4 {
    invert(view_proj).map_or(IDENTITY, |inverse| multiply(last_view_proj, &inverse))
}

/// The key of the motion pipeline of a pair that draws with `pipeline` in the scene: the motion
/// template's, with the bits of its skin, its morph targets and its mask where `masked` says the
/// material cuts holes, or a custom material's own template's motion build where `sways` says its
/// vertex offset moves it. It draws the faces that the pair draws, tests the scene's depth as near
/// or equal, nudged toward the camera as the outline mask's visible parts are, and writes none.
/// `None` for a pair that draws no motion: a blended one, one that writes no depth, which the
/// motion pass could not find its surfaces in, or a sprite or a line.
pub(crate) fn motion_key(pipeline: DrawKey, masked: bool, sways: bool) -> Option<DrawKey> {
    let mesh = matches!(
        pipeline.template,
        template::INSTANCED_LIT
            | template::INSTANCED_UNLIT
            | template::INSTANCED_TEXCOORDS
            | template::INSTANCED_UNLIT_MAP
            | template::INSTANCED_STANDARD_MAPS
    ) || pipeline.template >= template::CUSTOM_FIRST;
    if !mesh || pipeline.sorts() || !pipeline.writes_depth() {
        return None;
    }
    let faces = pipeline.state & (state_flags::CULL_NONE | state_flags::CULL_FRONT);
    let state = faces | state_flags::NO_DEPTH_WRITE | state_flags::DEPTH_OR_EQUAL;
    let deforms = pipeline.permutation & (permutation::SKIN | permutation::MORPH);
    if sways && pipeline.template >= template::CUSTOM_FIRST && deforms == 0 {
        // A material whose WGSL sets the surface's alpha cuts its motion's holes as its caster
        // cuts its shadow's, at the cutoff or by the alpha hash.
        let mask = if masked {
            pipeline.permutation
                & (permutation::ALPHA_MASK | permutation::VERTEX_COLOR | permutation::ALPHA_HASH)
        } else {
            0
        };
        return Some(DrawKey {
            template: pipeline.template,
            permutation: permutation::MOTION
                | (pipeline.permutation & permutation::ROW_VALUES)
                | mask,
            vertex_format: pipeline.vertex_format,
            state,
            bias: MOTION_BIAS,
        });
    }
    let mask = if masked {
        pipeline.permutation
            & (permutation::ALPHA_MASK | permutation::VERTEX_COLOR | permutation::ALPHA_HASH)
    } else {
        0
    };
    // A mask's vertex alpha needs the mask.
    let mask = if mask & permutation::ALPHA_MASK == 0 {
        0
    } else {
        mask
    };
    Some(DrawKey {
        template: template::MOTION,
        permutation: deforms | mask,
        vertex_format: pipeline.vertex_format,
        state,
        bias: MOTION_BIAS,
    })
}

/// The depth bias of the motion pass's draws, toward the camera: it lets a surface pass the test
/// against the depth that the scene passes drew for it, as the outline mask's does.
const MOTION_BIAS: DepthBias = DepthBias {
    constant: 4,
    slope_bits: 0,
};

/// Ranges of a buffer or a texture that changed in this frame and in the last, which a frame
/// copies into its parity's copy: that copy last took the frame before the last one, so both
/// frames' changes bring it up to this frame. Each range is its start and its length, in the
/// caller's units. The lists keep their room between frames.
#[derive(Debug, Default)]
pub(crate) struct ChangedRanges {
    now: Vec<(u32, u32)>,
    last: Vec<(u32, u32)>,
    merged: Vec<(u32, u32)>,
    /// True when everything changed in this frame or the last.
    everything: [bool; 2],
}

impl ChangedRanges {
    /// Starts a frame: this frame's ranges become the last frame's.
    pub(crate) fn begin(&mut self) {
        std::mem::swap(&mut self.now, &mut self.last);
        self.now.clear();
        self.everything = [false, self.everything[0]];
    }

    /// Adds a range that this frame changed.
    pub(crate) fn add(&mut self, start: u32, len: u32) {
        if len > 0 {
            self.now.push((start, len));
        }
    }

    /// Marks everything changed in this frame.
    pub(crate) fn add_everything(&mut self) {
        self.everything[0] = true;
    }

    /// True when everything changed in this frame or the last.
    pub(crate) fn everything(&self) -> bool {
        self.everything[0] || self.everything[1]
    }

    /// The ranges that changed in this frame or the last, sorted, with ranges that touch or
    /// overlap joined.
    pub(crate) fn both(&mut self) -> &[(u32, u32)] {
        self.merged.clear();
        self.merged.extend_from_slice(&self.now);
        self.merged.extend_from_slice(&self.last);
        self.merged.sort_unstable();
        let mut joined = 0;
        for k in 0..self.merged.len() {
            let (start, len) = self.merged[k];
            if joined > 0 {
                let (first, first_len) = self.merged[joined - 1];
                if start <= first + first_len {
                    self.merged[joined - 1].1 = (start + len).max(first + first_len) - first;
                    continue;
                }
            }
            self.merged[joined] = (start, len);
            joined += 1;
        }
        self.merged.truncate(joined);
        &self.merged
    }

    /// Makes room for `ranges` ranges in each list, so frames that add no more allocate nothing.
    pub(crate) fn reserve(
        &mut self,
        ranges: usize,
    ) -> Result<(), std::collections::TryReserveError> {
        for list in [&mut self.now, &mut self.last] {
            list.try_reserve(ranges.saturating_sub(list.len()))?;
        }
        self.merged
            .try_reserve((2 * ranges).saturating_sub(self.merged.len()))
    }

    /// Forgets every range, as after the copies were made again from the whole.
    pub(crate) fn clear(&mut self) {
        self.now.clear();
        self.last.clear();
        self.everything = [false; 2];
    }
}

/// The GPU objects of the motion debug view's step, which the frame builder's id ranges set.
#[derive(Clone, Copy, Debug)]
pub(crate) struct MotionIds {
    /// The step's uniform buffer.
    pub(crate) buffer: u32,
    /// The step's bind group.
    pub(crate) group: u32,
    /// The sampler that its layout takes.
    pub(crate) sampler: u32,
    /// The texture of one texel that the step reads in place of the motion target where the
    /// device cannot draw one: no motion of the surfaces' own.
    pub(crate) blank: u32,
}

/// The step's block, as `motion_view.wgsl`'s `ViewBlock` lays it out: the render size in pixels,
/// the targets' size in texels, and the reprojection.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
struct ViewBlock {
    size: [f32; 4],
    reproject: Mat4,
}

/// The motion debug view's step: one triangle over the scene color, which shows each pixel's whole
/// motion as a color, from the motion target and the depth.
#[derive(Debug)]
pub(crate) struct MotionView {
    ids: MotionIds,
    created: bool,
    /// The step's pipeline, with the format, the sample count and the bits that it was asked for.
    pipeline: Option<(u32, u32, u32, u32)>,
    /// What the bind group binds: the motion texture, the depth texture and the layout.
    bound: Option<(u32, u32, u32)>,
    uploaded: Option<ViewBlock>,
}

/// Bytes that a frame copies into its arena for the step.
pub(crate) const VIEW_UPLOAD_BYTES: usize = std::mem::size_of::<ViewBlock>();

impl MotionView {
    pub(crate) fn new(ids: MotionIds) -> Self {
        Self {
            ids,
            created: false,
            pipeline: None,
            bound: None,
            uploaded: None,
        }
    }

    /// Asks `pipelines` for the step's pipeline into the scene color of `color_format` with
    /// `samples`, and returns its id. `tone_map` draws display color for the 8-bit path, and
    /// `multisampled` reads sample 0 of a multisampled depth.
    pub(crate) fn request_pipeline(
        &mut self,
        pipelines: &mut PipelineCache,
        color_format: u32,
        samples: u32,
        tone_map: bool,
        multisampled: bool,
    ) -> u32 {
        let bits = if tone_map { permutation::TONE_MAP } else { 0 }
            | if multisampled {
                permutation::DEPTH_MULTISAMPLED
            } else {
                0
            };
        match self.pipeline {
            Some((id, format, count, permutation))
                if format == color_format && count == samples && permutation == bits =>
            {
                id
            }
            _ => {
                let id = pipelines.id(PipelineKey {
                    template: template::MOTION_VIEW,
                    permutation: bits,
                    vertex_format: 0,
                    color_format,
                    depth_format: format::NONE,
                    samples,
                    state: state_flags::CULL_NONE,
                    bias: DepthBias::NONE,
                });
                self.pipeline = Some((id, color_format, samples, bits));
                id
            }
        }
    }

    /// Records what the step reads in this frame: its objects the first time, its block when it
    /// changed, and its bind group when its textures moved. `motion` is the motion target's texture,
    /// or `None` where the device draws none, and `depth` the scene depth's, multisampled where
    /// `multisampled` says so. `render` is the render size and `targets` the targets' size.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        motion: Option<u32>,
        depth: u32,
        multisampled: bool,
        render: (u32, u32),
        targets: (u32, u32),
        reproject: &Mat4,
    ) -> Result<(), RecordError> {
        if !self.created {
            self.create_objects(list)?;
        }
        let block = ViewBlock {
            size: [
                render.0 as f32,
                render.1 as f32,
                targets.0.max(1) as f32,
                targets.1.max(1) as f32,
            ],
            reproject: *reproject,
        };
        if self.uploaded != Some(block) {
            let (at, bytes) = arena.push(bytes_of(&block))?;
            list.push(Op::WriteBuffer, &[self.ids.buffer, 0, at, bytes])?;
            self.uploaded = Some(block);
        }
        let layout = if multisampled {
            bind_layout::EFFECT_DEPTH_MS
        } else {
            bind_layout::EFFECT
        };
        let motion = motion.unwrap_or(self.ids.blank);
        if self.bound != Some((motion, depth, layout)) {
            list.push(
                Op::CreateBindGroup,
                &[
                    self.ids.group,
                    layout,
                    4,
                    0,
                    resource_kind::BUFFER,
                    self.ids.buffer,
                    0,
                    VIEW_UPLOAD_BYTES as u32,
                    1,
                    resource_kind::TEXTURE,
                    motion,
                    0,
                    0,
                    2,
                    resource_kind::SAMPLER,
                    self.ids.sampler,
                    0,
                    0,
                    3,
                    resource_kind::TEXTURE,
                    depth,
                    0,
                    0,
                ],
            )?;
            self.bound = Some((motion, depth, layout));
        }
        Ok(())
    }

    /// Records the step inside the render pass that the render graph began into the scene color.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let (pipeline, ..) = self
            .pipeline
            .expect("the step asks for its pipeline before it records");
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.ids.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Records the creation of the uniform buffer, the sampler and the blank motion texture.
    fn create_objects(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        list.push(
            Op::CreateBuffer,
            &[
                self.ids.buffer,
                VIEW_UPLOAD_BYTES as u32,
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        list.push(
            Op::CreateSampler,
            &[
                self.ids.sampler,
                address::CLAMP_TO_EDGE,
                address::CLAMP_TO_EDGE,
                address::CLAMP_TO_EDGE,
                filter::NEAREST,
                filter::NEAREST,
                filter::NEAREST,
                0f32.to_bits(),
                0f32.to_bits(),
                compare::NONE,
                1,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                self.ids.blank,
                1,
                1,
                1,
                FORMAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        self.created = true;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame makes them again, after the thread that draws
    /// replaced the GPU. The pipeline keeps its id, which the cache creates again.
    pub(crate) fn reset_gpu(&mut self) {
        self.created = false;
        self.bound = None;
        self.uploaded = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::perspective_reversed;

    fn near(a: &[f32], b: &[f32]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-5)
    }

    #[test]
    fn a_still_camera_reprojects_onto_itself_and_the_first_frame_has_no_move() {
        let projection = perspective_reversed(1.0, 16.0 / 9.0, 0.1, 100.0);
        let mut history = CameraHistory::default();
        let first = history.advance(&projection, [5.0, 1.0, 2.0], [1.0, 0.1, 0.0, 0.0]);
        assert!(near(&first.block.last_view_proj, &projection));
        assert!(near(&first.reproject, &IDENTITY));
        assert_eq!(first.block.last_clock, [1.0, 0.1, 0.0, 0.0]);
        let second = history.advance(&projection, [5.0, 1.0, 2.0], [1.1, 0.1, 0.0, 0.0]);
        assert!(near(&second.reproject, &IDENTITY));
        assert_eq!(
            second.block.last_clock,
            [1.0, 0.1, 0.0, 0.0],
            "the last frame's clock"
        );
    }

    #[test]
    fn a_moved_camera_sees_a_still_point_where_the_last_camera_saw_it() {
        let projection = perspective_reversed(1.0, 1.0, 0.1, 100.0);
        let mut history = CameraHistory::default();
        history.advance(&projection, [0.0, 0.0, 0.0], [0.0; 4]);
        // The camera steps 1 m along x: a point 5 m ahead, relative to the new camera at
        // (-1, 0, -5), lay at (0, 0, -5) relative to the last one, the center of its view.
        let frame = history.advance(&projection, [1.0, 0.0, 0.0], [0.0; 4]);
        let m = frame.block.last_view_proj;
        let p = [-1.0f32, 0.0, -5.0, 1.0];
        let clip: Vec<f32> = (0..4)
            .map(|row| (0..4).map(|k| m[k * 4 + row] * p[k]).sum())
            .collect();
        assert!(clip[0].abs() < 1e-5 && clip[1].abs() < 1e-5, "{clip:?}");
    }

    #[test]
    fn changed_ranges_join_this_frame_and_the_last() {
        let mut ranges = ChangedRanges::default();
        ranges.begin();
        ranges.add(10, 5);
        ranges.add(0, 2);
        assert_eq!(ranges.both(), &[(0, 2), (10, 5)]);
        ranges.begin();
        ranges.add(14, 4);
        ranges.add(30, 1);
        assert_eq!(
            ranges.both(),
            &[(0, 2), (10, 8), (30, 1)],
            "the last frame's ranges join"
        );
        ranges.begin();
        assert_eq!(
            ranges.both(),
            &[(14, 4), (30, 1)],
            "two frames back no longer count"
        );
        ranges.add_everything();
        ranges.begin();
        assert!(ranges.everything(), "everything changed in the last frame");
        ranges.begin();
        assert!(!ranges.everything());
    }

    #[test]
    fn motion_keys_follow_the_pair_and_leave_out_blended_pairs_and_sprites() {
        let lit = DrawKey {
            template: template::INSTANCED_STANDARD_MAPS,
            permutation: permutation::ALPHA_MASK
                | permutation::VERTEX_COLOR
                | permutation::RECEIVE_SHADOWS,
            vertex_format: 7,
            state: state_flags::CULL_NONE | state_flags::ALPHA_TO_COVERAGE,
            bias: DepthBias::NONE,
        };
        let masked = motion_key(lit, true, false).unwrap();
        assert_eq!(masked.template, template::MOTION);
        assert_eq!(
            masked.permutation,
            permutation::ALPHA_MASK | permutation::VERTEX_COLOR
        );
        assert_eq!(
            masked.state,
            state_flags::CULL_NONE | state_flags::NO_DEPTH_WRITE | state_flags::DEPTH_OR_EQUAL
        );
        assert_eq!(masked.vertex_format, 7);
        assert_eq!(motion_key(lit, false, false).unwrap().permutation, 0);
        let skinned = DrawKey {
            permutation: permutation::SKIN,
            state: 0,
            ..lit
        };
        assert_eq!(
            motion_key(skinned, false, false).unwrap().permutation,
            permutation::SKIN
        );
        let blended = DrawKey {
            state: state_flags::BLEND_NORMAL,
            ..lit
        };
        assert_eq!(motion_key(blended, false, false), None);
        let sprite = DrawKey {
            template: template::SPRITE,
            ..lit
        };
        assert_eq!(motion_key(sprite, false, false), None);
        let custom = DrawKey {
            template: template::CUSTOM_FIRST + 3,
            permutation: permutation::ROW_VALUES | permutation::RECEIVE_SHADOWS,
            ..lit
        };
        let swaying = motion_key(custom, false, true).unwrap();
        assert_eq!(swaying.template, template::CUSTOM_FIRST + 3);
        assert_eq!(
            swaying.permutation,
            permutation::MOTION | permutation::ROW_VALUES
        );
        assert_eq!(
            motion_key(custom, false, false).unwrap().template,
            template::MOTION
        );
    }
}
