// The render loop for a thread that owns the canvas and runs no sketch code: the render worker in
// pipelined mode, or the page's main thread with ?render=main. Inside its own frame callback it takes
// the newest published frame, applies a pending resize, draws, and tells the sketch worker it may
// compute the next frame. A callback that finds no new frame, a frame that waits for its pipelines,
// too many frames unfinished on the GPU, or that comes before the frame's turn under ?fps= or the
// display's rate, draws nothing. In a worker, each callback also sets a timer that wakes the thread
// shortly before the next callback is due. On the page's thread, two callbacks in a row now and then
// draw nothing while the frames run slower than the display, so the interval between them measures
// the display.

import { controlLabels, controlViews, Slot } from '../shared/control';
import { type LabelRegion, presentLabels } from '../shared/labels';
import { FrameRecorder, Role } from '../shared/metrics';
import { TARGET_CAP_HZ } from '../shared/stats';
import { notifySlot, type WakeTarget } from '../shared/wake';
import { FramePacer } from './pacer';
import { RefreshMeter, snapMeanInterval } from './refresh';
import type { FrameInput, Renderer } from './renderer';

export interface RenderLoop {
	stop(): void;
	/** Hold mode's loop: draws the held frame when first asked, and resolves once it has. */
	drawHeld?(): Promise<void>;
}

/** Hears the error that ended a frame loop. */
export type LoopFault = (error: unknown) => void;

/**
 * An animation frame callback that runs `step`, which asks for the next callback itself. When
 * `step` throws, the loop ends, and `fault` hears the error. Without `fault` the error goes on to
 * the thread's error handler, which in a worker tells the page that the worker failed.
 */
