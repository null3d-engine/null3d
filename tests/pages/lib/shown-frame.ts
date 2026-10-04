// The frame on screen at the pointer's last event, in the sketch's count, for the tests of rays
// from the frame on screen. The engine numbers it in its own count, which includes the frames that
// ran no sketch code; the public API leaves both out. A frame of the setup gives 0, the turn that
// the tests' cameras have before their first update.
import type { Input } from '@null3d/engine';

export function shownFrame(input: Input): number {
	const reader = input as unknown as { pointer: { frame: number }; setupFrames: number };
	return Math.max(0, reader.pointer.frame - reader.setupFrames);
}
