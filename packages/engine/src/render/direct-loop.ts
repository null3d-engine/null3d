// The loop for a thread that runs the game and draws in the same frame: the game worker in
// low-latency mode, or the page's main thread in single-threaded mode. Each frame callback steps the
// game, then draws, so input reaches the screen one frame sooner than in pipelined mode.

import type { GameRunner } from '../game/runner';
import { controlViews, Slot } from '../shared/control';
import { FrameIntervals } from '../shared/stats';
import type { RenderLoop } from './loop';
import { emptySceneInput } from './loop';
import type { Renderer } from './renderer';

export function runDirectLoop(
	runner: GameRunner,
	renderer: Renderer,
	control: ArrayBufferLike,
): RenderLoop {
	const { slots } = controlViews(control);
	const intervals = new FrameIntervals();
	let frameNumber = 0;
	let resizeSerial = 0;
	let stopped = false;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		const serial = Atomics.load(slots, Slot.ResizeSerial);
		if (serial !== resizeSerial) {
			resizeSerial = serial;
			renderer.resize(
				Atomics.load(slots, Slot.CanvasWidth),
				Atomics.load(slots, Slot.CanvasHeight),
			);
		}
		if (Atomics.load(slots, Slot.Paused) === 0) {
			runner.step(timestamp);
			frameNumber++;
			Atomics.store(slots, Slot.FramesPublished, frameNumber);
			Atomics.store(slots, Slot.FramesTaken, frameNumber);
			renderer.drawFrame(emptySceneInput(frameNumber));
			Atomics.add(slots, Slot.FramesPresented, 1);
			intervals.frame(timestamp);
		}
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	return {
		intervals,
		stop: () => {
			stopped = true;
		},
	};
}
