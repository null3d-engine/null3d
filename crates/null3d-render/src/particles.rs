//! Particle systems, which the particles add-on drives. A system is a scene object, whose material
//! has [`Shading::Particle`](crate::materials::Shading::Particle), and a table of particle records
//! in engine memory, which the sketch's thread writes. The object gives the system its place in the
//! world, its culling sphere, its layers and its place among the transparent pass's sorted objects;
//! the records give its particles.
//!
//! # Records
//!
//! A record is [`RECORD_BYTES`] bytes: the particle's birth place in the object's space and its
//! birth time in the system's seconds, its start velocity, and its lifetime as a 16-bit float
//! above a 16-bit seed. The sketch writes a particle's record once, when it is born, and marks the
//! range it wrote. The vertex shader works out each particle at its age in every frame, so a frame
//! uploads only the records of the particles born since the frame before.
//!
//! # Values
//!
//! The system's values ([`PARAM_FLOATS`] floats) hold its motion and its look: gravity, drag,
//! wind, turbulence, the ground, sizes, spin, the flipbook, the facing, the colours and the curves
//! over life. The sketch writes them and marks them, and a frame uploads them when they changed.
//! After them come the values that the sketch writes each frame: the system's time, how many
//! records the draw reads, and the rebase: a record and a shift in seconds. Birth times are 32-bit
//! floats, so the sketch moves the time that they count from now and then. It rewrites the records
//! a share per frame, and meanwhile the shader takes the shift off the birth times of the records
//! from that one up, so no frame uploads every record.
//!
//! # Drawing
//!
//! The sorted pass draws a system's object with one draw of six vertices for each record it reads,
//! from the system's own vertex buffer of records. Its bind groups are the view's frame group, the
//! system's group of its values and of a block for each view, the view's group of its depth copy for
//! soft particles, and the map's group for a system with a map. Each view's block holds the
//! object's world matrix moved by its cell's offset from that view's camera, so particles keep
//! their precision far from the world's origin as objects do.
//!
//! # Soft particles
//!
//! While a system on the scene has a soft fade, the render graph declares the depth copy pass
//! between the camera's opaque pass and its transparent pass, as it declares the transmission
//! copy: it copies the opaque depth, one texel per pixel, into a target of 32-bit floats (see
//! [`ParticleDepthCopy`]). The camera's depth group then binds the copy, and the systems' shaders
//! fade each particle where it nears the surface behind it. Other views, and frames without such
//! a system, bind one texel at the far plane, and their passes stay one render pass.

use std::collections::TryReserveError;

use null3d_core::handle::Handle;
use null3d_core::scene::SceneStorage;
use null3d_core::world::MATRIX_FLOATS;
use null3d_gpu::caps::OFFSET_ALIGNMENT;
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind, state_flags,
    template, texture_usage, view as view_dimension,
};

use crate::frame::{RecordError, SceneSettings, UploadArena};
use crate::materials::MapSlot;
use crate::pipelines::{DepthBias, PipelineCache, PipelineKey};
use crate::view::{ViewFrame, ViewId};

/// Bytes of one particle's record.
pub const RECORD_BYTES: u32 = 32;
/// 32-bit words of one particle's record.
pub const RECORD_WORDS: usize = (RECORD_BYTES / 4) as usize;
/// Floats of a system's values, which its shader reads as a uniform block.
pub const PARAM_FLOATS: usize = 128;
/// Floats that the sketch writes in every frame, after the values: the system's time in seconds,
/// the number of records the draw reads, the first record whose birth time still counts from the
/// old time base, and the seconds that the shader takes off such birth times.
pub const FRAME_FLOATS: usize = 4;
/// Bytes of a view's block of a system, at an aligned place for its dynamic offset.
pub const VIEW_BLOCK_BYTES: u32 = OFFSET_ALIGNMENT;
/// Bytes of a view's block that a frame writes: the object's three matrix rows, then the clock.
const VIEW_WRITTEN_BYTES: usize = 64;
/// The most particle systems that a scene holds at once.
pub const MAX_SYSTEMS: usize = 256;
/// The most records of one system.
pub const MAX_RECORDS: u32 = 1 << 22;
/// The ranges of records that a system keeps apart before it merges them.
const RANGES: usize = 4;
/// The place of the soft fade's distance among a system's values.
const SOFTNESS: usize = 15;
/// The format of the copy of the opaque depth that soft particles read.
pub(crate) const DEPTH_COPY_FORMAT: u32 = format::R32_FLOAT;

