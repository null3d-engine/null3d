// The render loop for a thread that owns the canvas and runs no sketch code: the render worker in
// pipelined mode, or the page's main thread with ?render=main. Inside its own frame callback it takes
// the newest published frame, applies a pending resize, draws, and tells the sketch worker it may
// compute the next frame.

import { controlViews, Slot } from '../shared/control';
import { FrameRecorder, Role } from '../shared/metrics';
import { RefreshMeter } from './refresh';
import type { FrameInput, Renderer } from './renderer';

export interface RenderLoop {
	stop(): void;
}

/** A frame input that `emptySceneInput` can fill again each frame. */
type ReusableInput = { frame: number; background: [number, number, number] };

/**
 * The input of an empty scene's frame, whose background cycles slowly so a running loop is
 * visible. It fills `out` when given, so a loop allocates nothing per frame.
 */
export function emptySceneInput(frame: number, out?: ReusableInput): FrameInput {
	const input = out ?? { frame, background: [0, 0, 0] };
	const phase = (frame % 600) / 600;
	input.frame = frame;
	input.background[0] = 0.05 + 0.05 * Math.sin(phase * Math.PI * 2);
	input.background[1] = 0.06;
	input.background[2] = 0.08;
	return input;
}

/** Resize and presentation bookkeeping for the thread that owns the canvas. */
export class Presenter {
	private resizeSerial = 0;
	private lastPresented = -1;
	private readonly input: ReusableInput = { frame: 0, background: [0, 0, 0] };
	private readonly refresh = new RefreshMeter();
	readonly record: FrameRecorder;

	constructor(
		private readonly slots: Int32Array,
		private readonly renderer: Renderer,
		metrics: ArrayBufferLike,
	) {
		this.record = new FrameRecorder(metrics, Role.Render);
	}

	/** Counts a frame callback, from whose times the display's refresh rate follows. */
	tick(timestamp: number): void {
		const hz = this.refresh.tick(timestamp);
		if (hz !== undefined) this.record.setRefreshHz(hz);
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

	/**
	 * Draws a frame and records its CPU time and the interval since the previous one. A frame whose
	 * draw list was recorded for a GPU device the browser took away is skipped: its list names
	 * objects the new device lacks.
	 */
	draw(frame: number, timestamp: number): void {
		const recordedFor = Atomics.load(this.slots, Slot.FrameEpoch0 + (frame & 1));
		if (recordedFor !== Atomics.load(this.slots, Slot.GpuEpoch)) return;
		const start = performance.now();
		this.record.begin(frame);
		this.renderer.drawFrame(emptySceneInput(frame, this.input), this.record);
		Atomics.add(this.slots, Slot.FramesPresented, 1);
		if (this.lastPresented < 0) {
			this.record.markFirstFrame();
			// Once, so the page learns when the first frame is on screen.
			void this.renderer.finished().then(() => this.record.markFirstFrameDone());
		} else this.record.interval(timestamp - this.lastPresented);
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
		presenter.tick(timestamp);
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
