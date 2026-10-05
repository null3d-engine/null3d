import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import type { SketchRunner } from '../sketch/runner';
import { runDirectLoop } from './direct-loop';
import { type FramePacing, HoldLoop, type RenderLoop, runRenderLoop, wakeDelayMs } from './loop';
import type { FrameInput, Renderer } from './renderer';

/** Frame callbacks that the loops asked for, which the test runs in place of a display. */
let pending: FrameRequestCallback[] = [];
const browserRequest = globalThis.requestAnimationFrame;
const scope = globalThis as { requestAnimationFrame: (callback: FrameRequestCallback) => number };

beforeEach(() => {
	pending = [];
	scope.requestAnimationFrame = (callback) => pending.push(callback);
});

afterEach(() => {
	scope.requestAnimationFrame = browserRequest;
});

/** A display at `hz` that calls the loops `count` times; `before` runs ahead of each call. */
function refresh(hz: number, count: number, before: (call: number) => void = () => {}): void {
	for (let call = 0; call < count; call++) {
		before(call);
		const callbacks = pending;
		pending = [];
		for (const callback of callbacks) callback((call * 1000) / hz);
	}
}

/**
 * The control block, the metrics and a renderer that lists the frames it draws and the frames it
 * was asked to prepare. Its pipelines build while `builds.left` is above 0: each check of a frame
 * counts it down.
 */
function setup(shared = false) {
	const control = createControlBuffer(shared);
	const metrics = createMetricsBuffer(false, 0);
	const drawn: number[] = [];
	const prepared: number[] = [];
	const builds = { left: 0, drawn: false };
	const renderer = {
		prepare(frame: number) {
			prepared.push(frame);
			if (builds.left > 0) builds.left--;
			return builds.drawn || builds.left === 0;
		},
		get building() {
			return builds.left > 0;
		},
		drawFrame: (input: FrameInput) => {
			drawn.push(input.frame);
			if (builds.left === 0) builds.drawn = true;
		},
		finished: () => Promise.resolve(),
		resize() {},
	} as unknown as Renderer;
	const { slots } = controlViews(control);
	Atomics.store(slots, Slot.Running, 1);
	return {
		control,
		metrics,
		slots,
		drawn,
		prepared,
		builds,
		renderer,
		reader: new MetricsReader(metrics),
	};
}

/** A sketch whose steps count frames from 1, and whose setup has run unless `started` is false. */
function countingSketch(started = true): SketchRunner & { started: boolean } {
	let frame = 0;
	return { step: () => ++frame, started } as unknown as SketchRunner & { started: boolean };
}

const DISPLAY_HZ = 60;
/** Callbacks the display makes: two refresh meter samples. */
const CALLBACKS = 64;

