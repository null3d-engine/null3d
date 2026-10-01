// How the engine's threads wait for each other without blocking. A thread waits for a control slot
// to change. Where the browser has Atomics.waitAsync, the wait watches the slot, and Atomics.notify
// ends it. Firefox before 145 lacks it, and ?wake=message acts it out. There the thread that changes
// a slot also sends a message to the thread that runs the sketch, the one thread that waits this
// way, and any such message ends each of that thread's waits. So a wait can end before its slot
// changes, and every caller checks its slot again after a wait.

/** The message that wakes the thread that runs the sketch. */
export const WAKE = { type: 'wake' } as const;

/** What carries wake messages to the thread that runs the sketch: its worker, or a port to it. */
export interface WakeTarget {
	postMessage(message: typeof WAKE): void;
}

interface WakeState {
	/** True when this thread's waits end at wake messages, not at Atomics.notify. */
	byMessage: boolean;
	/** This thread's waits for a wake message. */
	waiters: (() => void)[];
}

/** The key of the thread's wake state on its global object. */
const STATE = Symbol.for('null3d.wakes');
/** The thread's global object, which holds the wake state for every copy of this module. */
const thread = globalThis as { [STATE]?: WakeState };
/** The thread's wake state. The first copy of this module in the thread makes it. */
const state: WakeState = thread[STATE] ?? { byMessage: false, waiters: [] };
thread[STATE] = state;

/** Sets whether this thread's waits end at wake messages rather than at Atomics.notify. */
export function setWakeByMessage(byMessage: boolean): void {
	state.byMessage = byMessage;
}

/**
 * A promise that settles when the slot no longer holds `value`, or undefined when it holds another
 * value already. With wake messages, it settles at the next one, which may come before the slot
 * changes. A plain function, so a wait with Atomics.waitAsync makes no promise beyond the browser's
 * own.
 */
export function slotChange(
	slots: Int32Array,
	slot: number,
	value: number,
): Promise<unknown> | undefined {
	if (!state.byMessage) {
		const wait = Atomics.waitAsync(slots, slot, value);
		return wait.async ? wait.value : undefined;
	}
	if (Atomics.load(slots, slot) !== value) return undefined;
	return new Promise<void>((resolve) => {
		state.waiters.push(resolve);
	});
}

/** Ends each of this thread's waits for a wake message. */
export function wakeWaiters(): void {
	const { waiters } = state;
	for (let resolve = waiters.pop(); resolve; resolve = waiters.pop()) resolve();
}

/** Ends this thread's waits at each message that comes through `port`. */
export function wakeFrom(port: MessagePort): void {
	port.onmessage = wakeWaiters;
}

/**
 * Wakes the threads that wait for a slot, after this thread changed it. With wake messages, it also
 * ends this thread's own waits, and sends a wake message through `to`, where another thread runs the
 * sketch.
 */
export function notifySlot(slots: Int32Array, slot: number, to?: WakeTarget): void {
	Atomics.notify(slots, slot);
	if (!state.byMessage) return;
	wakeWaiters();
	to?.postMessage(WAKE);
}