/// One particle system: its object's scene slot and its records and values in engine memory.
#[derive(Debug)]
pub struct ParticleSystem {
    slot: u32,
    capacity: u32,
    records: Vec<u32>,
    /// The values, then the frame's values.
    values: Vec<f32>,
    /// Ranges of records written since the last frame, as starts and ends.
    ranges: [(u32, u32); RANGES],
    range_count: usize,
    values_changed: bool,
}

impl ParticleSystem {
    /// The records that the draw reads, which the sketch writes in each frame, at most the
    /// system's capacity.
    fn drawn(&self) -> u32 {
        let count = self.values[PARAM_FLOATS + 1];
        if count.is_finite() && count > 0.0 {
            (count as u32).min(self.capacity)
        } else {
            0
        }
    }

    /// The system's time in seconds, which the sketch writes in each frame.
    fn time(&self) -> f32 {
        self.values[PARAM_FLOATS]
    }

    /// The rebase, which the sketch writes in each frame: the first record whose birth time still
    /// counts from the old time base, and the seconds that the shader takes off such birth times.
    fn rebase(&self) -> [f32; 2] {
        [self.values[PARAM_FLOATS + 2], self.values[PARAM_FLOATS + 3]]
    }

    /// Adds records `start..end` to the ranges to upload. A range beside or across one it has
    /// joins it; past the most ranges, the nearest two merge.
    fn mark(&mut self, start: u32, end: u32) {
        let end = end.min(self.capacity);
        if start >= end {
            return;
        }
        let ranges = &mut self.ranges[..self.range_count];
        if let Some(range) = ranges.iter_mut().find(|r| start <= r.1 && end >= r.0) {
            *range = (range.0.min(start), range.1.max(end));
        } else if self.range_count < RANGES {
            self.ranges[self.range_count] = (start, end);
            self.range_count += 1;
        } else {
            let gap = |r: &(u32, u32)| {
                if start > r.1 {
                    start - r.1
                } else {
                    r.0.saturating_sub(end)
                }
            };
            let nearest = (0..RANGES)
                .min_by_key(|&k| gap(&self.ranges[k]))
                .unwrap_or(0);
            let range = &mut self.ranges[nearest];
            *range = (range.0.min(start), range.1.max(end));
        }
    }

    /// Bytes of records to upload in the next frame.
    fn marked_bytes(&self) -> usize {
        self.ranges[..self.range_count]
            .iter()
            .map(|r| (r.1 - r.0) as usize * RECORD_BYTES as usize)
            .sum()
    }
}

/// The scene's particle systems, by id from 1.
#[derive(Debug, Default)]
pub struct ParticleTable {
    systems: Vec<Option<ParticleSystem>>,
    /// Each live system's object slot and id, by slot.
    by_slot: Vec<(u32, u32)>,
    /// True when a system came or went since the builders last asked, so their draw tables find
    /// it.
    changed: bool,
    /// False when the quality preset draws soft particles with hard edges.
    hard: bool,
}

impl ParticleTable {
    /// Makes a system of `capacity` records for the object in scene slot `slot`, and returns its
    /// id, or 0 when the scene holds the most systems already.
    pub fn create(&mut self, slot: u32, capacity: u32) -> Result<u32, TryReserveError> {
        let capacity = capacity.clamp(1, MAX_RECORDS);
        let free = self.systems.iter().position(Option::is_none);
        let index = match free {
            Some(index) => index,
            None if self.systems.len() < MAX_SYSTEMS => {
                self.systems.try_reserve(1)?;
                self.systems.push(None);
                self.systems.len() - 1
            }
            None => return Ok(0),
        };
        let mut records = Vec::new();
        records.try_reserve_exact(capacity as usize * RECORD_WORDS)?;
        records.resize(capacity as usize * RECORD_WORDS, 0);
        let mut values = Vec::new();
        values.try_reserve_exact(PARAM_FLOATS + FRAME_FLOATS)?;
        values.resize(PARAM_FLOATS + FRAME_FLOATS, 0.0);
        self.by_slot.try_reserve(1)?;
        self.systems[index] = Some(ParticleSystem {
            slot,
            capacity,
            records,
            values,
            ranges: [(0, 0); RANGES],
            range_count: 0,
            values_changed: true,
        });
        let id = index as u32 + 1;
        // A slot whose object died with its system still made, as under a destroyed parent, takes
        // the new system. The old one keeps its memory until the sketch destroys it, as the
        // sketch may still write to it, but draws nothing.
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        if self.by_slot.get(at).is_some_and(|&(s, _)| s == slot) {
            self.by_slot[at] = (slot, id);
        } else {
            self.by_slot.insert(at, (slot, id));
        }
        self.changed = true;
        Ok(id)
    }

