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
//! soft particles, and the map's group of the material's maps, a flipbook among them. Each view's
//! block holds the object's world matrix moved by its cell's offset from that view's camera, so
//! particles keep their precision far from the world's origin as objects do.
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
/// Floats that one birth's parameters take in the block that the sketch writes: the birth place,
/// the birth time, the velocity, the lifetime and the seed.
pub const BIRTH_FLOATS: usize = 9;
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

// The emitter's block: the numbers that the sketch writes, and the core reads, for one system.
// The frame's numbers and the matrices come first, at the places below; then a row for each burst
// and each sub-emitter; then the emitter's fixed settings. The block is sized once, at configure,
// and never grows, so its address stays valid.

/// Floats before the bursts' and sub-emitters' rows.
pub const EMITTER_HEADER_FLOATS: usize = 88;
/// Floats of one burst's or one sub-emitter's row.
pub const EMITTER_ROW_FLOATS: usize = 4;
/// Floats of the emitter's fixed settings, after the rows.
pub const EMITTER_FIXED_FLOATS: usize = 48;
/// Floats of one sub-emitter's inverse world matrix.
pub const EMITTER_SUB_MATRIX_FLOATS: usize = 16;
/// The births per second of the frame.
const E_RATE: usize = 0;
/// 0 to stop emitting, 1 to emit.
const E_EMITTING: usize = 1;
/// The frame's span in seconds.
const E_FROM: usize = 2;
const E_TO: usize = 3;
/// The system's time in seconds, where a sub-emitter's burst is born.
const E_TIME: usize = 4;
/// 1 on the first frame of a prewarmed system.
const E_PREWARM: usize = 5;
/// A burst's own place and velocity: whether each is given, then its three numbers.
const E_AT_FLAG: usize = 6;
const E_AT: usize = 7;
const E_VELOCITY_FLAG: usize = 10;
const E_VELOCITY: usize = 11;
/// The counts of the burst and sub-emitter rows.
const E_BURSTS: usize = 14;
const E_SUBS: usize = 15;
/// The followed object's world matrix in the frame before and in this frame, and the system's
/// inverse world matrix.
const E_LAST: usize = 16;
const E_NOW: usize = 32;
const E_TO_LOCAL: usize = 48;
/// The system's world matrix, for a sub-emitter's event.
const E_WORLD: usize = 64;
/// The births' merged box: the low corner, then the high corner.
const E_BOX: usize = 80;
/// The particles emitted so far.
const E_EMITTED: usize = 86;
/// The first burst's row.
pub const EMITTER_ROWS: usize = 88;
/// The emitter's fixed settings, after the rows: the seed, the shape, the ranges, the velocity,
/// the direction's frame, the span of emission, and the motion.
const F_SEED: usize = 0;
const F_SHAPE: usize = 1;
const F_RADIUS: usize = 2;
const F_SURFACE: usize = 3;
const F_ANGLE: usize = 4;
const F_SIZE: usize = 5;
const F_SPEED: usize = 8;
const F_LIFE: usize = 10;
const F_VELOCITY_FLAG: usize = 12;
const F_VELOCITY: usize = 13;
const F_FRAME: usize = 16;
const F_SPREAD: usize = 25;
const F_DURATION: usize = 26;
const F_LOOP: usize = 27;
const F_FOLLOW: usize = 28;
const F_MOTION: usize = 29;
/// The shape codes that the sketch writes.
const SHAPE_SPHERE: u32 = 1;
const SHAPE_CONE: u32 = 2;
const SHAPE_BOX: u32 = 3;
const SHAPE_DISC: u32 = 4;
/// The ground's modes, as the shaders read them.
const GROUND_NONE: u32 = 0;
const GROUND_KILL: u32 = 1;
const GROUND_STICK: u32 = 3;
/// Whole seconds of a system's time after which its time base moves.
const REBASE_AFTER: f64 = 1024.0;
/// Records whose birth times one frame moves to the new time base, while the base moves.
const REBASE_RECORDS: u32 = 16_384;
/// Floats of a pending sub-emitter event: its time and sub-emitter, then the particle's numbers.
const EVENT_FLOATS: usize = 2 + PARTICLE_FLOATS;
/// The pending sub-emitter events that a system makes room for at first, before it doubles them.
const FIRST_EVENTS: usize = 64;
/// The random channels of a particle: its speed, shape, direction, place in a box, and lifetime.
const ROLL_SPEED: usize = 0;
const ROLL_U: usize = 1;
const ROLL_W: usize = 2;
const ROLL_R: usize = 3;
const ROLL_ANGLE: usize = 4;
const ROLL_BOX_Y: usize = 5;
const ROLL_BOX_Z: usize = 6;
const ROLL_LIFE: usize = 7;
const ROLLS: usize = 8;
/// The places of a system's seed, a particle's number and its seed in the hash's input.
const SEED_SYSTEM: usize = 0;
const SEED_NUMBER: usize = 1;
const SEED_PARTICLE: usize = 2;
/// The places of a particle's numbers, as the motion functions read them.
const PARTICLE_BIRTH: usize = 0;
const PARTICLE_VELOCITY: usize = 3;
const PARTICLE_AGE: usize = 6;
const PARTICLE_SEED: usize = 7;
const PARTICLE_FLOATS: usize = 8;
/// The places of a flight's numbers: its start, velocity and time, the impact's time, and its end.
const FLIGHT_P: usize = 0;
const FLIGHT_V: usize = 3;
const FLIGHT_T: usize = 6;
const FLIGHT_HIT: usize = 7;
const FLIGHT_OUT_P: usize = 8;
const FLIGHT_OUT_V: usize = 11;
const FLIGHT_FLOATS: usize = 14;
/// The most bounces a particle makes off the ground, and the steps toward each impact.
const BOUNCES: usize = 2;
const IMPACT_STEPS: usize = 4;
/// Drag below which the motion is the plain ballistic one.
const LITTLE_DRAG: f64 = 1e-4;
/// The offsets of the three noise channels of the turbulence, as in the shaders.
const NOISE_CHANNELS: [f64; 9] = [0.0, 0.0, 0.0, 31.4, 17.3, 5.9, -11.7, 41.2, 23.5];
/// The frame of directions about up, for the cone.
const IDENTITY_FRAME: [f64; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
/// The seed that a particle's numbers hash with, when the sketch gives none.
const DEFAULT_SEED: u32 = 1;

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
    /// The emitter that writes the frame's births, when the sketch configures one.
    emitter: Emitter,
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
        mark_ranges(
            &mut self.ranges,
            &mut self.range_count,
            start,
            end,
            self.capacity,
        );
    }

    /// Adds the records that the emitter wrote to the ranges to upload.
    fn mark_emitted(&mut self) {
        let ranges = self.emitter.ranges;
        let count = self.emitter.range_count;
        for &(start, end) in &ranges[..count] {
            self.mark(start, end);
        }
        self.emitter.range_count = 0;
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
    /// The parameters of the births that the sketch is writing, `BIRTH_FLOATS` numbers per birth.
    /// The sketch fills the block, then asks the table to write its records once.
    births: Vec<f32>,
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
            emitter: Emitter::new(),
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

    /// Makes room for an emitter's block of `floats` numbers and returns its address, or 0 for no
    /// such system or when the memory cannot grow.
    pub fn emitter_block(&mut self, id: u32, floats: usize) -> u32 {
        self.get_mut(id)
            .map_or(0, |system| system.emitter.reserve(floats))
    }

    /// Reads an emitter's fixed settings from its block, which the sketch wrote, and starts its
    /// births and its time base again.
    pub fn configure_emitter(&mut self, id: u32) {
        let Some(system) = self.get_mut(id) else {
            return;
        };
        let capacity = system.capacity;
        system.emitter.configure(capacity);
    }

    /// The address of a system's sub-emitter matrices, 16 numbers each, or 0 for none.
    pub fn emitter_sub_matrices(&self, id: u32) -> u32 {
        self.get(id)
            .filter(|system| system.emitter.configured && !system.emitter.sub_matrices.is_empty())
            .map_or(0, |system| {
                system.emitter.sub_matrices.as_ptr() as usize as u32
            })
    }

    /// Emits the births of a system's frame, fires the sub-emitters that fall due by its end, and
    /// moves its time base when the time calls for it.
    pub fn emit_frame(&mut self, id: u32) {
        {
            let Some(system) = self.get_mut(id) else {
                return;
            };
            let ParticleSystem {
                emitter,
                records,
                values,
                capacity,
                ..
            } = system;
            emitter.emit_frame(records, *capacity, values);
        }
        if let Some(system) = self.get_mut(id) {
            system.mark_emitted();
        }
        self.fire_events(id);
    }

    /// Emits `count` particles at once at the place and velocity in a system's emitter block.
    pub fn burst(&mut self, id: u32, count: u32) {
        let Some(system) = self.get(id) else {
            return;
        };
        let emitter = &system.emitter;
        if !emitter.configured {
            return;
        }
        let at = if emitter.block[E_AT_FLAG] != 0.0 {
            Some([
                emitter.block[E_AT],
                emitter.block[E_AT + 1],
                emitter.block[E_AT + 2],
            ])
        } else {
            None
        };
        let velocity = if emitter.block[E_VELOCITY_FLAG] != 0.0 {
            Some([
                emitter.block[E_VELOCITY],
                emitter.block[E_VELOCITY + 1],
                emitter.block[E_VELOCITY + 2],
            ])
        } else {
            None
        };
        self.burst_with(id, count, at, velocity);
    }

    /// Emits `count` particles of system `id` at once, at `at` with `velocity`, and plans their
    /// sub-emitter events. A system that the sketch did not configure, or that is gone, emits
    /// nothing.
    fn burst_with(
        &mut self,
        id: u32,
        count: u32,
        at: Option<[f64; 3]>,
        velocity: Option<[f64; 3]>,
    ) {
        let Some(system) = self.get_mut(id) else {
            return;
        };
        let ParticleSystem {
            emitter,
            records,
            capacity,
            ..
        } = system;
        if !emitter.configured {
            return;
        }
        let time = emitter.block[E_TIME];
        let motion = emitter.motion();
        let follow = emitter.follow_matrices();
        for _ in 0..count {
            emitter.emit_one(
                time,
                1.0,
                at,
                velocity,
                records,
                *capacity,
                &motion,
                follow.as_ref(),
            );
        }
        emitter.flush_run();
        system.mark_emitted();
    }

    /// Fires the sub-emitters of a system whose events fall due by the frame's end, and removes
    /// those events. The events fire in the table's order, as the add-on's emitter fired them.
    fn fire_events(&mut self, id: u32) {
        let mut k = 0;
        loop {
            let Some((event, sub, to, motion, world)) = self.event_at(id, k) else {
                return;
            };
            if event[0] > to {
                k += 1;
                continue;
            }
            let local = self
                .get(id)
                .map(|s| s.emitter.sub_matrix(sub.system as usize))
                .unwrap_or_default();
            let mut input = [0.0f64; PARTICLE_FLOATS];
            input.copy_from_slice(&event[2..2 + PARTICLE_FLOATS]);
            let mut state = ParticleState::default();
            state_at(&motion, &input, &mut state);
            // From this system's space to the world, then into the sub-emitter's space.
            let px = world[0] * state.px + world[4] * state.py + world[8] * state.pz + world[12];
            let py = world[1] * state.px + world[5] * state.py + world[9] * state.pz + world[13];
            let pz = world[2] * state.px + world[6] * state.py + world[10] * state.pz + world[14];
            let place = [
                local[12] + local[0] * px + local[4] * py + local[8] * pz,
                local[13] + local[1] * px + local[5] * py + local[9] * pz,
                local[14] + local[2] * px + local[6] * py + local[10] * pz,
            ];
            let inherit = sub.inherit;
            let velocity = if inherit == 0.0 {
                None
            } else {
                Some([state.vx * inherit, state.vy * inherit, state.vz * inherit])
            };
            self.burst_with(sub.system, sub.count, Some(place), velocity);
            // The last event takes the fired one's place, and the walk looks at this place again.
            if let Some(system) = self.get_mut(id) {
                let emitter = &mut system.emitter;
                if emitter.event_count > 0 {
                    emitter.event_count -= 1;
                    let at = k * EVENT_FLOATS;
                    let last = emitter.event_count * EVENT_FLOATS;
                    if last != at {
                        emitter.events.copy_within(last..last + EVENT_FLOATS, at);
                    }
                }
            }
        }
    }

    /// Event `k` of a system, with its sub-emitter, the frame's end, the motion and the system's
    /// world matrix. `None` when the system has no event there.
    fn event_at(&self, id: u32, k: usize) -> Option<(Event, Sub, f64, Motion, [f64; 16])> {
        let emitter = &self.get(id)?.emitter;
        if !emitter.configured || k >= emitter.event_count {
            return None;
        }
        let at = k * EVENT_FLOATS;
        let mut event = [0.0f64; EVENT_FLOATS];
        event.copy_from_slice(&emitter.events[at..at + EVENT_FLOATS]);
        let sub = emitter
            .subs
            .get(event[1] as usize)
            .copied()
            .unwrap_or_default();
        Some((
            event,
            sub,
            emitter.block[E_TO],
            emitter.motion(),
            emitter.matrix(E_WORLD),
        ))
    }

    /// Makes room for `count` births' parameters and returns the address of the block's first
    /// number, or 0 when the memory cannot grow. Each birth takes `BIRTH_FLOATS` floats.
    pub fn births_address(&mut self, count: usize) -> u32 {
        let floats = count.saturating_mul(BIRTH_FLOATS);
        if self.births.len() < floats {
            if self.births.try_reserve(floats - self.births.len()).is_err() {
                return 0;
            }
            self.births.resize(floats, 0.0);
        }
        self.births.as_ptr() as usize as u32
    }

    /// Writes the records of `count` births, whose parameters are in the birth block, from record
    /// `first` on, and marks what it wrote. Birth `i` takes the record at `(first + i) % capacity`.
    pub fn write_records(&mut self, id: u32, count: u32, first: u32) {
        let births = &self.births;
        let systems = &mut self.systems;
        let Some(system) = systems
            .get_mut((id as usize).wrapping_sub(1))
            .and_then(Option::as_mut)
        else {
            return;
        };
        let capacity = system.capacity;
        if capacity == 0 {
            return;
        }
        let base = first % capacity;
        let mut start = base;
        let mut end = base;
        for i in 0..count {
            let at = i as usize * BIRTH_FLOATS;
            if at + BIRTH_FLOATS > births.len() {
                break;
            }
            let index = (base + i) % capacity;
            if index != end {
                system.mark(start, end);
                start = index;
            }
            let mut record = [0.0f64; 8];
            for k in 0..8 {
                record[k] = births[at + k] as f64;
            }
            write_record(&mut system.records, index, &record, births[at + 8] as u32);
            end = index + 1;
        }
        system.mark(start, end);
    }

    /// Takes whole `seconds` off the birth times of records `from..to`, which moves the time that
    /// they count from, and marks what it wrote.
    pub fn shift_records(&mut self, id: u32, from: u32, to: u32, seconds: u32) {
        let Some(system) = self.get_mut(id) else {
            return;
        };
        let end = to.min(system.capacity);
        for index in from..end {
            let word = index as usize * RECORD_WORDS + 3;
            let time = f32::from_bits(system.records[word]) - seconds as f32;
            system.records[word] = time.to_bits();
        }
        system.mark(from, end);
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

/// The numbers of one pending sub-emitter event.
type Event = [f64; EVENT_FLOATS];

/// The motion of a system's particles, as the emitter's block holds it: gravity, drag toward the
/// wind, turbulence and the ground. The closed form matches the particle shaders.
#[derive(Clone, Copy, Debug, Default)]
struct Motion {
    gx: f64,
    gy: f64,
    gz: f64,
    drag: f64,
    wx: f64,
    wy: f64,
    wz: f64,
    turbulence: f64,
    turbulence_scale: f64,
    turbulence_speed: f64,
    ground_height: f64,
    ground_mode: u32,
    restitution: f64,
    friction: f64,
}

/// A particle's place and velocity at an event.
#[derive(Clone, Copy, Debug, Default)]
struct ParticleState {
    px: f64,
    py: f64,
    pz: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    alive: bool,
}

/// The followed object's world matrix in the frame before and in this frame, and the system's
/// inverse world matrix.
#[derive(Clone, Copy, Debug, Default)]
struct Follow {
    last: [f64; 16],
    now: [f64; 16],
    to_local: [f64; 16],
}

/// When a sub-emitter fires.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum EventOn {
    #[default]
    Death,
    Ground,
}

/// A burst: `count` particles at `time`, then every `interval` seconds, `cycles` times in all.
#[derive(Clone, Copy, Debug, Default)]
struct Burst {
    time: f64,
    count: u32,
    interval: Option<f64>,
    cycles: Option<f64>,
}

/// A sub-emitter: another system that bursts where a particle dies or meets the ground.
#[derive(Clone, Copy, Debug, Default)]
struct Sub {
    system: u32,
    on: EventOn,
    count: u32,
    inherit: f64,
}

/// Where an emitter's particles are born, in its own space.
#[derive(Clone, Copy, Debug, Default)]
enum Shape {
    #[default]
    Point,
    Sphere {
        radius: f64,
        surface: bool,
    },
    Cone {
        radius: f64,
        angle: f64,
    },
    Box {
        size: [f64; 3],
    },
    Disc {
        radius: f64,
    },
}

/// One system's emitter: the settings that the sketch writes once, the frame's numbers that it
/// writes in every frame, and the births' schedule, time base and pending events. `emit_frame`
/// makes every record of a frame here, so the sketch starts the frame and reads the settings.
#[derive(Debug)]
pub struct Emitter {
    /// The numbers that the sketch writes: the frame's, the matrices, the rows and the settings.
    block: Vec<f64>,
    /// The inverse world matrices of the sub-emitters, 16 numbers each.
    sub_matrices: Vec<f64>,
    configured: bool,
    /// The place of the fixed settings in `block`, after the rows.
    fixed: usize,
    capacity: u32,
    max_events: usize,
    shape: Shape,
    frame: [f64; 9],
    spread: f64,
    speed: [f64; 2],
    lifetime: [f64; 2],
    velocity: Option<[f64; 3]>,
    duration: f64,
    looping: bool,
    follow: bool,
    bursts: Vec<Burst>,
    subs: Vec<Sub>,
    seed: u32,
    emitted: u64,
    next_birth: f64,
    base: f64,
    shift: u32,
    rebased: u32,
    births: [f64; 12],
    epoch_end: f64,
    events: Vec<f64>,
    event_count: usize,
    /// The records that this frame's emission wrote, for the next frame's upload.
    ranges: [(u32, u32); RANGES],
    range_count: usize,
    /// The run of records that the last birth joined.
    run: Option<(u32, u32)>,
}

impl Emitter {
    fn new() -> Self {
        Self {
            block: Vec::new(),
            sub_matrices: Vec::new(),
            configured: false,
            fixed: EMITTER_ROWS,
            capacity: 0,
            max_events: 0,
            shape: Shape::Point,
            frame: IDENTITY_FRAME,
            spread: 0.0,
            speed: [1.0, 1.0],
            lifetime: [1.0, 1.0],
            velocity: None,
            duration: f64::INFINITY,
            looping: true,
            follow: false,
            bursts: Vec::new(),
            subs: Vec::new(),
            seed: DEFAULT_SEED,
            emitted: 0,
            next_birth: f64::INFINITY,
            base: 0.0,
            shift: 0,
            rebased: 0,
            births: [
                f64::INFINITY,
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
                f64::INFINITY,
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
            epoch_end: 0.0,
            events: Vec::new(),
            event_count: 0,
            ranges: [(0, 0); RANGES],
            range_count: 0,
            run: None,
        }
    }

    /// Makes room for `floats` numbers and returns their address, or 0 when the memory cannot
    /// grow. The block is sized once at configure, so the address stays valid.
    fn reserve(&mut self, floats: usize) -> u32 {
        if self.block.len() < floats {
            if self.block.try_reserve(floats - self.block.len()).is_err() {
                return 0;
            }
            self.block.resize(floats, 0.0);
        }
        self.block.as_ptr() as usize as u32
    }

    /// Reads the fixed settings from the block, which the sketch wrote, and starts the birth
    /// schedule, the time base and the events again.
    fn configure(&mut self, capacity: u32) {
        self.configured = false;
        let bursts = self.block.get(E_BURSTS).copied().unwrap_or(0.0) as usize;
        let subs = self.block.get(E_SUBS).copied().unwrap_or(0.0) as usize;
        let fixed = EMITTER_ROWS + (bursts + subs) * EMITTER_ROW_FLOATS;
        if fixed + EMITTER_FIXED_FLOATS > self.block.len() {
            return;
        }
        self.fixed = fixed;
        self.capacity = capacity;
        self.max_events = (capacity as usize).saturating_mul(subs);
        self.seed = pcg(self.block[fixed + F_SEED] as u32);
        self.shape = match self.block[fixed + F_SHAPE] as u32 {
            SHAPE_SPHERE => Shape::Sphere {
                radius: self.block[fixed + F_RADIUS],
                surface: self.block[fixed + F_SURFACE] != 0.0,
            },
            SHAPE_CONE => Shape::Cone {
                radius: self.block[fixed + F_RADIUS],
                angle: self.block[fixed + F_ANGLE],
            },
            SHAPE_BOX => Shape::Box {
                size: [
                    self.block[fixed + F_SIZE],
                    self.block[fixed + F_SIZE + 1],
                    self.block[fixed + F_SIZE + 2],
                ],
            },
            SHAPE_DISC => Shape::Disc {
                radius: self.block[fixed + F_RADIUS],
            },
            _ => Shape::Point,
        };
        self.speed = [self.block[fixed + F_SPEED], self.block[fixed + F_SPEED + 1]];
        self.lifetime = [self.block[fixed + F_LIFE], self.block[fixed + F_LIFE + 1]];
        self.velocity = (self.block[fixed + F_VELOCITY_FLAG] != 0.0).then(|| {
            [
                self.block[fixed + F_VELOCITY],
                self.block[fixed + F_VELOCITY + 1],
                self.block[fixed + F_VELOCITY + 2],
            ]
        });
        for k in 0..9 {
            self.frame[k] = self.block[fixed + F_FRAME + k];
        }
        self.spread = self.block[fixed + F_SPREAD];
        self.duration = self.block[fixed + F_DURATION];
        self.looping = self.block[fixed + F_LOOP] != 0.0;
        self.follow = self.block[fixed + F_FOLLOW] != 0.0;
        self.bursts.clear();
        if self.bursts.try_reserve(bursts).is_ok() {
            for row in 0..bursts {
                let at = EMITTER_ROWS + row * EMITTER_ROW_FLOATS;
                let interval = self.block[at + 2];
                let cycles = self.block[at + 3];
                self.bursts.push(Burst {
                    time: self.block[at],
                    count: self.block[at + 1] as u32,
                    interval: (!interval.is_nan()).then_some(interval),
                    cycles: (!cycles.is_nan()).then_some(cycles),
                });
            }
        }
        self.subs.clear();
        if self.subs.try_reserve(subs).is_ok() {
            for row in 0..subs {
                let at = EMITTER_ROWS + (bursts + row) * EMITTER_ROW_FLOATS;
                self.subs.push(Sub {
                    system: self.block[at] as u32,
                    on: if self.block[at + 1] != 0.0 {
                        EventOn::Ground
                    } else {
                        EventOn::Death
                    },
                    count: self.block[at + 2] as u32,
                    inherit: self.block[at + 3],
                });
            }
        }
        self.emitted = 0;
        self.next_birth = f64::INFINITY;
        self.base = 0.0;
        self.shift = 0;
        self.rebased = 0;
        self.births = [
            f64::INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        self.epoch_end = 0.0;
        self.events.clear();
        let first = self.max_events.min(FIRST_EVENTS) * EVENT_FLOATS;
        if self.events.try_reserve(first).is_ok() {
            self.events.resize(first, 0.0);
        }
        self.event_count = 0;
        self.range_count = 0;
        self.run = None;
        self.block[E_EMITTED] = 0.0;
        self.sub_matrices.clear();
        let floats = self.subs.len() * EMITTER_SUB_MATRIX_FLOATS;
        if self.sub_matrices.try_reserve(floats).is_ok() {
            self.sub_matrices.resize(floats, 0.0);
        }
        self.configured = true;
    }

    /// The motion numbers of the block, as f64, for the events' closed form.
    fn motion(&self) -> Motion {
        let f = self.fixed + F_MOTION;
        Motion {
            gx: self.block[f],
            gy: self.block[f + 1],
            gz: self.block[f + 2],
            drag: self.block[f + 3],
            wx: self.block[f + 4],
            wy: self.block[f + 5],
            wz: self.block[f + 6],
            turbulence: self.block[f + 7],
            turbulence_scale: self.block[f + 8],
            turbulence_speed: self.block[f + 9],
            ground_height: self.block[f + 10],
            ground_mode: self.block[f + 11] as u32,
            restitution: self.block[f + 12],
            friction: self.block[f + 13],
        }
    }

    /// A matrix of the block.
    fn matrix(&self, place: usize) -> [f64; 16] {
        let mut matrix = [0.0f64; 16];
        matrix.copy_from_slice(&self.block[place..place + 16]);
        matrix
    }

    /// The followed object's matrices, when the emitter follows one.
    fn follow_matrices(&self) -> Option<Follow> {
        self.follow.then(|| Follow {
            last: self.matrix(E_LAST),
            now: self.matrix(E_NOW),
            to_local: self.matrix(E_TO_LOCAL),
        })
    }

    /// A sub-emitter's inverse world matrix, or the identity for one that the sketch did not
    /// write.
    fn sub_matrix(&self, sub: usize) -> [f64; 16] {
        let mut matrix = IDENTITY_MATRIX;
        let at = sub * EMITTER_SUB_MATRIX_FLOATS;
        if at + EMITTER_SUB_MATRIX_FLOATS <= self.sub_matrices.len() {
            matrix.copy_from_slice(&self.sub_matrices[at..at + EMITTER_SUB_MATRIX_FLOATS]);
        }
        matrix
    }

    /// Emits a frame's births, moves the time base when the time calls for it, and writes the
    /// frame's values and the births' box for the sketch.
    fn emit_frame(&mut self, records: &mut [u32], capacity: u32, values: &mut [f32]) {
        if !self.configured {
            return;
        }
        let from = self.block[E_FROM];
        let to = self.block[E_TO];
        let rate = self.block[E_RATE];
        let sub_rows = EMITTER_ROWS + self.bursts.len() * EMITTER_ROW_FLOATS;
        for (index, sub) in self.subs.iter_mut().enumerate() {
            sub.system = self.block[sub_rows + index * EMITTER_ROW_FLOATS] as u32;
        }
        let emitting = self.block[E_EMITTING] != 0.0;
        let motion = self.motion();
        let follow = self.follow_matrices();
        if self.block[E_PREWARM] != 0.0 {
            let longest = self.lifetime[1];
            self.emit_between(
                0.0,
                longest,
                rate,
                emitting,
                records,
                capacity,
                &motion,
                follow.as_ref(),
            );
        }
        self.emit_between(
            from,
            to,
            rate,
            emitting,
            records,
            capacity,
            &motion,
            follow.as_ref(),
        );
        self.flush_run();
        self.rebase(records, capacity, to);
        values[PARAM_FLOATS] = (to - self.base) as f32;
        values[PARAM_FLOATS + 1] = self.emitted.min(capacity as u64) as f32;
        values[PARAM_FLOATS + 2] = self.rebased as f32;
        values[PARAM_FLOATS + 3] = self.shift as f32;
        self.rotate_births(to);
        self.write_box();
        self.block[E_EMITTED] = self.emitted as f64;
    }

    /// Emits the rate's and the bursts' particles born after `from` and up to `to`.
    #[allow(clippy::too_many_arguments)]
    fn emit_between(
        &mut self,
        from: f64,
        to: f64,
        rate: f64,
        emitting: bool,
        records: &mut [u32],
        capacity: u32,
        motion: &Motion,
        follow: Option<&Follow>,
    ) {
        let length = (to - from).max(1e-9);
        let end = if self.looping {
            f64::INFINITY
        } else {
            self.duration
        };
        if emitting && rate > 0.0 {
            let step = 1.0 / rate;
            if self.next_birth.is_infinite() || self.next_birth < from {
                self.next_birth = from + step;
            }
            let mut budget = capacity as i64;
            while self.next_birth <= to && self.next_birth <= end && budget > 0 {
                budget -= 1;
                let birth = self.next_birth;
                let share = (birth - from) / length;
                self.emit_one(birth, share, None, None, records, capacity, motion, follow);
                self.next_birth += step;
            }
        } else {
            self.next_birth = f64::INFINITY;
        }
        if !emitting || self.bursts.is_empty() {
            return;
        }
        for b in 0..self.bursts.len() {
            let burst = self.bursts[b];
            let interval = burst
                .interval
                .unwrap_or(if self.looping && self.duration.is_finite() {
                    self.duration
                } else {
                    0.0
                });
            let cycles = burst
                .cycles
                .unwrap_or(if burst.interval.is_some() || self.looping {
                    f64::INFINITY
                } else {
                    1.0
                });
            let mut first = if interval > 0.0 {
                ((from - burst.time) / interval).ceil().max(0.0)
            } else {
                0.0
            };
            if interval > 0.0 && burst.time + first * interval <= from {
                first += 1.0;
            }
            let mut j = first;
            while j < cycles {
                let at = burst.time + j * interval;
                if at > to || at > end {
                    break;
                }
                if at > from || (from == 0.0 && at == 0.0) {
                    let share = (at - from) / length;
                    for _ in 0..burst.count {
                        self.emit_one(at, share, None, None, records, capacity, motion, follow);
                    }
                }
                if interval <= 0.0 {
                    break;
                }
                j += 1.0;
            }
        }
    }

    /// Emits one particle, born at `birth` seconds, its share of the way through the frame. `at`
    /// and `velocity` give a burst's own place and the velocity that it adds.
    #[allow(clippy::too_many_arguments)]
    fn emit_one(
        &mut self,
        birth: f64,
        share: f64,
        at: Option<[f64; 3]>,
        velocity: Option<[f64; 3]>,
        records: &mut [u32],
        capacity: u32,
        motion: &Motion,
        follow: Option<&Follow>,
    ) {
        if capacity == 0 {
            return;
        }
        let number = self.emitted;
        self.emitted += 1;
        let mut seeds = [self.seed, number as u32, 0u32];
        let mut random = [0.0f64; ROLLS];
        randomize(&mut seeds, &mut random);
        let mut record = [0.0f64; 8];
        self.sample_shape(&mut record, &random);
        if let Some(at) = at {
            record[0] += at[0];
            record[1] += at[1];
            record[2] += at[2];
        } else if let Some(follow) = follow {
            place_followed(&mut record, follow, share);
        }
        if let Some(add) = velocity.or(self.velocity) {
            record[4] += add[0];
            record[5] += add[1];
            record[6] += add[2];
        }
        let shortest = self.lifetime[0];
        record[7] = shortest + (self.lifetime[1] - shortest) * random[ROLL_LIFE];
        let index = (number % capacity as u64) as u32;
        record[3] = birth - self.base
            + if index >= self.rebased {
                self.shift as f64
            } else {
                0.0
            };
        let seed = seeds[SEED_PARTICLE] & 0xffff;
        write_record(records, index, &record, seed);
        grow_births(&mut self.births, &record);
        match self.run {
            Some((start, end)) if index == end => self.run = Some((start, index + 1)),
            Some((start, end)) => {
                self.mark(start, end);
                self.run = Some((index, index + 1));
            }
            None => self.run = Some((index, index + 1)),
        }
        for sub in 0..self.subs.len() {
            self.plan_event(sub, &record, birth, seeds[SEED_PARTICLE], motion);
        }
    }

    /// Writes a place and a velocity from the shape, in the emitter's space, into the record.
    fn sample_shape(&self, record: &mut [f64; 8], random: &[f64; ROLLS]) {
        let speed = self.speed[0] + (self.speed[1] - self.speed[0]) * random[ROLL_SPEED];
        let u = random[ROLL_U];
        let v = random[ROLL_W];
        let w = random[ROLL_R];
        let (mut px, mut py, mut pz) = (0.0f64, 0.0f64, 0.0f64);
        let (dx, dy, dz);
        match self.shape {
            Shape::Sphere { radius, surface } => {
                let z = 2.0 * u - 1.0;
                let ring = (1.0 - z * z).sqrt();
                let a = 2.0 * std::f64::consts::PI * v;
                dx = ring * a.cos();
                dy = z;
                dz = ring * a.sin();
                let at = radius * if surface { 1.0 } else { w.cbrt() };
                px = dx * at;
                py = dy * at;
                pz = dz * at;
            }
            _ => {
                // A direction within the cone's angle of up, or within the spread of the
                // option's direction, evenly over the cap of the sphere that the angle cuts.
                let (cone, angle) = match self.shape {
                    Shape::Cone { angle, .. } => (true, angle),
                    _ => (false, self.spread),
                };
                let cos = 1.0 - u * (1.0 - angle.cos());
                let sin = (0.0f64).max(1.0 - cos * cos).sqrt();
                let a = 2.0 * std::f64::consts::PI * v;
                let x = sin * a.cos();
                let z = sin * a.sin();
                let f = if cone { IDENTITY_FRAME } else { self.frame };
                dx = f[0] * x + f[3] * cos + f[6] * z;
                dy = f[1] * x + f[4] * cos + f[7] * z;
                dz = f[2] * x + f[5] * cos + f[8] * z;
                match self.shape {
                    Shape::Cone { radius, .. } | Shape::Disc { radius } => {
                        let radius = radius * w.sqrt();
                        let turn = 2.0 * std::f64::consts::PI * random[ROLL_ANGLE];
                        px = radius * turn.cos();
                        pz = radius * turn.sin();
                    }
                    Shape::Box { size } => {
                        px = (w - 0.5) * size[0];
                        py = (random[ROLL_BOX_Y] - 0.5) * size[1];
                        pz = (random[ROLL_BOX_Z] - 0.5) * size[2];
                    }
                    _ => {}
                }
            }
        }
        record[0] = px;
        record[1] = py;
        record[2] = pz;
        record[4] = dx * speed;
        record[5] = dy * speed;
        record[6] = dz * speed;
    }

    /// Records when the newest particle's sub-emitter `sub` fires, if it does within its life.
    fn plan_event(
        &mut self,
        sub: usize,
        record: &[f64; 8],
        birth: f64,
        particle_seed: u32,
        motion: &Motion,
    ) {
        let target = self.subs[sub];
        let lifetime = record[7];
        let mut age = lifetime;
        if motion.ground_mode != GROUND_NONE {
            let mut io = [0.0f64; FLIGHT_FLOATS];
            io[FLIGHT_P..FLIGHT_P + 3].copy_from_slice(&record[0..3]);
            io[FLIGHT_V..FLIGHT_V + 3].copy_from_slice(&record[4..7]);
            io[FLIGHT_T] = lifetime;
            impact(motion, &mut io);
            let hit = io[FLIGHT_HIT];
            if target.on == EventOn::Ground && hit < 0.0 {
                return;
            }
            if hit >= 0.0 && (target.on == EventOn::Ground || motion.ground_mode == GROUND_KILL) {
                age = hit;
            }
        } else if target.on == EventOn::Ground {
            return;
        }
        let mut event = [0.0f64; EVENT_FLOATS];
        event[0] = birth + age;
        event[1] = sub as f64;
        for k in 0..3 {
            event[2 + PARTICLE_BIRTH + k] = record[k];
            event[2 + PARTICLE_VELOCITY + k] = record[4 + k];
        }
        event[2 + PARTICLE_AGE] = age;
        event[2 + PARTICLE_SEED] = particle_seed as f64;
        self.push_event(event);
    }

    /// Adds an event to the pending table, which doubles while the system warms up. An event past
    /// the most that the system holds, one for each sub-emitter of each record, is dropped.
    fn push_event(&mut self, event: Event) {
        if (self.event_count + 1) * EVENT_FLOATS > self.events.len() && !self.grow_events() {
            return;
        }
        let at = self.event_count * EVENT_FLOATS;
        self.events[at..at + EVENT_FLOATS].copy_from_slice(&event);
        self.event_count += 1;
    }

    /// Doubles the table of pending events, up to one for each sub-emitter of each record. False
    /// when it holds that many already.
    fn grow_events(&mut self) -> bool {
        let size = self.max_events.min((self.events.len() / EVENT_FLOATS) * 2);
        let floats = size * EVENT_FLOATS;
        if floats <= self.events.len() {
            return false;
        }
        if self.events.try_reserve(floats - self.events.len()).is_err() {
            return false;
        }
        self.events.resize(floats, 0.0);
        true
    }

    /// Moves the time base when `time` passes the threshold, and moves the birth times of this
    /// frame's share of records to the new base.
    fn rebase(&mut self, records: &mut [u32], capacity: u32, time: f64) {
        if self.shift == 0 && time - self.base > REBASE_AFTER {
            let shift = (time - self.base - self.lifetime[1] - 1.0).floor();
            if shift > 0.0 {
                self.base += shift;
                self.shift = shift as u32;
                self.rebased = 0;
            }
        }
        if self.shift == 0 {
            return;
        }
        let count = self.emitted.min(capacity as u64) as u32;
        let end = (self.rebased + REBASE_RECORDS).min(count);
        for index in self.rebased..end {
            let word = index as usize * RECORD_WORDS + 3;
            let moved = f32::from_bits(records[word]) - self.shift as f32;
            records[word] = moved.to_bits();
        }
        if end > self.rebased {
            self.mark(self.rebased, end);
        }
        self.rebased = end;
        if end >= count {
            self.shift = 0;
            self.rebased = 0;
        }
    }

    /// Turns the births' box when a lifetime has passed since the last turn, and writes the
    /// merged box of the last two lifetimes into the block.
    fn rotate_births(&mut self, time: f64) {
        if time >= self.epoch_end {
            self.births.copy_within(0..6, 6);
            for c in 0..3 {
                self.births[c] = f64::INFINITY;
                self.births[3 + c] = f64::NEG_INFINITY;
            }
            self.epoch_end = time + self.lifetime[1];
        }
    }

    /// Writes the low and the high corner of the births' box into the block.
    fn write_box(&mut self) {
        for c in 0..3 {
            let low = self.births[c].min(self.births[6 + c]);
            let high = self.births[3 + c].max(self.births[9 + c]);
            self.block[E_BOX + c] = low;
            self.block[E_BOX + 3 + c] = high;
        }
    }

    /// Adds a record to the ranges that this frame wrote.
    fn mark(&mut self, start: u32, end: u32) {
        let capacity = self.capacity;
        mark_ranges(
            &mut self.ranges,
            &mut self.range_count,
            start,
            end,
            capacity,
        );
    }

    /// Closes the last run of records that the births wrote.
    fn flush_run(&mut self) {
        if let Some((start, end)) = self.run.take() {
            self.mark(start, end);
        }
    }
}

/// Adds records `start..end` to a table of ranges. A range beside or across one it has joins it;
/// past the most ranges, the nearest two merge.
fn mark_ranges(
    ranges: &mut [(u32, u32); RANGES],
    count: &mut usize,
    start: u32,
    end: u32,
    capacity: u32,
) {
    let end = end.min(capacity);
    if start >= end {
        return;
    }
    if let Some(range) = ranges[..*count]
        .iter_mut()
        .find(|r| start <= r.1 && end >= r.0)
    {
        *range = (range.0.min(start), range.1.max(end));
    } else if *count < RANGES {
        ranges[*count] = (start, end);
        *count += 1;
    } else {
        let gap = |r: &(u32, u32)| {
            if start > r.1 {
                start - r.1
            } else {
                r.0.saturating_sub(end)
            }
        };
        let nearest = (0..RANGES).min_by_key(|&k| gap(&ranges[k])).unwrap_or(0);
        let range = &mut ranges[nearest];
        *range = (range.0.min(start), range.1.max(end));
    }
}

/// The identity matrix, for a sub-emitter whose inverse world matrix the sketch did not write.
const IDENTITY_MATRIX: [f64; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];

/// Writes one particle's record, with its lifetime as the 16-bit float nearest below it and its
/// seed above.
fn write_record(records: &mut [u32], index: u32, record: &[f64; 8], seed: u32) {
    let word = index as usize * RECORD_WORDS;
    for k in 0..7 {
        records[word + k] = (record[k] as f32).to_bits();
    }
    let bits = (record[7] as f32).to_bits();
    let exponent = ((bits >> 23) & 0xff) as i32 - 112;
    let half = if exponent <= 0 {
        0
    } else if exponent >= 31 {
        0x7bff
    } else {
        ((exponent as u32) << 10) | ((bits >> 13) & 0x3ff)
    };
    records[word + 7] = (half << 16) | (seed & 0xffff);
}

/// Grows a births' box by the newest birth place.
fn grow_births(births: &mut [f64; 12], record: &[f64; 8]) {
    for c in 0..3 {
        births[c] = births[c].min(record[c]);
        births[3 + c] = births[3 + c].max(record[c]);
    }
}

/// The PCG hash of a 32-bit value, for the seed that a system makes once.
fn pcg(value: u32) -> u32 {
    let state = value.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277_803_737);
    (word >> 22) ^ word
}

/// Writes the seed of particle `seeds[1]` of the system whose seed is `seeds[0]` at `seeds[2]`,
/// and fills `out` with that particle's numbers from 0 up to 1, one for each channel.
fn randomize(seeds: &mut [u32; 3], out: &mut [f64; ROLLS]) {
    let mut state = (seeds[SEED_SYSTEM] ^ seeds[SEED_NUMBER])
        .wrapping_mul(747_796_405)
        .wrapping_add(2_891_336_453);
    let mut word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277_803_737);
    let seed = (word >> 22) ^ word;
    seeds[SEED_PARTICLE] = seed;
    for (c, value) in out.iter_mut().enumerate() {
        let channel = (c as u32).wrapping_mul(2_654_435_769);
        state = (seed ^ channel)
            .wrapping_mul(747_796_405)
            .wrapping_add(2_891_336_453);
        word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277_803_737);
        *value = (((word >> 22) ^ word) >> 8) as f64 / 16_777_216.0;
    }
}

