//! The check of what two-phase occlusion culling saves, which turns its passes off while they do
//! not pay, and on again when they do.
//!
//! The passes cost a depth draw of the occluders, a depth pyramid and a second culling dispatch,
//! and a chain of five dependent passes in place of three. They pay only where the pyramid hides
//! enough of the scene, and only where the GPU's frame gets shorter. Another program's work on the
//! GPU can fill the gaps between the extra passes, so a frame with them can take longer although
//! its opaque pass is shorter (decision record D-40). The check measures both, during play, and
//! never waits for the GPU:
//!
//! - The late culling phase counts the sources in view that would draw and those that the pyramid
//!   hides. A frame of the measured window copies the counts, with the first set of indirect
//!   draws, into a buffer that the GPU then reads into engine memory, a few frames later.
//! - The page hands the check the GPU's time for each frame that it finished: from the frame's
//!   submit to its completion, which includes any wait behind another program's work.
//!
//! The check runs the passes in one mode, on or off. Every [`PERIOD`] frames it runs a trial: a
//! few frames in the other mode. It compares the frame times of the trial's frames with those of
//! the frames just before it, which ran in the check's own mode. The passes pay while the pyramid
//! hides at least [`MIN_HIDDEN_PERCENT`] of the sources in view that would draw, and a frame with
//! them takes no longer than [`TOLERANCE_PERCENT`] past a frame without. The verdict sets the mode
//! until the next trial. Where no frame times come, the counts decide alone.
//!
//! The counts' readback also names the buckets that held occluders. The occluders' pass then draws
//! only those buckets, with those that held occluders in the last few readings, instead of every
//! bucket with a count of zero. A bucket that becomes an occluder between readings draws no depth
//! until the next reading, which hides less, never more.
//!
//! A test that compares the image with culling and without it holds the check: every frame then
//! runs the passes and copies its counts, so no frame of the comparison draws without them.
//!
//! The check rests while the camera's view holds still. A view is still while each frame records
//! what the frame two before it recorded, and only then does it accumulate and stop drawing. A
//! trial, or a frame that copies its counts, records other commands, so the view would never come
//! to rest. While it is still, each frame keeps the check's mode and copies nothing, and the next
//! trial comes [`FIRST_TRIAL`] frames after the view moves again.

use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, sizes};

use super::cull::{COUNTS_BYTES, counts_offset};
use super::ids;
use super::layout::Layout;
use crate::frame::{RecordError, address};
use crate::view::ViewId;

/// Frames from the check's first frame to its first trial, so the scene's start settles first.
const FIRST_TRIAL: u32 = 30;
/// Frames from one trial's start to the next's.
pub(super) const PERIOD: u32 = 120;
/// Frames at the start of a trial whose figures the check leaves out: the frames just after a
/// switch on choose their occluders from an old history, and a switch off leaves frames in flight.
const SETTLE: u32 = 2;
/// Frames of each window whose figures the check compares.
const WINDOW: u32 = 8;
/// The frames of a trial.
pub(super) const TRIAL: u32 = SETTLE + WINDOW;
/// Frames after a trial ends that the check waits for its figures at most. The counts land a few
/// frames after the frame that copied them, and the frame times when the GPU finishes each frame.
const WAIT: u32 = 60;
/// Frame times of each window that a comparison needs at least.
const MIN_TIMES: usize = 4;
/// The share of the sources in view that would draw which the pyramid must hide, at least, in
/// percent, for the passes to pay.
pub(super) const MIN_HIDDEN_PERCENT: u32 = 10;
/// How much longer a frame with the passes may take than a frame without, in percent of the
/// frame without, for the passes to pay. A margin within the frame times' noise keeps a scene
/// where both modes take the same time from switching at every trial.
pub(super) const TOLERANCE_PERCENT: u32 = 2;
/// Frame times that the check keeps, the newest ones. They cover a trial, the window before it and
/// the frames that the check may wait for its counts after it.
const TIMES: usize = 128;
const _: () = assert!(TIMES as u32 >= WINDOW + TRIAL + WAIT + SETTLE);
/// A frame time's place that holds none.
const NO_FRAME: u32 = u32::MAX;

/// What the check asks of a frame.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Plan {
    /// True when the frame runs the occlusion passes.
    pub(super) occlude: bool,
    /// True when the frame copies its counts for the check to read.
    pub(super) read: bool,
}

/// A window of frames, from `start` to before `end`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Window {
    start: u32,
    end: u32,
}

impl Window {
    fn holds(self, frame: u32) -> bool {
        frame >= self.start && frame < self.end
    }
}

/// A trial whose verdict waits for its figures: the window that ran the passes, the window that
/// did not, and the frame after which it decides with what has come.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Pending {
    on: Window,
    off: Window,
    deadline: u32,
}

/// The counts that a frame's late culling phase made: the sources in view that would draw, and
/// those that the pyramid hid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Counts {
    pub(super) frame: u32,
    pub(super) tested: u32,
    pub(super) hidden: u32,
}