    /// Forgets a system and frees its memory. Its object draws nothing from then on.
    pub fn destroy(&mut self, id: u32) {
        if self.get(id).is_none() {
            return;
        }
        self.systems[id as usize - 1] = None;
        self.by_slot.retain(|&(_, i)| i != id);
        self.changed = true;
    }

    fn get(&self, id: u32) -> Option<&ParticleSystem> {
        self.systems.get((id as usize).wrapping_sub(1))?.as_ref()
    }

    fn get_mut(&mut self, id: u32) -> Option<&mut ParticleSystem> {
        self.systems
            .get_mut((id as usize).wrapping_sub(1))?
            .as_mut()
    }

    /// The address of a system's records in engine memory, or 0 for no such system.
    pub fn records_address(&self, id: u32) -> u32 {
        self.get(id)
            .map_or(0, |s| s.records.as_ptr() as usize as u32)
    }

    /// The address of a system's values in engine memory, then its frame's values, or 0 for no
    /// such system.
    pub fn values_address(&self, id: u32) -> u32 {
        self.get(id)
            .map_or(0, |s| s.values.as_ptr() as usize as u32)
    }

    /// A system's records, as 32-bit words, for code that writes them in place of the sketch.
    pub fn records_mut(&mut self, id: u32) -> Option<&mut [u32]> {
        self.get_mut(id).map(|s| s.records.as_mut_slice())
    }

    /// A system's values, then its frame's values, for code that writes them in place of the
    /// sketch.
    pub fn values_mut(&mut self, id: u32) -> Option<&mut [f32]> {
        self.get_mut(id).map(|s| s.values.as_mut_slice())
    }

    /// Marks `count` records from `start` on, which the sketch wrote, for the next frame's upload.
    pub fn mark_records(&mut self, id: u32, start: u32, count: u32) {
        if let Some(system) = self.get_mut(id) {
            system.mark(start, start.saturating_add(count));
        }
    }

    /// Marks a system's values, which the sketch wrote, for the next frame's upload.
    pub fn mark_values(&mut self, id: u32) {
        if let Some(system) = self.get_mut(id) {
            system.values_changed = true;
        }
    }

    /// The id of the system whose object is in scene slot `slot`.
    pub fn system_of(&self, slot: u32) -> Option<u32> {
        let at = self.by_slot.partition_point(|&(s, _)| s < slot);
        self.by_slot
            .get(at)
            .filter(|&&(s, _)| s == slot)
            .map(|&(_, id)| id)
    }

    /// True when a system came or went since the last call.
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }

    /// True when the scene has no particle system.
    pub fn is_empty(&self) -> bool {
        self.by_slot.is_empty()
    }

    /// Lets systems fade their particles near the surfaces behind them, or not.
    pub fn set_soft(&mut self, on: bool) {
        self.hard = !on;
    }

    /// True when a system fades its particles near the surfaces behind them, so the camera's view
    /// copies its opaque depth for them, unless the quality preset turned soft particles off.
    pub fn wants_depth(&self) -> bool {
        !self.hard
            && self
                .ids()
                .filter_map(|id| self.get(id))
                .any(|s| s.values[SOFTNESS] > 0.0 && s.drawn() > 0)
    }

    /// The live systems' ids.
    fn ids(&self) -> impl Iterator<Item = u32> + '_ {
        self.by_slot.iter().map(|&(_, id)| id)
    }

    /// Clears every system's marks, once each builder that draws has uploaded them.
    pub fn clear_marks(&mut self) {
        for system in self.systems.iter_mut().flatten() {
            system.range_count = 0;
            system.values_changed = false;
        }
    }
}

