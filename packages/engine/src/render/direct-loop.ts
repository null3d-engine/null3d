// The loop for a thread that runs the sketch and draws in the same frame: the sketch worker in
// low-latency mode, or the page's main thread in single-threaded mode. Each frame callback steps the
// sketch, then draws, so input reaches the screen one frame sooner than in pipelined mode. While the
// page pauses the engine, or before the frame's turn under ?fps=, a callback does neither.

import { controlViews, Slot } from '../shared/control';
import type { SketchRunner } from '../sketch/runner';
import { Presenter, type RenderLoop } from './loop';
import type { Renderer } from './renderer';

export function runDirectLoop(
	runner: SketchRunner,
	renderer: Renderer,
	control: ArrayBufferLike,
	metrics: ArrayBufferLike,
	fps: number | undefined,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics, fps);
	let stopped = false;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.tick(timestamp);
		presenter.applyResize();
		if (Atomics.load(slots, Slot.Paused) === 0 && presenter.due(timestamp)) {
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
