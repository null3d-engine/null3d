// The engine's frame numbers, as every thread and the core count them. The control slots hold them
// in 32 bits, so the count goes round after about 4 billion frames: 2 years at 60 frames a second,
// and 207 days at 240. A frame number is a 32-bit integer that skips 0, which means "no frame yet",
// and -1, which means "none" where a frame is asked for. Frames compare by their distance in that
// circle, which holds while two frames lie less than 2^31 frames apart.

/** The first frame number, which also follows the last of the circle, -2. */
export const FIRST_FRAME = 1;

/** The frame after `frame`. */
export function nextFrame(frame: number): number {
	const next = (frame + 1) | 0;
	return next === 0 || next === -1 ? FIRST_FRAME : next;
}

/** The frame before `frame`. */
export function previousFrame(frame: number): number {
	return frame === FIRST_FRAME ? -2 : (frame - 1) | 0;
}

/** True when frame `a` comes after frame `b`. */
export function frameAfter(a: number, b: number): boolean {
	return ((a - b) | 0) > 0;
}

/** True when frame `a` is frame `b` or comes after it. */
export function frameReached(a: number, b: number): boolean {
	return ((a - b) | 0) >= 0;
}