/// The ids that a builder gives the particle systems' GPU objects.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ParticleIds {
    /// The first buffer id: each system takes three from it, its records, its values and its
    /// views' blocks.
    pub buffers: u32,
    /// The first bind group id: one for each system.
    pub groups: u32,
    /// The first bind group id of the views' depth groups: one for each view.
    pub depth_groups: u32,
    /// The texture that stands in for a view's depth copy: one texel at the far plane.
    pub blank_depth: u32,
}

impl ParticleIds {
    /// Buffer ids that the systems take.
    pub const BUFFERS: u32 = 3 * MAX_SYSTEMS as u32;
    /// Bind group ids that the systems take.
    pub const GROUPS: u32 = MAX_SYSTEMS as u32;

    fn records(&self, index: usize) -> u32 {
        self.buffers + 3 * index as u32
    }

    fn values(&self, index: usize) -> u32 {
        self.records(index) + 1
    }

    fn views(&self, index: usize) -> u32 {
        self.records(index) + 2
    }

    fn group(&self, index: usize) -> u32 {
        self.groups + index as u32
    }

    fn depth_group(&self, view: ViewId) -> u32 {
        self.depth_groups + view.index() as u32
    }
}

/// What the GPU has of one system.
#[derive(Clone, Copy, Debug, Default)]
struct Made {
    /// Bytes of the records buffer, 0 before it exists.
    records: u32,
    /// Views that the views' buffer holds blocks for, 0 before it exists.
    views: u32,
    /// True once the values buffer exists.
    values: bool,
    /// The frame's draw: the records it reads and the map's layer, or none.
    drawn: u32,
}

/// A builder's GPU objects of the particle systems, and each system's draw in the frame.
#[derive(Debug)]
pub(crate) struct ParticlePass {
    ids: ParticleIds,
    made: Vec<Made>,
    /// Views whose depth group exists.
    depth_views: usize,
    /// The texture that the camera's depth group binds: the blank texel or the depth copy.
    camera_depth: u32,
    /// True once the blank depth texture exists.
    blank: bool,
}

impl ParticlePass {
    pub(crate) fn new(ids: ParticleIds) -> Self {
        Self {
            ids,
            made: Vec::new(),
            depth_views: 0,
            camera_depth: 0,
            blank: false,
        }
    }

    /// Bytes that a frame may copy into its arena for the systems, with `views` views: the
    /// records of a system whose buffer the GPU lacks, else its marked records, its values, and a
    /// block for each view.
    pub(crate) fn upload_bound(&self, table: &ParticleTable, views: usize) -> usize {
        table
            .ids()
            .filter_map(|id| Some((id, table.get(id)?)))
            .map(|(id, s)| {
                let made = self.made.get(id as usize - 1).map_or(0, |m| m.records);
                let records = if made < s.capacity * RECORD_BYTES {
                    (s.capacity * RECORD_BYTES) as usize
                } else {
                    s.marked_bytes()
                };
                records + PARAM_FLOATS * 4 + views * VIEW_WRITTEN_BYTES
            })
            .sum()
    }