/// Moves the record's place and velocity from the emitter's space to the world, between the
/// emitter's places in the two frames, then into the system's space.
fn place_followed(record: &mut [f64; 8], follow: &Follow, share: f64) {
    let mut point = [0.0f64; 3];
    let mut moved = [0.0f64; 3];
    for c in 0..3 {
        let from = follow.last[12 + c];
        point[c] = from + (follow.now[12 + c] - from) * share;
        moved[c] = 0.0;
        for k in 0..3 {
            let axis = follow.now[4 * k + c];
            point[c] += axis * record[k];
            moved[c] += axis * record[4 + k];
        }
    }
    for c in 0..3 {
        let mut place = follow.to_local[12 + c];
        let mut speed = 0.0;
        for k in 0..3 {
            place += follow.to_local[4 * k + c] * point[k];
            speed += follow.to_local[4 * k + c] * moved[k];
        }
        record[c] = place;
        record[4 + c] = speed;
    }
}

/// Where a flight that `io` describes ends after its time, written into `io`.
fn flight(motion: &Motion, io: &mut [f64; FLIGHT_FLOATS]) {
    let t = io[FLIGHT_T];
    let k = motion.drag;
    if k < LITTLE_DRAG {
        io[FLIGHT_OUT_P] = io[FLIGHT_P] + io[FLIGHT_V] * t + 0.5 * motion.gx * t * t;
        io[FLIGHT_OUT_P + 1] = io[FLIGHT_P + 1] + io[FLIGHT_V + 1] * t + 0.5 * motion.gy * t * t;
        io[FLIGHT_OUT_P + 2] = io[FLIGHT_P + 2] + io[FLIGHT_V + 2] * t + 0.5 * motion.gz * t * t;
        io[FLIGHT_OUT_V] = io[FLIGHT_V] + motion.gx * t;
        io[FLIGHT_OUT_V + 1] = io[FLIGHT_V + 1] + motion.gy * t;
        io[FLIGHT_OUT_V + 2] = io[FLIGHT_V + 2] + motion.gz * t;
        return;
    }
    let decay = (-k * t).exp();
    let share = (1.0 - decay) / k;
    for c in 0..3 {
        let end = match c {
            0 => motion.wx + motion.gx / k,
            1 => motion.wy + motion.gy / k,
            _ => motion.wz + motion.gz / k,
        };
        let v = io[FLIGHT_V + c] - end;
        io[FLIGHT_OUT_P + c] = io[FLIGHT_P + c] + end * t + v * share;
        io[FLIGHT_OUT_V + c] = end + v * decay;
    }
}

