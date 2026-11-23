//! The sound add-on's mixer, as a WebAssembly module that its AudioWorklet runs on the browser's
//! audio thread (hard rule 42).
//!
//! In each render quantum the worklet copies the sketch's table into this module's memory and calls
//! `sound_render`. The module works out each voice's place relative to the listener, its gain, its
//! playback rate and its filter's cutoff, and writes each of them for every frame of the quantum:
//! the gain eased across it, so a change never clicks, and the other values held. The worklet
//! copies each of those runs into the browser's output arrays as a block, the one part that stays
//! in JavaScript, so it passes no number per value and allocates nothing.
//!
//! A group of many emitters gets a few voices. Every few quanta the module ranks the group's
//! emitters by how loud each would be where the listener stands, and hands the voices to the
//! loudest. A voice keeps its emitter while that emitter stays close to the cut, and one that moves
//! to another emitter fades out first and takes the new emitter's pitch while silent. A shot's
//! voice takes its slot's values once, as its play starts, and keeps them until its next play.
//!
//! When the sketch's frame count stands still, every voice fades out and `sound_render` reports
//! the stop, so the page suspends the audio.
//!
//! The module imports nothing and keeps its state in buffers made once, so a quantum allocates
//! nothing and the memory never grows: the worklet's views of it stay valid. The table's layout
//! comes from the add-on's `layout.ts`, which the worklet passes to `sound_table`.
// The WebAssembly build keeps no standard library, so the module is small and has no allocator.
// A build for another machine links the standard library, as cargo check, clippy and the tests do.
#![cfg_attr(all(target_arch = "wasm32", not(test)), no_std)]

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // Every index that a message or the table reaches is checked, so a call reaches this only
    // through a fault in the module. A trap stops the worklet's processing: the page hears of it
    // through the node's processor error, warns and stops the sound.
    core::arch::wasm32::unreachable()
}

use libm::{expf, powf, sqrtf};

/// The voices that one page plays at once: the channels of each of the worklet's outputs.
pub const MAX_VOICES: usize = 32;
/// The most emitters that one table holds.
pub const MAX_CAPACITY: usize = 4096;
/// The most floats of one table: the header, then six values for each emitter.
pub const MAX_TABLE: usize = 12 + 6 * MAX_CAPACITY;
/// The most frames of one render quantum.
pub const MAX_FRAMES: usize = 1024;
/// The values that each voice holds besides its gain: its place, its rate and its cutoff.
pub const VALUES: usize = 5;

/// A sound that plays its file over and over, with one emitter for each voice.
pub const LOOP: u32 = 0;
/// A sound of many emitters, of which the loudest few take its voices.
pub const GROUP: u32 = 1;
/// A sound that plays its file once for each play, with one emitter for each voice.
pub const SHOT: u32 = 2;

/// `sound_render`'s report: the sketch's frames have stopped.
pub const STOPPED: u32 = 1;
/// `sound_render`'s report: the sketch's frames move again.
pub const MOVING: u32 = 2;

/// A voice or a slot that holds no emitter, or a voice that no sound owns.
const NONE: i32 = -1;
/// How fast a voice's gain follows its target, as a time constant in seconds.
const GAIN_TIME: f32 = 0.08;
/// How fast a voice fades in once its file plays.
const FADE_IN_TIME: f32 = 0.25;
/// How fast a voice fades out before it moves to another emitter, or as its sound stops. A short
/// fade leaves a dip that the ear hears as a flutter as a group's nearest members change.
const SWITCH_TIME: f32 = 0.12;
/// How fast a voice's tone and rate follow their targets.
const TONE_TIME: f32 = 0.08;
/// How fast every sound fades when the sketch stops or starts again.
const PAUSE_TIME: f32 = 0.15;
/// How long the frame count may stand still before the sketch counts as stopped, in seconds.
const IDLE_AFTER: f32 = 0.3;
/// The quanta between two rankings of a group's emitters.
const RANK_EVERY: u32 = 4;
/// The share of the weakest chosen emitter's loudness that a voice's emitter must keep for the
/// voice to stay on it.
const HOLD_SHARE: f32 = 0.7;
/// A gain below this is silence.
const SILENT: f32 = 1e-4;
/// The filter's cutoff at a tone of 0 and at a tone of 1, in hertz.
const LOW_CUTOFF: f32 = 120.0;
const HIGH_CUTOFF: f32 = 20_000.0;
/// The share of its tone that a muffled sound loses at its far distance.
/// The share of its tone that a sound loses at its far distance. A voice that moves between a
/// group's members takes a gentler share, so the mix's brightness does not jump with the swap.
const MUFFLE: f32 = 0.22;
/// Where a sound with a far distance starts to fade, as a share of that distance.
const FAR_FADE: f32 = 0.6;
/// The largest level that the mixer takes from the table.
const LOUDEST: f32 = 16.0;
/// The widest playback rate that the mixer takes from the table, each way from 1.
const FASTEST: f32 = 16.0;

/// No voice takes its values at once.
const EASE: u8 = 0;
/// The voice takes its emitter's rate and tone at once, as it moves to a new emitter.
const SNAP_PITCH: u8 = 1;
/// The voice takes its gain, rate and tone at once, as a shot starts.
const SNAP_ALL: u8 = 2;

/// A smooth step from 0 at `low` to 1 at `high`.
fn smoothstep(low: f32, high: f32, value: f32) -> f32 {
    if value <= low {
        return 0.0;
    }
    if value >= high {
        return 1.0;
    }
    let t = (value - low) / (high - low);
    t * t * (3.0 - 2.0 * t)
}

