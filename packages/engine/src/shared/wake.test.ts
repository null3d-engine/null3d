import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from './control';
import {
	notifySlot,
	RECHECK_MS,
	setWakeByMessage,
	slotChange,
	slotChangeOrRecheck,
	WAKE,
	type WakeTarget,
	wakeFrom,
} from './wake';

/** A wake target that records what it was sent. */
function recorder(): WakeTarget & { sent: unknown[] } {
	const sent: unknown[] = [];
	return { sent, postMessage: (message) => sent.push(message) };
}

/** True once the promise has settled, after the microtasks queued so far have run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
	let done = false;
	void promise.then(() => {
		done = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	return done;
}

afterEach(() => setWakeByMessage(false));

describe('waits that end at wake messages', () => {
	test('end at a wake from another thread, and not before', async () => {
		setWakeByMessage(true);
		const { slots } = controlViews(createControlBuffer(true));
		const change = slotChange(slots, Slot.FramesTaken, 0);
		if (!change) throw new Error('the wait ended before the slot changed');
		expect(await settled(change)).toBe(false);
		const { port1, port2 } = new MessageChannel();
		wakeFrom(port1);
		port2.postMessage(WAKE);
		await change;
		port1.close();
	});

	test('need no wait when the slot holds another value already', () => {
		setWakeByMessage(true);
		const { slots } = controlViews(createControlBuffer(true));
		Atomics.store(slots, Slot.FramesTaken, 3);
		expect(slotChange(slots, Slot.FramesTaken, 2)).toBeUndefined();
	});

	test('end when this thread changes the slot, and the change wakes the other thread', async () => {
		setWakeByMessage(true);
		const { slots } = controlViews(createControlBuffer(true));
		const change = slotChange(slots, Slot.PipelinesBuilt, 0);
		const target = recorder();
		Atomics.store(slots, Slot.PipelinesBuilt, 1);
		notifySlot(slots, Slot.PipelinesBuilt, target);
		expect(await settled(change as Promise<unknown>)).toBe(true);
		expect(target.sent).toEqual([WAKE]);
	});
});

describe('waits with Atomics.waitAsync', () => {
	test('end at the slot change, and send no message', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const change = slotChange(slots, Slot.FramesTaken, 0);
		if (!change) throw new Error('the wait ended before the slot changed');
		const target = recorder();
		Atomics.store(slots, Slot.FramesTaken, 1);
		notifySlot(slots, Slot.FramesTaken, target);
		await change;
		expect(target.sent).toEqual([]);
	});
});

describe('waits of a start', () => {
	test('end at the slot change', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		const change = slotChangeOrRecheck(slots, Slot.PipelinesBuilt, 0);
		if (!change) throw new Error('the wait ended before the slot changed');
		Atomics.store(slots, Slot.PipelinesBuilt, 1);
		notifySlot(slots, Slot.PipelinesBuilt);
		expect(await settled(change)).toBe(true);
	});

	test('end after a short time when the browser misses the wake', async () => {
		const { slots } = controlViews(createControlBuffer(true));
		// Safari's fault: the wait stays pending after the notify that should end it.
		const missed = spyOn(Atomics, 'waitAsync').mockImplementation(() => ({
			async: true,
			value: new Promise<'ok'>(() => {}),
		}));
		try {
			const started = performance.now();
			const change = slotChangeOrRecheck(slots, Slot.PipelinesBuilt, 0);
			if (!change) throw new Error('the wait ended before the slot changed');
			await change;
			expect(performance.now() - started).toBeGreaterThanOrEqual(RECHECK_MS - 5);
		} finally {
			missed.mockRestore();
		}
	});

	test('need no wait when the slot holds another value already', () => {
		const { slots } = controlViews(createControlBuffer(true));
		Atomics.store(slots, Slot.PipelinesBuilt, 2);
		expect(slotChangeOrRecheck(slots, Slot.PipelinesBuilt, 0)).toBeUndefined();
	});
});
