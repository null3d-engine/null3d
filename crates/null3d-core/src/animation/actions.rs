//! How played clips move from frame to frame: each sample slot that [`Animations::play`] fills
//! advances its time by the frame's step, loops or holds at its end, fades its weight in or out,
//! and reports the clip's events that its time passes. The clips of a 1D blend
//! ([`Animations::play_blend`]) share one phase: each moves at its length over the blend's
//! weight-averaged length, so their cycles stay in step. The rules follow three.js's
//! `AnimationAction` where it has the same feature.

use std::sync::atomic::{AtomicU32, Ordering};

use super::system::{
    Blend, EVENT_CAPACITY, EVENT_WORDS, MAX_BLEND, MAX_LAYERS, NO_SOURCE, Play, counts,
};
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
    /// The clip belongs to its layer's 1D blend, at the blend value of [`super::Action::point`].
    pub const BLEND: u32 = 16;
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
    /// The rate of the clip's time. In a blend, the rate of the blend's phase in cycles of the
    /// blend's weight-averaged length.
    pub speed: f32,
    /// [`flag`] bits, with the layer above [`flag::LAYER_SHIFT`].
    pub flags: u32,
    /// The fade's last value.
    pub fade_to: f32,
    /// Seconds of the instance's time until the fade reaches its last value; 0 when it has.
    pub fade_left: f32,
    /// How fast the fade moves toward its last value, per second.
    pub fade_rate: f32,
    /// The blend value at which a blend's clip counts in full.
    pub point: f32,
}

