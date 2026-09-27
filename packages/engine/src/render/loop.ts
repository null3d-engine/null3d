// The render loop for a thread that owns the canvas and runs no game code: the render worker in
// pipelined mode, or the page's main thread with ?render=main. Inside its own frame callback it takes
// the newest published frame, applies a pending resize, draws, and tells the game worker it may
// compute the next frame.

import { controlViews, Slot } from '../shared/control';
import { FrameIntervals } from '../shared/stats';
import type { FrameInput, Renderer } from './renderer';

export interface RenderLoop {
	readonly intervals: FrameIntervals;
	stop(): void;
}

/** The background color of the empty scene, which cycles slowly so a running loop is visible. */
export function emptySceneInput(frame: number): FrameInput {
	const phase = (frame % 600) / 600;
	return { frame, background: [0.05 + 0.05 * Math.sin(phase * Math.PI * 2), 0.06, 0.08] };
}

export function runRenderLoop(renderer: Renderer, control: ArrayBufferLike): RenderLoop {
	const { slots } = controlViews(control);
	const intervals = new FrameIntervals();
	let taken = 0;
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
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (published > taken) {
			taken = published;
			Atomics.store(slots, Slot.FramesTaken, taken);
			Atomics.notify(slots, Slot.FramesTaken);
			renderer.drawFrame(emptySceneInput(taken));
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