    /// Makes the GPU objects that the scene's systems need, uploads their marked records and
    /// changed values, and writes each view's block of each system: the object's matrix moved by
    /// its cell's offset from the view's camera, the system's time and its map's layer, for each
    /// of `views` views. `frame_of` gives a view's values, or `None` for a view that draws
    /// nothing. `depth` is the texture of the camera's depth copy while the graph declares it, and
    /// `textures_made` says that the graph made its textures again. A system whose map's image is
    /// not on the GPU yet draws nothing.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare<'a>(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        settings: &SceneSettings,
        table: &ParticleTable,
        scene: &SceneStorage,
        parity: usize,
        views: usize,
        frame_of: &dyn Fn(usize) -> Option<&'a ViewFrame>,
        (depth, textures_made): (Option<u32>, bool),
    ) -> Result<(), RecordError> {
        if !self.blank && !table.is_empty() {
            list.push(
                Op::CreateTexture,
                &[
                    self.ids.blank_depth,
                    1,
                    1,
                    1,
                    format::R32_FLOAT,
                    texture_usage::TEXTURE_BINDING,
                    1,
                    1,
                    view_dimension::D2,
                ],
            )?;
            self.blank = true;
        }
        if self.blank {
            let camera = depth.unwrap_or(self.ids.blank_depth);
            let first = if camera != self.camera_depth || textures_made {
                0
            } else {
                self.depth_views
            };
            for index in first..views {
                let view = ViewId::from_index(index);
                let texture = if index == ViewId::CAMERA.index() {
                    camera
                } else if index < self.depth_views {
                    continue;
                } else {
                    self.ids.blank_depth
                };
                list.push(
                    Op::CreateBindGroup,
                    &[
                        self.ids.depth_group(view),
                        bind_layout::PARTICLE_SCENE_DEPTH,
                        1,
                        0,
                        resource_kind::TEXTURE,
                        texture,
                        0,
                        0,
                    ],
                )?;
            }
            self.camera_depth = camera;
            self.depth_views = self.depth_views.max(views);
        }
        if self.made.len() < MAX_SYSTEMS {
            self.made.resize(MAX_SYSTEMS, Made::default());
        }
        for made in &mut self.made {
            made.drawn = 0;
        }
        for id in table.ids() {
            let Some(system) = table.get(id) else {
                continue;
            };
            let index = id as usize - 1;
            let ids = self.ids;
            let made = &mut self.made[index];
            let bytes = system.capacity * RECORD_BYTES;
            let mut group_changed = false;
            let mut all_records = false;
            if made.records < bytes {
                list.push(
                    Op::CreateBuffer,
                    &[ids.records(index), bytes, usage::VERTEX | usage::COPY_DST],
                )?;
                made.records = bytes;
                all_records = true;
            }
            if !made.values {
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids.values(index),
                        (PARAM_FLOATS * 4) as u32,
                        usage::UNIFORM | usage::COPY_DST,
                    ],
                )?;
                made.values = true;
                group_changed = true;
            }
            if (made.views as usize) < views {
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids.views(index),
                        views as u32 * VIEW_BLOCK_BYTES,
                        usage::UNIFORM | usage::COPY_DST,
                    ],
                )?;
                made.views = views as u32;
                group_changed = true;
            }
            if group_changed {
                list.push(
                    Op::CreateBindGroup,
                    &[
                        ids.group(index),
                        bind_layout::PARTICLE,
                        2,
                        0,
                        resource_kind::BUFFER,
                        ids.values(index),
                        0,
                        (PARAM_FLOATS * 4) as u32,
                        1,
                        resource_kind::BUFFER,
                        ids.views(index),
                        0,
                        VIEW_WRITTEN_BYTES as u32,
                    ],
                )?;
            }
            let record_bytes = |words: &[u32]| -> &[u8] {
                // SAFETY: a u32 slice is plain bytes of four times its length.
                unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), words.len() * 4) }
            };
            if all_records {
                let (at, len) = arena.push(record_bytes(&system.records))?;
                list.push(Op::WriteBuffer, &[ids.records(index), 0, at, len])?;
            } else {
                for &(start, end) in &system.ranges[..system.range_count] {
                    let words =
                        &system.records[start as usize * RECORD_WORDS..end as usize * RECORD_WORDS];
                    let (at, len) = arena.push(record_bytes(words))?;
                    list.push(
                        Op::WriteBuffer,
                        &[ids.records(index), start * RECORD_BYTES, at, len],
                    )?;
                }
            }
            if system.values_changed || group_changed {
                let values = &system.values[..PARAM_FLOATS];
                // SAFETY: an f32 slice is plain bytes of four times its length.
                let bytes = unsafe {
                    std::slice::from_raw_parts(values.as_ptr().cast::<u8>(), values.len() * 4)
                };
                let (at, len) = arena.push(bytes)?;
                list.push(Op::WriteBuffer, &[ids.values(index), 0, at, len])?;
            }
            let count = system.drawn();
            // The map's layer, for a system whose material samples a map.
            let material = scene
                .materials()
                .get(system.slot as usize)
                .copied()
                .unwrap_or(0);
            let layer = if material == 0 {
                None
            } else {
                let map = settings.materials().map(material - 1, MapSlot::BaseColor);
                if map == Handle::NONE {
                    Some(0)
                } else {
                    settings.textures().ready_layer(map)
                }
            };
            if let Some(layer) = layer {
                made.drawn = count;
                if count > 0 {
                    let views = (views, frame_of);
                    self.write_views(list, arena, views, scene, parity, system, index, layer)?;
                }
            }
        }
        Ok(())
    }

    /// Writes each view's block of a system.
    #[allow(clippy::too_many_arguments)]
    fn write_views<'a>(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        (views, frame_of): (usize, &dyn Fn(usize) -> Option<&'a ViewFrame>),
        scene: &SceneStorage,
        parity: usize,
        system: &ParticleSystem,
        index: usize,
        layer: u32,
    ) -> Result<(), RecordError> {
        let slot = system.slot as usize;
        let matrix = &scene.world(parity).matrices()[slot * MATRIX_FLOATS..][..MATRIX_FLOATS];
        let cell = scene.cells()[slot];
        let [first, shift] = system.rebase();
        for k in 0..views {
            let Some(frame) = frame_of(k) else {
                continue;
            };
            let offset = scene.cell_table().offset(&frame.camera, cell);
            let mut block = [0f32; VIEW_WRITTEN_BYTES / 4];
            for (r, row) in matrix.as_chunks::<4>().0.iter().enumerate() {
                block[r * 4..r * 4 + 4].copy_from_slice(row);
                block[r * 4 + 3] += offset[r];
            }
            block[12] = system.time();
            block[13] = layer as f32;
            block[14] = first;
            block[15] = shift;
            // SAFETY: an f32 array is plain bytes of four times its length.
            let bytes = unsafe {
                std::slice::from_raw_parts(block.as_ptr().cast::<u8>(), VIEW_WRITTEN_BYTES)
            };
            let (at, len) = arena.push(bytes)?;
            list.push(
                Op::WriteBuffer,
                &[self.ids.views(index), k as u32 * VIEW_BLOCK_BYTES, at, len],
            )?;
        }
        Ok(())
    }

    /// Records a system's draw in a view's transparent pass, with the pipeline and the map's group
    /// of its sorted bucket, after the view's frame group. It records nothing for a system that
    /// draws no records in the frame. It changes the bind groups after the frame's, so the caller
    /// sets its own groups again before its next draw.
    pub(crate) fn record(
        &self,
        list: &mut DrawList,
        view: ViewId,
        id: u32,
        pipeline: u32,
        textures: u32,
    ) -> Result<bool, RecordError> {
        let index = id as usize - 1;
        let count = self.made.get(index).map_or(0, |m| m.drawn);
        if count == 0 {
            return Ok(false);
        }
        let ids = self.ids;
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(
            Op::SetBindGroup,
            &[
                1,
                ids.group(index),
                1,
                view.index() as u32 * VIEW_BLOCK_BYTES,
            ],
        )?;
        list.push(Op::SetBindGroup, &[2, ids.depth_group(view), 0])?;
        if textures != 0 {
            list.push(Op::SetBindGroup, &[3, textures, 0])?;
        }
        list.push(Op::SetVertexBuffer, &[0, ids.records(index), 0, 0])?;
        list.push(Op::Draw, &[6, count, 0, 0])?;
        Ok(true)
    }

    /// Forgets the GPU's objects after the GPU was lost, so the next frame makes them again.
    pub(crate) fn reset_gpu(&mut self) {
        self.made.clear();
        self.depth_views = 0;
        self.camera_depth = 0;
        self.blank = false;
    }
}