impl Default for Action {
    fn default() -> Self {
        Action {
            speed: 1.0,
            flags: 0,
            fade_to: 1.0,
            fade_left: 0.0,
            fade_rate: 0.0,
            point: 0.0,
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

    /// True for a played slot on layer `layer` whose `ADDITIVE` bit is `kind`.
    fn plays_on(&self, layer: usize, kind: u32) -> bool {
        self.playing() && self.layer() == layer && self.flags & flag::ADDITIVE == kind
    }

    /// True for a clip of layer `layer`'s blend.
    fn in_blend(&self, layer: usize) -> bool {
        self.plays_on(layer, 0) && self.flags & flag::BLEND != 0
    }

    /// True while the slot fades out.
    fn fading_out(&self) -> bool {
        self.playing() && self.fade_left > 0.0 && self.fade_to <= 0.0
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

/// How a layer's blend weighs its clips at one blend value.
#[derive(Clone, Copy)]
pub(super) struct BlendState {
    /// Each slot's share of the blend, which multiplies its weight: the two clips around the
    /// value share it, the blend's other clips get 0, and slots outside the blend 1.
    pub shares: [f32; MAX_BLEND],
    /// The blend's clips' lengths averaged by their weights, in seconds: the length of one cycle
    /// of the blend.
    pub length: f32,
    /// The first of the blend's clips with a length, whose time gives the blend's phase.
    pub lead: Option<usize>,
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
    pub source: &'a mut [u32],
    pub action: &'a mut [Action],
    /// Each slot's share of its layer's blend in this step, as [`BlendState::shares`].
    pub shares: [f32; MAX_BLEND],
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

    /// Frees slot `k`: its clip leaves the pose.
    fn free(&mut self, k: usize) {
        self.action[k] = Action::default();
        self.weight[k] = 0.0;
        self.source[k] = NO_SOURCE;
    }
}

/// Includes the start of a span in [`Advance::emit_between`].
const FROM: u32 = 1;
/// Includes the end of a span.
const TO: u32 = 2;

/// Where a clip of `duration` seconds starts at `time`: within the clip for a repeating clip, and
/// held at its first or last frame for a clip that plays once.
fn start_time(time: f32, duration: f32, looping: bool) -> f32 {
    if looping && duration > 0.0 {
        let t = time.rem_euclid(duration);
        // A tiny negative time rounds up to the clip's length.
        if t < duration { t } else { 0.0 }
    } else {
        time.clamp(0.0, duration.max(0.0))
    }
}

impl Animations {
    /// Plays clip `clip` on instance `instance`, as `play` says. Unless `play.join` is set, the
    /// layer's other clips of the same kind (base or additive) fade out over `play.fade` seconds,
    /// from the weight they have, and a blend on the layer leaves it. The clip fades in over the
    /// same time. A clip that already plays on the layer keeps its time and fades back in from
    /// its weight, unless it played once and reached its end: then it starts again. A clip
    /// starts at `play.time`, or from its first frame, or with a negative speed from its last.
    /// Its weight is `play.weight`; without one, a clip that starts takes 1 and one that plays
    /// keeps its weight. Each instance has [`MAX_BLEND`] slots; when all of them hold clips, the
    /// play takes the slot of a clip that fades out, or else the slot whose clip counts least
    /// now.
    pub fn play(&mut self, instance: u32, clip: u32, play: Play) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        if self.clip_skeleton(clip) != Some(skeleton) {
            return Err(AnimationError::UnknownClip { clip });
        }
        check_options(play.layer, play.fade, play.speed)?;
        if play.time.is_some_and(|t| !t.is_finite()) {
            return Err(AnimationError::Play { option: 2 });
        }
        if play.weight.is_some_and(|w| !(w.is_finite() && w >= 0.0)) {
            return Err(AnimationError::Play { option: 3 });
        }
        let source = self.clip_sources[clip as usize];
        let target = if play.additive {
            self.additive_clip(clip)?
        } else {
            source
        };
        let first = instance as usize * MAX_BLEND;
        let layer = play.layer as usize;
        let kind = if play.additive { flag::ADDITIVE } else { 0 };
        let slots = first..first + MAX_BLEND;
        let existing = slots.clone().find(|&s| {
            let a = &self.actions[s];
            a.plays_on(layer, kind) && a.flags & flag::BLEND == 0 && self.slots.clip[s] == target
        });
        // A clip that the layer's blend plays: a new slot takes its time, so the switch keeps
        // the step.
        let blend_time = slots
            .clone()
            .find(|&s| self.actions[s].in_blend(layer) && self.slots.clip[s] == target)
            .map(|s| self.slots.time[s]);
        if !play.join {
            self.fade_out_layer(instance, layer, kind, play.fade, existing);
        }
        let slot = existing.unwrap_or_else(|| self.take_slot(first, 0));
        let duration = self.clips[target as usize].duration();
        let looping = play.looping;
        let action = &mut self.actions[slot];
        let restart = existing.is_none() || action.flags & flag::FINISHED != 0;
        let from = if existing.is_some() {
            action.factor()
        } else {
            0.0
        };
        action.speed = play.speed;
        action.flags = flag::PLAYING
            | if looping { flag::LOOP } else { 0 }
            | kind
            | ((layer as u32) << flag::LAYER_SHIFT);
        action.fade(from, 1.0, play.fade);
        if existing.is_none() {
            self.slots.clip[slot] = target;
            self.slots.weight[slot] = 1.0;
            self.slots.source[slot] = source;
        }
        if let Some(weight) = play.weight {
            self.slots.weight[slot] = weight;
        }
        if let Some(time) = play.time {
            self.slots.time[slot] = start_time(time, duration, looping);
        } else if restart {
            let start = if play.speed < 0.0 { duration } else { 0.0 };
            self.slots.time[slot] = match (existing, blend_time) {
                (None, Some(time)) => time,
                _ => start,
            };
        }
        Ok(())
    }

    /// Plays a 1D blend of `clips` on instance `instance`: clip `k` counts in full at the blend
    /// value `points[k]`, and between two points the two clips around the value share it. The
    /// layer's blend value ([`Self::blend_values_mut`]) picks the mix, and can change every
    /// frame. The clips share one phase: each clip's time moves at its length over the
    /// weight-averaged length of the clips, so a walk and a run of different lengths keep their
    /// steps together. The layer's other base clips fade out over `blend.fade` seconds, and the
    /// blend's clips fade in. Clips that the layer's blend already plays keep their slots and
    /// their weights. The clips start at `blend.phase`, a share of their cycle, or else at the
    /// phase of the layer's blend, or of the first of `clips` that the layer plays. A
    /// `blend.value` sets the layer's blend value.
    pub fn play_blend(
        &mut self,
        instance: u32,
        clips: &[u32],
        points: &[f32],
        blend: Blend,
    ) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        check_options(blend.layer, blend.fade, blend.speed)?;
        let count = clips.len();
        if count == 0 || count > MAX_BLEND || points.len() != count {
            return Err(AnimationError::Play { option: 4 });
        }
        for (k, &clip) in clips.iter().enumerate() {
            if self.clip_skeleton(clip) != Some(skeleton) {
                return Err(AnimationError::UnknownClip { clip });
            }
            let source = self.clip_sources[clip as usize];
            if clips[..k]
                .iter()
                .any(|&c| self.clip_sources[c as usize] == source)
            {
                return Err(AnimationError::Play { option: 4 });
            }
            let point = points[k];
            if !point.is_finite() || points[..k].contains(&point) {
                return Err(AnimationError::Play { option: 5 });
            }
        }
        if blend.phase.is_some_and(|p| !p.is_finite()) {
            return Err(AnimationError::Play { option: 2 });
        }
        let first = instance as usize * MAX_BLEND;
        let layer = blend.layer as usize;
        let phase = blend
            .phase
            .unwrap_or_else(|| self.layer_phase(instance, layer, clips, blend.speed));
        // The blend's slots, by clip: those of the layer's blend that it keeps, then new ones.
        let mut slot_of = [usize::MAX; MAX_BLEND];
        let mut kept = 0u32;
        for (m, &clip) in clips.iter().enumerate() {
            let source = self.clip_sources[clip as usize];
            if let Some(s) = (first..first + MAX_BLEND)
                .find(|&s| self.actions[s].in_blend(layer) && self.slots.source[s] == source)
            {
                slot_of[m] = s;
                kept |= 1 << (s - first);
            }
        }
        let state = self.blend_state(instance, layer);
        for s in first..first + MAX_BLEND {
            let action = self.actions[s];
            if kept & (1 << (s - first)) != 0 || !action.plays_on(layer, 0) {
                continue;
            }
            if action.flags & flag::BLEND != 0 {
                self.leave_blend(s, &state);
            }
            self.fade_out(s, blend.fade);
        }
        let mut taken = kept;
        for slot in &mut slot_of[..count] {
            if *slot == usize::MAX {
                *slot = self.take_slot(first, taken);
                taken |= 1 << (*slot - first);
            }
        }
        for (m, &clip) in clips.iter().enumerate() {
            let s = slot_of[m];
            let existing = kept & (1 << (s - first)) != 0;
            let source = self.clip_sources[clip as usize];
            let action = &mut self.actions[s];
            let from = if existing { action.factor() } else { 0.0 };
            action.speed = blend.speed;
            action.flags = flag::PLAYING
                | flag::BLEND
                | if blend.looping { flag::LOOP } else { 0 }
                | ((layer as u32) << flag::LAYER_SHIFT);
            action.point = points[m];
            action.fade(from, 1.0, blend.fade);
            if !existing {
                self.slots.clip[s] = source;
                self.slots.weight[s] = 1.0;
                self.slots.source[s] = source;
            }
            let duration = self.clips[source as usize].duration();
            self.slots.time[s] = start_time(phase * duration, duration, blend.looping);
        }
        if let Some(value) = blend.value {
            self.blend_values[instance as usize * MAX_LAYERS + layer] = value;
        }
        Ok(())
    }

    /// Stops clip `clip` on instance `instance` on every layer, or with `None`, every clip. Each
    /// fades out over `fade` seconds from the weight it has, or stops at once when `fade` is 0. A
    /// clip of a blend leaves the blend with the weight and the rate it has.
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
        let source = clip.map(|c| self.clip_sources.get(c as usize).copied());
        let matches = |this: &Self, s: usize| {
            this.actions[s].playing() && source.is_none_or(|c| c == Some(this.slots.source[s]))
        };
        for layer in 0..MAX_LAYERS {
            let leaving = (first..first + MAX_BLEND)
                .filter(|&s| self.actions[s].in_blend(layer) && matches(self, s))
                .fold(0u32, |bits, s| bits | 1 << (s - first));
            if leaving != 0 {
                let state = self.blend_state(instance, layer);
                for k in 0..MAX_BLEND {
                    if leaving & (1 << k) != 0 {
                        self.leave_blend(first + k, &state);
                    }
                }
            }
        }
        for s in first..first + MAX_BLEND {
            if matches(self, s) {
                self.fade_out(s, fade);
            }
        }
        Ok(())
    }

    /// Fades out the clips of kind `kind` (base or additive) on layer `layer` of instance
    /// `instance`, all but slot `keep`, over `seconds`. A base play first ends the layer's
    /// blend: each of its clips keeps the weight and the rate it has.
    fn fade_out_layer(
        &mut self,
        instance: u32,
        layer: usize,
        kind: u32,
        seconds: f32,
        keep: Option<usize>,
    ) {
        let first = instance as usize * MAX_BLEND;
        if kind == 0 {
            let state = self.blend_state(instance, layer);
            for s in first..first + MAX_BLEND {
                if self.actions[s].in_blend(layer) {
                    self.leave_blend(s, &state);
                }
            }
        }
        for s in first..first + MAX_BLEND {
            if Some(s) != keep && self.actions[s].plays_on(layer, kind) {
                self.fade_out(s, seconds);
            }
        }
    }

    /// Takes slot `s` out of its layer's blend, whose weights and length `state` gives: its
    /// weight takes its share of the blend, and its speed the rate at which the blend moves it.
    fn leave_blend(&mut self, s: usize, state: &BlendState) {
        let k = s % MAX_BLEND;
        let duration = self.slot_duration(s);
        self.slots.weight[s] *= state.shares[k];
        let action = &mut self.actions[s];
        action.speed *= if state.length > 0.0 {
            duration / state.length
        } else {
            0.0
        };
        action.flags &= !flag::BLEND;
    }

    /// Fades slot `s` out over `seconds` from the weight it has, or frees it at once.
    fn fade_out(&mut self, s: usize, seconds: f32) {
        let action = &mut self.actions[s];
        if seconds > 0.0 {
            action.fade(action.factor(), 0.0, seconds);
        } else {
            *action = Action::default();
            self.slots.weight[s] = 0.0;
            self.slots.source[s] = NO_SOURCE;
        }
    }

    /// A slot of the instance whose slots start at `first` for a new clip, outside the slots that
    /// `taken`'s bits name: an empty slot, else the slot of a clip that fades out, else the slot
    /// whose clip counts least now. Among clips that fade out, the one that counts least.
    fn take_slot(&self, first: usize, taken: u32) -> usize {
        let open = (0..MAX_BLEND).filter(|k| taken & (1 << k) == 0);
        let empty =
            |k: &usize| !self.actions[first + k].playing() && !counts(self.slots.weight[first + k]);
        if let Some(k) = open.clone().find(empty) {
            return first + k;
        }
        let rank = |k: usize| {
            let action = &self.actions[first + k];
            let count = self.slots.weight[first + k] * action.factor();
            (!action.fading_out(), count)
        };
        open.min_by(|&a, &b| {
            let (a, b) = (rank(a), rank(b));
            a.0.cmp(&b.0).then(a.1.total_cmp(&b.1))
        })
        .map_or(first, |k| first + k)
    }

    /// The length of the clip in slot `s`, or 0 for a slot whose clip the table lacks.
    fn slot_duration(&self, s: usize) -> f32 {
        self.clips
            .get(self.slots.clip[s] as usize)
            .map_or(0.0, |c| c.duration())
    }

    /// The phase at which a new blend of `clips` on layer `layer` starts, as a share of the
    /// cycle: the phase of the layer's blend, or of the first of `clips` that the layer plays as
    /// a base clip, or the start, which a negative speed puts at the end.
    fn layer_phase(&self, instance: u32, layer: usize, clips: &[u32], speed: f32) -> f32 {
        let first = instance as usize * MAX_BLEND;
        let start = if speed < 0.0 { 1.0 } else { 0.0 };
        let phase_of = |s: usize| {
            let duration = self.slot_duration(s);
            let finished = self.actions[s].flags & flag::FINISHED != 0;
            (duration > 0.0 && !finished).then(|| self.slots.time[s] / duration)
        };
        let state = self.blend_state(instance, layer);
        if let Some(lead) = state.lead {
            return phase_of(first + lead).unwrap_or(start);
        }
        clips
            .iter()
            .find_map(|&clip| {
                let source = self.clip_sources[clip as usize];
                (first..first + MAX_BLEND)
                    .find(|&s| self.actions[s].plays_on(layer, 0) && self.slots.source[s] == source)
                    .and_then(phase_of)
            })
            .unwrap_or(start)
    }

    /// How layer `layer`'s blend of instance `instance` weighs its clips now.
    fn blend_state(&self, instance: u32, layer: usize) -> BlendState {
        let first = instance as usize * MAX_BLEND;
        let at = first..first + MAX_BLEND;
        let value = self.blend_values[instance as usize * MAX_LAYERS + layer];
        self.weigh_blend(
            first,
            layer,
            &self.actions[at.clone()],
            &self.slots.weight[at],
            value,
        )
    }

    /// How the blend of layer `layer` weighs its clips at blend value `value`, for the instance
    /// whose slots start at `first`, with its slots' `actions` and `weights`. A value below the
    /// lowest point gives the lowest point's clip in full, one above the highest the highest's,
    /// and NaN the lowest's.
    pub(super) fn weigh_blend(
        &self,
        first: usize,
        layer: usize,
        actions: &[Action],
        weights: &[f32],
        value: f32,
    ) -> BlendState {
        let mut state = BlendState {
            shares: [1.0; MAX_BLEND],
            length: 0.0,
            lead: None,
        };
        let value = if value.is_nan() {
            f32::NEG_INFINITY
        } else {
            value
        };
        let (mut below, mut above) = (None::<usize>, None::<usize>);
        for (k, action) in actions.iter().enumerate() {
            if !action.in_blend(layer) {
                continue;
            }
            state.shares[k] = 0.0;
            let point = action.point;
            if point <= value && below.is_none_or(|b| point > actions[b].point) {
                below = Some(k);
            }
            if point > value && above.is_none_or(|a| point < actions[a].point) {
                above = Some(k);
            }
        }
        match (below, above) {
            (Some(b), Some(a)) => {
                let (low, high) = (actions[b].point, actions[a].point);
                let t = ((value - low) / (high - low)).clamp(0.0, 1.0);
                state.shares[b] = 1.0 - t;
                state.shares[a] = t;
            }
            (Some(k), None) | (None, Some(k)) => state.shares[k] = 1.0,
            (None, None) => return state,
        }
        let (mut sum, mut total, mut longest) = (0.0f32, 0.0f32, 0.0f32);
        for (k, action) in actions.iter().enumerate() {
            let duration = self.slot_duration(first + k);
            if !action.in_blend(layer) || duration <= 0.0 {
                continue;
            }
            state.lead = state.lead.or(Some(k));
            longest = longest.max(duration);
            let w = state.shares[k] * weights[k];
            if counts(w) && w.is_finite() {
                sum += w * duration;
                total += w;
            }
        }
        state.length = if total > 0.0 { sum / total } else { longest };
        state
    }

    /// Advances an instance's played slots by `step` seconds of its time: each clip's time by
    /// the step times its speed, a blend's clips together by their shared phase, and each fade
    /// by the step. Reports the events that each clip's time passes, a loop each time a
    /// repeating clip starts again, and the end of a clip that plays once. Frees a slot whose
    /// fade out ends. A step or a move that is not finite moves nothing.
    pub(super) fn advance(&self, slots: &mut Advance<'_, '_>, step: f32) {
        let step = if step.is_finite() { step } else { 0.0 };
        slots.shares = [1.0; MAX_BLEND];
        let blends = slots
            .action
            .iter()
            .filter(|a| a.playing() && a.flags & flag::BLEND != 0)
            .fold(0u32, |bits, a| bits | 1 << a.layer().min(MAX_LAYERS - 1));
        for layer in 0..MAX_LAYERS {
            if blends & (1 << layer) != 0 {
                self.advance_blend(slots, layer, step);
            }
        }
        for k in 0..MAX_BLEND {
            let action = slots.action[k];
            if !action.playing() {
                continue;
            }
            // A slot whose clip id names no clip, as a direct write of the slot arrays can leave
            // it, is skipped, as sampling skips it.
            let clip = self.slots().clip[slots.instance as usize * MAX_BLEND + k];
            if self.clip_sources.get(clip as usize).is_none() {
                continue;
            }
            if action.flags & (flag::FINISHED | flag::BLEND) == 0 {
                let moved = step * action.speed;
                if moved != 0.0 && moved.is_finite() {
                    let looping = action.flags & flag::LOOP != 0;
                    self.advance_time(slots, k, moved, looping);
                }
            }
            let action = &mut slots.action[k];
            if action.fade_left > 0.0 {
                action.fade_left -= step.abs();
                if action.fade_left <= 0.0 || !action.fade_left.is_finite() {
                    action.fade_left = 0.0;
                    if action.fade_to <= 0.0 {
                        slots.free(k);
                    }
                }
            }
        }
    }

    /// Advances the clips of layer `layer`'s blend by `step` seconds: the phase moves by the
    /// step times the blend's speed over its weight-averaged length, and each clip by that share
    /// of its own length. Each clip's time then follows the lead clip's phase exactly, so the
    /// clips never drift apart. Records each slot's share of the blend.
    fn advance_blend(&self, slots: &mut Advance<'_, '_>, layer: usize, step: f32) {
        let instance = slots.instance as usize;
        let value = self.blend_values[instance * MAX_LAYERS + layer];
        let first = instance * MAX_BLEND;
        let state = self.weigh_blend(first, layer, slots.action, slots.weight, value);
        for k in 0..MAX_BLEND {
            if slots.action[k].in_blend(layer) {
                slots.shares[k] = state.shares[k];
            }
        }
        let Some(lead) = state.lead else {
            return;
        };
        let cycles = step * slots.action[lead].speed / state.length;
        if cycles != 0.0 && cycles.is_finite() {
            for k in 0..MAX_BLEND {
                let action = slots.action[k];
                let duration = self.slot_duration(first + k);
                if action.in_blend(layer) && action.flags & flag::FINISHED == 0 && duration > 0.0 {
                    let looping = action.flags & flag::LOOP != 0;
                    self.advance_time(slots, k, cycles * duration, looping);
                }
            }
        }
        let phase = slots.time[lead] / self.slot_duration(first + lead);
        for k in 0..MAX_BLEND {
            if k != lead && slots.action[k].in_blend(layer) {
                slots.time[k] = phase * self.slot_duration(first + k);
            }
        }
    }

    /// Moves slot `k`'s time by `moved` seconds of its clip, and reports what it passes. A time
    /// that is not finite starts again from the clip's start.
    fn advance_time(&self, slots: &mut Advance<'_, '_>, k: usize, moved: f32, looping: bool) {
        let instance = slots.instance as usize;
        let Some(&source) = self
            .clip_sources
            .get(self.slots().clip[instance * MAX_BLEND + k] as usize)
        else {
            return;
        };
        let duration = self.clips[source as usize].duration();
        let events = self.events_of(source);
        let backward = moved < 0.0;
        let t0 = if slots.time[k].is_finite() {
            slots.time[k].clamp(0.0, duration.max(0.0))
        } else {
            0.0
        };
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
                t1 = start_time(t1, duration, true);
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

/// Checks the options that every play takes: a layer below [`MAX_LAYERS`], a fade of 0 or more
/// seconds, and a finite speed.
fn check_options(layer: u32, fade: f32, speed: f32) -> Result<(), AnimationError> {
    if layer as usize >= MAX_LAYERS {
        return Err(AnimationError::Layer { layer });
    }
    if !(fade.is_finite() && fade >= 0.0) {
        return Err(AnimationError::Play { option: 0 });
    }
    if !speed.is_finite() {
        return Err(AnimationError::Play { option: 1 });
    }
    Ok(())
}

/// A clip's event times and ids.
#[derive(Clone, Copy)]
struct ClipEventsRef<'a> {
    times: &'a [f32],
    ids: &'a [u32],
}