/// Finds the first time after 0 at which the flight that `io` describes falls onto the ground,
/// within its time, and writes it at `FLIGHT_HIT`, or -1 for none.
fn impact(motion: &Motion, io: &mut [f64; FLIGHT_FLOATS]) {
    let ground = motion.ground_height;
    let g = motion.gy;
    let limit = io[FLIGHT_T];
    let vy = io[FLIGHT_V + 1];
    let rise = io[FLIGHT_P + 1] - ground;
    let mut t = limit;
    let d = vy * vy - 2.0 * g * rise;
    if g < 0.0 && d >= 0.0 {
        t = (-vy - d.sqrt()) / g;
    } else if vy < 0.0 {
        t = rise / -vy;
    }
    t = t.min(limit).max(0.0);
    let mut probe = *io;
    for _ in 0..IMPACT_STEPS {
        probe[FLIGHT_T] = t;
        flight(motion, &mut probe);
        let fall = probe[FLIGHT_OUT_V + 1].min(-1e-3);
        t = (t - (probe[FLIGHT_OUT_P + 1] - ground) / fall)
            .min(limit)
            .max(0.0);
    }
    // A flight that ends near the ground counts only while it falls, so one that bounced up off
    // it does not meet it again at once.
    probe[FLIGHT_T] = t;
    flight(motion, &mut probe);
    let near = (probe[FLIGHT_OUT_P + 1] - ground).abs() < 0.01;
    io[FLIGHT_HIT] = if near && t > 0.0 && probe[FLIGHT_OUT_V + 1] < 0.0 {
        t
    } else {
        -1.0
    };
}

