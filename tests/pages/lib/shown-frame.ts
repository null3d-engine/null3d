// The frames on screen, for the tests of rays from the frame on screen: the one at the pointer's
// last event, in the sketch's count, and the one now, in the engine's count. The engine's count
// includes the frames that ran no sketch code; the public API leaves out both. A frame of the setup
// gives 0 in the sketch's count, the turn that the tests' cameras have before their first update.
import type { Input } from '@null3d/engine';

export function shownFrame(input: Input): number {
	const reader = input as unknown as { pointer: { frame: number }; setupFrames: number };
	return Math.max(0, reader.pointer.frame - reader.setupFrames);
}

/** The frame on screen now, in the engine's count, or 0 before the first. */
export function presentedFrame(input: Input): number {
	return (input as unknown as { presentedFrame(): number }).presentedFrame();
}
