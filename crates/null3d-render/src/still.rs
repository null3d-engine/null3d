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
//! the frame of the same parity and so the same draw list and upload arena. That comparison, the
//! accumulation pass and the resting of the thread that draws are the next steps of the task; this
//! module holds the parts that they rest on.

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

    /// The jitter sample of the frame about to be recorded: the samples accumulated so far, so the
    /// first frame of a still view uses sample 0 and no offset.
    pub const fn jitter_sample(self) -> u32 {
        self.samples
    }

    /// The weight of the frame about to be recorded in the average: one over the frames it joins,
    /// which is 1 while the view moves and the history is ignored.
    pub fn weight(self) -> f32 {
        if self.samples == 0 {
            1.0
        } else {
            1.0 / (self.samples + 1) as f32
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
/// whether anything changed. The buffers grow to the largest frame and are reused, so a comparison
/// allocates nothing.
#[derive(Default)]
pub(crate) struct Snapshot {
    words: Vec<u32>,
    bytes: Vec<u8>,
    /// The byte ranges of `bytes` that the frame wrote every frame whatever the scene holds, such
    /// as the clock and the jitter: the comparison ignores them.
    volatile: Vec<Range<usize>>,
}

impl Snapshot {
    /// True when `words` and `bytes`, with the `volatile` ranges ignored, are the same as the frame
    /// this snapshot kept, and then replaces it with this frame. The first frame of a parity, and
    /// the first after [`Snapshot::forget`], have nothing to compare with, so they read as changed.
    pub(crate) fn unchanged(
        &mut self,
        words: &[u32],
        bytes: &[u8],
        volatile: &[Range<usize>],
    ) -> bool {
        let same = !self.bytes.is_empty()
            && self.words == words
            && self.bytes.len() == bytes.len()
            && same_outside(&self.bytes, bytes, volatile)
            && self.volatile == volatile;
        self.words.clear();
        self.words.extend_from_slice(words);
        self.bytes.clear();
        self.bytes.extend_from_slice(bytes);
        self.volatile.clear();
        self.volatile.extend_from_slice(volatile);
        same
    }

    /// Forgets the frame this snapshot kept, so the next comparison reads as changed, as the first
    /// frame of a parity does.
    pub(crate) fn forget(&mut self) {
        self.words.clear();
        self.bytes.clear();
        self.volatile.clear();
    }
}

/// True when `a` and `b` are equal outside the byte ranges in `volatile`, which are sorted and do
/// not overlap.
fn same_outside(a: &[u8], b: &[u8], volatile: &[Range<usize>]) -> bool {
    let mut at = 0;
    for range in volatile {
        // A range that moves, shrinks or lies outside the frame means the frame's layout changed:
        // the frames are not the same.
        if range.start < at || range.end > a.len() || range.end > b.len() {
            return false;
        }
        if a[at..range.start] != b[at..range.start] {
            return false;
        }
        at = range.end;
    }
    a[at..] == b[at..]
}

#[cfg(test)]
mod tests {
    use super::*;

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
        for sample in 1..=MAX_SAMPLES {
            still = still.after(true);
            assert_eq!(still.samples(), sample);
            assert!(still.accumulating());
            assert_eq!(still.jitter_sample(), sample);
            assert!((still.weight() - 1.0 / (sample + 1) as f32).abs() < 1e-6);
        }
        assert!(still.rests());
        assert_eq!(still.after(true).samples(), MAX_SAMPLES + 1);
        assert_eq!(still.after(false), moving, "a change starts again");
    }

    #[test]
    fn only_a_frame_that_matches_outside_its_volatile_parts_is_unchanged() {
        let mut snapshot = Snapshot::default();
        let first = [1u32, 2, 3];
        let bytes = [1u8, 2, 3, 4, 5, 6, 7, 8];
        // The first frame of a parity has nothing to compare with.
        assert!(!snapshot.unchanged(&first, &bytes, &[]));
        // The same frame again is unchanged.
        assert!(snapshot.unchanged(&first, &bytes, &[]));
        // A different word, or a different byte, is a change.
        assert!(!snapshot.unchanged(&[1, 2, 4], &bytes, &[]));
        let mut other = bytes;
        other[5] = 9;
        assert!(!snapshot.unchanged(&first, &other, &[]));
        // A byte inside a volatile range is not a change, once the same volatile set is the one
        // the snapshot holds (the first frame of a volatile layout has nothing to compare with).
        let range = 4..6;
        let volatile = std::slice::from_ref(&range);
        assert!(!snapshot.unchanged(&first, &other, volatile));
        assert!(snapshot.unchanged(&first, &other, volatile));
        // A shorter frame, a moved range or a range past the end is a change.
        assert!(!snapshot.unchanged(&first, &bytes[..7], std::slice::from_ref(&range)));
        let past = 7..9;
        assert!(!snapshot.unchanged(&first, &bytes, std::slice::from_ref(&past)));
        assert!(!snapshot.unchanged(&first, &bytes, &[0..2, 1..3]));
        // Forgetting the frame makes the next one read as changed.
        snapshot.forget();
        assert!(!snapshot.unchanged(&first, &bytes, &[]));
    }
}
