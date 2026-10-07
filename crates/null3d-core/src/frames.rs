//! Frame numbers. The engine's threads count frames in 32 bits, as the control slots hold them, so
//! the count goes round after about 4 billion frames: 2 years at 60 frames a second, and 207 days
//! at 240. A frame number skips 0, which means "no frame yet", and `u32::MAX`, which the
//! TypeScript side reads as -1, "no frame". Frames compare by their distance around that circle,
//! which holds while two frames lie less than 2^31 frames apart.

/// The first frame number, which also follows the last one of the circle.
pub const FIRST_FRAME: u32 = 1;

/// The frame after `frame`.
pub const fn next_frame(frame: u32) -> u32 {
    match frame.wrapping_add(1) {
        0 | u32::MAX => FIRST_FRAME,
        next => next,
    }
}

/// The frame before `frame`.
pub const fn previous_frame(frame: u32) -> u32 {
    if frame == FIRST_FRAME {
        u32::MAX - 1
    } else {
        frame.wrapping_sub(1)
    }
}

/// True when frame `a` comes after frame `b`.
pub const fn frame_after(a: u32, b: u32) -> bool {
    (a.wrapping_sub(b) as i32) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_count_skips_its_two_marks_and_goes_round() {
        assert_eq!(next_frame(0), 1);
        assert_eq!(next_frame(41), 42);
        assert_eq!(next_frame(i32::MAX as u32), 1 << 31);
        assert_eq!(next_frame(u32::MAX - 1), FIRST_FRAME);
        assert_eq!(previous_frame(FIRST_FRAME), u32::MAX - 1);
        assert_eq!(previous_frame(next_frame(1 << 31)), 1 << 31);
    }

    #[test]
    fn frames_compare_across_the_wrap() {
        let late = u32::MAX - 3;
        let early = next_frame(next_frame(next_frame(late)));
        assert_eq!(early, FIRST_FRAME);
        assert!(frame_after(early, late));
        assert!(!frame_after(late, early));
        assert!(frame_after(1 << 31, (1 << 31) - 5));
        assert!(!frame_after(7, 7));
    }
}