describe('the render loop', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	it('draws nothing at a callback that finds no new frame', () => {
		const { control, metrics, slots, drawn, renderer } = setup();
		loop = runRenderLoop(renderer, control, metrics, {});
		Atomics.store(slots, Slot.FramesPublished, 1);
		refresh(DISPLAY_HZ, 10);
		expect(drawn).toEqual([1]);
		Atomics.store(slots, Slot.FramesPublished, 2);
		refresh(DISPLAY_HZ, 10);
		expect(drawn).toEqual([1, 2]);
		expect(Atomics.load(slots, Slot.FramePresented)).toBe(2);
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(2);
	});

	it('holds ?fps= and still measures the display from every callback', () => {
		const { control, metrics, slots, drawn, renderer, reader } = setup();
		loop = runRenderLoop(renderer, control, metrics, { fps: 30 });
		// A sketch fast enough to publish a new frame before every callback.
		refresh(DISPLAY_HZ, CALLBACKS, (call) => Atomics.store(slots, Slot.FramesPublished, call + 1));
		expect(drawn).toHaveLength(CALLBACKS / 2);
		expect(reader.refreshHz).toBe(DISPLAY_HZ);
	});

	it('takes and draws the first frame only once its pipelines are built', () => {
		const { control, metrics, slots, drawn, prepared, builds, renderer, reader } = setup();
		builds.left = 4;
		loop = runRenderLoop(renderer, control, metrics, {});
		Atomics.store(slots, Slot.FramesPublished, 1);
		refresh(DISPLAY_HZ, 3);
		// The sketch may not record the next frame yet, and warm-ups still wait.
		expect(drawn).toEqual([]);
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(0);
		expect(Atomics.load(slots, Slot.PipelinesBuilt)).toBe(0);
		refresh(DISPLAY_HZ, 2);
		expect(drawn).toEqual([1]);
		expect(prepared).toEqual([1, 1, 1, 1]);
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(1);
		expect(Atomics.load(slots, Slot.PipelinesBuilt)).toBe(1);
		expect(reader.warmUpMs).toBeGreaterThanOrEqual(0);
		expect(reader.firstFramePipelines).toBe(0);
	});

	it('draws later frames at once while their pipelines build, and reports them built after', () => {
		const { control, metrics, slots, drawn, builds, renderer } = setup();
		loop = runRenderLoop(renderer, control, metrics, {});
		Atomics.store(slots, Slot.FramesPublished, 1);
		refresh(DISPLAY_HZ, 1);
		// Frame 2 creates a pipeline, which builds while frames 2 to 4 are checked.
		builds.left = 4;
		refresh(DISPLAY_HZ, 3, (call) => Atomics.store(slots, Slot.FramesPublished, call + 2));
		expect(drawn).toEqual([1, 2, 3, 4]);
		expect(Atomics.load(slots, Slot.PipelinesBuilt)).toBe(1);
		refresh(DISPLAY_HZ, 1, () => Atomics.store(slots, Slot.FramesPublished, 5));
		expect(Atomics.load(slots, Slot.PipelinesBuilt)).toBe(5);
	});

	it('takes a frame of a device that the browser took away without waiting for it', () => {
		const { control, metrics, slots, drawn, prepared, builds, renderer } = setup();
		builds.left = 100;
		Atomics.store(slots, Slot.GpuEpoch, 1);
		loop = runRenderLoop(renderer, control, metrics, {});
		Atomics.store(slots, Slot.FramesPublished, 1);
		refresh(DISPLAY_HZ, 1);
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(1);
		expect(drawn).toEqual([]);
		expect(prepared).toEqual([]);
	});
});

describe('the hold loop', () => {
	it('draws the held frame once its pipelines are built', async () => {
		const { metrics, slots, drawn, builds, renderer } = setup();
		builds.left = 3;
		const hold = new HoldLoop(slots, renderer, metrics);
		Atomics.store(slots, Slot.FramesPublished, 7);
		const held = hold.drawHeld();
		refresh(DISPLAY_HZ, 2);
		expect(drawn).toEqual([]);
		refresh(DISPLAY_HZ, 2);
		await held;
		expect(drawn).toEqual([7]);
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(7);
	});
});