/// The copy of the camera's opaque depth that soft particles read, with its pipeline and bind
/// group.
#[derive(Debug)]
pub(crate) struct ParticleDepthCopy {
    group: u32,
    /// The copy's pipeline, for the scene depth's samples it was asked for.
    pipeline: Option<(u32, u32)>,
    /// The texture that the bind group reads, or 0 before it has a group.
    bound: u32,
}

impl ParticleDepthCopy {
    /// The copy, whose bind group takes the id `group`.
    pub(crate) fn new(group: u32) -> Self {
        Self {
            group,
            pipeline: None,
            bound: 0,
        }
    }

    /// Asks `pipelines` for the copy's pipeline from a scene depth of `samples` samples, and
    /// returns its id. A multisampled depth's build reads its first sample.
    pub(crate) fn request_pipeline(&mut self, pipelines: &mut PipelineCache, samples: u32) -> u32 {
        match self.pipeline {
            Some((id, kept)) if kept == samples => id,
            _ => {
                let template = if samples > 1 {
                    template::PARTICLE_DEPTH_MS
                } else {
                    template::PARTICLE_DEPTH
                };
                let id = pipelines.id(PipelineKey {
                    template,
                    permutation: 0,
                    vertex_format: 0,
                    color_format: DEPTH_COPY_FORMAT,
                    depth_format: format::NONE,
                    samples: 1,
                    state: state_flags::CULL_NONE,
                    bias: DepthBias::NONE,
                });
                self.pipeline = Some((id, samples));
                id
            }
        }
    }

