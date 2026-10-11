//! The motion view of the WebGPU builder (see [`crate::motion`]): its GPU objects, the camera's
//! move, and the last frame's data that the motion pass reads.
//!
//! The builder keeps two copies of the last frame's data, one for each frame parity: the world
//! matrices, the joint texture and each skinned vertex buffer. A frame reads the copy of the parity
//! before its own, and after its passes it copies its own data into its parity's copy, for the next
//! frame. That copy last took the frame before the last one, so a frame copies the matrices that it
//! or the last frame uploaded, and the joints and skinned vertices whole. A frame that draws again,
//! as a capture draws it, reads and writes the same copies, so it draws the same motion.
//!
//! The copies hold nothing of use in the first frame after the motion pass starts to draw, after a
//! copy grows, or after the draw tables are rebuilt, which can move every source and skinned region.
//! Such a frame fills both copies, and the motion view draws no object in it: the frame records the
//! camera's motion alone.

use null3d_gpu::drawlist::{
    DrawList, Op, address, buffer_usage as usage, compare, filter, format, layout as bind_layout,
    resource_kind, texture_usage, view,
};

use super::ids;
use super::layout::Layout;
use super::opaque;
use super::skin::{MAX_SKINNED_BUFFERS, Skinning};
use crate::frame::{RecordError, UploadArena};
use crate::motion::{self, CameraHistory, ChangedRanges, MotionFrame};
use crate::skinning::{JOINTS_PER_ROW, TEXELS_PER_JOINT};
use crate::view::{ViewFrame, ViewId};

/// The binding of the motion block in the motion view's frame group, and of the last frame's
/// joint texture.
const BLOCK_BINDING: u32 = 4;
const LAST_JOINTS_BINDING: u32 = 5;

/// The motion view's state across frames.
#[derive(Debug, Default)]
pub(super) struct Motion {
    camera: CameraHistory,
    /// True once the motion view's frame buffer, motion block, blank map and its group exist.
    made: bool,
    /// True once the motion view's culling pipeline is created.
    pipeline_made: bool,
    /// The byte ranges of the matrix buffer that this frame and the last uploaded.
    matrices: ChangedRanges,
    /// Bytes of each copy of the last frame's matrices, rows of each copy of its joints, and bytes
    /// of each copy of each skinned vertex buffer, 0 before they exist.
    matrix_bytes: u32,
    joint_rows: u32,
    skinned: [u32; MAX_SKINNED_BUFFERS as usize],
    /// What the frame groups bind that can change: the copies of the joints, as their rows.
    groups: Option<u32>,
    /// True when the frame fills both copies, and draws no object's motion.
    filling: bool,
    /// True when the frame before this one kept the last frame's data in its copy.
    kept: bool,
    /// True when the motion view's bundles must be recorded again.
    bundles_stale: bool,
}

impl Motion {
    /// Records the creation of the motion view's culling pipeline, the first time the motion pass
    /// draws. Returns true when it recorded it. Pipelines come first in a frame's list.
    pub(super) fn create_pipeline(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        if self.pipeline_made {
            return Ok(false);
        }
        super::cull::create_motion_pipeline(list)?;
        self.pipeline_made = true;
        Ok(true)
    }

    /// The camera's move in this frame, from the camera's view in `camera`, which becomes the last
    /// view of the next frame.
    pub(super) fn advance(&mut self, camera: &ViewFrame) -> MotionFrame {
        let uniform = &camera.uniform;
        self.camera
            .advance(&uniform.view_proj, camera.camera.absolute(), uniform.clock)
    }