/// A level from the table: 0 up to the loudest, and 0 for a value that is not a finite number.
fn level_of(value: f32) -> f32 {
    if value.is_nan() || value <= 0.0 || value == f32::INFINITY {
        return 0.0;
    }
    value.min(LOUDEST)
}

/// A tone from the table: 0 to 1, and 1 for a value that is not a number.
fn tone_of(value: f32) -> f32 {
    if value.is_nan() {
        1.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

/// A playback rate from the table, held within the widest rates each way. A value that is not a
/// number plays at the file's own speed.
fn rate_of(value: f32) -> f32 {
    if value.is_nan() {
        1.0
    } else {
        value.clamp(1.0 / FASTEST, FASTEST)
    }
}

/// How far a group member's playback rate sits from its neighbours': from 0.97 to 1.03, stepped by
/// the golden ratio so neighbours differ most. Copies of one recording at one pitch comb into a
/// metallic flutter; a few per cent apart, a group of like sources adds as a crowd.
fn detune_of(emitter: usize) -> f32 {
    let step = (emitter as f32 * 0.618_034) % 1.0;
    0.97 + 0.06 * step
}

/// The filter's cutoff in hertz for a tone from 0 to 1.
pub fn cutoff_of(tone: f32) -> f32 {
    LOW_CUTOFF * powf(HIGH_CUTOFF / LOW_CUTOFF, tone.clamp(0.0, 1.0))
}

/// One sound, as the sketch described it.
#[derive(Clone, Copy)]
struct Sound {
    id: i32,
    kind: u32,
    first: usize,
    count: usize,
    positional: bool,
    near: f32,
    far: f32,
    muffle: bool,
    voices: [u8; MAX_VOICES],
    voice_count: usize,
    /// True until the sketch removes the sound.
    live: bool,
}

impl Sound {
    const EMPTY: Sound = Sound {
        id: 0,
        kind: LOOP,
        first: 0,
        count: 0,
        positional: false,
        near: 0.0,
        far: 0.0,
        muffle: false,
        voices: [0; MAX_VOICES],
        voice_count: 0,
        live: false,
    };

    /// The share of the sound's level that is left at `distance`.
    fn distance_gain(&self, distance: f32) -> f32 {
        let mut gain = 1.0;
        if self.near > 0.0 && distance > self.near {
            gain = self.near / distance;
        }
        if self.far > 0.0 {
            gain *= 1.0 - smoothstep(self.far * FAR_FADE, self.far, distance);
        }
        gain
    }

    /// The share of the sound's tone that is left at `distance`, as muffling takes the highs.
    fn distance_tone(&self, distance: f32) -> f32 {
        if !self.muffle || self.far <= 0.0 {
            return 1.0;
        }
        1.0 - MUFFLE * smoothstep(self.near, self.far, distance)
    }
}

/// Where each block of values lies in the table, in floats.
#[derive(Clone, Copy)]
struct Layout {
    capacity: usize,
    frame: usize,
    volume: usize,
    listener_at: usize,
    listener_turn: usize,
    places: usize,
    levels: usize,
    rates: usize,
    tones: usize,
}

/// The mixer's state, made once.
struct Mixer {
    voices: usize,
    sample_rate: f32,
    layout: Layout,
    has_table: bool,
    table: [f32; MAX_TABLE],
    loudness: [f32; MAX_CAPACITY],
    sounds: [Sound; MAX_VOICES],
    /// The sound that each voice belongs to, as its place in `sounds`, or NONE.
    owner: [i32; MAX_VOICES],
    emitter: [i32; MAX_VOICES],
    next: [i32; MAX_VOICES],
    ready: [bool; MAX_VOICES],
    fresh: [bool; MAX_VOICES],
    wanted: [bool; MAX_VOICES],
    dying: [bool; MAX_VOICES],
    free: [bool; MAX_VOICES],
    snap: [u8; MAX_VOICES],
    /// A shot voice's place, level, rate and tone, as its play started.
    held: [f32; MAX_VOICES * 6],
    gain: [f32; MAX_VOICES],
    tone: [f32; MAX_VOICES],
    rate: [f32; MAX_VOICES],
    chosen: [i32; MAX_VOICES],
    chosen_loudness: [f32; MAX_VOICES],
    frames: usize,
    gain_step: f32,
    fade_in_step: f32,
    switch_step: f32,
    tone_step: f32,
    pause_step: f32,
    last_frame: i32,
    primed: bool,
    moved: bool,
    /// How long the sketch's frame count has stood still, in seconds, up to the idle wait.
    still: f32,
    pause: f32,
    idle: bool,
    quantum: u32,
    /// The listener's place and turn, read once per quantum.
    listener: [f32; 7],
    /// The emitter's place relative to the listener, and its distance, that `place` works out.
    relative: [f32; 3],
    distance: f32,
    /// Each voice's gain for every frame of the quantum, `MAX_FRAMES` floats per voice.
    gains: [f32; MAX_VOICES * MAX_FRAMES],
    /// Each voice's place, rate and cutoff for the quantum.
    values: [f32; MAX_VOICES * VALUES],
    /// The same values for every frame of the quantum, `MAX_FRAMES` floats for each value of each
    /// voice, in the order of `values`.
    columns: [f32; MAX_VOICES * VALUES * MAX_FRAMES],
    /// The value that each run of `columns` holds, and over how many of its frames, so a run whose
    /// value holds from the last quantum is not written again.
    column_value: [f32; MAX_VOICES * VALUES],
    column_frames: [u32; MAX_VOICES * VALUES],
    /// The voice list that `sound_add` reads.
    scratch: [i32; MAX_VOICES],
}

impl Mixer {
    /// The mixer before `setup`: every value zero, with no voice. A static of all zeros takes no
    /// room in the module's file, since its memory starts at zero; `setup` writes the start values.
    const ZERO: Mixer = Mixer {
        voices: 0,
        sample_rate: 0.0,
        layout: Layout {
            capacity: 0,
            frame: 0,
            volume: 0,
            listener_at: 0,
            listener_turn: 0,
            places: 0,
            levels: 0,
            rates: 0,
            tones: 0,
        },
        has_table: false,
        table: [0.0; MAX_TABLE],
        loudness: [0.0; MAX_CAPACITY],
        sounds: [Sound::EMPTY; MAX_VOICES],
        owner: [0; MAX_VOICES],
        emitter: [0; MAX_VOICES],
        next: [0; MAX_VOICES],
        ready: [false; MAX_VOICES],
        fresh: [false; MAX_VOICES],
        wanted: [false; MAX_VOICES],
        dying: [false; MAX_VOICES],
        free: [false; MAX_VOICES],
        snap: [EASE; MAX_VOICES],
        held: [0.0; MAX_VOICES * 6],
        gain: [0.0; MAX_VOICES],
        tone: [0.0; MAX_VOICES],
        rate: [0.0; MAX_VOICES],
        chosen: [0; MAX_VOICES],
        chosen_loudness: [0.0; MAX_VOICES],
        frames: 0,
        gain_step: 0.0,
        fade_in_step: 0.0,
        switch_step: 0.0,
        tone_step: 0.0,
        pause_step: 0.0,
        last_frame: 0,
        primed: false,
        moved: false,
        still: 0.0,
        pause: 0.0,
        idle: false,
        quantum: 0,
        listener: [0.0; 7],
        relative: [0.0; 3],
        distance: 0.0,
        gains: [0.0; MAX_VOICES * MAX_FRAMES],
        values: [0.0; MAX_VOICES * VALUES],
        columns: [0.0; MAX_VOICES * VALUES * MAX_FRAMES],
        column_value: [0.0; MAX_VOICES * VALUES],
        column_frames: [0; MAX_VOICES * VALUES],
        scratch: [0; MAX_VOICES],
    };

    /// Starts over with `voices` voices at `sample_rate`, with no table and no sound.
    fn setup(&mut self, voices: usize, sample_rate: f32) {
        self.voices = voices.min(MAX_VOICES);
        self.sample_rate = sample_rate;
        self.has_table = false;
        self.sounds = [Sound::EMPTY; MAX_VOICES];
        for v in 0..MAX_VOICES {
            self.clear(v);
            self.tone[v] = 1.0;
            self.rate[v] = 1.0;
        }
        self.chosen = [NONE; MAX_VOICES];
        // A quantum's steps follow its length, which the next render sets.
        self.frames = 0;
        self.primed = false;
        self.moved = false;
        self.still = 0.0;
        self.pause = 0.0;
        self.idle = false;
        self.quantum = 0;
        self.gains.fill(0.0);
        self.values.fill(0.0);
        // Every run is written again at the first render.
        self.column_frames.fill(0);
    }

    /// Frees voice `v` at once.
    fn clear(&mut self, v: usize) {
        self.owner[v] = NONE;
        self.emitter[v] = NONE;
        self.next[v] = NONE;
        self.ready[v] = false;
        self.fresh[v] = false;
        self.wanted[v] = false;
        self.dying[v] = false;
        self.snap[v] = EASE;
        self.gain[v] = 0.0;
        self.held[v * 6 + 3] = 0.0;
    }

    /// Adds a sound whose voices `sound_add`'s caller wrote into the scratch list.
    #[allow(clippy::too_many_arguments)]
    fn add(
        &mut self,
        id: i32,
        kind: u32,
        first: usize,
        count: usize,
        positional: bool,
        near: f32,
        far: f32,
        muffle: bool,
        voice_count: usize,
    ) {
        let voice_count = voice_count.min(MAX_VOICES);
        // A free place for the sound: one that no live sound holds and whose voices, if any still
        // fade, all pass to the new sound. A fading sound that gives up its last voice so frees its
        // place, which keeps a place free whenever a voice is. An add that finds none takes nothing.
        let taken = |m: &Mixer, v: usize| m.scratch[..voice_count].contains(&(v as i32));
        let mut slot = NONE;
        for s in 0..MAX_VOICES {
            let kept = (0..self.voices).any(|v| self.owner[v] == s as i32 && !taken(self, v));
            if !self.sounds[s].live && !kept {
                slot = s as i32;
                break;
            }
        }
        if slot == NONE {
            return;
        }
        let s = slot as usize;
        // The new sound's voices leave the sounds that held them.
        for k in 0..voice_count {
            let v = self.scratch[k];
            if v >= 0 && (v as usize) < self.voices {
                self.clear(v as usize);
            }
        }
        let mut sound = Sound {
            id,
            kind,
            first,
            count,
            positional,
            near,
            far,
            muffle,
            voices: [0; MAX_VOICES],
            voice_count: 0,
            live: true,
        };
        for k in 0..voice_count {
            let v = self.scratch[k];
            if v < 0 || v as usize >= self.voices {
                continue;
            }
            let v = v as usize;
            sound.voices[sound.voice_count] = v as u8;
            sound.voice_count += 1;
            self.owner[v] = s as i32;
            // A loop and a shot keep one emitter for each voice; a group's voices wait for a ranking.
            self.emitter[v] = if kind == GROUP {
                NONE
            } else {
                (first + k) as i32
            };
            // A shot's voice is ready at once: its file starts on each play, with its own attack.
            self.ready[v] = kind == SHOT;
            self.wanted[v] = kind != GROUP;
            self.tone[v] = 1.0;
            self.rate[v] = 1.0;
        }
        self.sounds[s] = sound;
    }

    /// Fades out the voices of sound `id`, which clear once silent.
    fn remove(&mut self, id: i32) {
        for s in 0..MAX_VOICES {
            if self.sounds[s].live && self.sounds[s].id == id {
                self.sounds[s].live = false;
                for v in 0..self.voices {
                    if self.owner[v] == s as i32 {
                        self.wanted[v] = false;
                        self.dying[v] = true;
                    }
                }
            }
        }
    }

    /// Sets each time constant's step for a quantum of `frames` frames.
    fn set_frames(&mut self, frames: usize) {
        self.frames = frames;
        let seconds = frames as f32 / self.sample_rate;
        let step = |time: f32| 1.0 - expf(-seconds / time);
        self.gain_step = step(GAIN_TIME);
        self.fade_in_step = step(FADE_IN_TIME);
        self.switch_step = step(SWITCH_TIME);
        self.tone_step = step(TONE_TIME);
        self.pause_step = step(PAUSE_TIME);
    }

    /// The emitter that voice `v` holds or waits to move to, or NONE.
    fn held_emitter(&self, v: usize) -> i32 {
        if self.next[v] != NONE {
            self.next[v]
        } else {
            self.emitter[v]
        }
    }

    /// Works out emitter `e`'s place from the table relative to the listener, and its distance.
    fn place_of(&mut self, e: usize) -> bool {
        let at = self.layout.places + 3 * e;
        self.place(self.table[at], self.table[at + 1], self.table[at + 2])
    }

    /// Works out the place `x`, `y`, `z` relative to the listener and its distance. Returns false
    /// for a place that is not a number, which leaves its emitter silent.
    fn place(&mut self, x: f32, y: f32, z: f32) -> bool {
        let [lx, ly, lz, qx, qy, qz, qw] = self.listener;
        let px = x - lx;
        let py = y - ly;
        let pz = z - lz;
        let distance = sqrtf(px * px + py * py + pz * pz);
        if !distance.is_finite() {
            return false;
        }
        // The inverse of the listener's turn, which carries the world into the listener's frame.
        let (ux, uy, uz) = (-qx, -qy, -qz);
        let tx = 2.0 * (uy * pz - uz * py);
        let ty = 2.0 * (uz * px - ux * pz);
        let tz = 2.0 * (ux * py - uy * px);
        self.relative = [
            px + qw * tx + (uy * tz - uz * ty),
            py + qw * ty + (uz * tx - ux * tz),
            pz + qw * tz + (ux * ty - uy * tx),
        ];
        self.distance = distance;
        true
    }

    /// Ranks group `s`'s emitters and hands its voices to the loudest.
    #[allow(clippy::needless_range_loop)]
    fn rank(&mut self, s: usize) {
        let sound = self.sounds[s];
        let layout = self.layout;
        let wanted = sound.voice_count;
        // A group whose voices were all refused has nothing to hand out.
        if wanted == 0 {
            return;
        }
        let mut count = 0;
        // A sound's emitters lie within the table; one that the sketch named past it stays silent.
        let end = (sound.first + sound.count).min(layout.capacity);
        for e in sound.first..end {
            let level = level_of(self.table[layout.levels + e]);
            let mut value = 0.0;
            if level > 0.0 && self.place_of(e) {
                value = level * sound.distance_gain(self.distance);
            }
            self.loudness[e] = value;
            if value.is_nan() || value <= SILENT {
                continue;
            }
            if count == wanted && value <= self.chosen_loudness[count - 1] {
                continue;
            }
            // Insert the emitter in loudness order, dropping the quietest when the list is full.
            if count < wanted {
                count += 1;
            }
            let mut at = count - 1;
            while at > 0 && self.chosen_loudness[at - 1] < value {
                self.chosen[at] = self.chosen[at - 1];
                self.chosen_loudness[at] = self.chosen_loudness[at - 1];
                at -= 1;
            }
            self.chosen[at] = e as i32;
            self.chosen_loudness[at] = value;
        }
        let cut = if count == wanted && count > 0 {
            HOLD_SHARE * self.chosen_loudness[count - 1]
        } else {
            0.0
        };
        // A voice keeps its emitter while that emitter is chosen, or stays near the cut. A voice that
        // another sound has taken since is that sound's now, and the group leaves it alone.
        let mine = |m: &Mixer, v: usize| m.owner[v] == s as i32;
        for j in 0..wanted {
            let v = sound.voices[j] as usize;
            if !mine(self, v) {
                continue;
            }
            let held = self.held_emitter(v);
            let inside = held != NONE && (held as usize) >= sound.first && (held as usize) < end;
            let keep = inside && {
                let loud = self.loudness[held as usize];
                loud > SILENT && (self.chosen[..count].contains(&held) || loud >= cut)
            };
            self.free[v] = !keep;
            self.wanted[v] = keep;
        }
        // Each chosen emitter that no voice holds takes a free voice.
        for k in 0..count {
            let e = self.chosen[k];
            let mut held_by = NONE;
            let mut free_voice = NONE;
            for j in 0..wanted {
                let v = sound.voices[j] as usize;
                if !mine(self, v) {
                    continue;
                }
                let held = self.held_emitter(v);
                if held == e && !self.free[v] {
                    held_by = v as i32;
                } else if free_voice == NONE && self.free[v] {
                    free_voice = v as i32;
                }
            }
            if held_by != NONE || free_voice == NONE {
                continue;
            }
            let v = free_voice as usize;
            self.free[v] = false;
            self.wanted[v] = true;
            // A silent voice takes its emitter at once; one that sounds fades out and then moves.
            if self.emitter[v] == NONE || self.gain[v] < SILENT {
                self.emitter[v] = e;
                self.next[v] = NONE;
                self.snap[v] = SNAP_PITCH;
            } else {
                self.next[v] = e;
            }
        }
    }

    /// Writes one quantum of every voice into the gain and value buffers, and returns what the
    /// page needs to hear: `STOPPED` as the sketch's frames stop, `MOVING` as they move again.
    fn render(&mut self, frames: usize) -> u32 {
        // A mixer that `setup` has not given a sample rate renders nothing.
        if frames == 0
            || frames > MAX_FRAMES
            || self.sample_rate.is_nan()
            || self.sample_rate <= 0.0
        {
            return 0;
        }
        if frames != self.frames {
            self.set_frames(frames);
        }
        if !self.has_table {
            self.gains.fill(0.0);
            return 0;
        }
        let layout = self.layout;
        let mut report = 0;

        // The sketch counts its frames; a count that stands still means the sketch has stopped. The
        // first count read is the reference that later counts move from.
        let frame = self.table[layout.frame].to_bits() as i32;
        if !self.primed {
            self.primed = true;
            self.last_frame = frame;
            self.still = 0.0;
        } else if frame != self.last_frame {
            self.last_frame = frame;
            self.still = 0.0;
            self.moved = true;
            if self.idle {
                self.idle = false;
                report |= MOVING;
            }
        } else if self.still < IDLE_AFTER {
            // The wait counts time, not renders, so a quantum that renders in pieces waits as long.
            self.still += frames as f32 / self.sample_rate;
        }
        // No voice sounds until the count moves, and the sketch counts as stopped only once its
        // count has stood still for the whole wait.
        let waited = self.still >= IDLE_AFTER;
        let running = self.moved && !waited;
        let target_pause = if running { 1.0 } else { 0.0 };
        self.pause += (target_pause - self.pause) * self.pause_step;
        if waited && !self.idle && self.pause < SILENT {
            self.idle = true;
            report |= STOPPED;
        }

        for (i, value) in self.listener.iter_mut().enumerate() {
            let slot = if i < 3 {
                layout.listener_at + i
            } else {
                layout.listener_turn + i - 3
            };
            *value = self.table[slot];
        }
        // A listener that is not a number hears nothing until the sketch writes one that is.
        let heard = self.listener.iter().all(|value| value.is_finite());
        let volume_value = self.table[layout.volume];
        let volume = if heard && volume_value > 0.0 {
            volume_value.min(1.0)
        } else {
            0.0
        };

        self.quantum += 1;
        if self.quantum >= RANK_EVERY {
            self.quantum = 0;
            for s in 0..MAX_VOICES {
                if self.sounds[s].live && self.sounds[s].kind == GROUP {
                    self.rank(s);
                }
            }
        }

        for v in 0..self.voices {
            self.voice(v, frames, volume);
            // Each value holds across the quantum. A run that holds it already over these frames, as
            // a still place or a settled rate does, is left as it is.
            for i in 0..VALUES {
                let run = v * VALUES + i;
                let value = self.values[run];
                if self.column_value[run].to_bits() == value.to_bits()
                    && self.column_frames[run] as usize >= frames
                {
                    continue;
                }
                let start = run * MAX_FRAMES;
                self.columns[start..start + frames].fill(value);
                self.column_value[run] = value;
                self.column_frames[run] = frames as u32;
            }
        }
        report
    }

    /// Works out voice `v` for a quantum of `frames` frames at `volume`.
    fn voice(&mut self, v: usize, frames: usize, volume: f32) {
        let ramp = v * MAX_FRAMES;
        if self.owner[v] == NONE {
            self.gains[ramp..ramp + frames].fill(0.0);
            return;
        }
        let sound = self.sounds[self.owner[v] as usize];
        let layout = self.layout;
        let mut e = self.emitter[v];
        let before = self.gain[v];
        // A voice that has faded out moves to the emitter it waits for, or stops for good.
        if before < SILENT && self.next[v] != NONE {
            e = self.next[v];
            self.emitter[v] = e;
            self.next[v] = NONE;
            // The pitch glides to the new member's, as the tone does: a voice that snapped both
            // while it was silent still landed on a different timbre than its neighbours.
            self.snap[v] = 0;
        }
        if before < SILENT && self.dying[v] {
            self.clear(v);
            self.gains[ramp..ramp + frames].fill(0.0);
            return;
        }
        let mut target = 0.0;
        let mut tone_target = 1.0;
        let mut rate_target = self.rate[v];
        // An emitter past the table's capacity stays silent.
        if e != NONE && (e as usize) < layout.capacity {
            let e = e as usize;
            let shot = sound.kind == SHOT;
            let h = v * 6;
            // A shot takes its slot's values once, as its play starts, and keeps them until the next.
            if shot && self.snap[v] == SNAP_ALL {
                let at = layout.places + 3 * e;
                self.held[h] = self.table[at];
                self.held[h + 1] = self.table[at + 1];
                self.held[h + 2] = self.table[at + 2];
                self.held[h + 3] = self.table[layout.levels + e];
                self.held[h + 4] = self.table[layout.rates + e];
                self.held[h + 5] = self.table[layout.tones + e];
            }
            let (level, tone, rate) = if shot {
                (self.held[h + 3], self.held[h + 5], self.held[h + 4])
            } else {
                (
                    self.table[layout.levels + e],
                    self.table[layout.tones + e],
                    self.table[layout.rates + e],
                )
            };
            let level = level_of(level);
            tone_target = tone_of(tone);
            rate_target = rate_of(rate);
            // A group's members share one file, so each takes its own rate: at one pitch their
            // copies comb as the nearest few swap around the listener.
            if sound.kind == GROUP {
                rate_target = (rate_target * detune_of(e)).clamp(1.0 / FASTEST, FASTEST);
            }
            let mut share = 1.0;
            if sound.positional {
                let found = if shot {
                    self.place(self.held[h], self.held[h + 1], self.held[h + 2])
                } else {
                    self.place_of(e)
                };
                if found {
                    share = sound.distance_gain(self.distance);
                    tone_target *= sound.distance_tone(self.distance);
                    let at = v * VALUES;
                    self.values[at] = self.relative[0];
                    self.values[at + 1] = self.relative[1];
                    self.values[at + 2] = self.relative[2];
                } else {
                    share = 0.0;
                }
            }
            let on = self.ready[v] && self.wanted[v] && !self.dying[v] && self.next[v] == NONE;
            target = if on && level > 0.0 {
                level * share * volume * self.pause
            } else {
                0.0
            };
        }
        let mut after;
        if self.snap[v] == SNAP_ALL {
            // A shot starts at its own level, place and pitch, not at its slot's last play.
            after = target;
            self.tone[v] = tone_target;
            self.rate[v] = rate_target;
        } else {
            if self.snap[v] == SNAP_PITCH {
                // A voice that moves to a new emitter takes its pitch and tone while silent.
                self.tone[v] = tone_target;
                self.rate[v] = rate_target;
            }
            let mut step = self.gain_step;
            if target < before && (self.next[v] != NONE || self.dying[v]) {
                step = self.switch_step;
            } else if self.fresh[v] && target > 0.0 {
                step = self.fade_in_step;
                if before >= target * 0.9 {
                    self.fresh[v] = false;
                }
            }
            after = before + (target - before) * step;
        }
        self.snap[v] = EASE;
        if after.is_nan() || after < 0.0 {
            after = 0.0;
        }
        self.gain[v] = after;
        // The gain eases across the quantum, so a change makes no step that clicks.
        let delta = (after - before) / frames as f32;
        for (i, gain) in self.gains[ramp..ramp + frames].iter_mut().enumerate() {
            *gain = before + delta * (i + 1) as f32;
        }
        let tone = self.tone[v] + (tone_target - self.tone[v]) * self.tone_step;
        self.tone[v] = tone;
        let rate = self.rate[v] + (rate_target - self.rate[v]) * self.tone_step;
        self.rate[v] = rate;
        let at = v * VALUES;
        self.values[at + 3] = rate;
        self.values[at + 4] = cutoff_of(tone).min(self.sample_rate * 0.45);
    }
}

/// The mixer's one state. The worklet runs on one thread and calls the module from it alone.
static mut MIXER: Mixer = Mixer::ZERO;

/// The mixer's state.
///
/// # Safety
/// The caller is the one thread that runs the module, and holds no other reference to the state.
unsafe fn mixer() -> &'static mut Mixer {
    unsafe { &mut *core::ptr::addr_of_mut!(MIXER) }
}

/// Starts the mixer over with `voices` voices at `sample_rate`, with no table and no sound.
#[unsafe(no_mangle)]
pub extern "C" fn sound_setup(voices: u32, sample_rate: f32) {
    unsafe { mixer() }.setup(voices as usize, sample_rate);
}

/// Takes the table's layout, in floats, and returns where the worklet copies the table each
/// quantum. A capacity past the most leaves the mixer without a table.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn sound_table(
    capacity: u32,
    frame: u32,
    volume: u32,
    listener_at: u32,
    listener_turn: u32,
    places: u32,
    levels: u32,
    rates: u32,
    tones: u32,
) -> *mut f32 {
    let m = unsafe { mixer() };
    let layout = Layout {
        capacity: capacity as usize,
        frame: frame as usize,
        volume: volume as usize,
        listener_at: listener_at as usize,
        listener_turn: listener_turn as usize,
        places: places as usize,
        levels: levels as usize,
        rates: rates as usize,
        tones: tones as usize,
    };
    let fits = layout.capacity <= MAX_CAPACITY && layout.tones + layout.capacity <= MAX_TABLE;
    m.layout = layout;
    m.has_table = fits;
    m.primed = false;
    m.moved = false;
    m.table.fill(0.0);
    m.table.as_mut_ptr()
}

