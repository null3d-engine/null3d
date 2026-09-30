import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	controlViews,
	createControlBuffer,
	EVENT_GAMEPAD_BUTTON,
	FIELD_BUTTONS,
	FIELD_CODE,
	FIELD_ID,
	FIELD_TYPE,
	FIELD_X,
	INPUT_EVENT_INTS,
	INPUT_RING_EVENTS,
	Slot,
} from '../shared/control';
import { GamepadWatch, type PadReading } from './gamepads';
import { InputRing } from './input-ring';

/** A pad with its buttons as values, pressed from 0.5 up, and its axes. */
function pad(index: number, buttons: number[], axes: number[] = [0, 0, 0, 0]): PadReading {
	return {
		index,
		connected: true,
		buttons: buttons.map((value) => ({ pressed: value >= 0.5, value })),
		axes,
	};
}

/** A ring on a fresh control block, the watch that writes into it, and the pads it reads. */
function setup() {
	const control = createControlBuffer(false);
	const views = controlViews(control);
	let pads: (PadReading | null)[] = [];
	let reads = 0;
	const watch = new GamepadWatch(new InputRing(control), () => {
		reads++;
		return pads;
	});
	let taken = 0;
	/** The records written since the last call, as short text. */
	const written = () => {
		const end = Atomics.load(views.slots, Slot.InputWrite);
		const out: string[] = [];
		for (; taken < end; taken++) {
			const base = (taken % INPUT_RING_EVENTS) * INPUT_EVENT_INTS;
			const type = views.inputInts[base + FIELD_TYPE];
			const what = type === EVENT_GAMEPAD_BUTTON ? 'button' : 'axis';
			const value = Number((views.inputFloats[base + FIELD_X] as number).toFixed(3));
			const pressed =
				type === EVENT_GAMEPAD_BUTTON
					? ` ${views.inputInts[base + FIELD_BUTTONS] === 1 ? 'down' : 'up'}`
					: '';
			out.push(
				`pad ${views.inputInts[base + FIELD_ID]} ${what} ${views.inputInts[base + FIELD_CODE]} ${value}${pressed}`,
			);
		}
		return out;
	};
	return {
		views,
		watch,
		written,
		setPads: (next: (PadReading | null)[]) => {
			pads = next;
		},
		reads: () => reads,
	};
}

describe('GamepadWatch', () => {
	it('writes the buttons and axes that changed, and leaves out a small change of a value', () => {
		const { watch, written, setPads } = setup();
		setPads([null, pad(1, [1, 0, 0, 0, 0, 0, 0, 0.25], [0.5, 0, 0, 0])]);
		expect(watch.poll()).toBe(true);
		expect(written()).toEqual([
			'pad 1 button 0 1 down',
			'pad 1 button 7 0.25 up',
			'pad 1 axis 0 0.5',
		]);
		watch.poll();
		expect(written()).toEqual([]);
		setPads([null, pad(1, [1, 0, 0, 0, 0, 0, 0, 0.255], [0.505, 0, 0, 0])]);
		watch.poll();
		expect(written()).toEqual([]);
		// A value that comes to rest at 0 is written, however small the change.
		setPads([null, pad(1, [1, 0, 0, 0, 0, 0, 0, 0.255], [0, 0, 0, 0])]);
		watch.poll();
		expect(written()).toEqual(['pad 1 axis 0 0']);
	});

	it('releases the buttons and centers the sticks of a pad that goes away', () => {
		const { watch, written, setPads } = setup();
		setPads([pad(0, [0, 1], [0, -1, 0, 0])]);
		watch.poll();
		written();
		setPads([]);
		expect(watch.poll()).toBe(false);
		expect(written()).toEqual(['pad 0 button 1 0 up', 'pad 0 axis 1 0']);
	});

	it('writes presses while half the ring waits for the sketch, and the values once it has room', () => {
		const { views, watch, written, setPads } = setup();
		Atomics.store(views.slots, Slot.InputWrite, INPUT_RING_EVENTS / 2);
		written();
		setPads([pad(0, [1], [0.8, 0, 0, 0])]);
		watch.poll();
		expect(written()).toEqual(['pad 0 button 0 1 down']);
		Atomics.store(views.slots, Slot.InputRead, Atomics.load(views.slots, Slot.InputWrite));
		watch.poll();
		expect(written()).toEqual(['pad 0 axis 0 0.8']);
	});
});

describe('GamepadWatch reading loop', () => {
	let requests: FrameRequestCallback[] = [];
	const scope = globalThis as {
		requestAnimationFrame?: (callback: FrameRequestCallback) => number;
		cancelAnimationFrame?: (handle: number) => void;
	};
	beforeEach(() => {
		requests = [];
		scope.requestAnimationFrame = (callback) => requests.push(callback);
		scope.cancelAnimationFrame = () => {
			requests = [];
		};
	});
	afterEach(() => {
		delete scope.requestAnimationFrame;
		delete scope.cancelAnimationFrame;
	});
	/** Runs the frame callbacks the watch asked for, as one display frame. */
	const frame = () => {
		const callbacks = requests;
		requests = [];
		for (const callback of callbacks) callback(0);
	};

	it('reads the pads only while one is connected', () => {
		const { watch, written, setPads, reads } = setup();
		watch.start();
		// One read at the start finds no pad, and no loop starts.
		expect([reads(), requests.length]).toEqual([1, 0]);
		setPads([pad(0, [1])]);
		dispatchEvent(new Event('gamepadconnected'));
		expect([reads(), requests.length]).toEqual([2, 1]);
		frame();
		expect([reads(), requests.length]).toEqual([3, 1]);
		setPads([]);
		frame();
		expect([reads(), requests.length]).toEqual([4, 0]);
		expect(written()).toEqual(['pad 0 button 0 1 down', 'pad 0 button 0 0 up']);
		watch.stop();
		setPads([pad(0, [1])]);
		dispatchEvent(new Event('gamepadconnected'));
		expect([reads(), requests.length]).toEqual([4, 0]);
	});

	it('releases every button when it stops', () => {
		const { watch, written, setPads } = setup();
		setPads([pad(2, [0, 0, 1])]);
		watch.start();
		expect(written()).toEqual(['pad 2 button 2 1 down']);
		watch.stop();
		expect(written()).toEqual(['pad 2 button 2 0 up']);
		expect(requests).toHaveLength(0);
	});
});