/// Writes the state of the particle that `input` describes, at its age, into `out`.
fn state_at(motion: &Motion, input: &[f64; PARTICLE_FLOATS], out: &mut ParticleState) {
    let mut leg = [0.0f64; FLIGHT_FLOATS];
    leg[..6].copy_from_slice(&input[..6]);
    leg[FLIGHT_T] = input[PARTICLE_AGE];
    out.alive = true;
    let mut stopped = false;
    if motion.ground_mode != GROUND_NONE {
        for bounce in 0..=BOUNCES {
            impact(motion, &mut leg);
            let hit = leg[FLIGHT_HIT];
            if hit < 0.0 {
                break;
            }
            let left = leg[FLIGHT_T] - hit;
            leg[FLIGHT_T] = hit;
            flight(motion, &mut leg);
            if motion.ground_mode == GROUND_KILL {
                out.alive = false;
                break;
            }
            leg[FLIGHT_P] = leg[FLIGHT_OUT_P];
            leg[FLIGHT_P + 1] = motion.ground_height;
            leg[FLIGHT_P + 2] = leg[FLIGHT_OUT_P + 2];
            if motion.ground_mode == GROUND_STICK || bounce == BOUNCES {
                leg[FLIGHT_V] = 0.0;
                leg[FLIGHT_V + 1] = 0.0;
                leg[FLIGHT_V + 2] = 0.0;
                leg[FLIGHT_T] = 0.0;
                stopped = true;
                break;
            }
            let keep = 1.0 - motion.friction;
            leg[FLIGHT_V] = leg[FLIGHT_OUT_V] * keep;
            leg[FLIGHT_V + 1] = -leg[FLIGHT_OUT_V + 1] * motion.restitution;
            leg[FLIGHT_V + 2] = leg[FLIGHT_OUT_V + 2] * keep;
            leg[FLIGHT_T] = left;
        }
    }
    flight(motion, &mut leg);
    out.px = leg[FLIGHT_OUT_P];
    out.py = leg[FLIGHT_OUT_P + 1];
    out.pz = leg[FLIGHT_OUT_P + 2];
    out.vx = if stopped { 0.0 } else { leg[FLIGHT_OUT_V] };
    out.vy = if stopped { 0.0 } else { leg[FLIGHT_OUT_V + 1] };
    out.vz = if stopped { 0.0 } else { leg[FLIGHT_OUT_V + 2] };
    if motion.turbulence <= 0.0 {
        return;
    }
    let s = (input[PARTICLE_SEED] as u32 & 0xffff) as f64 * 0.013;
    let q = motion.turbulence_scale;
    let drift = motion.turbulence_speed * input[PARTICLE_AGE];
    for c in 0..3 {
        let mut moved = 0.0;
        for later in (0..2).rev() {
            let mut noise = [0.0f64; 4];
            for a in 0..3 {
                noise[a] = input[PARTICLE_BIRTH + a] * q
                    + s
                    + later as f64 * drift
                    + NOISE_CHANNELS[c * 3 + a];
            }
            simplex3(&mut noise);
            moved += (later as f64 * 2.0 - 1.0) * noise[3];
        }
        match c {
            0 => out.px += motion.turbulence * moved,
            1 => out.py += motion.turbulence * moved,
            _ => out.pz += motion.turbulence * moved,
        }
    }
    if motion.ground_mode != GROUND_NONE {
        out.py = out.py.max(motion.ground_height);
    }
}