/// Why the check chose its mode at its last verdict, for tests and for the page's figures.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Verdict {
    /// The share of the sources that the pyramid hid, in percent, where the counts came.
    pub(super) hidden_percent: Option<u32>,
    /// The median frame times with the passes and without, in microseconds, where both came.
    pub(super) times: Option<(u32, u32)>,
    /// True when the passes paid.
    pub(super) pays: bool,
}

/// The check's state.
#[derive(Debug)]
pub(super) struct OcclusionCheck {
    /// True while the check's mode runs the passes.
    on: bool,
    /// True while a test holds the passes on in every frame, with no trials.
    held: bool,
    /// The frame that the next trial starts at, once the check has seen a frame.
    next_trial: Option<u32>,
    pending: Option<Pending>,
    /// The newest frame times: each frame and its time in microseconds.
    times: [(u32, u32); TIMES],
    next_time: usize,
    /// The newest counts that landed.
    counts: Option<Counts>,
    /// The start of the trial whose window with the passes copied its counts.
    read_for: Option<u32>,
    /// The frame that the last plan was made for, and that plan, so a frame recorded twice gets
    /// the same one.
    planned: Option<(u32, Plan)>,
    verdict: Option<Verdict>,
}

impl Default for OcclusionCheck {
    fn default() -> Self {
        Self {
            on: true,
            held: false,
            next_trial: None,
            pending: None,
            times: [(NO_FRAME, 0); TIMES],
            next_time: 0,
            counts: None,
            read_for: None,
            planned: None,
            verdict: None,
        }
    }
}

impl OcclusionCheck {
    /// True while the check's mode runs the passes, outside its trials.
    pub(super) fn on(&self) -> bool {
        self.on
    }

    /// Holds the passes on in every frame, each frame copying its counts, or lets the check judge
    /// them again from its next frame on.
    pub(super) fn hold(&mut self, held: bool) {
        self.held = held;
        self.on = true;
        self.next_trial = None;
        self.pending = None;
        self.planned = None;
    }

    /// The last verdict, once a trial was judged.
    #[cfg(test)]
    pub(super) fn verdict(&self) -> Option<Verdict> {
        self.verdict
    }

    /// The newest counts that landed.
    pub(super) fn counts(&self) -> Option<Counts> {
        self.counts
    }

    /// Notes the GPU's time for frame `frame`, from its submit to its completion, in microseconds.
    pub(super) fn time(&mut self, frame: u32, micros: u32) {
        self.times[self.next_time] = (frame, micros);
        self.next_time = (self.next_time + 1) % TIMES;
    }

    /// Notes counts that landed.
    pub(super) fn land(&mut self, counts: Counts) {
        self.counts = Some(counts);
    }

    /// Notes that the frame that asked for its counts copied them, so the frames after it in the
    /// window ask no more.
    pub(super) fn read_recorded(&mut self) {
        self.read_for = self.next_trial;
    }

    /// What frame `frame` does while the camera's view holds still: the check's mode, with no
    /// trial and no copy of the counts. A trial that runs is dropped, and the next one starts
    /// [`FIRST_TRIAL`] frames after the first frame that moves. A frame recorded again gets the
    /// plan it got first.
    pub(super) fn rest(&mut self, frame: u32) -> Plan {
        if let Some((planned, plan)) = self.planned
            && planned == frame
        {
            return plan;
        }
        self.next_trial = None;
        self.pending = None;
        let plan = Plan {
            occlude: self.on,
            read: false,
        };
        self.planned = Some((frame, plan));
        plan
    }

    /// What frame `frame` does. It judges a trial whose figures have come, or whose wait ended,
    /// and starts and ends trials. A frame recorded again gets the plan it got first.
    pub(super) fn plan(&mut self, frame: u32) -> Plan {
        if let Some((planned, plan)) = self.planned
            && planned == frame
        {
            return plan;
        }
        if self.held {
            return Plan {
                occlude: true,
                read: true,
            };
        }
        let next = *self.next_trial.get_or_insert(frame + FIRST_TRIAL);
        if let Some(pending) = self.pending
            && (frame >= pending.deadline || self.ready(&pending))
        {
            self.judge(&pending);
            self.pending = None;
        }
        // A frame past the trial's end closes it, and the next trial starts a period after it.
        let mut next = next;
        if frame >= next + TRIAL {
            if self.pending.is_none() {
                let trial = Window {
                    start: next + SETTLE,
                    end: next + TRIAL,
                };
                let before = Window {
                    start: next.saturating_sub(WINDOW),
                    end: next,
                };
                let (on, off) = if self.on {
                    (before, trial)
                } else {
                    (trial, before)
                };
                self.pending = Some(Pending {
                    on,
                    off,
                    deadline: frame + WAIT,
                });
            }
            while frame >= next + TRIAL {
                next += PERIOD;
            }
            self.next_trial = Some(next);
        }
        let in_trial = frame >= next && frame < next + TRIAL;
        let occlude = self.on != in_trial;
        // The measured window that runs the passes asks for its counts until a frame copies them:
        // the window before a trial while the check is on, or the trial's own while it is off.
        let measured = if self.on {
            frame >= next.saturating_sub(WINDOW) && frame < next
        } else {
            frame >= next + SETTLE && in_trial
        };
        let read = occlude && measured && self.read_for != Some(next);
        let plan = Plan { occlude, read };
        self.planned = Some((frame, plan));
        plan
    }

