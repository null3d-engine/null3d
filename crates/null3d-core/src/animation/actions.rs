//! How played clips move from frame to frame: each sample slot that [`Animations::play`] fills
//! advances its time by the frame's step, loops or holds at its end, fades its weight in or out,
//! and reports the clip's events that its time passes. The rules follow three.js's
//! `AnimationAction` where it has the same feature.

use std::sync::atomic::{AtomicU32, Ordering};

use super::system::{EVENT_CAPACITY, EVENT_WORDS, MAX_BLEND, MAX_LAYERS, Play, counts};
use super::{AnimationError, Animations};
use crate::shared::SharedMut;

/// The bits of [`Action::flags`].
pub mod flag {
    /// The slot plays a clip: each frame step advances it.
    pub const PLAYING: u32 = 1;
    /// The clip repeats; without this bit it plays once and holds its last frame.
    pub const LOOP: u32 = 2;
    /// The clip adds its change to the pose instead of blending in.
    pub const ADDITIVE: u32 = 4;
    /// A clip that plays once has reached its end and holds there.
    pub const FINISHED: u32 = 8;
    /// The layer sits in the bits from here up.
    pub const LAYER_SHIFT: u32 = 8;
}

/// The kinds of event that a frame step reports, in bits 8 to 15 of an event record's second
/// word.
pub mod event_kind {
    /// The clip's time passed one of its events; the fourth word is the event's id.
    pub const EVENT: u32 = 0;
    /// A repeating clip went past its end and started again.
    pub const LOOP: u32 = 1;
    /// A clip that plays once reached its end.
    pub const FINISHED: u32 = 2;
}

/// The play state of one sample slot: its rate and how its weight fades. A slot that no play
/// filled keeps the defaults, which leave its time and weight alone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Action {
    /// The rate of the clip's time.
    pub speed: f32,
    /// [`flag`] bits, with the layer above [`flag::LAYER_SHIFT`].
    pub flags: u32,
    /// The fade's last value.
    pub fade_to: f32,
    /// Seconds of the instance's time until the fade reaches its last value; 0 when it has.
    pub fade_left: f32,
    /// How fast the fade moves toward its last value, per second.
    pub fade_rate: f32,
}

impl Default for Action {
    fn default() -> Self {
        Action {
            speed: 1.0,
            flags: 0,
            fade_to: 1.0,
            fade_left: 0.0,
            fade_rate: 0.0,
        }
    }
}

impl Action {
    /// The fade's value now, from 0 to 1, by which the slot's weight is multiplied.
    #[inline]
    pub fn factor(&self) -> f32 {
        if self.fade_left > 0.0 {
            (self.fade_to - self.fade_left * self.fade_rate).clamp(0.0, 1.0)
        } else {
            self.fade_to
        }
    }

    /// The slot's layer.
    #[inline]
    pub fn layer(&self) -> usize {
        (self.flags >> flag::LAYER_SHIFT) as usize
    }

    fn playing(&self) -> bool {
        self.flags & flag::PLAYING != 0
    }

    /// Fades from `from` to `to` over `seconds`; at once when `seconds` is 0.
    fn fade(&mut self, from: f32, to: f32, seconds: f32) {
        self.fade_to = to;
        if seconds > 0.0 && from != to {
            self.fade_left = seconds;
            self.fade_rate = (to - from) / seconds;
        } else {
            self.fade_left = 0.0;
        }
    }
}

/// Where a frame step's chunks write their events: a buffer of [`EVENT_CAPACITY`] records, the
/// next free record, and the count of events that did not fit.
pub(super) struct EventSink<'a> {
    pub records: SharedMut<[u32; EVENT_WORDS]>,
    pub count: &'a AtomicU32,
    pub dropped: &'a AtomicU32,
}

/// One instance's slots, which the frame step advances.
pub(super) struct Advance<'a, 'b> {
    pub instance: u32,
    pub time: &'a mut [f32],
    pub weight: &'a mut [f32],
    pub action: &'a mut [Action],
    pub sink: &'b EventSink<'b>,
    /// The instance's events so far in this frame step, which orders them.
    pub order: u32,
}

impl Advance<'_, '_> {
    fn emit(&mut self, slot: usize, kind: u32, clip: u32, id: u32) {
        let at = self.sink.count.fetch_add(1, Ordering::Relaxed) as usize;
        if at < EVENT_CAPACITY {
            let layer = self.action[slot].layer() as u32;
            let word = (self.order.min(0xffff) << 16) | (kind << 8) | layer;
            // SAFETY: each record index is handed out once per frame step by the atomic count.
            unsafe {
                self.sink.records.write(at, [self.instance, word, clip, id]);
            }
        } else {
            self.sink.dropped.fetch_add(1, Ordering::Relaxed);
        }
        self.order += 1;
    }