/// One corner's part of simplex noise at the corner (cx, cy, cz), from the offset in `io`'s first
/// three numbers, added to its fourth.
fn corner(cx: i32, cy: i32, cz: i32, io: &mut [f64; 4]) {
    let x = io[0];
    let y = io[1];
    let z = io[2];
    let t = (0.6 - (x * x + y * y + z * z)).max(0.0);
    if t == 0.0 {
        return;
    }
    // The first word of the pcg3d hash of the lattice point, then Perlin's gradient that it picks.
    let mut px = (cx.wrapping_mul(1_664_525) as u32).wrapping_add(1_013_904_223);
    let mut py = (cy.wrapping_mul(1_664_525) as u32).wrapping_add(1_013_904_223);
    let mut pz = (cz.wrapping_mul(1_664_525) as u32).wrapping_add(1_013_904_223);
    px = px.wrapping_add(py.wrapping_mul(pz));
    py = py.wrapping_add(pz.wrapping_mul(px));
    pz = pz.wrapping_add(px.wrapping_mul(py));
    px ^= px >> 16;
    py ^= py >> 16;
    pz ^= pz >> 16;
    let k = (px.wrapping_add(py.wrapping_mul(pz))) & 15;
    let u = if k < 8 { x } else { y };
    let v = if k < 4 {
        y
    } else if k == 12 || k == 14 {
        x
    } else {
        z
    };
    let t2 = t * t;
    io[3] += t2 * t2 * ((if k & 1 == 0 { u } else { -u }) + (if k & 2 == 0 { v } else { -v }));
}