/// The voice list that `sound_add` reads: up to 32 whole numbers.
#[unsafe(no_mangle)]
pub extern "C" fn sound_scratch() -> *mut i32 {
    unsafe { mixer() }.scratch.as_mut_ptr()
}

/// Adds a sound: its number, its kind, its emitters, whether it comes from a place, its near and
/// far distances, whether it muffles with distance, and how many voices the scratch list holds.
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn sound_add(
    id: i32,
    kind: u32,
    first: u32,
    count: u32,
    positional: u32,
    near: f32,
    far: f32,
    muffle: u32,
    voices: u32,
) {
    unsafe { mixer() }.add(
        id,
        kind,
        first as usize,
        count as usize,
        positional != 0,
        near,
        far,
        muffle != 0,
        voices as usize,
    );
}

/// Fades out sound `id`'s voices, which free once silent.
#[unsafe(no_mangle)]
pub extern "C" fn sound_remove(id: i32) {
    unsafe { mixer() }.remove(id);
}

/// Marks voice `voice`'s file as playing, so the voice fades in.
#[unsafe(no_mangle)]
pub extern "C" fn sound_ready(voice: u32) {
    let m = unsafe { mixer() };
    let v = voice as usize;
    if v < m.voices {
        m.ready[v] = true;
        m.fresh[v] = true;
    }
}

