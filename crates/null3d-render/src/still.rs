//! Still-camera accumulation: the sub-pixel jitter that sharpens a view that does not move, and the
//! state that says how still a view is (M2-F11).
//!
//! A view that keeps its camera draws the same scene every frame. Drawing each frame with the
//! camera's projection moved by a different fraction of a pixel, and averaging the frames, is a
//! form of supersampling: edges and fine detail converge on a sharper image than any one frame, and
//! the cost is one frame's work for each sample.
//!
//! The jitter cycles through the Halton sequence of bases 2 and 3, whose samples spread evenly over
//! the pixel, so the average converges quickly. Sample 0 is no offset: the first frame of a still
//! view is the frame a moving view would draw.
//!
//! [`Still`] holds how still a view is. The frame builder decides each frame whether the view
//! changed, by comparing the frame it has just recorded with the frame two frames before, which is
//! the frame of the same parity and so the same draw list and upload arena. The comparison leaves
//! out the parts of a frame that the accumulation itself changes: the clock and the jitter in the
//! frame's values, the accumulation's weight, and the commands that blend and show the history. A
//! frame that blends therefore compares equal to the frame before the view became still.

use std::ops::Range;

/// The bases of the jitter sequence's two axes: Halton(2, 3).
const HALTON_X: u32 = 2;
const HALTON_Y: u32 = 3;

/// The most frames a still view accumulates before the thread that draws may rest. The average of
/// this many jittered frames is within a step of the converged image at any pixel, and the GPU then
/// has the frame it needs until the scene changes.
pub const MAX_SAMPLES: u32 = 64;

/// The jitter of accumulated sample `sample` in the clip space a projection of `size` pixels maps
/// onto: sample 0 is no offset. The offsets lie within half a pixel of its centre, so the samples
/// cover the pixel.
pub fn jitter(sample: u32, size: (u32, u32)) -> [f32; 2] {
    if sample == 0 {
        return [0.0, 0.0];
    }
    let x = radical_inverse(sample, HALTON_X) - 0.5;
    let y = radical_inverse(sample, HALTON_Y) - 0.5;
    let width = size.0.max(1) as f32;
    let height = size.1.max(1) as f32;
    // Clip space spans -1 to 1 over the target, so a whole pixel is 2 / size.
    [2.0 * x / width, 2.0 * y / height]
}

/// The radical inverse of `index` in `base`: its digits in `base`, reflected about the point, which
/// spreads successive indices evenly over 0 to 1.
fn radical_inverse(mut index: u32, base: u32) -> f32 {
    let mut fraction = 1.0 / base as f32;
    let mut result = 0.0;
    while index > 0 {
        result += (index % base) as f32 * fraction;
        index /= base;
        fraction /= base as f32;
    }
    result
}

/// How still a view is: the frames it has accumulated, from 0 while it moves.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Still {
    samples: u32,
}

impl Still {
    /// The frames accumulated so far: 0 while the view draws as it moves, from 1 while it is still.
    pub const fn samples(self) -> u32 {
        self.samples
    }

    /// True while the view is still, so the frame builder records the accumulation passes and draws
    /// with the history.
    pub const fn accumulating(self) -> bool {
        self.samples > 0
    }

    /// True once the view has accumulated enough frames: the thread that draws then takes frames
    /// without drawing, and the canvas keeps the converged image until the scene changes.
    pub const fn rests(self) -> bool {
        self.samples >= MAX_SAMPLES
    }

    /// The jitter sample of the frame about to be recorded: the frames compared still so far. The
    /// frame that first blends uses sample 1, as the frame before it drew with no offset.
    pub const fn jitter_sample(self) -> u32 {
        self.samples
    }

    /// The weight of the frame about to be recorded in the average: one over the frames it joins.
    /// The frame that first blends has weight 1, so it starts the history and ignores whatever the
    /// history held. A view that rests has weight 0: its frames keep the history as it is, so a
    /// capture, which draws the last frame again, shows the converged image.
    pub fn weight(self) -> f32 {
        if self.rests() {
            0.0
        } else {
            1.0 / self.samples.max(1) as f32
        }
    }