/// Simplex noise in 3D at the point in `io`'s first three numbers, from about -1 to 1, written
/// into its fourth.
fn simplex3(io: &mut [f64; 4]) {
    let x = io[0];
    let y = io[1];
    let z = io[2];
    let skew = (x + y + z) / 3.0;
    let cx = to_int32((x + skew).floor());
    let cy = to_int32((y + skew).floor());
    let cz = to_int32((z + skew).floor());
    let unskew = (cx as f64 + cy as f64 + cz as f64) / 6.0;
    let x0 = x - (cx as f64 - unskew);
    let y0 = y - (cy as f64 - unskew);
    let z0 = z - (cz as f64 - unskew);
    // step(x0.yzx, x0.xyz): 1 where the first is no larger; i1 = min(g, l.zxy), i2 = max(g, l.zxy).
    let gx = i32::from(y0 <= x0);
    let gy = i32::from(z0 <= y0);
    let gz = i32::from(x0 <= z0);
    let i1x = gx.min(1 - gz);
    let i1y = gy.min(1 - gx);
    let i1z = gz.min(1 - gy);
    let i2x = gx.max(1 - gz);
    let i2y = gy.max(1 - gx);
    let i2z = gz.max(1 - gy);
    io[3] = 0.0;
    for c in 0..4 {
        let ox = match c {
            0 => 0,
            1 => i1x,
            2 => i2x,
            _ => 1,
        };
        let oy = match c {
            0 => 0,
            1 => i1y,
            2 => i2y,
            _ => 1,
        };
        let oz = match c {
            0 => 0,
            1 => i1z,
            2 => i2z,
            _ => 1,
        };
        let back = c as f64 / 6.0;
        let mut offset = [
            x0 - ox as f64 + back,
            y0 - oy as f64 + back,
            z0 - oz as f64 + back,
            0.0,
        ];
        corner(cx + ox, cy + oy, cz + oz, &mut offset);
        io[3] += offset[3];
    }
    io[3] *= 32.0;
}