    /// True once a trial's figures have come: counts from its window with the passes, and enough
    /// frame times from both windows.
    fn ready(&self, pending: &Pending) -> bool {
        let counted = self.counts.is_some_and(|c| pending.on.holds(c.frame));
        counted
            && self.times_in(pending.on).1 >= MIN_TIMES
            && self.times_in(pending.off).1 >= MIN_TIMES
    }

    /// The median frame time of the frames of `window`, and how many came.
    fn times_in(&self, window: Window) -> (u32, usize) {
        let mut found = [0u32; TIMES];
        let mut count = 0;
        for &(frame, micros) in &self.times {
            if frame != NO_FRAME && window.holds(frame) {
                found[count] = micros;
                count += 1;
            }
        }
        let found = &mut found[..count];
        found.sort_unstable();
        (found.get(count / 2).copied().unwrap_or(0), count)
    }

    /// Sets the mode from a trial's figures. Without counts from its window with the passes, the
    /// passes may not have run, so the frame times alone decide, and with neither the mode stays.
    fn judge(&mut self, pending: &Pending) {
        let counts = self.counts.filter(|c| pending.on.holds(c.frame));
        let (on_time, on_count) = self.times_in(pending.on);
        let (off_time, off_count) = self.times_in(pending.off);
        let times =
            (on_count >= MIN_TIMES && off_count >= MIN_TIMES).then_some((on_time, off_time));
        if counts.is_none() && times.is_none() {
            return;
        }
        let hidden_percent = counts.map(|c| {
            if c.tested == 0 {
                0
            } else {
                (u64::from(c.hidden) * 100 / u64::from(c.tested)) as u32
            }
        });
        let hides = hidden_percent.is_none_or(|percent| percent >= MIN_HIDDEN_PERCENT);
        let quicker = times.is_none_or(|(on, off)| {
            u64::from(on) * 100 <= u64::from(off) * u64::from(100 + TOLERANCE_PERCENT)
        });
        let pays = hides && quicker;
        self.on = pays;
        self.verdict = Some(Verdict {
            hidden_percent,
            times,
            pays,
        });
    }
}

/// Reads of a view's buffers that may wait for the GPU at once: one lands while the next waits.
pub(super) const READ_RING: usize = 2;
/// The draws of the first set whose counts a read takes at most. A layout with more reads only
/// its counts, and its occluders' pass draws every bucket that draws depth.
const MAX_READ_DRAWS: u32 = 4096;
/// The draws of the pieces and of their buckets' tallies whose counts a read takes at most. A
/// layout with more reads none of them, and the check of what pieces cull keeps its modes.
pub(super) const MAX_PIECE_DRAWS: u32 = 2048;
/// The bytes of a read's destination: the counts, then the first set's draws, then the first set's
/// draws of the pieces and their tallies.
const READ_BYTES: usize =
    (COUNTS_BYTES + (MAX_READ_DRAWS + MAX_PIECE_DRAWS) * sizes::INDIRECT_WORDS * 4) as usize;
/// Frames that a read may wait before the check gives it up and reads into the ring's other
/// buffer. A list that never draws, as after a lost GPU, never lands its read.
const READ_TIMEOUT: u32 = 90;

/// A read that waits: the frame whose counts it copies, its buffer of the ring, the layout of its
/// draws, and the bytes of draws that it copied.
#[derive(Clone, Copy, Debug)]
struct WaitingRead {
    frame: u32,
    ring: usize,
    layout: u32,
    draw_bytes: u32,
    /// True for a read that the occlusion check asked for, whose counts it takes.
    occlusion: bool,
    piece_bytes: u32,
}

/// The reads of a view's counts and first set of draws into engine memory.
#[derive(Debug, Default)]
pub(super) struct CountReads {
    /// Whether each buffer of the ring exists, and whether a read into it may still land.
    made: [bool; READ_RING],
    waiting: [bool; READ_RING],
    next: usize,
    read: Option<WaitingRead>,
    /// The frame that the last read copied, so a frame recorded again copies its counts no more:
    /// that copy's read would never land, and would hold back the reads after it.
    recorded: u32,
    /// Where reads land, made at the first read and kept, so a read that lands late never writes
    /// into memory that was given back.
    landing: Option<Box<[u8]>>,
    /// The control slot that a landed read raises. Nothing reads it, as the words that land name
    /// their frame. 0 records no read.
    slot: u32,
}