    /// Binds the copy to `source`, the draw list's texture of the scene depth, when its group is
    /// new, the source moved, or the frame made the plan's textures again.
    pub(crate) fn prepare(
        &mut self,
        list: &mut DrawList,
        source: u32,
        textures_made: bool,
    ) -> Result<(), RecordError> {
        if !textures_made && self.bound == source {
            return Ok(());
        }
        let layout = match self.pipeline {
            Some((_, samples)) if samples > 1 => bind_layout::PARTICLE_DEPTH_MS,
            _ => bind_layout::VIEW_COPY,
        };
        list.push(
            Op::CreateBindGroup,
            &[
                self.group,
                layout,
                1,
                0,
                resource_kind::TEXTURE,
                source,
                0,
                0,
            ],
        )?;
        self.bound = source;
        Ok(())
    }

    /// Records the copy inside the render pass that the render graph began into its target.
    pub(crate) fn record(&self, list: &mut DrawList) -> Result<(), RecordError> {
        let Some((pipeline, _)) = self.pipeline else {
            return Ok(());
        };
        list.push(Op::SetPipeline, &[pipeline])?;
        list.push(Op::SetBindGroup, &[0, self.group, 0])?;
        list.push(Op::Draw, &[3, 1, 0, 0])?;
        Ok(())
    }

    /// Forgets the bind group, so the next frame makes it again, after the thread that draws
    /// replaced the GPU.
    pub(crate) fn reset_gpu(&mut self) {
        self.bound = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn systems_take_ids_and_give_them_back() {
        let mut table = ParticleTable::default();
        let a = table.create(5, 100).unwrap();
        let b = table.create(2, 10).unwrap();
        assert_eq!((a, b), (1, 2));
        assert_eq!(table.system_of(5), Some(1));
        assert_eq!(table.system_of(2), Some(2));
        assert_eq!(table.system_of(3), None);
        assert!(table.take_changed());
        table.destroy(a);
        assert_eq!(table.system_of(5), None);
        assert_eq!(table.create(9, 1).unwrap(), 1);
        // A new system in a slot that has one takes the slot; the old one keeps its memory.
        let c = table.create(2, 4).unwrap();
        assert_eq!(table.system_of(2), Some(c));
        assert_ne!(table.records_address(b), 0);
        table.destroy(b);
        assert_eq!(table.system_of(2), Some(c));
        assert_ne!(table.records_address(1), 0);
        assert_eq!(table.records_address(7), 0);
    }

    #[test]
    fn marks_join_ranges_that_touch_and_merge_the_nearest_past_the_most() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 1000).unwrap();
        let system = table.get_mut(id).unwrap();
        system.mark(0, 10);
        system.mark(10, 20);
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (0, 20));
        system.mark(100, 110);
        system.mark(200, 210);
        system.mark(300, 310);
        system.mark(990, 2000);
        assert_eq!(system.range_count, 4);
        assert_eq!(system.ranges[3], (300, 1000));
        assert_eq!(system.marked_bytes(), (20 + 10 + 10 + 700) * 32);
        table.clear_marks();
        assert_eq!(table.get(id).unwrap().marked_bytes(), 0);
    }

    #[test]
    fn the_draw_reads_at_most_the_capacity() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 8).unwrap();
        let system = table.get_mut(id).unwrap();
        system.values[PARAM_FLOATS + 1] = 20.0;
        assert_eq!(system.drawn(), 8);
        system.values[PARAM_FLOATS + 1] = f32::NAN;
        assert_eq!(system.drawn(), 0);
    }

    #[test]
    fn the_rebase_follows_the_time_and_the_count() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 8).unwrap();
        let system = table.get_mut(id).unwrap();
        assert_eq!(system.rebase(), [0.0, 0.0]);
        system.values[PARAM_FLOATS + 2] = 5.0;
        system.values[PARAM_FLOATS + 3] = 1000.0;
        assert_eq!(system.rebase(), [5.0, 1000.0]);
    }
}