    /// The state after a frame that changed `still` nothing, or changed something when false.
    pub fn after(self, still: bool) -> Self {
        Self {
            samples: if still {
                self.samples.saturating_add(1)
            } else {
                0
            },
        }
    }
}

/// The last frame of one parity that the comparison kept, so the next frame of that parity can tell
/// whether anything changed. It keeps the frame's words and bytes outside the ranges that the frame
/// marked as changing every frame, joined, so a frame whose marked ranges differ in number or
/// length from the kept frame's can still compare equal. The buffers grow to the largest frame and
/// are reused, so a comparison allocates nothing.
#[derive(Default)]
pub(crate) struct Snapshot {
    words: Vec<u32>,
    bytes: Vec<u8>,
    /// True once the snapshot holds a frame.
    kept: bool,
}

impl Snapshot {
    /// True when `words` outside `word_marks`, and `bytes` outside `byte_marks`, are the same as
    /// the frame this snapshot kept, and then keeps this frame in its place. The first frame of a
    /// parity, and the first after [`Snapshot::forget`], have nothing to compare with, so they read
    /// as changed. Marks must be in order and must not overlap; a frame with marks that do not
    /// read as changed.
    pub(crate) fn unchanged(
        &mut self,
        words: &[u32],
        word_marks: &[Range<usize>],
        bytes: &[u8],
        byte_marks: &[Range<usize>],
    ) -> bool {
        let valid = in_order(word_marks, words.len()) && in_order(byte_marks, bytes.len());
        let same = self.kept
            && valid
            && same_outside(&self.words, words, word_marks)
            && same_outside(&self.bytes, bytes, byte_marks);
        self.kept = valid;
        if valid {
            keep_outside(&mut self.words, words, word_marks);
            keep_outside(&mut self.bytes, bytes, byte_marks);
        }
        same
    }

    /// Forgets the frame this snapshot kept, so the next comparison reads as changed, as the first
    /// frame of a parity does.
    pub(crate) fn forget(&mut self) {
        self.kept = false;
    }
}

/// True when `marks` are in order, do not overlap and lie within `len` items.
fn in_order(marks: &[Range<usize>], len: usize) -> bool {
    let mut at = 0;
    for range in marks {
        if range.start < at || range.end < range.start || range.end > len {
            return false;
        }
        at = range.end;
    }
    true
}

/// True when the items of `frame` outside `marks`, joined, are `kept`. The marks are in order.
fn same_outside<T: PartialEq>(kept: &[T], frame: &[T], marks: &[Range<usize>]) -> bool {
    let (mut at, mut from) = (0, 0);
    for range in marks {
        let part = &frame[at..range.start];
        if kept.get(from..from + part.len()) != Some(part) {
            return false;
        }
        from += part.len();
        at = range.end;
    }
    kept.get(from..) == Some(&frame[at..])
}