    /// Reports the events of clip `clip` whose times lie in `from..to`, both ends as `ends` says:
    /// bit 0 includes `from`, bit 1 includes `to`. With `backward`, in order from `to` down.
    fn emit_between(
        &mut self,
        slot: usize,
        clip: u32,
        events: ClipEventsRef<'_>,
        span: (f32, f32),
        ends: u32,
        backward: bool,
    ) {
        let ClipEventsRef { times, ids } = events;
        let (from, to) = span;
        let inside = |t: f32| {
            (t > from || (ends & 1 != 0 && t == from)) && (t < to || (ends & 2 != 0 && t == to))
        };
        if backward {
            for k in (0..times.len()).rev() {
                if inside(times[k]) {
                    self.emit(slot, event_kind::EVENT, clip, ids[k]);
                }
            }
        } else {
            for k in 0..times.len() {
                if inside(times[k]) {
                    self.emit(slot, event_kind::EVENT, clip, ids[k]);
                }
            }
        }
    }
}

/// Includes the start of a span in [`Advance::emit_between`].
const FROM: u32 = 1;
/// Includes the end of a span.
const TO: u32 = 2;

impl Animations {
    /// Plays clip `clip` on instance `instance`, as `play` says. The clip fades in over
    /// `play.fade` seconds, and the layer's other clips fade out over the same time, from the
    /// weight they have. A clip that already plays on the layer keeps its time and fades back in
    /// from its weight, unless it played once and reached its end: then it starts again. A clip
    /// starts from its first frame, or with a negative speed from its last. Each instance has
    /// [`MAX_BLEND`] slots; when all of them hold clips, the play takes the slot whose clip
    /// counts least now.
    pub fn play(&mut self, instance: u32, clip: u32, play: Play) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        if self.clip_skeleton(clip) != Some(skeleton) {
            return Err(AnimationError::UnknownClip { clip });
        }
        if play.layer as usize >= MAX_LAYERS {
            return Err(AnimationError::Layer { layer: play.layer });
        }
        if !(play.fade.is_finite() && play.fade >= 0.0) {
            return Err(AnimationError::Play { option: 0 });
        }
        if !play.speed.is_finite() {
            return Err(AnimationError::Play { option: 1 });
        }
        let target = if play.additive {
            self.additive_clip(clip)?
        } else {
            self.clip_sources[clip as usize]
        };
        let first = instance as usize * MAX_BLEND;
        let layer = play.layer as usize;
        let slots = first..first + MAX_BLEND;
        let existing = slots.clone().find(|&s| {
            let a = &self.actions[s];
            a.playing() && a.layer() == layer && self.slots.clip[s] == target
        });
        let slot = existing
            .or_else(|| slots.clone().find(|&s| !counts(self.slots.weight[s])))
            .unwrap_or_else(|| {
                // Every slot holds a clip: take the one that counts least now.
                let count = |s: usize| self.slots.weight[s] * self.actions[s].factor();
                slots
                    .clone()
                    .min_by(|&a, &b| count(a).total_cmp(&count(b)))
                    .unwrap_or(first)
            });
        for s in slots {
            let same_layer = self.actions[s].playing() && self.actions[s].layer() == layer;
            if s != slot && same_layer {
                self.fade_out(s, play.fade);
            }
        }
        let duration = self.clips[target as usize].duration();
        let start = if play.speed < 0.0 { duration } else { 0.0 };
        let action = &mut self.actions[slot];
        let restart = existing.is_none() || action.flags & flag::FINISHED != 0;
        let from = if existing.is_some() {
            action.factor()
        } else {
            0.0
        };
        action.speed = play.speed;
        action.flags = flag::PLAYING
            | if play.looping { flag::LOOP } else { 0 }
            | if play.additive { flag::ADDITIVE } else { 0 }
            | ((layer as u32) << flag::LAYER_SHIFT);
        action.fade(from, 1.0, play.fade);
        if existing.is_none() {
            self.slots.clip[slot] = target;
            self.slots.weight[slot] = 1.0;
        }
        if restart {
            self.slots.time[slot] = start;
        }
        Ok(())
    }

    /// Stops clip `clip` on instance `instance` on every layer, or with `None`, every clip. Each
    /// fades out over `fade` seconds from the weight it has, or stops at once when `fade` is 0.
    pub fn stop(
        &mut self,
        instance: u32,
        clip: Option<u32>,
        fade: f32,
    ) -> Result<(), AnimationError> {
        self.live_skeleton(instance)?;
        if !(fade.is_finite() && fade >= 0.0) {
            return Err(AnimationError::Play { option: 0 });
        }
        let first = instance as usize * MAX_BLEND;
        for s in first..first + MAX_BLEND {
            let source = self.clip_sources.get(self.slots.clip[s] as usize).copied();
            let matches = clip.is_none() || source == clip;
            if self.actions[s].playing() && matches {
                self.fade_out(s, fade);
            }
        }
        Ok(())
    }

    /// Fades slot `s` out over `seconds` from the weight it has, or frees it at once.
    fn fade_out(&mut self, s: usize, seconds: f32) {
        let action = &mut self.actions[s];
        if seconds > 0.0 {
            action.fade(action.factor(), 0.0, seconds);
        } else {
            *action = Action::default();
            self.slots.weight[s] = 0.0;
        }
    }

    /// Advances an instance's played slots by `step` seconds of its time: each clip's time by
    /// the step times its speed, and each fade by the step. Reports the events that each clip's
    /// time passes, a loop each time a repeating clip starts again, and the end of a clip that
    /// plays once. Frees a slot whose fade out ends.
    pub(super) fn advance(&self, slots: &mut Advance<'_, '_>, step: f32) {
        for k in 0..MAX_BLEND {
            let action = slots.action[k];
            if !action.playing() || !counts(slots.weight[k]) {
                continue;
            }
            // A slot whose clip id names no clip, as a direct write of the slot arrays can leave
            // it, is skipped, as sampling skips it.
            let clip = self.slots_clip(slots.instance, k);
            let Some(&source) = self.clip_sources.get(clip as usize) else {
                continue;
            };
            if action.flags & flag::FINISHED == 0 {
                let moved = step * action.speed;
                if moved != 0.0 {
                    self.advance_time(slots, k, source, moved, action.flags & flag::LOOP != 0);
                }
            }
            let action = &mut slots.action[k];
            if action.fade_left > 0.0 {
                action.fade_left -= step.abs();
                if action.fade_left <= 0.0 {
                    action.fade_left = 0.0;
                    if action.fade_to <= 0.0 {
                        *action = Action::default();
                        slots.weight[k] = 0.0;
                    }
                }
            }
        }
    }

    fn slots_clip(&self, instance: u32, k: usize) -> u32 {
        self.slots().clip[instance as usize * MAX_BLEND + k]
    }

    /// Moves slot `k`'s time by `moved` seconds of clip `source`, and reports what it passes.
    fn advance_time(
        &self,
        slots: &mut Advance<'_, '_>,
        k: usize,
        source: u32,
        moved: f32,
        looping: bool,
    ) {
        let duration = self.clips[source as usize].duration();
        let events = self.events_of(source);
        let backward = moved < 0.0;
        let t0 = slots.time[k];
        let mut t1 = t0 + moved;
        let emit = |slots: &mut Advance<'_, '_>, span, ends| {
            slots.emit_between(k, source, events, span, ends, backward);
        };
        if duration <= 0.0 {
            // A clip of one frame has no time to pass.
            if !looping {
                slots.action[k].flags |= flag::FINISHED;
                slots.emit(k, event_kind::FINISHED, source, 0);
            }
            return;
        }
        if looping {
            if moved.abs() >= duration {
                // A step of a whole loop or more passes each event once.
                emit(slots, (0.0, duration), FROM | TO);
                t1 = t1.rem_euclid(duration);
                slots.emit(k, event_kind::LOOP, source, 0);
            } else if t1 >= duration {
                // An event at the end fires as the clip wraps, as one at the start does.
                emit(slots, (t0, duration), FROM | TO);
                t1 -= duration;
                emit(slots, (0.0, t1), FROM);
                slots.emit(k, event_kind::LOOP, source, 0);
            } else if t1 < 0.0 {
                emit(slots, (0.0, t0), FROM | TO);
                t1 += duration;
                emit(slots, (t1, duration), TO);
                slots.emit(k, event_kind::LOOP, source, 0);
            } else if backward {
                emit(slots, (t1, t0), TO);
            } else {
                emit(slots, (t0, t1), FROM);
            }
        } else if t1 >= duration && !backward {
            emit(slots, (t0, duration), FROM | TO);
            t1 = duration;
            slots.action[k].flags |= flag::FINISHED;
            slots.emit(k, event_kind::FINISHED, source, 0);
        } else if t1 <= 0.0 && backward {
            emit(slots, (0.0, t0), FROM | TO);
            t1 = 0.0;
            slots.action[k].flags |= flag::FINISHED;
            slots.emit(k, event_kind::FINISHED, source, 0);
        } else if backward {
            emit(slots, (t1, t0), TO);
        } else {
            emit(slots, (t0, t1), FROM);
        }
        slots.time[k] = t1;
    }

    fn events_of(&self, source: u32) -> ClipEventsRef<'_> {
        let events = &self.clip_events[source as usize];
        ClipEventsRef {
            times: &events.times,
            ids: &events.ids,
        }
    }
}

/// A clip's event times and ids.
#[derive(Clone, Copy)]
struct ClipEventsRef<'a> {
    times: &'a [f32],
    ids: &'a [u32],
}
