//! The motion pass of the WebGL2 builder (see [`crate::motion`]). The job workers cull no view of
//! its own: the motion pass replays the camera view's opaque calls, from the same index list, draw
//! records and instance textures, with each draw's motion pipeline. It leaves out each call whose
//! buckets hold nothing that moved in the frame: no scene object or static batch row that the
//! frame uploaded, no dynamic batch, and no bucket that moves by itself, as skinned and morphed
//! meshes and swaying custom materials do. A call that it draws draws its still instances too,
//! whose motion is 0.
//!
//! The builder keeps two copies of the last frame's resident texture, and two of its joint texture
//! with its morph weights in the rows after the joints, one for each frame parity, as the WebGPU
//! builder keeps its own (see `gpu_driven::motion`). Joints and weights share a texture, as the
//! vertex stage of a skinned and morphed draw has no texture unit to spare for a second. The
//! streamed ring keeps the last frame's dynamic rows in the slot before its current one. A frame
//! reads the copies of the parity before its own, and after its passes copies its own data into
//! its parity's copy: the resident rows that it or the last frame uploaded, and the joints and
//! weights whole.

use null3d_core::culling::NO_BUCKET;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, sizes,
    texture_usage, view,
};

use super::data::RING;
use super::ids;
use super::layout::Layout;
use super::opaque::{OBJECT_RANGES_BINDING, OFFSETS_AT, OFFSETS_BYTES};
use super::skin::Skins;
use crate::frame::{FrameInput, RecordError, UploadArena};
use crate::morph::TEXTURE_WIDTH as MORPH_WIDTH;
use crate::motion::{self, CameraHistory, ChangedRanges, MotionFrame};
use crate::skinning::{JOINTS_PER_ROW, TEXELS_PER_JOINT};
use crate::view::{ViewFrame, ViewId};

/// The width of the resident texture in texels.
const RESIDENT_WIDTH: u32 = sizes::MATRICES_PER_TEXTURE_ROW * sizes::MATRIX_TEXELS;
/// The width of the joint texture in texels.
const JOINTS_WIDTH: u32 = JOINTS_PER_ROW * TEXELS_PER_JOINT;
/// The width of the copies of the joints and morph weights in texels, the wider of the two.
const SKINS_WIDTH: u32 = if JOINTS_WIDTH > MORPH_WIDTH {
    JOINTS_WIDTH
} else {
    MORPH_WIDTH
};

/// The motion pass's state across frames.
#[derive(Debug, Default)]
pub(super) struct Motion {
    camera: CameraHistory,
    /// True once the motion block and the blank texel exist.
    made: bool,
    /// The resident rows that this frame and the last uploaded, in rows of matrices.
    resident: ChangedRanges,
    /// Texel rows of each copy of the resident texture, and of the joints and the morph weights in
    /// each copy of the joints, 0 before they exist.
    resident_rows: u32,
    joint_rows: u32,
    weight_rows: u32,
    /// The copies' rows that the frame groups were made for.
    groups: Option<(u32, u32, u32)>,
    /// True when the frame fills both copies, and draws no object's motion.
    filling: bool,
    /// True when the frame before this one kept the last frame's data in its copy.
    kept: bool,
}

impl Motion {
    /// The camera's move in this frame, from the camera's view in `camera`, which becomes the last
    /// view of the next frame.
    pub(super) fn advance(&mut self, camera: &ViewFrame) -> MotionFrame {
        let uniform = &camera.uniform;
        self.camera
            .advance(&uniform.view_proj, camera.camera.absolute(), uniform.clock)
    }