/// A number as JavaScript's ToInt32 reads it, which the simplex lattice uses.
fn to_int32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let m = value.trunc() % 4_294_967_296.0;
    let m = if m < 0.0 { m + 4_294_967_296.0 } else { m };
    m as u32 as i32
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
        let cells = scene.cell_table();
        let [first, shift] = system.rebase();
        for k in 0..views {
            let Some(frame) = frame_of(k) else {
                continue;
            };
            let offset = cells.offset_of(cell, &frame.camera);
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

    #[test]
    fn a_birth_block_writes_the_records_that_the_sketch_gave_it() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 8).unwrap();
        assert_ne!(table.births_address(2), 0);
        table.births[0..9].copy_from_slice(&[1.0, 2.0, 3.0, 4.5, -1.0, 0.5, 0.0, 1.75, 4660.0]);
        table.births[9..18].copy_from_slice(&[0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 2.0, 7.0]);
        table.write_records(id, 2, 3);
        let system = table.get(id).unwrap();
        let record =
            |index: usize| &system.records[index * RECORD_WORDS..(index + 1) * RECORD_WORDS];
        let words = record(3);
        assert_eq!(
            words[..7]
                .iter()
                .map(|w| f32::from_bits(*w))
                .collect::<Vec<_>>(),
            [1.0, 2.0, 3.0, 4.5, -1.0, 0.5, 0.0]
        );
        // 1.75 as a 16-bit float, then the seed.
        assert_eq!(words[7], (0x3f00 << 16) | 0x1234);
        let words = record(4);
        assert_eq!(f32::from_bits(words[3]), 5.0);
        // 2.0 as a 16-bit float, then the seed.
        assert_eq!(words[7], (0x4000 << 16) | 7);
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (3, 5));
    }

    #[test]
    fn a_batch_that_wraps_writes_the_records_around_the_buffer() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 4).unwrap();
        assert_ne!(table.births_address(4), 0);
        for birth in 0..4 {
            let at = birth * BIRTH_FLOATS;
            table.births[at + 3] = birth as f32;
        }
        // Records 2, 3, 0 and 1: the end of the buffer, then its start.
        table.write_records(id, 4, 2);
        let system = table.get(id).unwrap();
        // The two ranges touch, so they upload as the whole buffer.
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (0, 4));
        for index in 0..4 {
            let time = f32::from_bits(system.records[index * RECORD_WORDS + 3]);
            let expected = if index >= 2 { index - 2 } else { index + 2 } as f32;
            assert_eq!(time, expected);
        }
    }

    #[test]
    fn shifting_records_moves_the_birth_times_and_marks_them() {
        let mut table = ParticleTable::default();
        let id = table.create(1, 8).unwrap();
        assert_ne!(table.births_address(4), 0);
        for birth in 0..4 {
            let at = birth * BIRTH_FLOATS;
            table.births[at + 3] = 1000.0 + birth as f32;
        }
        table.write_records(id, 4, 0);
        table.clear_marks();
        table.shift_records(id, 1, 3, 1000);
        let system = table.get(id).unwrap();
        let time = |index: usize| f32::from_bits(system.records[index * RECORD_WORDS + 3]);
        assert_eq!(
            [time(0), time(1), time(2), time(3)],
            [1000.0, 1.0, 2.0, 1003.0]
        );
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (1, 3));
    }

    /// Writes an emitter's fixed settings at `f`: a point that sends particles up, with `speed`
    /// and `lifetime`, looping and with no velocity of its own.
    fn settings(block: &mut [f64], f: usize, seed: f64, speed: f64, lifetime: f64) {
        block[f + F_SEED] = seed;
        block[f + F_SHAPE] = 0.0;
        block[f + F_SPEED] = speed;
        block[f + F_SPEED + 1] = speed;
        block[f + F_LIFE] = lifetime;
        block[f + F_LIFE + 1] = lifetime;
        block[f + F_VELOCITY_FLAG] = 0.0;
        block[f + F_FRAME..f + F_FRAME + 9].copy_from_slice(&IDENTITY_FRAME);
        block[f + F_DURATION] = f64::INFINITY;
        block[f + F_LOOP] = 1.0;
        let m = f + F_MOTION;
        block[m + 8] = 1.0;
        block[m + 9] = 1.0;
        block[m + 12] = 0.4;
        block[m + 13] = 0.2;
    }

    /// A table with one emitter of `bursts` bursts and `subs` sub-emitters, and the emitter's id.
    fn emitter(capacity: u32, bursts: usize, subs: usize) -> (ParticleTable, u32) {
        let mut table = ParticleTable::default();
        let id = table.create(1, capacity).unwrap();
        let floats = EMITTER_ROWS + (bursts + subs) * EMITTER_ROW_FLOATS + EMITTER_FIXED_FLOATS;
        assert_ne!(table.emitter_block(id, floats), 0);
        {
            let block = &mut table.get_mut(id).unwrap().emitter.block;
            block[E_BURSTS] = bursts as f64;
            block[E_SUBS] = subs as f64;
            let f = EMITTER_ROWS + (bursts + subs) * EMITTER_ROW_FLOATS;
            settings(block, f, 1.0, 3.0, 2.0);
        }
        table.configure_emitter(id);
        (table, id)
    }

    /// Sets the frame's numbers of an emitter.
    fn frame(table: &mut ParticleTable, id: u32, from: f64, to: f64, rate: f64) {
        let emitter = &mut table.get_mut(id).unwrap().emitter;
        let block = &mut emitter.block;
        block[E_RATE] = rate;
        block[E_EMITTING] = 1.0;
        block[E_FROM] = from;
        block[E_TO] = to;
        block[E_TIME] = to;
        block[E_PREWARM] = 0.0;
    }

    fn record(system: &ParticleSystem, index: usize) -> [f32; 8] {
        let words = &system.records[index * RECORD_WORDS..(index + 1) * RECORD_WORDS];
        std::array::from_fn(|k| f32::from_bits(words[k]))
    }

    /// A burst's or a sub-emitter's row.
    fn row(table: &mut ParticleTable, id: u32, index: usize, values: [f64; 4]) {
        let block = &mut table.get_mut(id).unwrap().emitter.block;
        let at = EMITTER_ROWS + index * EMITTER_ROW_FLOATS;
        block[at..at + 4].copy_from_slice(&values);
    }

    #[test]
    fn the_hash_gives_the_numbers_that_the_addon_gave() {
        assert_eq!(pcg(1), 2_831_084_092);
        let mut seeds = [pcg(1), 0, 0];
        let mut rolls = [0.0f64; ROLLS];
        randomize(&mut seeds, &mut rolls);
        assert_eq!(seeds[SEED_PARTICLE], 3_911_864_714);
        assert_eq!(rolls[0], 0.138_429_045_677_185_06);
        assert_eq!(rolls[ROLL_LIFE], 0.525_761_365_890_502_9);
    }

    #[test]
    fn the_first_birth_takes_the_rates_time_and_the_direction() {
        let (mut table, id) = emitter(4, 0, 0);
        // A rate of one birth each second, from 0 up to 1, gives one birth at 1 second.
        frame(&mut table, id, 0.0, 1.0, 1.0);
        table.emit_frame(id);
        let system = table.get(id).unwrap();
        let words = record(system, 0);
        assert_eq!([words[0], words[1], words[2]], [0.0, 0.0, 0.0]);
        assert_eq!(words[3], 1.0);
        // The default frame sends the particle up at the speed of 3.
        assert_eq!([words[4], words[5], words[6]], [0.0, 3.0, 0.0]);
        // The lifetime of 2 as a 16-bit float, above the seed of particle 0.
        assert_eq!(words[7].to_bits(), (0x4000u32 << 16) | 20_874);
        let values = &system.values[PARAM_FLOATS..PARAM_FLOATS + 4];
        assert_eq!(values, [1.0, 1.0, 0.0, 0.0]);
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (0, 1));
    }

    #[test]
    fn a_rate_wraps_the_ring_and_reads_at_most_the_capacity() {
        let (mut table, id) = emitter(4, 0, 0);
        // One span makes at most a record for each place: the rate of 10 asks for five births
        // from 0 up to 0.5, and four of them write.
        frame(&mut table, id, 0.0, 0.5, 10.0);
        table.emit_frame(id);
        let system = table.get(id).unwrap();
        assert_eq!(system.emitter.emitted, 4);
        assert_eq!(system.values[PARAM_FLOATS + 1], 4.0);
        for (index, time) in [0.1f32, 0.2, 0.3, 0.4].into_iter().enumerate() {
            assert_eq!(record(system, index)[3], time);
        }
        // The next birth starts again at the first record.
        frame(&mut table, id, 0.5, 0.55, 10.0);
        table.emit_frame(id);
        let system = table.get(id).unwrap();
        assert_eq!(system.emitter.emitted, 5);
        assert_eq!(record(system, 0)[3], 0.5);
        assert_eq!(record(system, 1)[3], 0.2);
        // The rows in order: the four records, then the first one again.
        assert_eq!(system.range_count, 1);
        assert_eq!(system.ranges[0], (0, 4));
    }

    #[test]
    fn a_burst_happens_once_at_its_time() {
        let (mut table, id) = emitter(8, 1, 0);
        row(&mut table, id, 0, [0.25, 3.0, f64::NAN, f64::NAN]);
        table.configure_emitter(id);
        frame(&mut table, id, 0.0, 1.0, 0.0);
        table.emit_frame(id);
        let system = table.get(id).unwrap();
        assert_eq!(system.emitter.emitted, 3);
        for index in 0..3 {
            assert_eq!(record(system, index)[3], 0.25);
        }
        assert_eq!(system.ranges[0], (0, 3));
    }

    #[test]
    fn a_sub_emitter_bursts_where_its_particle_dies() {
        let (mut table, parent) = emitter(4, 1, 1);
        let child = table.create(2, 4).unwrap();
        {
            // The child draws nothing of its own: its place and velocity come from the burst.
            let floats = EMITTER_ROWS + EMITTER_FIXED_FLOATS;
            assert_ne!(table.emitter_block(child, floats), 0);
            let block = &mut table.get_mut(child).unwrap().emitter.block;
            block[E_BURSTS] = 0.0;
            block[E_SUBS] = 0.0;
            settings(block, EMITTER_ROWS, 3.0, 0.0, 1.0);
        }
        table.configure_emitter(child);
        // One burst at the start, then one particle that dies half a second later.
        row(&mut table, parent, 0, [0.0, 1.0, f64::NAN, f64::NAN]);
        // The sub-emitter row: the child, on death, two particles, half the velocity.
        row(&mut table, parent, 1, [child as f64, 0.0, 2.0, 0.5]);
        {
            let block = &mut table.get_mut(parent).unwrap().emitter.block;
            let f = EMITTER_ROWS + 2 * EMITTER_ROW_FLOATS;
            block[f + F_LIFE] = 0.5;
            block[f + F_LIFE + 1] = 0.5;
            block[f + F_SPEED] = 2.0;
            block[f + F_SPEED + 1] = 2.0;
            // The matrices of the world and of the child, both the identity.
            block[E_WORLD..E_WORLD + 16].copy_from_slice(&IDENTITY_MATRIX);
        }
        table.configure_emitter(parent);
        {
            let emitter = &mut table.get_mut(parent).unwrap().emitter;
            emitter.sub_matrices[..16].copy_from_slice(&IDENTITY_MATRIX);
        }
        frame(&mut table, parent, 0.0, 0.0, 0.0);
        table.emit_frame(parent);
        assert_eq!(table.get(parent).unwrap().emitter.event_count, 1);
        assert_eq!(table.get(child).unwrap().emitter.emitted, 0);
        // The particle is 1 meter up when its life ends, and the child bursts there.
        frame(&mut table, parent, 0.5, 0.5, 0.0);
        table.emit_frame(parent);
        assert_eq!(table.get(parent).unwrap().emitter.event_count, 0);
        let child = table.get(child).unwrap();
        assert_eq!(child.emitter.emitted, 2);
        for index in 0..2 {
            let words = record(child, index);
            assert_eq!([words[0], words[1], words[2]], [0.0, 1.0, 0.0]);
            // Half of the particle's 2 meters per second, along its way up.
            assert_eq!([words[4], words[5], words[6]], [0.0, 1.0, 0.0]);
        }
    }

    #[test]
    fn the_time_base_moves_and_the_records_follow_it() {
        let (mut table, id) = emitter(8, 0, 0);
        {
            let block = &mut table.get_mut(id).unwrap().emitter.block;
            block[EMITTER_ROWS + F_LIFE] = 1.0;
            block[EMITTER_ROWS + F_LIFE + 1] = 1.0;
        }
        table.configure_emitter(id);
        frame(&mut table, id, 0.0, 0.1, 10.0);
        table.emit_frame(id);
        // A frame after the time base's threshold moves it back by whole seconds.
        frame(&mut table, id, 1029.9, 1030.0, 10.0);
        table.emit_frame(id);
        let system = table.get(id).unwrap();
        // The first record counts from the move's base, the second was born at it.
        assert_eq!(record(system, 0)[3], (0.1f64 - 1028.0) as f32);
        assert_eq!(record(system, 1)[3], 2.0);
        let values = &system.values[PARAM_FLOATS..PARAM_FLOATS + 4];
        // The move finished in this frame, so no record counts from the old base now.
        assert_eq!(values, [2.0, 2.0, 0.0, 0.0]);
    }
}