describe('the direct loop', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	it('steps and draws nothing while the page pauses the engine', () => {
		const { control, metrics, slots, drawn, renderer } = setup();
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, {});
		refresh(DISPLAY_HZ, 5);
		Atomics.store(slots, Slot.Paused, 1);
		refresh(DISPLAY_HZ, 5);
		expect(drawn).toEqual([1, 2, 3, 4, 5]);
		Atomics.store(slots, Slot.Paused, 0);
		refresh(DISPLAY_HZ, 2);
		expect(drawn).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it('holds ?fps= and still measures the display from every callback', () => {
		const { control, metrics, drawn, renderer, reader } = setup();
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, { fps: 30 });
		refresh(DISPLAY_HZ, CALLBACKS);
		expect(drawn).toHaveLength(CALLBACKS / 2);
		expect(reader.refreshHz).toBe(DISPLAY_HZ);
	});

	it('steps nothing before the setup has run, and draws the frames that its warm-ups publish', () => {
		const { control, metrics, slots, drawn, builds, renderer } = setup();
		const sketch = countingSketch(false);
		loop = runDirectLoop(sketch, renderer, control, metrics, {});
		refresh(DISPLAY_HZ, 3);
		expect(drawn).toEqual([]);
		// A warm-up records frame 1 itself; the loop draws it once its pipelines are built.
		builds.left = 2;
		Atomics.store(slots, Slot.FramesPublished, 1);
		refresh(DISPLAY_HZ, 1);
		expect(drawn).toEqual([]);
		refresh(DISPLAY_HZ, 1);
		expect(drawn).toEqual([1]);
		expect(Atomics.load(slots, Slot.PipelinesBuilt)).toBe(1);
		sketch.started = true;
		refresh(DISPLAY_HZ, 2);
		// The sketch's own frames count from 1 in this fake: the loop steps and draws them.
		expect(drawn).toEqual([1, 1, 2]);
	});

	it("wakes the setup's code that waits for its frame to be taken", async () => {
		const { control, metrics, slots, renderer } = setup(true);
		loop = runDirectLoop(countingSketch(false), renderer, control, metrics, {});
		Atomics.store(slots, Slot.FramesPublished, 1);
		const wait = Atomics.waitAsync(slots, Slot.FramesTaken, 0, 1000);
		expect(wait.async).toBe(true);
		refresh(DISPLAY_HZ, 1);
		expect(await wait.value).toBe('ok');
	});

	it('steps no new frame while the frame it stepped waits for its pipelines', () => {
		const { control, metrics, drawn, builds, renderer } = setup();
		builds.left = 3;
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, {});
		refresh(DISPLAY_HZ, 2);
		expect(drawn).toEqual([]);
		refresh(DISPLAY_HZ, 2);
		expect(drawn).toEqual([1, 2]);
	});
});

describe('the frames in flight', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	/** A renderer whose GPU finishes frames only when the test says so. */
	function slowGpu() {
		const parts = setup();
		const gpu = { unfinished: 0 };
		Object.assign(parts.renderer, {
			drawFrame: (input: FrameInput) => {
				parts.drawn.push(input.frame);
				gpu.unfinished++;
			},
			completions: { unfinished: () => gpu.unfinished },
		});
		return { ...parts, gpu };
	}

	it('takes no new frame while two frames are unfinished on the GPU', () => {
		const { control, metrics, slots, drawn, renderer, gpu } = slowGpu();
		loop = runRenderLoop(renderer, control, metrics, {});
		// A sketch fast enough to publish a new frame before every callback.
		const publish = (frame: number) => Atomics.store(slots, Slot.FramesPublished, frame);
		refresh(DISPLAY_HZ, 4, (call) => publish(call + 1));
		expect(drawn).toEqual([1, 2]);
		// The sketch waits for the frame it published to be taken.
		expect(Atomics.load(slots, Slot.FramesTaken)).toBe(2);
		gpu.unfinished--;
		refresh(DISPLAY_HZ, 1, () => publish(5));
		expect(drawn).toEqual([1, 2, 5]);
	});

	it("takes the setup's frames in the direct loop only when the GPU has room for them", () => {
		const { control, metrics, slots, drawn, renderer, gpu } = slowGpu();
		loop = runDirectLoop(countingSketch(false), renderer, control, metrics, {});
		// The setup publishes each frame once the one before it was taken, as the preset check does.
		refresh(DISPLAY_HZ, 4, () =>
			Atomics.store(slots, Slot.FramesPublished, Atomics.load(slots, Slot.FramesTaken) + 1),
		);
		expect(drawn).toEqual([1, 2]);
		gpu.unfinished = 0;
		refresh(DISPLAY_HZ, 1);
		expect(drawn).toEqual([1, 2, 3]);
	});

	it('steps the sketch of the direct loop only when the GPU has room for its frame', () => {
		const { control, metrics, drawn, renderer, gpu } = slowGpu();
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, {});
		refresh(DISPLAY_HZ, 4);
		expect(drawn).toEqual([1, 2]);
		gpu.unfinished = 0;
		refresh(DISPLAY_HZ, 1);
		expect(drawn).toEqual([1, 2, 3]);
	});
});