    /// Starts the frame of the motion pass: makes the GPU objects that it lacks, the copies of the
    /// last frame's data as large as the resident texture's `resident_rows` and as the joint
    /// texture and the morph weights together, and the frame groups that bind them. A frame that
    /// `rebuilt` the layout, or that makes a copy, fills both copies and draws no object's motion.
    pub(super) fn prepare(
        &mut self,
        list: &mut DrawList,
        resident_rows: u32,
        skins: &Skins,
        rebuilt: bool,
    ) -> Result<(), RecordError> {
        let mut remade = false;
        if !self.made {
            list.push(
                Op::CreateBuffer,
                &[
                    ids::MOTION_BLOCK,
                    motion::BLOCK_BYTES,
                    usage::UNIFORM | usage::COPY_DST,
                ],
            )?;
            create(list, ids::BLANK_LAST, 1, 1)?;
            self.made = true;
            remade = true;
        }
        if resident_rows > self.resident_rows {
            self.resident_rows = resident_rows;
            for copy in 0..2 {
                create(
                    list,
                    ids::last_resident(copy),
                    RESIDENT_WIDTH,
                    resident_rows,
                )?;
            }
            remade = true;
        }
        let (joint_rows, weight_rows) = (skins.joints().rows(), skins.morph().weight_rows());
        if joint_rows > self.joint_rows || weight_rows > self.weight_rows {
            self.joint_rows = self.joint_rows.max(joint_rows);
            self.weight_rows = self.weight_rows.max(weight_rows);
            for copy in 0..2 {
                let rows = self.joint_rows + self.weight_rows;
                create(list, ids::last_skins(copy), SKINS_WIDTH, rows)?;
            }
            remade = true;
        }
        let rows = (self.resident_rows, self.joint_rows, self.weight_rows);
        if self.groups != Some(rows) {
            for parity in 0..2 {
                for streamed in 0..RING {
                    self.bind_frame(list, parity, streamed)?;
                }
            }
            self.groups = Some(rows);
        }
        self.filling = remade || rebuilt;
        if self.filling {
            self.resident.clear();
        }
        self.resident.begin();
        Ok(())
    }

    /// Notes what moved in the frame: the resident rows that its upload list names, which it
    /// copies afterwards, and in `moving` the buckets of the layout that hold them, with every
    /// bucket of a dynamic batch with active rows and every bucket that moves by itself.
    pub(super) fn mark(&mut self, input: &FrameInput<'_>, layout: &Layout, moving: &mut Vec<bool>) {
        moving.clear();
        moving.extend(layout.buckets.iter().map(|bucket| bucket.moves));
        if input.snapshot.overflowed() {
            self.resident.add_everything();
            moving.fill(true);
            return;
        }
        let mut mark = |bucket: u32| {
            if bucket != NO_BUCKET {
                // A key's bucket of rows, then its bucket of clusters.
                for b in [bucket, bucket + 1] {
                    if let Some(slot) = moving.get_mut(b as usize) {
                        *slot = true;
                    }
                }
            }
        };
        for range in input.snapshot.uploads() {
            if range.target == SCENE_TARGET {
                self.resident.add(range.start, range.count);
                let end = (range.start + range.count).min(layout.scene_buckets.len() as u32);
                for slot in range.start..end {
                    mark(layout.scene_buckets[slot as usize]);
                }
                continue;
            }
            let Some(slot) = layout.batch(range.target) else {
                continue;
            };
            if !slot.dynamic {
                self.resident.add(slot.base + range.start, range.count);
            }
            mark(slot.bucket);
        }
        let parity = input.parity();
        for slot in layout.batches.iter().filter(|slot| slot.dynamic) {
            let active = input
                .batches
                .get(slot.id)
                .is_ok_and(|batch| batch.frame_active_count(parity) > 0);
            if active {
                mark(slot.bucket);
            }
        }
    }

    /// Makes room for the frame's upload ranges, so frames that need no more allocate nothing.
    pub(super) fn reserve(&mut self, ranges: usize) -> Result<(), RecordError> {
        self.resident
            .reserve(ranges)
            .map_err(|_| RecordError::OutOfMemory {
                bytes: (ranges * 24) as u32,
            })
    }

    /// True when the motion pass draws its objects in this frame: the last frame kept its data,
    /// and this frame does not fill the copies.
    pub(super) fn draws(&self) -> bool {
        self.kept && !self.filling
    }

    /// Uploads the motion block, with the row of the morph weights in the copies of the joints.
    pub(super) fn upload(
        &self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        frame: &MotionFrame,
    ) -> Result<(), RecordError> {
        let block = frame.block.with_weights_row(self.joint_rows);
        let (at, bytes) = arena.push(block.as_bytes())?;
        list.push(Op::WriteBuffer, &[ids::MOTION_BLOCK, 0, at, bytes])?;
        Ok(())
    }