/// What a read brought: the counts, the first set's draws where they fit, and the first set's
/// draws of the pieces and their tallies where the read took them.
pub(super) struct Landed<'a> {
    pub(super) counts: Counts,
    /// True for a read that the occlusion check asked for, whose counts it takes.
    pub(super) occlusion: bool,
    /// The first set of draws' words, five per draw, of the layout that `layout` names, or none.
    pub(super) draws: &'a [u8],
    /// The words of the first set's draws from the layout's first draw of a piece on, five per
    /// draw, or none.
    pub(super) pieces: &'a [u8],
    pub(super) layout: u32,
}

impl CountReads {
    /// Reads land by raising control slot `slot`.
    pub(super) fn set_slot(&mut self, slot: u32) {
        self.slot = slot;
    }

    /// Records a read of `view`'s counts of frame `frame`, after the frame's passes, from where a
    /// view that culls in `two_phases` or in one keeps them: for the
    /// occlusion check with `occlusion`, its first set of draws too while the layout has at most
    /// [`MAX_READ_DRAWS`] draws, and with `pieces` the first set's draws of the pieces and their
    /// tallies while they number at most [`MAX_PIECE_DRAWS`]. `layout_epoch` names the layout, so
    /// draws that land for an older one are left out. Records nothing while another read waits,
    /// for a frame that recorded its read already, or while no slot is set. Returns true when it
    /// recorded the read.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn record(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        layout: &Layout,
        layout_epoch: u32,
        frame: u32,
        two_phases: bool,
        occlusion: bool,
        pieces: bool,
    ) -> Result<bool, RecordError> {
        if self.slot == 0 || frame == 0 || frame == self.recorded {
            return Ok(false);
        }
        if let Some(read) = self.read {
            if frame.wrapping_sub(read.frame) < READ_TIMEOUT {
                return Ok(false);
            }
            self.read = None;
        }
        let draws = layout.draws.len() as u32;
        let draw_bytes = if occlusion && draws <= MAX_READ_DRAWS {
            draws * sizes::INDIRECT_WORDS * 4
        } else {
            0
        };
        let piece_draws = draws - layout.first_piece_draw.min(draws);
        let piece_bytes = if pieces && piece_draws <= MAX_PIECE_DRAWS {
            piece_draws * sizes::INDIRECT_WORDS * 4
        } else {
            0
        };
        let bytes = COUNTS_BYTES + draw_bytes + piece_bytes;
        let ring = self.next;
        let buffer = ids::OCCLUSION_READ_BUFFERS + ring as u32;
        // The first read makes every buffer of the ring, each at the largest read's size, so a
        // read later in play makes no GPU object. A buffer whose read never landed is made again,
        // which drops that read.
        for (index, made) in self.made.iter_mut().enumerate() {
            if !*made || (index == ring && self.waiting[index]) {
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids::OCCLUSION_READ_BUFFERS + index as u32,
                        READ_BYTES as u32,
                        usage::MAP_READ | usage::COPY_DST,
                    ],
                )?;
                *made = true;
            }
        }
        let landing = self
            .landing
            .get_or_insert_with(|| vec![0; READ_BYTES].into_boxed_slice());
        let indirect = ids::indirect(view);
        list.push(
            Op::CopyBufferToBuffer,
            &[
                indirect,
                counts_offset(layout, two_phases),
                buffer,
                0,
                COUNTS_BYTES,
            ],
        )?;
        if draw_bytes > 0 {
            list.push(
                Op::CopyBufferToBuffer,
                &[indirect, 0, buffer, COUNTS_BYTES, draw_bytes],
            )?;
        }
        if piece_bytes > 0 {
            list.push(
                Op::CopyBufferToBuffer,
                &[
                    indirect,
                    layout.first_piece_draw * sizes::INDIRECT_WORDS * 4,
                    buffer,
                    COUNTS_BYTES + draw_bytes,
                    piece_bytes,
                ],
            )?;
        }
        list.push(
            Op::ReadBuffer,
            &[buffer, 0, bytes, address(landing), self.slot],
        )?;
        // The copies read the indirect draws that the next frame's uploads write, so they go to
        // the GPU first. A read of the pieces' counts alone goes with the frame's own submit: a
        // submit inside a frame ends the frame's GPU timing there, and those reads come every few
        // frames.
        if occlusion {
            list.push(Op::Submit, &[])?;
        }
        self.waiting[ring] = true;
        self.next = (ring + 1) % READ_RING;
        self.recorded = frame;
        self.read = Some(WaitingRead {
            frame,
            ring,
            layout: layout_epoch,
            draw_bytes,
            occlusion,
            piece_bytes,
        });
        Ok(true)
    }

    /// The read that landed since the last call, if one did: its words name the frame that the
    /// waiting read copied.
    pub(super) fn take(&mut self) -> Option<Landed<'_>> {
        let read = self.read?;
        let landing = self.landing.as_ref()?;
        let word = |k: usize| {
            let at = k * 4;
            u32::from_le_bytes([
                landing[at],
                landing[at + 1],
                landing[at + 2],
                landing[at + 3],
            ])
        };
        if word(2) != read.frame {
            return None;
        }
        self.read = None;
        self.waiting[read.ring] = false;
        let start = COUNTS_BYTES as usize;
        let pieces = start + read.draw_bytes as usize;
        Some(Landed {
            counts: Counts {
                frame: read.frame,
                tested: word(0),
                hidden: word(1),
            },
            occlusion: read.occlusion,
            draws: &landing[start..pieces],
            pieces: &landing[pieces..pieces + read.piece_bytes as usize],
            layout: read.layout,
        })
    }

    /// Forgets the GPU's buffers after the thread that draws replaced the GPU. A read in flight
    /// never lands.
    pub(super) fn forget_gpu(&mut self) {
        self.made = [false; READ_RING];
        self.waiting = [false; READ_RING];
        self.read = None;
    }
}