describe('the wake-up before the next frame', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => {
		loop?.stop();
		mock.restore();
	});

	/** Runs `start` on a display at `hz`, and returns the delays of the timers it set. */
	function wakeDelays(hz: number, start: () => RenderLoop): number[] {
		const delays: number[] = [];
		spyOn(globalThis, 'setTimeout').mockImplementation(((_handler: () => void, ms: number) =>
			delays.push(ms)) as unknown as typeof setTimeout);
		loop = start();
		refresh(hz, CALLBACKS);
		return delays;
	}

	it('gives the wake-up a delay in whole milliseconds, a few before the next callback', () => {
		expect(wakeDelayMs(60)).toBe(13);
		expect(wakeDelayMs(120)).toBe(4);
		// A display too fast for a wake-up gets one at once.
		expect(wakeDelayMs(360)).toBe(0);
	});

	it('wakes a worker before each callback, at the rate the refresh meter measured', () => {
		const { control, metrics, renderer } = setup();
		const hz = 120;
		const delays = wakeDelays(hz, () => runRenderLoop(renderer, control, metrics, {}));
		expect(delays).toHaveLength(CALLBACKS);
		// Until the refresh meter has its first samples, the wake-up assumes a 60 Hz display.
		expect(delays[0]).toBe(wakeDelayMs(60));
		expect(delays.at(-1)).toBe(wakeDelayMs(hz));
	});

	it('wakes the thread of the direct loop too', () => {
		const { control, metrics, renderer } = setup();
		const delays = wakeDelays(DISPLAY_HZ, () =>
			runDirectLoop(countingSketch(), renderer, control, metrics, {}),
		);
		expect(delays).toHaveLength(CALLBACKS);
	});

	it('sets no timer on a page, whose frame callbacks follow the display', () => {
		const { control, metrics, renderer } = setup();
		const scope = globalThis as { document?: unknown };
		scope.document = {};
		try {
			const delays = wakeDelays(DISPLAY_HZ, () => runRenderLoop(renderer, control, metrics, {}));
			expect(delays).toEqual([]);
		} finally {
			delete scope.document;
		}
	});
});