export function guardFrame(
	step: (timestamp: number) => void,
	fault: LoopFault | undefined,
): FrameRequestCallback {
	return (timestamp) => {
		try {
			step(timestamp);
		} catch (error) {
			if (!fault) throw error;
			fault(error);
		}
	};
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
const MICROSECONDS_PER_MS = 1000;
/**
 * The most frames that may be unfinished on the GPU once a frame is submitted. Browsers let many
 * more queue when the GPU falls behind, and each frame in the queue adds a frame of delay between
 * input and the screen. With two, the GPU has the next frame ready as it finishes one, so it never
 * waits for work.
 */
const MAX_FRAMES_IN_FLIGHT = 2;
/**
 * The intervals of each measurement of the display on the page's thread. Under load, one comes
 * about every `CHECK_AFTER` callbacks, so few keep the measurement quick.
 */
const DISPLAY_SAMPLES = 8;
/**
 * Callbacks in a row that drew a frame, on the page's thread, after which a check of the display
 * starts, while the frames run slower than the display.
 */
const CHECK_AFTER = 30;
/**
 * Callbacks in a row that draw nothing in a check of the display. In Safari, the callback after a
 * frame that the GPU held up comes at no refresh, and the next comes at the display's next refresh,
 * so only the interval after that one measures a whole refresh. Each check delays a frame by about
 * two refreshes.
 */
const QUIET_RUN = 2;
/**
 * Callbacks at a rate under this percentage of the display's measured rate run slower than the
 * display. Measurements of callbacks at the display's rate jitter by a few percent.
 */
const SLOW_PERCENT = 90;

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
	/**
	 * The timestamp of the callback that presented the last frame, or -1 before the first. It lives
	 * in a typed array: some browsers make a new object for each fraction stored in a property.
	 */
	private readonly lastPresented = Float64Array.of(-1);
	/** The newest frame whose pipelines the presenter reported built to the sketch thread. */
	private builtFrame = 0;
	private readonly input: ReusableInput = { frame: 0, background: [0, 0, 0] };
	private readonly refresh = new RefreshMeter();
	private readonly pacer: FramePacer;
	/** The wake-up's delay at the refresh rate that the meter measured last. */
	private wakeDelay = wakeDelayMs(ASSUMED_DISPLAY_HZ);
	/** A worker's frame callbacks can run from a timer; a page's always follow the display. */
	private readonly inWorker = typeof document === 'undefined';
	/** The display's refresh period in microseconds that the pacer holds to, or 0 for none. */
	private displayInterval = 0;
	/**
	 * True once a measurement of a worker's callbacks matched no display's rate: a timer runs them,
	 * and their rate never tells the display's again, as it slows when the thread waits for the GPU.
	 */
	private timerDriven = false;
	/** The page's display period in microseconds that the metrics hold as the refresh rate, or -1. */
	private recordedInterval = -1;
	/**
	 * On the page's thread, measures the display from the intervals that follow `QUIET_RUN`
	 * callbacks in a row that drew nothing. Safari's page callbacks slow while the GPU falls behind,
	 * and their intervals then follow the frames, not the display.
	 */
	private readonly display = new RefreshMeter(DISPLAY_SAMPLES);
	/**
	 * The page's display rate, which the metrics hold: the rate that the quiet intervals measured
	 * last, or any faster rate of all the callbacks measured since, since callbacks never come
	 * faster than the display. 0 before either.
	 */
	private displayHz = 0;
	/** True once the quiet intervals have measured the display. */
	private displayMeasured = false;
	/** The rate of all the page's callbacks that the refresh meter measured last, or 0 before the first. */
	private callbackHz = 0;
	/** True when this thread drew a frame since the last callback started. */
	private drew = false;
	/** The page's callbacks in a row, up to the last one, that drew a frame. */
	private busyCallbacks = 0;
	/** The page's callbacks in a row, up to the last one, that drew nothing. */
	private quietCallbacks = 0;
	/** True while a check of the display holds back the frames on the page's thread. */
	private checking = false;
	/** The last callback's timestamp, or -1 before the first, in a typed array as `lastPresented`. */
	private readonly lastCallback = Float64Array.of(-1);
	/** The label tables, whose presented table follows each frame this thread presents. */
	private readonly labels: LabelRegion | undefined;
	readonly record: FrameRecorder;

	/**
	 * `fps` is the frame rate that ?fps= holds, or undefined to draw at the display's rate. `queue`
	 * is the most frames that may wait unfinished on the GPU. `wake` carries wake messages to the
	 * sketch thread, where another thread runs the sketch. `presented` runs after each frame this
	 * thread presents, once the frame's labels are in place.
	 */
	constructor(
		private readonly slots: Int32Array,
		private readonly renderer: Renderer,
		metrics: ArrayBufferLike,
		fps: number | undefined,
		private readonly queue = MAX_FRAMES_IN_FLIGHT,
		private readonly wake?: WakeTarget,
		private readonly presented?: () => void,
	) {
		this.record = new FrameRecorder(metrics, Role.Render);
		this.pacer = new FramePacer(fps);
		this.labels = controlLabels(slots.buffer);
	}

	/**
	 * Counts a frame callback, from whose times the display's refresh rate follows. Every callback
	 * counts, including those that draw nothing. When a worker's callbacks come at a rate that no
	 * display runs at, a timer runs them, and the frames hold to the display's rate that the page
	 * measured. From then on, the metrics hold the page's rate as the refresh rate too: the timer's
	 * callbacks slow down while the worker waits for the GPU, and the quality governor's budget
	 * would grow with them. On the page's thread, the metrics hold the display rate that the
	 * intervals after callbacks that drew nothing measure, or a faster rate of all the callbacks.
	 */
	tick(timestamp: number): void {
		const hz = this.refresh.tick(timestamp);
		const onDisplayRate = this.refresh.onDisplayRate;
		if (!this.inWorker) this.measureDisplay(timestamp);
		if (hz !== undefined) {
			this.wakeDelay = wakeDelayMs(hz);
			if (!this.inWorker) {
				this.callbackHz = hz;
				if (hz > this.displayHz) this.setDisplayHz(hz);
			} else {
				this.timerDriven ||= !onDisplayRate;
				if (!this.timerDriven) this.record.setRefreshHz(hz);
			}
		}
		const display = this.inWorker ? Atomics.load(this.slots, Slot.DisplayInterval) : 0;
		if (this.timerDriven && display > 0 && display !== this.recordedInterval) {
			this.recordedInterval = display;
			this.record.setRefreshHz(snapMeanInterval(display, 1));
		}
		const interval = onDisplayRate ? 0 : display;
		if (interval === this.displayInterval) return;
		this.displayInterval = interval;
		this.pacer.holdToDisplay(interval / MICROSECONDS_PER_MS);
	}

	/**
	 * Counts the last callback as busy or quiet, and adds the interval since it to the display's
	 * measurement when it ended a quiet run.
	 */
	private measureDisplay(timestamp: number): void {
		const last = this.lastCallback[0] as number;
		this.lastCallback[0] = timestamp;
		if (last < 0) return;
		if (this.drew) {
			this.drew = false;
			this.busyCallbacks++;
			this.quietCallbacks = 0;
			return;
		}
		this.busyCallbacks = 0;
		if (++this.quietCallbacks < QUIET_RUN || timestamp <= last) return;
		this.checking = false;
		const hz = this.display.add(timestamp - last);
		if (hz === undefined) return;
		this.displayMeasured = true;
		this.setDisplayHz(hz);
	}

	/** Holds `hz` as the page's display rate, and records it as the refresh rate. */
	private setDisplayHz(hz: number): void {
		this.displayHz = hz;
		this.record.setRefreshHz(hz);
	}

	/**
	 * True when a callback on the page's thread should draw nothing, as a check of the display. A
	 * check starts after `CHECK_AFTER` callbacks in a row that drew, while all the callbacks come
	 * slower than the display, and lasts `QUIET_RUN` callbacks. Until the quiet intervals have
	 * measured the display, the display counts as at least the highest rate the engine aims for:
	 * callbacks slowed from the first frame on would otherwise pass for the display. A display that slowed,
	 * such as a window moved to a slower screen, comes out the same way.
	 */
	private checksDisplay(): boolean {
		if (this.inWorker) return false;
		if (this.checking) return true;
		if (this.busyCallbacks < CHECK_AFTER || this.callbackHz === 0) return false;
		const display = this.displayMeasured ? this.displayHz : Math.max(this.displayHz, TARGET_CAP_HZ);
		this.checking = this.callbackHz * 100 < display * SLOW_PERCENT;
		return this.checking;
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
	 * True when the callback at `timestamp` may draw a frame: the GPU has room for one more, and the
	 * frame rate that ?fps= or the display holds gives the frame its turn, and on the page's thread,
	 * the callback is not one that measures the display. A true answer uses up the turn, so ask only
	 * when a frame is ready to draw.
	 */
	due(timestamp: number): boolean {
		if (this.checksDisplay()) return false;
		const unfinished = this.renderer.completions?.unfinished() ?? 0;
		return unfinished < this.queue && this.pacer.take(timestamp);
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

	/** True when a frame's draw list was recorded for a GPU device that the browser took away. */
	private stale(frame: number): boolean {
		const recordedFor = Atomics.load(this.slots, Slot.FrameEpoch0 + (frame & 1));
		return recordedFor !== Atomics.load(this.slots, Slot.GpuEpoch);
	}

	/**
	 * True when a frame may draw. The first call for a frame starts to build the pipelines that its
	 * list creates, and the frame waits for them until the renderer has drawn a frame with every
	 * pipeline built. A stale frame never waits, since it draws nothing. Once no pipeline is building,
	 * the frame's number goes to the sketch thread, whose warm-ups wait for it.
	 */
	ready(frame: number): boolean {
		if (this.stale(frame)) return true;
		const ready = this.renderer.prepare(frame);
		if ((this.lastPresented[0] as number) < 0) this.record.markWarmUp(this.renderer.building);
		if (!this.renderer.building && frame > this.builtFrame) {
			this.builtFrame = frame;
			Atomics.store(this.slots, Slot.PipelinesBuilt, frame);
			notifySlot(this.slots, Slot.PipelinesBuilt, this.wake);
		}
		return ready;
	}

	/**
	 * Draws a frame and records its CPU time and the interval since the previous one, and gives the
	 * page the frame's labels. A frame whose draw list was recorded for a GPU device the browser took
	 * away is skipped: its list names objects the new device lacks.
	 */
	draw(frame: number, timestamp: number): void {
		if (this.stale(frame)) return;
		const start = performance.now();
		this.drew = true;
		this.record.begin(frame);
		this.renderer.drawFrame(emptySceneInput(frame, this.input), this.record);
		Atomics.store(this.slots, Slot.FramePresented, frame);
		if (this.labels) presentLabels(this.labels, frame);
		this.presented?.();
		const lastPresented = this.lastPresented[0] as number;
		if (lastPresented < 0) this.markFirstFrame(performance.now() - start);
		else this.record.interval(timestamp - lastPresented);
		this.lastPresented[0] = timestamp;
		this.record.commit(performance.now() - start);
	}

	/**
	 * Records the first frame, and when the GPU has finished it, so the page learns when it reached
	 * the screen. Its closure stays out of `draw`, which would otherwise allocate the closure's
	 * variables on every frame until the browser optimizes it.
	 */
	private markFirstFrame(drawMs: number): void {
		this.record.markFirstFrame(drawMs);
		void this.renderer.finished().then(() => this.record.markFirstFrameDone());
	}
}

/**
 * Hold mode's loop, which runs no frame loop. When first asked, it draws the frame that the sketch
 * thread published, in the first animation frame callback after its pipelines are built, and it
 * draws nothing after.
 */
export class HoldLoop implements RenderLoop {
	private readonly presenter: Presenter;
	private drawn: Promise<void> | undefined;
	private stopped = false;

	constructor(
		private readonly slots: Int32Array,
		renderer: Renderer,
		metrics: ArrayBufferLike,
		presented?: () => void,
	) {
		this.presenter = new Presenter(
			slots,
			renderer,
			metrics,
			undefined,
			undefined,
			undefined,
			presented,
		);
	}

	drawHeld(): Promise<void> {
		this.drawn ??= new Promise((resolve, reject) => {
			const attempt = (timestamp: number) => {
				const frame = Atomics.load(this.slots, Slot.FramesPublished);
				if (this.stopped) reject(new Error('the engine stopped before it drew the held frame'));
				else if (frame === 0) reject(new Error('the sketch thread published no held frame'));
				else
					try {
						if (!this.presenter.ready(frame)) {
							requestAnimationFrame(attempt);
							return;
						}
						this.presenter.applyResize();
						Atomics.store(this.slots, Slot.FramesTaken, frame);
						this.presenter.draw(frame, timestamp);
						resolve();
					} catch (error) {
						reject(error);
					}
			};
			requestAnimationFrame(attempt);
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
	queue?: number,
	wake?: WakeTarget,
	fault?: LoopFault,
	presented?: () => void,
): RenderLoop {
	const { slots } = controlViews(control);
	const presenter = new Presenter(slots, renderer, metrics, fps, queue, wake, presented);
	let taken = 0;
	let stopped = false;

	const frame = guardFrame((timestamp) => {
		if (stopped || Atomics.load(slots, Slot.Running) === 0) return;
		presenter.tick(timestamp);
		presenter.wakeBeforeNextFrame();
		presenter.applyResize();
		const published = Atomics.load(slots, Slot.FramesPublished);
		if (published > taken && presenter.ready(published) && presenter.due(timestamp)) {
			taken = published;
			Atomics.store(slots, Slot.FramesTaken, taken);
			notifySlot(slots, Slot.FramesTaken, wake);
			presenter.draw(taken, timestamp);
		}
		requestAnimationFrame(frame);
	}, fault);
	requestAnimationFrame(frame);

	return {
		stop: () => {
			stopped = true;
		},
	};
}
