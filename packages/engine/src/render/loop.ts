// The render loop for a thread that owns the canvas and runs no game code: the render worker in
// pipelined mode, or the page's main thread with ?render=main. Inside its own frame callback it takes
// the newest published frame, applies a pending resize, draws, and tells the game worker it may
// compute the next frame.

import { controlViews, Slot } from '../shared/control';
import { FrameRecorder, Role } from '../shared/metrics';
import type { FrameInput, Renderer } from './renderer';

export interface RenderLoop {
	stop(): void;
}

/** The background color of the empty scene, which cycles slowly so a running loop is visible. */
export function emptySceneInput(frame: number): FrameInput {
	const phase = (frame % 600) / 600;
	return { frame, background: [0.05 + 0.05 * Math.sin(phase * Math.PI * 2), 0.06, 0.08] };
}

/** Resize and presentation bookkeeping for the thread that owns the canvas. */
export class Presenter {
	private resizeSerial = 0;
	private lastPresented = -1;
	readonly record: FrameRecorder;

	constructor(
		private readonly slots: Int32Array,
		private readonly renderer: Renderer,
		metrics: ArrayBufferLike,
	) {
		this.record = new FrameRecorder(metrics, Role.Render);
	}

	/** Applies the canvas size the page wrote last, if it changed. */
	applyResize(): void {
		const serial = Atomics.load(this.slots, Slot.ResizeSerial);
		if (serial === this.resizeSerial) return;
		this.resizeSerial = serial;
		this.renderer.resize(
			Atomics.load(this.slots, Slot.CanvasWidth),
			Atomics.load(this.slots, Slot.CanvasHeight),
		);
	}

	/** Draws a frame and records its CPU time and the interval since the previous one. */
	draw(frame: number, timestamp: number): void {
		const start = performance.now();
		this.record.begin(frame);
		this.renderer.drawFrame(emptySceneInput(frame), this.record);
		Atomics.add(this.slots, Slot.FramesPresented, 1);
		if (this.lastPresented < 0) this.record.markFirstFrame();
		else this.record.interval(timestamp - this.lastPresented);
		this.lastPresented = timestamp;
		this.record.commit(performance.now() - start);
	}
}

export function runRenderLoop(
	renderer: Renderer,
	control: ArrayBufferLike,
	metrics: ArrayBufferLike,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics);
	let taken = 0;
	let stopped = false;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.applyResize();
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (published > taken) {
			taken = published;
			Atomics.store(slots, Slot.FramesTaken, taken);
			Atomics.notify(slots, Slot.FramesTaken);
			presenter.draw(taken, timestamp);
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
