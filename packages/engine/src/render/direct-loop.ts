// The loop for a thread that runs the game and draws in the same frame: the game worker in
// low-latency mode, or the page's main thread in single-threaded mode. Each frame callback steps the
// game, then draws, so input reaches the screen one frame sooner than in pipelined mode.

import type { GameRunner } from '../game/runner';
import { controlViews, Slot } from '../shared/control';
import { Presenter, type RenderLoop } from './loop';
import type { Renderer } from './renderer';

export function runDirectLoop(
	runner: GameRunner,
	renderer: Renderer,
	control: ArrayBufferLike,
	metrics: ArrayBufferLike,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics);
	let stopped = false;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.applyResize();
		if (Atomics.load(slots, Slot.Paused) === 0) {
			const frameNumber = runner.step(timestamp);
			Atomics.store(slots, Slot.FramesPublished, frameNumber);
			Atomics.store(slots, Slot.FramesTaken, frameNumber);
			presenter.draw(frameNumber, timestamp);
		}
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);

	return {
		stop: () => {
			stopped = true;
		},
	};
}