    /// Records the copies of the frame's data into its parity's copy, after the frame's passes: the
    /// texel rows of the resident rows that this frame and the last uploaded, and the joints and
    /// morph weights whole. A frame that fills the copies copies everything into both.
    pub(super) fn finish(
        &mut self,
        list: &mut DrawList,
        parity: usize,
        skins: &Skins,
    ) -> Result<(), RecordError> {
        let parities = if self.filling {
            0..2
        } else {
            parity..parity + 1
        };
        let whole = self.filling || self.resident.everything();
        let per_row = sizes::MATRICES_PER_TEXTURE_ROW;
        for parity in parities {
            let last = ids::last_resident(parity);
            if whole {
                copy_rows(
                    list,
                    ids::RESIDENT,
                    last,
                    RESIDENT_WIDTH,
                    0,
                    0,
                    self.resident_rows,
                )?;
            } else {
                // Each range's texel rows, joined where they touch.
                let mut span: Option<(u32, u32)> = None;
                for &(start, len) in self.resident.both() {
                    let (first, end) = (start / per_row, (start + len).div_ceil(per_row));
                    let end = end.min(self.resident_rows);
                    span = match span {
                        Some((from, to)) if first <= to => Some((from, to.max(end))),
                        Some((from, to)) => {
                            copy_rows(
                                list,
                                ids::RESIDENT,
                                last,
                                RESIDENT_WIDTH,
                                from,
                                from,
                                to - from,
                            )?;
                            Some((first, end))
                        }
                        None => Some((first, end)),
                    };
                }
                if let Some((from, to)) = span {
                    copy_rows(
                        list,
                        ids::RESIDENT,
                        last,
                        RESIDENT_WIDTH,
                        from,
                        from,
                        to - from,
                    )?;
                }
            }
            let to = ids::last_skins(parity);
            if skins.joints().exists() {
                let rows = skins.joints().rows().min(self.joint_rows);
                copy_rows(list, skins.joints().id(), to, JOINTS_WIDTH, 0, 0, rows)?;
            }
            if skins.morph().exists() {
                let rows = skins.morph().weight_rows().min(self.weight_rows);
                let [_, weights] = skins.morph().ids();
                copy_rows(list, weights, to, MORPH_WIDTH, 0, self.joint_rows, rows)?;
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
        self.resident.clear();
    }

    /// Records the creation of the motion pass's frame group for a frame parity and a slot of the
    /// streamed ring: the camera view's frame uniform and cell offsets, which take the dynamic
    /// offset of its ring slot, the material table, the motion block, and the copies of the last
    /// frame's joints and morph weights and of its resident rows that the parity reads, the other
    /// parity's,
    /// with the streamed ring's slot before `streamed`, and the table of object ranges.
    fn bind_frame(
        &self,
        list: &mut DrawList,
        parity: usize,
        streamed: u32,
    ) -> Result<(), RecordError> {
        let read = 1 - parity;
        let or_blank = |rows: u32, id: u32| if rows > 0 { id } else { ids::BLANK_LAST };
        let frame = ids::frame(ViewId::CAMERA);
        let entries = [
            [
                0,
                resource_kind::BUFFER,
                frame,
                0,
                sizes::FRAME_UNIFORM_BYTES,
            ],
            [2, resource_kind::BUFFER, frame, OFFSETS_AT, OFFSETS_BYTES],
            [1, resource_kind::TEXTURE, ids::MATERIALS, 0, 0],
            [
                4,
                resource_kind::BUFFER,
                ids::MOTION_BLOCK,
                0,
                motion::BLOCK_BYTES,
            ],
            [
                5,
                resource_kind::TEXTURE,
                or_blank(self.joint_rows + self.weight_rows, ids::last_skins(read)),
                0,
                0,
            ],
            [
                7,
                resource_kind::TEXTURE,
                or_blank(self.resident_rows, ids::last_resident(read)),
                0,
                0,
            ],
            [
                9,
                resource_kind::TEXTURE,
                ids::STREAMED + (streamed + RING - 1) % RING,
                0,
                0,
            ],
            [
                OBJECT_RANGES_BINDING,
                resource_kind::BUFFER,
                ids::OBJECT_RANGES,
                0,
                sizes::OBJECT_RANGE_BYTES,
            ],
        ];
        let mut words = [0u32; 3 + 5 * 8];
        words[..3].copy_from_slice(&[
            ids::motion_frame_group(parity, streamed),
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

/// Records the creation of a copy of `rows` rows of `width` texels of 32-bit floats.
fn create(list: &mut DrawList, id: u32, width: u32, rows: u32) -> Result<(), RecordError> {
    list.push(
        Op::CreateTexture,
        &[
            id,
            width,
            rows,
            1,
            format::RGBA32_FLOAT,
            texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
            1,
            1,
            view::D2,
        ],
    )?;
    Ok(())
}

/// Records the copy of `rows` whole texel rows of `width` texels, from row `first` on of texture
/// `from` into texture `to` from row `at` on.
fn copy_rows(
    list: &mut DrawList,
    from: u32,
    to: u32,
    width: u32,
    first: u32,
    at: u32,
    rows: u32,
) -> Result<(), RecordError> {
    if rows == 0 {
        return Ok(());
    }
    list.push(
        Op::CopyTextureToTexture,
        &[from, 0, 0, first, 0, to, 0, 0, at, 0, width, rows, 1],
    )?;
    Ok(())
}
