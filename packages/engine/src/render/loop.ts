// The render loop for a thread that owns the canvas and runs no sketch code: the render worker in
// pipelined mode, or the page's main thread with ?render=main. Inside its own frame callback it takes
// the newest published frame, applies a pending resize, draws, and tells the sketch worker it may
// compute the next frame. A callback that finds no new frame, or that comes before the frame's turn
// under ?fps=, draws nothing. In a worker, each callback also sets a timer that wakes the thread
// shortly before the next callback is due.

import { controlViews, Slot } from '../shared/control';
import { FrameRecorder, Role } from '../shared/metrics';
import { FramePacer } from './pacer';
import { RefreshMeter } from './refresh';
import type { FrameInput, Renderer } from './renderer';

export interface RenderLoop {
	stop(): void;
	/** Hold mode's loop: draws the held frame when first asked, and resolves once it has. */
	drawHeld?(): Promise<void>;
}

/**
 * How long before its next frame callback is due a worker that draws wakes up. Safari runs a
 * worker's frame callbacks from a timer, which fires late when the worker has slept through most of
 * the frame. A wake-up this long before the callback leaves too short a sleep for that.
 */
const WAKE_AHEAD_MS = 4;
/** The display rate that the wake-up assumes until the refresh meter has measured the callbacks. */
const ASSUMED_DISPLAY_HZ = 60;
const MS_PER_SECOND = 1000;

/**
 * The delay, in whole milliseconds, from the start of a frame callback to the wake-up before the
 * next one, for callbacks `hz` times a second. A whole number reaches the timer without allocating.
 */
export function wakeDelayMs(hz: number): number {
	return Math.max(0, Math.round(MS_PER_SECOND / hz - WAKE_AHEAD_MS));
}

/** The wake-up's timer callback: waking the thread is all it is for. */
function wakeUp(): void {}

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

/** Resize, pacing and presentation bookkeeping for the thread that owns the canvas. */
export class Presenter {
	private resizeSerial = 0;
	private lastPresented = -1;
	private readonly input: ReusableInput = { frame: 0, background: [0, 0, 0] };
	private readonly refresh = new RefreshMeter();
	private readonly pacer: FramePacer;
	/** The wake-up's delay at the refresh rate that the meter measured last. */
	private wakeDelay = wakeDelayMs(ASSUMED_DISPLAY_HZ);
	/** A worker's frame callbacks can run from a timer; a page's always follow the display. */
	private readonly inWorker = typeof document === 'undefined';
	readonly record: FrameRecorder;

	/** `fps` is the frame rate that ?fps= holds, or undefined to draw at the display's rate. */
	constructor(
		private readonly slots: Int32Array,
		private readonly renderer: Renderer,
		metrics: ArrayBufferLike,
		fps: number | undefined,
	) {
		this.record = new FrameRecorder(metrics, Role.Render);
		this.pacer = new FramePacer(fps);
	}

	/**
	 * Counts a frame callback, from whose times the display's refresh rate follows. Every callback
	 * counts, including those that draw nothing.
	 */
	tick(timestamp: number): void {
		const hz = this.refresh.tick(timestamp);
		if (hz === undefined) return;
		this.record.setRefreshHz(hz);
		this.wakeDelay = wakeDelayMs(hz);
	}

	/**
	 * In a worker, sets a timer that wakes the thread shortly before the next frame callback is due.
	 * Call it as a callback starts. Where a worker's frame callbacks follow the display, the timer
	 * runs and does nothing else.
	 */
	wakeBeforeNextFrame(): void {
		if (this.inWorker) setTimeout(wakeUp, this.wakeDelay);
	}

	/**
	 * True when the callback at `timestamp` may draw a frame, under the frame rate that ?fps= holds.
	 * A true answer uses up the frame's turn, so ask only when a frame is ready to draw.
	 */
	due(timestamp: number): boolean {
		return this.pacer.take(timestamp);
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
		Atomics.store(this.slots, Slot.FramePresented, frame);
		if (this.lastPresented < 0) {
			this.record.markFirstFrame();
			// Once, so the page learns when the first frame is on screen.
			void this.renderer.finished().then(() => this.record.markFirstFrameDone());
		} else this.record.interval(timestamp - this.lastPresented);
		this.lastPresented = timestamp;
		this.record.commit(performance.now() - start);
	}
}

/**
 * Hold mode's loop, which runs no frame loop. When first asked, it draws the frame that the sketch
 * thread published, in one animation frame callback, and it draws nothing after.
 */
export class HoldLoop implements RenderLoop {
	private readonly presenter: Presenter;
	private drawn: Promise<void> | undefined;
	private stopped = false;

	constructor(
		private readonly slots: Int32Array,
		renderer: Renderer,
		metrics: ArrayBufferLike,
	) {
		this.presenter = new Presenter(slots, renderer, metrics, undefined);
	}

	drawHeld(): Promise<void> {
		this.drawn ??= new Promise((resolve, reject) => {
			requestAnimationFrame((timestamp) => {
				const frame = Atomics.load(this.slots, Slot.FramesPublished);
				if (this.stopped) reject(new Error('the engine stopped before it drew the held frame'));
				else if (frame === 0) reject(new Error('the sketch thread published no held frame'));
				else
					try {
						this.presenter.applyResize();
						Atomics.store(this.slots, Slot.FramesTaken, frame);
						this.presenter.draw(frame, timestamp);
						resolve();
					} catch (error) {
						reject(error);
					}
			});
		});
		return this.drawn;
	}

	stop(): void {
		this.stopped = true;
	}
}

export function runRenderLoop(
	renderer: Renderer,
	control: ArrayBufferLike,
	metrics: ArrayBufferLike,
	fps: number | undefined,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics, fps);
	let taken = 0;
	let stopped = false;

	const frame = (timestamp: number) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.tick(timestamp);
		presenter.wakeBeforeNextFrame();
		presenter.applyResize();
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (published > taken && presenter.due(timestamp)) {
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