    /// Starts the frame of the motion pass: makes the GPU objects that it lacks, the copies of the
    /// last frame's data as large as the layout's matrices, the joint texture and the skinned
    /// vertex buffers, and the frame groups that bind them. A frame that `rebuilt` the draw tables,
    /// or that makes a copy, fills both copies and draws no object's motion. Returns true when the
    /// motion view's bundles must be recorded again.
    pub(super) fn prepare(
        &mut self,
        list: &mut DrawList,
        layout: &Layout,
        skinning: &Skinning,
        rebuilt: bool,
        values_remade: bool,
    ) -> Result<bool, RecordError> {
        let mut remade = false;
        if !self.made {
            self.create_objects(list)?;
            remade = true;
        }
        let matrix_bytes = layout.matrix_bytes();
        if matrix_bytes > self.matrix_bytes {
            self.matrix_bytes = matrix_bytes;
            for parity in 0..2 {
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids::last_matrices(parity),
                        matrix_bytes,
                        usage::STORAGE | usage::COPY_DST,
                    ],
                )?;
            }
            remade = true;
        }
        let rows = skinning.joints().rows();
        if rows > self.joint_rows {
            self.joint_rows = rows;
            for parity in 0..2 {
                list.push(
                    Op::CreateTexture,
                    &[
                        ids::last_joints(parity),
                        JOINTS_PER_ROW * TEXELS_PER_JOINT,
                        rows,
                        1,
                        format::RGBA32_FLOAT,
                        texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                        1,
                        1,
                        view::D2,
                    ],
                )?;
            }
            remade = true;
        }
        for (buffer, _, made) in skinning.skinned_buffers() {
            let copied = &mut self.skinned[buffer as usize];
            if made > *copied {
                *copied = made;
                for parity in 0..2 {
                    list.push(
                        Op::CreateBuffer,
                        &[
                            ids::last_skinned(parity, buffer),
                            made,
                            usage::VERTEX | usage::COPY_DST,
                        ],
                    )?;
                }
                self.bundles_stale = true;
                remade = true;
            }
        }
        if self.groups != Some(self.joint_rows) || values_remade {
            for parity in 0..2 {
                self.bind_frame(list, parity)?;
            }
            self.groups = Some(self.joint_rows);
        }
        self.filling = remade || rebuilt;
        if self.filling {
            self.matrices.clear();
        }
        self.matrices.begin();
        Ok(std::mem::take(&mut self.bundles_stale))
    }

    /// The byte ranges of the matrix buffer that the frame uploads, which it copies afterwards.
    pub(super) fn changed_matrices(&mut self) -> &mut ChangedRanges {
        &mut self.matrices
    }

    /// Makes room for `ranges` upload ranges of the matrix buffer in each frame.
    pub(super) fn reserve(&mut self, ranges: usize) -> Result<(), RecordError> {
        self.matrices
            .reserve(ranges)
            .map_err(|_| RecordError::OutOfMemory {
                bytes: (ranges * 24) as u32,
            })
    }

    /// True when the motion view draws its objects in this frame: the last frame kept its data, and
    /// this frame does not fill the copies.
    pub(super) fn draws(&self) -> bool {
        self.kept && !self.filling
    }

    /// Uploads the motion view's frame uniform, the camera's in `camera`, and the motion block.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        camera: &ViewFrame,
        frame: &MotionFrame,
    ) -> Result<(), RecordError> {
        opaque::upload(list, arena, ViewId::MOTION, camera)?;
        let (at, bytes) = arena.push(frame.block.as_bytes())?;
        list.push(Op::WriteBuffer, &[ids::MOTION_BLOCK, 0, at, bytes])?;
        Ok(())
    }

    /// Records the copies of the frame's data into its parity's copy, after the frame's passes:
    /// the matrices that this frame and the last uploaded, and the joints in use and the skinned
    /// vertices whole. A frame that fills the copies copies everything into both.
    pub(super) fn finish(
        &mut self,
        list: &mut DrawList,
        parity: usize,
        layout: &Layout,
        skinning: &Skinning,
    ) -> Result<(), RecordError> {
        let parities = if self.filling {
            0..2
        } else {
            parity..parity + 1
        };
        let whole = self.filling || self.matrices.everything();
        let matrix_bytes = layout.matrix_bytes().min(self.matrix_bytes);
        for parity in parities.clone() {
            let last = ids::last_matrices(parity);
            if whole {
                if matrix_bytes > 0 {
                    list.push(
                        Op::CopyBufferToBuffer,
                        &[ids::MATRICES, 0, last, 0, matrix_bytes],
                    )?;
                }
            } else {
                for &(start, len) in self.matrices.both() {
                    let len = len.min(matrix_bytes.saturating_sub(start));
                    if len > 0 {
                        list.push(
                            Op::CopyBufferToBuffer,
                            &[ids::MATRICES, start, last, start, len],
                        )?;
                    }
                }
            }
            let joints = skinning.joints();
            if joints.exists() && self.joint_rows > 0 {
                let rows = joints.rows().min(self.joint_rows);
                list.push(
                    Op::CopyTextureToTexture,
                    &[
                        joints.id(),
                        0,
                        0,
                        0,
                        0,
                        ids::last_joints(parity),
                        0,
                        0,
                        0,
                        0,
                        JOINTS_PER_ROW * TEXELS_PER_JOINT,
                        rows,
                        1,
                    ],
                )?;
            }
            for (buffer, used, _) in skinning.skinned_buffers() {
                let bytes = used.min(self.skinned[buffer as usize]);
                if bytes > 0 {
                    list.push(
                        Op::CopyBufferToBuffer,
                        &[
                            ids::skinned(buffer),
                            0,
                            ids::last_skinned(parity, buffer),
                            0,
                            bytes,
                        ],
                    )?;
                }
            }
        }
        self.kept = true;
        Ok(())
    }

    /// Stops keeping the last frame's data while no pass reads the motion: the next frame that
    /// draws it starts again from its own.
    pub(super) fn stop(&mut self) {
        self.kept = false;
        self.camera.forget();
        self.matrices.clear();
    }

    /// Records the creation of the motion view's frame buffer, the motion block, and the blank
    /// map, with its sampler and group, which buckets without a map bind.
    fn create_objects(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        opaque::create_frame_buffer(list, ViewId::MOTION)?;
        list.push(
            Op::CreateBuffer,
            &[
                ids::MOTION_BLOCK,
                motion::BLOCK_BYTES,
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                ids::BLANK_MAP,
                1,
                1,
                1,
                format::RGBA8_UNORM,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2_ARRAY,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                ids::BLANK_JOINTS,
                1,
                1,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        list.push(
            Op::CreateSampler,
            &[
                ids::MOTION_SAMPLER,
                address::REPEAT,
                address::REPEAT,
                address::REPEAT,
                filter::LINEAR,
                filter::LINEAR,
                filter::NEAREST,
                0f32.to_bits(),
                0f32.to_bits(),
                compare::NONE,
                1,
            ],
        )?;
        list.push(
            Op::CreateBindGroup,
            &[
                ids::BLANK_MAP_GROUP,
                bind_layout::TEXTURES,
                2,
                0,
                resource_kind::TEXTURE,
                ids::BLANK_MAP,
                0,
                0,
                1,
                resource_kind::SAMPLER,
                ids::MOTION_SAMPLER,
                0,
                0,
            ],
        )?;
        self.made = true;
        self.bundles_stale = true;
        Ok(())
    }

    /// Records the creation of the motion view's frame group for a frame parity: the depth
    /// group's bindings, the motion block, and the copy of the last frame's joints that the
    /// parity reads, the other parity's, or a blank texel before the scene skins, and the table of
    /// object ranges.
    fn bind_frame(&self, list: &mut DrawList, parity: usize) -> Result<(), RecordError> {
        let joints = if self.joint_rows > 0 {
            ids::last_joints(1 - parity)
        } else {
            ids::BLANK_JOINTS
        };
        let entry = |binding: u32, kind: u32, id: u32| [binding, kind, id, 0, 0];
        let entries = [
            entry(0, resource_kind::BUFFER, ids::frame(ViewId::MOTION)),
            entry(1, resource_kind::BUFFER, ids::MATERIALS),
            entry(2, resource_kind::TEXTURE, ids::CUSTOM_VALUES),
            entry(BLOCK_BINDING, resource_kind::BUFFER, ids::MOTION_BLOCK),
            entry(LAST_JOINTS_BINDING, resource_kind::TEXTURE, joints),
            entry(
                opaque::ROW_VALUES_BINDING,
                resource_kind::TEXTURE,
                ids::ROW_VALUES,
            ),
            entry(
                opaque::OBJECT_RANGES_BINDING,
                resource_kind::BUFFER,
                ids::OBJECT_RANGES,
            ),
        ];
        let mut words = [0u32; 3 + 5 * 7];
        words[..3].copy_from_slice(&[
            ids::motion_frame_group(parity),
            bind_layout::MOTION_FRAME,
            entries.len() as u32,
        ]);
        words[3..].copy_from_slice(entries.as_flattened());
        list.push(Op::CreateBindGroup, &words)?;
        Ok(())
    }

    /// Forgets the GPU objects, so the next frame that draws the motion makes them again, after the
    /// thread that draws replaced the GPU.
    pub(super) fn forget_gpu(&mut self) {
        *self = Self::default();
    }
}