/// Replaces `kept` with the items of `frame` outside `marks`, joined. The marks are in order.
fn keep_outside<T: Copy>(kept: &mut Vec<T>, frame: &[T], marks: &[Range<usize>]) {
    kept.clear();
    let mut at = 0;
    for range in marks {
        kept.extend_from_slice(&frame[at..range.start]);
        at = range.end;
    }
    kept.extend_from_slice(&frame[at..]);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One marked range, as the comparison takes its marks.
    fn marks(range: Range<usize>) -> [Range<usize>; 1] {
        [range]
    }

    #[test]
    fn sample_zero_draws_with_no_offset_and_later_samples_cover_the_pixel() {
        assert_eq!(jitter(0, (1920, 1080)), [0.0, 0.0]);
        let mut least = [f32::MAX; 2];
        let mut most = [f32::MIN; 2];
        for sample in 1..64 {
            let offset = jitter(sample, (1920, 1080));
            // Half a pixel in clip space is 1 / size, so every offset is within it.
            assert!(offset[0].abs() <= 1.0 / 1920.0, "{sample}: {offset:?}");
            assert!(offset[1].abs() <= 1.0 / 1080.0, "{sample}: {offset:?}");
            for axis in 0..2 {
                least[axis] = least[axis].min(offset[axis]);
                most[axis] = most[axis].max(offset[axis]);
            }
        }
        // The sequence spreads over the pixel rather than clustering at its centre.
        for axis in 0..2 {
            assert!(most[axis] - least[axis] > 0.5 / 1920.0, "axis {axis}");
        }
    }

    #[test]
    fn the_first_sample_has_no_offset_and_the_sequence_is_deterministic() {
        for size in [(1, 1), (1920, 1080), (64, 64)] {
            assert_eq!(jitter(0, size), [0.0, 0.0]);
        }
        assert_eq!(jitter(7, (100, 100)), jitter(7, (100, 100)));
        assert_ne!(jitter(7, (100, 100)), jitter(8, (100, 100)));
    }

    #[test]
    fn a_still_view_accumulates_a_weight_that_falls_and_rests() {
        let moving = Still::default();
        assert_eq!(moving.samples(), 0);
        assert!(!moving.accumulating() && !moving.rests());
        assert_eq!(moving.jitter_sample(), 0);
        assert_eq!(moving.weight(), 1.0);
        assert_eq!(moving.after(false), moving);

        let mut still = moving;
        for sample in 1..MAX_SAMPLES {
            still = still.after(true);
            assert_eq!(still.samples(), sample);
            assert!(still.accumulating() && !still.rests());
            assert_eq!(still.jitter_sample(), sample);
            assert!((still.weight() - 1.0 / sample as f32).abs() < 1e-6);
        }
        // The frame that first blends takes the whole weight, so no older history shows.
        assert_eq!(moving.after(true).weight(), 1.0);
        // A resting view's frames leave the history as it is.
        still = still.after(true);
        assert!(still.rests());
        assert_eq!(still.weight(), 0.0);
        assert_eq!(still.after(true).samples(), MAX_SAMPLES + 1);
        assert_eq!(still.after(false), moving, "a change starts again");
    }

    #[test]
    fn only_a_frame_that_matches_outside_its_marked_parts_is_unchanged() {
        let mut snapshot = Snapshot::default();
        let first = [1u32, 2, 3];
        let bytes = [1u8, 2, 3, 4, 5, 6, 7, 8];
        // The first frame of a parity has nothing to compare with.
        assert!(!snapshot.unchanged(&first, &[], &bytes, &[]));
        // The same frame again is unchanged.
        assert!(snapshot.unchanged(&first, &[], &bytes, &[]));
        // A different word, or a different byte, is a change.
        assert!(!snapshot.unchanged(&[1, 2, 4], &[], &bytes, &[]));
        let mut other = bytes;
        other[5] = 9;
        assert!(!snapshot.unchanged(&first, &[], &other, &[]));
        // A byte inside a marked range is not a change, once the kept frame left out the same
        // range: the kept frame here holds all eight bytes.
        assert!(!snapshot.unchanged(&first, &[], &bytes, &marks(4..6)));
        assert!(snapshot.unchanged(&first, &[], &other, &marks(4..6)));
        // A frame whose marked parts differ in number and length still compares what lies outside
        // them: the commands that blend a still view are marked, and the frame before had none.
        assert!(snapshot.unchanged(&[1, 7, 7, 7, 2, 3], &marks(1..4), &bytes, &marks(4..6)));
        assert!(snapshot.unchanged(&[1, 2, 3], &marks(3..3), &bytes, &marks(4..6)));
        assert!(!snapshot.unchanged(&[1, 7, 2, 4], &marks(1..2), &bytes, &marks(4..6)));
        // A shorter frame is a change, and marks out of order or past the end read as one and keep
        // nothing to compare with.
        assert!(!snapshot.unchanged(&first, &[], &bytes[..7], &[]));
        assert!(!snapshot.unchanged(&first, &[], &bytes, &marks(7..9)));
        assert!(!snapshot.unchanged(&first, &[], &bytes, &[0..2, 1..3]));
        assert!(!snapshot.unchanged(&first, &[], &bytes, &[]));
        // Forgetting the frame makes the next one read as changed.
        assert!(snapshot.unchanged(&first, &[], &bytes, &[]));
        snapshot.forget();
        assert!(!snapshot.unchanged(&first, &[], &bytes, &[]));
    }
}