describe('the hold to the display rate', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	/** Safari runs a worker's frame callbacks from a timer, every 15 ms. */
	const TIMER_HZ = 1000 / 15;
	const CALLS = 640;
	/** Callbacks before the refresh meter's first measurement, which draw at the callbacks' rate. */
	const UNMEASURED = 40;

	/** Frames per second drawn after the refresh meter's first measurement. */
	function heldRate(drawn: number[], callbackHz: number): number {
		const held = drawn.filter((frame) => frame > UNMEASURED).length;
		return (held * callbackHz) / (CALLS - UNMEASURED);
	}

	/** Runs the render loop with a sketch that publishes a frame before every callback. */
	function runTimed(displayHz: number, callbackHz: number): number[] {
		const { control, metrics, slots, drawn, renderer } = setup();
		Atomics.store(slots, Slot.DisplayInterval, Math.round(1_000_000 / displayHz));
		loop = runRenderLoop(renderer, control, metrics, {});
		refresh(callbackHz, CALLS, (call) => Atomics.store(slots, Slot.FramesPublished, call + 1));
		return drawn;
	}

	it('holds a worker whose callbacks come from a timer to the display rate that the page measured', () => {
		const drawn = runTimed(60, TIMER_HZ);
		expect(heldRate(drawn, TIMER_HZ)).toBeCloseTo(60, 0);
		// Until the meter has measured, every callback draws.
		expect(drawn.filter((frame) => frame <= 32)).toHaveLength(32);
	});

	it('draws at every timer callback when the display is faster than the timer', () => {
		expect(runTimed(72, TIMER_HZ)).toHaveLength(CALLS);
	});

	it('leaves a worker whose callbacks follow the display alone, whatever rate the page measured', () => {
		// A busy page thread can measure a slower rate than the display runs at.
		expect(runTimed(30, 60)).toHaveLength(CALLS);
	});

	/**
	 * Runs the render loop's callbacks at each rate of `rates` in turn, `CALLS` times each, with the
	 * page's measurement of a display at `displayHz`, and returns the refresh rate that the metrics
	 * held at the end of each rate.
	 */
	function recordedRates(displayHz: number, rates: number[]): number[] {
		const { control, metrics, slots, renderer, reader } = setup();
		Atomics.store(slots, Slot.DisplayInterval, Math.round(1_000_000 / displayHz));
		loop = runRenderLoop(renderer, control, metrics, {});
		let time = 0;
		return rates.map((hz) => {
			for (let call = 0; call < CALLS; call++) {
				time += 1000 / hz;
				const callbacks = pending;
				pending = [];
				for (const callback of callbacks) callback(time);
			}
			return reader.refreshHz;
		});
	}

	it("records the page's display rate once a timer runs the worker's callbacks", () => {
		// While the worker waits for the GPU, Safari's timer calls it less often: at 45 or at 48
		// times a second, the rate of no display or of one. The frame budget still follows the display.
		expect(recordedRates(60, [TIMER_HZ, 45, 48])).toEqual([60, 60, 60]);
	});

	it('records the rate of callbacks that follow the display, whatever rate the page measured', () => {
		expect(recordedRates(30, [60, 120])).toEqual([60, 120]);
	});

	it('holds the direct loop to the display rate too', () => {
		const { control, metrics, slots, drawn, renderer } = setup();
		Atomics.store(slots, Slot.DisplayInterval, Math.round(1_000_000 / 60));
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, {});
		refresh(TIMER_HZ, CALLS);
		expect(heldRate(drawn, TIMER_HZ)).toBeCloseTo(60, 0);
	});

	it('does not hold the frames of the page, whose callbacks follow the display', () => {
		const scope = globalThis as { document?: unknown };
		scope.document = {};
		try {
			expect(runTimed(60, TIMER_HZ)).toHaveLength(CALLS);
		} finally {
			delete scope.document;
		}
	});
});

