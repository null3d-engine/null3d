// The loop for a thread that runs the sketch and draws in the same frame: the sketch worker in
// low-latency mode, or the page's main thread in single-threaded mode. Each frame callback steps the
// sketch, then draws, so input reaches the screen one frame sooner than in pipelined mode. While the
// page pauses the engine, while too many frames are unfinished on the GPU, or before the frame's
// turn under ?fps=, a callback does neither. A frame that waits for its pipelines draws in a later
// callback, and no new frame is stepped until then. The loop starts before the sketch's setup has
// run: until then it steps nothing, and draws the frames that warm-ups in the setup publish. In a
// worker, each callback also sets a timer that wakes the thread shortly before the next is due.

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
	queue?: number,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics, fps, queue);
	let stopped = false;
	/** A frame that is recorded and waits to draw, or 0. */
	let pending = 0;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.tick(timestamp);
		presenter.wakeBeforeNextFrame();
		presenter.applyResize();
		if (pending === 0) {
			const published = Atomics.load(slots, Slot.FramesPublished);
			if (published > Atomics.load(slots, Slot.FramesTaken)) pending = published;
			else if (
				runner.started &&
				Atomics.load(slots, Slot.Paused) === 0 &&
				presenter.due(timestamp)
			) {
				pending = runner.step(timestamp);
				Atomics.store(slots, Slot.FramesPublished, pending);
			}
		}
		if (pending !== 0 && presenter.ready(pending)) {
			Atomics.store(slots, Slot.FramesTaken, pending);
			presenter.draw(pending, timestamp);
			pending = 0;
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
