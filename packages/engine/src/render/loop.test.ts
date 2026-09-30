import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import type { SketchRunner } from '../sketch/runner';
import { runDirectLoop } from './direct-loop';
import { type RenderLoop, runRenderLoop, wakeDelayMs } from './loop';
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

/** The control block, the metrics and a renderer that lists the frames it draws. */
function setup() {
	const control = createControlBuffer(false);
	const metrics = createMetricsBuffer(false, 0);
	const drawn: number[] = [];
	const renderer = {
		drawFrame: (input: FrameInput) => drawn.push(input.frame),
		finished: () => Promise.resolve(),
		resize() {},
	} as unknown as Renderer;
	const { slots } = controlViews(control);
	Atomics.store(slots, Slot.Running, 1);
	return { control, metrics, slots, drawn, renderer, reader: new MetricsReader(metrics) };
}

/** A sketch whose steps count frames from 1. */
function countingSketch(): SketchRunner {
	let frame = 0;
	return { step: () => ++frame } as unknown as SketchRunner;
}

const DISPLAY_HZ = 60;
/** Callbacks the display makes: two refresh meter samples. */
const CALLBACKS = 64;

describe('the render loop', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	it('draws nothing at a callback that finds no new frame', () => {
		const { control, metrics, slots, drawn, renderer } = setup();
		loop = runRenderLoop(renderer, control, metrics, undefined);
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
		loop = runRenderLoop(renderer, control, metrics, 30);
		// A sketch fast enough to publish a new frame before every callback.
		refresh(DISPLAY_HZ, CALLBACKS, (call) => Atomics.store(slots, Slot.FramesPublished, call + 1));
		expect(drawn).toHaveLength(CALLBACKS / 2);
		expect(reader.refreshHz).toBe(DISPLAY_HZ);
	});
});

describe('the direct loop', () => {
	let loop: RenderLoop | undefined;
	afterEach(() => loop?.stop());

	it('steps and draws nothing while the page pauses the engine', () => {
		const { control, metrics, slots, drawn, renderer } = setup();
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, undefined);
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
		loop = runDirectLoop(countingSketch(), renderer, control, metrics, 30);
		refresh(DISPLAY_HZ, CALLBACKS);
		expect(drawn).toHaveLength(CALLBACKS / 2);
		expect(reader.refreshHz).toBe(DISPLAY_HZ);
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
		const delays = wakeDelays(hz, () => runRenderLoop(renderer, control, metrics, undefined));
		expect(delays).toHaveLength(CALLBACKS);
		// Until the refresh meter has its first samples, the wake-up assumes a 60 Hz display.
		expect(delays[0]).toBe(wakeDelayMs(60));
		expect(delays.at(-1)).toBe(wakeDelayMs(hz));
	});

	it('wakes the thread of the direct loop too', () => {
		const { control, metrics, renderer } = setup();
		const delays = wakeDelays(DISPLAY_HZ, () =>
			runDirectLoop(countingSketch(), renderer, control, metrics, undefined),
		);
		expect(delays).toHaveLength(CALLBACKS);
	});

	it('sets no timer on a page, whose frame callbacks follow the display', () => {
		const { control, metrics, renderer } = setup();
		const scope = globalThis as { document?: unknown };
		scope.document = {};
		try {
			const delays = wakeDelays(DISPLAY_HZ, () =>
				runRenderLoop(renderer, control, metrics, undefined),
			);
			expect(delays).toEqual([]);
		} finally {
			delete scope.document;
		}
	});
});