describe("the display's rate on the page's thread", () => {
	let loop: RenderLoop | undefined;
	const scope = globalThis as { document?: unknown };
	beforeEach(() => {
		scope.document = {};
	});
	afterEach(() => {
		loop?.stop();
		delete scope.document;
	});

	const DISPLAY_MS = 1000 / 72;
	/** Callbacks before the sketch publishes its first frame, as while the pipelines build. */
	const IDLE = 20;
	const CALLS = 600;

	/**
	 * Runs the render loop on the page, with callbacks as Safari's page makes them while the GPU
	 * falls behind: the callback after one that drew a frame comes `drawnMs` later, at no refresh.
	 * The callback after one that drew nothing comes at the display's next refresh, part of a
	 * refresh later when the one before it drew, and a whole refresh later when it drew nothing too.
	 * Each callback after the first `idle` finds a new frame. `run` makes `calls` callbacks and
	 * returns how many of those that found a frame drew nothing.
	 */
	function slowedPage(pacing: FramePacing = {}, idle = IDLE) {
		const { control, metrics, slots, drawn, renderer, reader } = setup();
		loop = runRenderLoop(renderer, control, metrics, pacing);
		let call = 0;
		let time = 0;
		let lastDrew = false;
		const run = (calls: number, drawnMs: number, displayMs = DISPLAY_MS) => {
			let skipped = 0;
			for (const end = call + calls; call < end; call++) {
				const found = call >= idle;
				if (found) Atomics.store(slots, Slot.FramesPublished, call + 1);
				const before = drawn.length;
				const callbacks = pending;
				pending = [];
				for (const callback of callbacks) callback(time);
				const drew = drawn.length > before;
				if (found && !drew) skipped++;
				time += drew ? drawnMs : lastDrew ? displayMs / 2 : displayMs;
				lastDrew = drew;
			}
			return skipped;
		};
		return { run, drawn, reader };
	}

	/** Runs `slowedPage` for `CALLS` callbacks whose frames come `drawnMs` apart. */
	function runSlowed(drawnMs: number, idle = IDLE, pacing: FramePacing = {}) {
		const page = slowedPage(pacing, idle);
		const skipped = page.run(CALLS, drawnMs);
		return { skipped, refreshHz: page.reader.refreshHz };
	}

	it('records the display rate while slowed callbacks draw every frame', () => {
		// Safari's page callbacks at 34 a second under the hold's load, on a 72 Hz display.
		const { skipped, refreshHz } = runSlowed(1000 / 34);
		expect(refreshHz).toBe(72);
		// Pairs of callbacks draw nothing now and then, so the interval after them measures the display.
		expect(skipped).toBeGreaterThan(0);
		expect(skipped % 2).toBe(0);
	});

	it('measures the display through such callbacks when every callback found a frame', () => {
		expect(runSlowed(1000 / 34, 0).refreshHz).toBe(72);
	});

	it('spaces the checks out while the display keeps its rate', () => {
		const page = slowedPage();
		page.run(3000, 1000 / 34);
		// The stretch between checks has grown to its longest: one pair in about 242 callbacks.
		const skipped = page.run(2420, 1000 / 34);
		expect(skipped).toBeGreaterThanOrEqual(18);
		expect(skipped).toBeLessThanOrEqual(22);
		expect(page.reader.refreshHz).toBe(72);
	});

	it('checks often again once the display turns slower', () => {
		const page = slowedPage();
		page.run(3000, 1000 / 34);
		// A window moved to a 30 Hz screen while the frames run at 20 a second. At the longest
		// stretch, 8 checks would take some 1,900 callbacks.
		page.run(800, 1000 / 20, 1000 / 30);
		expect(page.reader.refreshHz).toBe(30);
	});

	it('makes no checks with ?display-check=off', () => {
		const { skipped, refreshHz } = runSlowed(1000 / 34, IDLE, { displayChecks: false });
		expect(skipped).toBe(0);
		// The callbacks before the first frame drew nothing, and measured the display.
		expect(refreshHz).toBe(72);
	});

	it('keeps the rate of callbacks that ran at the display rate once they slow', () => {
		// The page's thread runs the sketch and draws from the first callback on, so no callback
		// drew nothing before the load came.
		const { control, metrics, renderer, reader } = setup();
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, {});
		let time = 0;
		const run = (calls: number, ms: number) => {
			for (let call = 0; call < calls; call++) {
				const callbacks = pending;
				pending = [];
				for (const callback of callbacks) callback(time);
				time += ms;
			}
		};
		run(CALLBACKS, DISPLAY_MS);
		expect(reader.refreshHz).toBe(72);
		// A sketch that spins for two refreshes slows every callback that steps it.
		run(CALLBACKS, 1000 / 28);
		expect(reader.refreshHz).toBe(72);
	});

	it('draws every callback where the callbacks keep the display rate', () => {
		const { skipped, refreshHz } = runSlowed(DISPLAY_MS);
		expect(refreshHz).toBe(72);
		expect(skipped).toBe(0);
	});

	it('follows a display that turns slower, then draws every callback again', () => {
		const { control, metrics, slots, drawn, renderer, reader } = setup();
		loop = runRenderLoop(renderer, control, metrics, {});
		let time = 0;
		const run = (calls: number, ms: number, publish: boolean) => {
			for (let call = 0; call < calls; call++) {
				if (publish) Atomics.store(slots, Slot.FramesPublished, drawn.length + 1);
				const callbacks = pending;
				pending = [];
				for (const callback of callbacks) callback(time);
				time += ms;
			}
		};
		run(CALLS, DISPLAY_MS, false);
		expect(reader.refreshHz).toBe(72);
		// A window moved to a 30 Hz screen: every callback comes 33 ms after the last.
		run(CALLS, 1000 / 30, true);
		expect(reader.refreshHz).toBe(30);
		const before = drawn.length;
		run(CALLS, 1000 / 30, true);
		expect(drawn.length - before).toBe(CALLS);
	});
});