/// Readings for which a bucket that held occluders stays in the occluders' pass after it holds
/// none.
const HOLD_READINGS: u8 = 3;

/// The buckets that the occluders' pass draws: those that held occluders in the last few readings.
#[derive(Debug, Default)]
pub(super) struct OccluderBuckets {
    /// The readings left for each bucket, by bucket: 0 for a bucket that the pass leaves out.
    holds: Vec<u8>,
    /// True when the set changed since the occluders' bundle was last recorded.
    changed: bool,
}

impl OccluderBuckets {
    /// Starts with every bucket of `layout` that draws depth in the occluders' pass, as a new
    /// layout has no reading yet. Runs when the layout is built, not in a steady frame.
    pub(super) fn reset(&mut self, layout: &Layout) {
        self.holds.clear();
        self.holds
            .extend((0..layout.buckets.len() as u32).map(|bucket| {
                if layout.bucket_occludes(bucket) {
                    HOLD_READINGS
                } else {
                    0
                }
            }));
        self.changed = true;
    }

    /// Takes in a reading of the first set of draws: `draws` holds five words per draw of
    /// `layout`.
    pub(super) fn update(&mut self, layout: &Layout, draws: &[u8]) {
        let count = |draw: u32| {
            let at = (draw * sizes::INDIRECT_WORDS + 1) as usize * 4;
            draws
                .get(at..at + 4)
                .map_or(0, |b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        for (b, bucket) in layout.buckets.iter().enumerate() {
            let Some(hold) = self.holds.get_mut(b) else {
                break;
            };
            let held = *hold > 0;
            if layout.bucket_occludes(b as u32) && count(bucket.first_draw) > 0 {
                *hold = HOLD_READINGS;
            } else {
                *hold = hold.saturating_sub(1);
            }
            self.changed |= held != (*hold > 0);
        }
    }

    /// True when the occluders' pass draws bucket `bucket`.
    pub(super) fn draws(&self, bucket: usize) -> bool {
        self.holds.get(bucket).is_some_and(|&hold| hold > 0)
    }

    /// True once after the set changed, for the frame that records the bundle again.
    pub(super) fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scene as the check sees it: the GPU's time for a frame with the passes and without, in
    /// microseconds, and the share of the sources that the pyramid hides, in percent.
    #[derive(Clone, Copy)]
    struct Scene {
        on_micros: u32,
        off_micros: u32,
        hidden_percent: u32,
    }

    /// Runs the check over `frames` frames from `first` on, as the renderer and the page feed it:
    /// each frame's time lands two frames later, and a frame's counts three frames later. Returns
    /// each frame's plan.
    fn run(check: &mut OcclusionCheck, scene: Scene, first: u32, frames: u32) -> Vec<Plan> {
        let mut plans = Vec::new();
        let mut reads = Vec::new();
        for frame in first..first + frames {
            let plan = check.plan(frame);
            if plan.read {
                check.read_recorded();
                reads.push(frame);
            }
            plans.push(plan);
            if frame >= first + 2 {
                let done = frame - 2;
                let occluded = plans[(done - first) as usize].occlude;
                let micros = if occluded {
                    scene.on_micros
                } else {
                    scene.off_micros
                };
                check.time(done, micros);
            }
            if let Some(&read) = reads.first()
                && frame >= read + 3
            {
                reads.remove(0);
                check.land(Counts {
                    frame: read,
                    tested: 1000,
                    hidden: scene.hidden_percent * 10,
                });
            }
        }
        plans
    }

    const PAYS: Scene = Scene {
        on_micros: 900,
        off_micros: 1000,
        hidden_percent: 60,
    };

    #[test]
    fn a_held_check_runs_the_passes_and_reads_their_counts_in_every_frame() {
        let mut check = OcclusionCheck::default();
        check.hold(true);
        // Passes that cost more and hide nothing would turn off at the first trial.
        let costly = Scene {
            on_micros: 2000,
            off_micros: 1000,
            hidden_percent: 0,
        };
        let plans = run(&mut check, costly, 1, FIRST_TRIAL + 3 * PERIOD);
        assert!(plans.iter().all(|plan| plan.occlude && plan.read));
        // Let go, the check runs its trials again.
        check.hold(false);
        let plans = run(&mut check, costly, 1000, FIRST_TRIAL + TRIAL + 1);
        assert!(plans.iter().any(|plan| !plan.occlude));
    }

    #[test]
    fn a_still_view_keeps_the_mode_with_no_trial_or_read_until_it_moves() {
        let mut check = OcclusionCheck::default();
        let plans = run(&mut check, PAYS, 1, FIRST_TRIAL - 5);
        assert!(plans.iter().all(|plan| plan.occlude));
        // Still from here on, past the frames where the first trial and its reads would come.
        let still = FIRST_TRIAL - 4..FIRST_TRIAL + 3 * PERIOD;
        for frame in still.clone() {
            assert_eq!(
                check.rest(frame),
                Plan {
                    occlude: true,
                    read: false,
                },
            );
        }
        // A frame recorded again keeps its plan.
        assert_eq!(check.rest(still.end - 1), check.plan(still.end - 1));
        // Moving again, the first trial comes FIRST_TRIAL frames later.
        let moved = still.end;
        let plans = run(&mut check, PAYS, moved, FIRST_TRIAL + TRIAL);
        let off: Vec<u32> = (moved..)
            .zip(&plans)
            .filter(|(_, plan)| !plan.occlude)
            .map(|(frame, _)| frame)
            .collect();
        let start = moved + FIRST_TRIAL;
        assert_eq!(off, (start..start + TRIAL).collect::<Vec<_>>());
    }

    #[test]
    fn the_passes_run_until_the_first_trial_which_turns_them_off_for_a_few_frames() {
        let mut check = OcclusionCheck::default();
        let plans = run(&mut check, PAYS, 1, FIRST_TRIAL + TRIAL + 1);
        let off: Vec<u32> = (1..)
            .zip(&plans)
            .filter(|(_, plan)| !plan.occlude)
            .map(|(frame, _)| frame)
            .collect();
        let start = 1 + FIRST_TRIAL;
        assert_eq!(off, (start..start + TRIAL).collect::<Vec<_>>());
        // The window before the trial copies its counts once, at its first frame.
        let reads: Vec<u32> = (1..)
            .zip(&plans)
            .filter(|(_, plan)| plan.read)
            .map(|(frame, _)| frame)
            .collect();
        assert_eq!(reads, [start - WINDOW]);
    }

    #[test]
    fn passes_that_hide_much_and_shorten_the_frame_stay_on() {
        let mut check = OcclusionCheck::default();
        run(&mut check, PAYS, 1, FIRST_TRIAL + 3 * PERIOD);
        assert!(check.on());
        let verdict = check.verdict().expect("a verdict");
        assert_eq!(verdict.hidden_percent, Some(60));
        assert_eq!(verdict.times, Some((900, 1000)));
        assert!(verdict.pays);
    }

    #[test]
    fn passes_that_lengthen_the_frame_turn_off_and_run_only_in_their_trials() {
        // Another program's GPU work fills the gaps between the extra passes: the pyramid hides
        // most of the scene, but the frame takes longer.
        let loaded = Scene {
            on_micros: 3800,
            off_micros: 2500,
            hidden_percent: 94,
        };
        let mut check = OcclusionCheck::default();
        let frames = FIRST_TRIAL + 4 * PERIOD;
        let plans = run(&mut check, loaded, 1, frames);
        assert!(!check.on());
        assert_eq!(check.verdict().map(|v| v.pays), Some(false));
        // After the first verdict, only the trials run the passes: a tenth of the frames or less.
        let later = &plans[(FIRST_TRIAL + PERIOD) as usize..];
        let on = later.iter().filter(|plan| plan.occlude).count() as u32;
        assert!(
            on * PERIOD <= TRIAL * later.len() as u32 + TRIAL * PERIOD,
            "{on} frames on"
        );
    }

    #[test]
    fn a_frame_within_the_tolerance_keeps_the_passes_on() {
        let even = Scene {
            on_micros: 1015,
            off_micros: 1000,
            hidden_percent: 50,
        };
        let mut check = OcclusionCheck::default();
        run(&mut check, even, 1, FIRST_TRIAL + 2 * PERIOD);
        assert!(check.on());
    }

    #[test]
    fn passes_that_hide_too_little_turn_off_though_the_frame_is_no_longer() {
        let open = Scene {
            on_micros: 1000,
            off_micros: 1000,
            hidden_percent: MIN_HIDDEN_PERCENT - 1,
        };
        let mut check = OcclusionCheck::default();
        run(&mut check, open, 1, FIRST_TRIAL + 2 * PERIOD);
        assert!(!check.on());
        assert_eq!(
            check.verdict().and_then(|v| v.hidden_percent),
            Some(MIN_HIDDEN_PERCENT - 1)
        );
    }

    #[test]
    fn a_trial_that_finds_the_passes_paying_again_turns_them_back_on() {
        let mut check = OcclusionCheck::default();
        let loaded = Scene {
            on_micros: 3000,
            off_micros: 2000,
            hidden_percent: 90,
        };
        let frames = FIRST_TRIAL + 2 * PERIOD;
        run(&mut check, loaded, 1, frames);
        assert!(!check.on());
        // The other program stops: the next trial, which runs the passes, finds them paying.
        let quiet = Scene {
            on_micros: 1500,
            off_micros: 2000,
            hidden_percent: 90,
        };
        run(&mut check, quiet, 1 + frames, 2 * PERIOD);
        assert!(check.on());
    }

    #[test]
    fn without_frame_times_the_counts_decide_alone() {
        let mut check = OcclusionCheck::default();
        let mut reads = Vec::new();
        for frame in 1..FIRST_TRIAL + 2 * PERIOD {
            let plan = check.plan(frame);
            if plan.read {
                check.read_recorded();
                reads.push(frame);
            }
            if let Some(&read) = reads.first()
                && frame >= read + 3
            {
                reads.remove(0);
                check.land(Counts {
                    frame: read,
                    tested: 100,
                    hidden: 5,
                });
            }
        }
        assert!(!check.on());
        assert_eq!(check.verdict().and_then(|v| v.times), None);
    }

    #[test]
    fn without_figures_the_mode_stays() {
        let mut check = OcclusionCheck::default();
        for frame in 1..FIRST_TRIAL + 3 * PERIOD {
            check.plan(frame);
        }
        assert!(check.on());
        assert_eq!(check.verdict(), None);
    }

    #[test]
    fn a_frame_recorded_again_gets_the_same_plan() {
        let mut check = OcclusionCheck::default();
        let start = 1 + FIRST_TRIAL;
        for frame in 1..start - WINDOW {
            check.plan(frame);
        }
        let first = check.plan(start - WINDOW);
        assert!(first.read && first.occlude);
        assert_eq!(check.plan(start - WINDOW), first);
        check.read_recorded();
        assert!(!check.plan(start - WINDOW + 1).read);
        // Frames that the engine skips still close the trial.
        let after = check.plan(start + TRIAL + 5);
        assert!(after.occlude);
    }

    /// The first set of draws' words for a layout of a draw per bucket, with each bucket's count.
    fn draws_with(counts: &[u32]) -> Vec<u8> {
        counts
            .iter()
            .flat_map(|&count| [6, count, 0, 0, 0])
            .flat_map(u32::to_le_bytes)
            .collect()
    }

    #[test]
    fn the_occluders_pass_draws_the_buckets_that_held_occluders_in_the_last_readings() {
        // Buckets 0, 1 and 3 draw depth; bucket 2, a blended or custom surface, never does.
        let layout = Layout::with_occluder_buckets(&[true, true, false, true]);
        let mut buckets = OccluderBuckets::default();
        buckets.reset(&layout);
        let drawn =
            |buckets: &OccluderBuckets| (0..4).map(|b| buckets.draws(b)).collect::<Vec<_>>();
        // A new layout has no reading, so the pass draws every bucket that draws depth.
        assert_eq!(drawn(&buckets), [true, true, false, true]);
        assert!(buckets.take_changed());
        assert!(!buckets.take_changed());
        // Only bucket 1 held occluders: the others stay for a few readings, then leave.
        for reading in 1..=HOLD_READINGS {
            buckets.update(&layout, &draws_with(&[0, 2, 5, 0]));
            let left = reading == HOLD_READINGS;
            assert_eq!(
                drawn(&buckets),
                [!left, true, false, !left],
                "reading {reading}"
            );
            assert_eq!(buckets.take_changed(), left);
        }
        // A bucket that holds occluders again comes back at once.
        buckets.update(&layout, &draws_with(&[1, 0, 0, 0]));
        assert_eq!(drawn(&buckets), [true, true, false, false]);
        assert!(buckets.take_changed());
    }

    /// The buffers of the read ring that a list copies into.
    fn copied_into(list: &DrawList) -> Vec<u32> {
        null3d_gpu::drawlist::decode(list.words())
            .map(Result::unwrap)
            .filter(|command| command.op == Op::CopyBufferToBuffer)
            .map(|command| command.operands[2])
            .collect()
    }

    #[test]
    fn a_frame_recorded_again_after_its_read_landed_copies_its_counts_no_more() {
        let layout = Layout::with_occluder_buckets(&[true]);
        let mut reads = CountReads::default();
        reads.set_slot(60);
        let mut list = DrawList::with_capacity(256);
        let view = ViewId::CAMERA;
        assert!(
            reads
                .record(&mut list, view, &layout, 1, 40, true, true, false)
                .unwrap()
        );
        assert_eq!(copied_into(&list), [ids::OCCLUSION_READ_BUFFERS]);
        // While the read waits, the frame recorded again copies nothing.
        list.clear();
        assert!(
            !reads
                .record(&mut list, view, &layout, 1, 40, true, true, false)
                .unwrap()
        );
        assert!(copied_into(&list).is_empty());
        // The read lands: its words name the frame that it copied.
        let landing = reads.landing.as_mut().expect("the landing memory");
        landing[8..12].copy_from_slice(&40u32.to_le_bytes());
        assert_eq!(reads.take().map(|landed| landed.counts.frame), Some(40));
        // The frame recorded once more still copies nothing, as the GPU draws it from the list
        // that read already, and the next frame reads into the ring's other buffer.
        assert!(
            !reads
                .record(&mut list, view, &layout, 1, 40, true, true, false)
                .unwrap()
        );
        assert!(copied_into(&list).is_empty());
        assert!(
            reads
                .record(&mut list, view, &layout, 1, 41, true, true, false)
                .unwrap()
        );
        assert_eq!(copied_into(&list), [ids::OCCLUSION_READ_BUFFERS + 1]);
    }

    #[test]
    fn the_first_read_makes_every_buffer_of_the_ring_and_later_reads_make_none() {
        let made = |list: &DrawList| -> Vec<(u32, u32)> {
            null3d_gpu::drawlist::decode(list.words())
                .map(Result::unwrap)
                .filter(|command| command.op == Op::CreateBuffer)
                .map(|command| (command.operands[0], command.operands[1]))
                .collect()
        };
        let layout = Layout::with_occluder_buckets(&[true]);
        let mut reads = CountReads::default();
        reads.set_slot(60);
        let mut list = DrawList::with_capacity(256);
        let view = ViewId::CAMERA;
        // A read of the pieces alone comes first, and is the smallest read.
        assert!(
            reads
                .record(&mut list, view, &layout, 1, 40, true, false, true)
                .unwrap()
        );
        let ring: Vec<(u32, u32)> = (0..READ_RING as u32)
            .map(|index| (ids::OCCLUSION_READ_BUFFERS + index, READ_BYTES as u32))
            .collect();
        assert_eq!(made(&list), ring);
        // The reads that follow, the occlusion check's among them, land in those buffers.
        for frame in 41..45 {
            let landing = reads.landing.as_mut().expect("the landing memory");
            landing[8..12].copy_from_slice(&(frame - 1u32).to_le_bytes());
            assert!(reads.take().is_some());
            list.clear();
            assert!(
                reads
                    .record(&mut list, view, &layout, 1, frame, true, true, true)
                    .unwrap()
            );
            assert!(made(&list).is_empty(), "frame {frame}");
        }
    }

    #[test]
    fn a_read_of_the_pieces_alone_takes_their_draws_and_leaves_the_occlusion_check_out() {
        let mut layout = Layout::with_occluder_buckets(&[true, false, false]);
        layout.draws = (0..3)
            .map(|_| super::super::layout::Draw {
                page: 0,
                index_count: 3,
                first_index: 0,
                base_vertex: 0,
                vertices: None,
            })
            .collect();
        layout.first_piece_draw = 1;
        let mut reads = CountReads::default();
        reads.set_slot(60);
        let mut list = DrawList::with_capacity(256);
        let view = ViewId::CAMERA;
        assert!(
            reads
                .record(&mut list, view, &layout, 1, 50, false, false, true)
                .unwrap()
        );
        // The counts and the draws from the first piece's on, without the first set's draws. The
        // view culls in one phase, so its counts follow its one set of draws.
        let copies: Vec<[u32; 5]> = null3d_gpu::drawlist::decode(list.words())
            .map(Result::unwrap)
            .filter(|command| command.op == Op::CopyBufferToBuffer)
            .map(|command| command.operands[..5].try_into().unwrap())
            .collect();
        let piece_bytes = 2 * sizes::INDIRECT_WORDS * 4;
        assert_eq!(copies.len(), 2);
        assert_eq!(
            copies[0],
            [
                ids::indirect(view),
                3 * sizes::INDIRECT_WORDS * 4,
                ids::OCCLUSION_READ_BUFFERS,
                0,
                COUNTS_BYTES
            ]
        );
        assert_eq!(
            copies[1],
            [
                ids::indirect(view),
                sizes::INDIRECT_WORDS * 4,
                ids::OCCLUSION_READ_BUFFERS,
                COUNTS_BYTES,
                piece_bytes
            ]
        );
        let landing = reads.landing.as_mut().expect("the landing memory");
        landing[8..12].copy_from_slice(&50u32.to_le_bytes());
        let landed = reads.take().expect("the read landed");
        assert!(!landed.occlusion);
        assert!(landed.draws.is_empty());
        assert_eq!(landed.pieces.len(), piece_bytes as usize);
    }

    #[test]
    fn the_median_frame_time_of_a_window_leaves_out_other_frames() {
        let mut check = OcclusionCheck::default();
        for (frame, micros) in [(10, 900), (11, 5000), (12, 950), (13, 1000), (30, 1)] {
            check.time(frame, micros);
        }
        let window = Window { start: 10, end: 14 };
        assert_eq!(check.times_in(window), (1000, 4));
    }
}
