import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { watchDisplay } from './display';

/** Frame callbacks that the watch asked for, which the test runs in place of a display. */
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

/** A display at `hz` that calls the page `count` times. */
function refresh(hz: number, count: number, start = 0): void {
	for (let call = 0; call < count; call++) {
		const callbacks = pending;
		pending = [];
		for (const callback of callbacks) callback(start + (call * 1000) / hz);
	}
}

describe('watchDisplay', () => {
	it("writes the display's refresh period in microseconds once it has measured it", () => {
		const { slots } = controlViews(createControlBuffer(false));
		const stop = watchDisplay(slots);
		refresh(60, 10);
		expect(Atomics.load(slots, Slot.DisplayInterval)).toBe(0);
		refresh(60, 30, 10_000);
		expect(Atomics.load(slots, Slot.DisplayInterval)).toBe(16_667);
		// The display changes, as when the window moves to another screen.
		refresh(120, 40, 20_000);
		expect(Atomics.load(slots, Slot.DisplayInterval)).toBe(8_333);
		stop();
	});

	it('asks for no more frame callbacks once stopped', () => {
		const { slots } = controlViews(createControlBuffer(false));
		const stop = watchDisplay(slots);
		refresh(60, 5);
		stop();
		refresh(60, 1);
		expect(pending).toEqual([]);
	});
});