/// Marks a shot's play as starting on voice `voice`, which takes its slot's values at once.
#[unsafe(no_mangle)]
pub extern "C" fn sound_shot(voice: u32) {
    let m = unsafe { mixer() };
    let v = voice as usize;
    if v < m.voices {
        m.snap[v] = SNAP_ALL;
    }
}

/// Works out one quantum of `frames` frames, and returns `STOPPED`, `MOVING`, both or neither.
#[unsafe(no_mangle)]
pub extern "C" fn sound_render(frames: u32) -> u32 {
    unsafe { mixer() }.render(frames as usize)
}

/// Each voice's gain for every frame of the last quantum, `MAX_FRAMES` floats per voice.
#[unsafe(no_mangle)]
pub extern "C" fn sound_gains() -> *const f32 {
    unsafe { mixer() }.gains.as_ptr()
}

/// Each voice's place, rate and cutoff for every frame of the last quantum: `MAX_FRAMES` floats for
/// each of the `VALUES` values of each voice.
#[unsafe(no_mangle)]
pub extern "C" fn sound_columns() -> *const f32 {
    unsafe { mixer() }.columns.as_ptr()
}

/// The frames that each run of `sound_gains` and `sound_columns` takes.
#[unsafe(no_mangle)]
pub extern "C" fn sound_max_frames() -> u32 {
    MAX_FRAMES as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;
    const FRAMES: usize = 128;
    const CAPACITY: usize = 16;

    /// A mixer with a table of 16 emitters, every level, rate and tone at 1.
    fn mixer_with_table() -> Box<Mixer> {
        let mut m = Box::new(Mixer::ZERO);
        m.setup(MAX_VOICES, RATE);
        m.layout = Layout {
            capacity: CAPACITY,
            frame: 0,
            volume: 1,
            listener_at: 4,
            listener_turn: 7,
            places: 12,
            levels: 12 + 3 * CAPACITY,
            rates: 12 + 4 * CAPACITY,
            tones: 12 + 5 * CAPACITY,
        };
        m.has_table = true;
        m.table[1] = 1.0;
        m.table[10] = 1.0;
        for e in 0..CAPACITY {
            m.table[m.layout.levels + e] = 1.0;
            m.table[m.layout.rates + e] = 1.0;
            m.table[m.layout.tones + e] = 1.0;
        }
        m
    }

    /// Renders `quanta` quanta, counting a sketch frame before each.
    fn run(m: &mut Mixer, quanta: usize) {
        for _ in 0..quanta {
            let next = (m.table[0].to_bits() as i32).wrapping_add(1);
            m.table[0] = f32::from_bits(next as u32);
            m.render(FRAMES);
        }
    }

    fn add(m: &mut Mixer, kind: u32, first: usize, count: usize, voices: &[i32], near: f32) {
        m.scratch[..voices.len()].copy_from_slice(voices);
        m.add(1, kind, first, count, true, near, 0.0, false, voices.len());
    }

    fn last_gain(m: &Mixer, v: usize) -> f32 {
        m.gains[v * MAX_FRAMES + FRAMES - 1]
    }

    const SETTLE: usize = 2 * 48_000 / FRAMES;

    #[test]
    fn a_group_spreads_its_members_rates_so_their_copies_do_not_comb() {
        // Neighbouring members differ most, every factor sits within three per cent of the file's
        // own speed, and no two of the first sixteen share one, so the nearest few never play in
        // lockstep.
        let factors: Vec<f32> = (0..16).map(detune_of).collect();
        for (k, factor) in factors.iter().enumerate() {
            assert!((0.97..=1.03).contains(factor), "member {k} at {factor}");
            if k > 0 {
                assert!((factor - factors[k - 1]).abs() > 0.004);
            }
        }
        for a in 0..16 {
            for b in (a + 1)..16 {
                assert!((factors[a] - factors[b]).abs() > 1e-4);
            }
        }
    }

    #[test]
    fn a_loop_fades_in_to_its_level_at_its_distance() {
        let mut m = mixer_with_table();
        add(&mut m, LOOP, 0, 1, &[0], 2.0);
        m.table[12 + 2] = -4.0;
        run(&mut m, SETTLE);
        assert_eq!(last_gain(&m, 0), 0.0);
        m.ready[0] = true;
        m.fresh[0] = true;
        run(&mut m, SETTLE);
        assert!((last_gain(&m, 0) - 0.5).abs() < 1e-3);
        assert!((m.values[2] + 4.0).abs() < 1e-4);
    }

    #[test]
    fn a_group_gives_its_voices_to_its_loudest_members() {
        let mut m = mixer_with_table();
        add(&mut m, GROUP, 0, 6, &[0, 1], 1.0);
        m.ready[0] = true;
        m.ready[1] = true;
        for e in 0..6 {
            m.table[12 + 3 * e + 2] = -(10.0 + 10.0 * e as f32);
        }
        run(&mut m, SETTLE);
        let mut heard = [-m.values[2], -m.values[VALUES + 2]];
        heard.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert!((heard[0] - 10.0).abs() < 1e-3 && (heard[1] - 20.0).abs() < 1e-3);
    }

    #[test]
    fn a_value_that_is_not_a_number_silences_only_while_it_lasts() {
        let mut m = mixer_with_table();
        add(&mut m, LOOP, 0, 1, &[0], 1.0);
        m.ready[0] = true;
        m.table[12 + 2] = -2.0;
        run(&mut m, SETTLE);
        let level = m.layout.levels;
        m.table[level] = f32::INFINITY;
        run(&mut m, SETTLE);
        assert!(last_gain(&m, 0) < SILENT);
        m.table[level] = 1.0;
        run(&mut m, SETTLE);
        assert!((last_gain(&m, 0) - 0.5).abs() < 1e-3);
    }

    #[test]
    fn a_stopped_sketch_fades_out_and_is_reported_once() {
        let mut m = mixer_with_table();
        add(&mut m, LOOP, 0, 1, &[0], 0.0);
        m.ready[0] = true;
        run(&mut m, SETTLE);
        let mut reports = 0;
        for _ in 0..SETTLE {
            reports |= m.render(FRAMES);
        }
        assert_eq!(reports, STOPPED);
        assert!(last_gain(&m, 0) < SILENT);
    }

    #[test]
    fn a_group_whose_voices_were_all_refused_ranks_nothing_and_stops_nothing() {
        let mut m = mixer_with_table();
        // A voice past the mixer's voices is refused, which leaves the group none.
        add(&mut m, GROUP, 0, 4, &[MAX_VOICES as i32], 1.0);
        add(&mut m, LOOP, 4, 1, &[0], 0.0);
        m.ready[0] = true;
        run(&mut m, SETTLE);
        assert!((last_gain(&m, 0) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn a_new_sound_takes_a_place_when_every_place_holds_a_fading_sound() {
        let mut m = mixer_with_table();
        // 32 one-voice loops, all playing, then all removed: each fades on its voice.
        for v in 0..MAX_VOICES {
            m.scratch[0] = v as i32;
            m.add(v as i32, LOOP, v % CAPACITY, 1, false, 0.0, 0.0, false, 1);
            m.ready[v] = true;
        }
        run(&mut m, SETTLE);
        for id in 0..MAX_VOICES as i32 {
            m.remove(id);
        }
        // The next system's loops take voices that still fade, as a page's reset makes them.
        for v in 0..6 {
            m.scratch[0] = v as i32;
            m.add(100 + v as i32, LOOP, v, 1, false, 0.0, 0.0, false, 1);
            m.ready[v] = true;
            m.fresh[v] = true;
        }
        run(&mut m, SETTLE);
        for v in 0..6 {
            assert!((last_gain(&m, v) - 1.0).abs() < 1e-3, "voice {v}");
        }
    }

    #[test]
    fn a_group_leaves_alone_a_voice_that_another_sound_took() {
        let mut m = mixer_with_table();
        m.layout.capacity = MAX_CAPACITY;
        m.scratch[0] = 3;
        m.add(1, GROUP, 0, 4, true, 1.0, 0.0, false, 1);
        // A shot takes the group's voice with an emitter past the end of the loudness list.
        m.scratch[..2].copy_from_slice(&[5, 3]);
        m.add(2, SHOT, MAX_CAPACITY - 1, 2, true, 1.0, 0.0, false, 2);
        m.emitter[3] = MAX_CAPACITY as i32;
        run(&mut m, SETTLE);
        assert_eq!(m.owner[3], m.owner[5]);
    }

    #[test]
    fn a_group_whose_first_emitter_is_past_any_table_ranks_nothing() {
        let mut m = mixer_with_table();
        m.scratch[0] = 0;
        m.add(4, GROUP, u32::MAX as usize, 32, true, 1.0, 0.0, false, 1);
        run(&mut m, SETTLE);
        assert_eq!(last_gain(&m, 0), 0.0);
    }

    #[test]
    fn an_add_that_finds_no_place_takes_no_voice() {
        let mut m = mixer_with_table();
        // 32 live one-voice loops hold every place; a 33rd, sent in error on voice 0, is refused.
        for v in 0..MAX_VOICES {
            m.scratch[0] = v as i32;
            m.add(v as i32, LOOP, v % CAPACITY, 1, false, 0.0, 0.0, false, 1);
            m.ready[v] = true;
        }
        m.scratch[0] = 0;
        m.add(99, LOOP, 3, 1, false, 0.0, 0.0, false, 1);
        run(&mut m, SETTLE);
        assert!((last_gain(&m, 0) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn each_value_holds_across_every_frame_of_each_quantum() {
        let mut m = mixer_with_table();
        add(&mut m, LOOP, 0, 1, &[0], 2.0);
        m.ready[0] = true;
        m.table[12 + 2] = -4.0;
        run(&mut m, SETTLE);
        // A long render, then a short one at a moved place: every frame holds the new value.
        m.render(MAX_FRAMES);
        m.table[12 + 2] = -6.0;
        run(&mut m, 1);
        let z = 2 * MAX_FRAMES;
        assert!(
            m.columns[z..z + FRAMES]
                .iter()
                .all(|&v| (v + 6.0).abs() < 1e-4)
        );
        let rate = 3 * MAX_FRAMES;
        assert!(
            m.columns[rate..rate + FRAMES]
                .iter()
                .all(|&v| (v - 1.0).abs() < 1e-4)
        );
    }

    #[test]
    fn the_cutoff_runs_from_the_low_end_to_the_high_end() {
        assert!((cutoff_of(0.0) - LOW_CUTOFF).abs() < 1e-2);
        assert!((cutoff_of(1.0) - HIGH_CUTOFF).abs() < 1.0);
    }
}
