// Ends the job workers' loops from the page, which holds the engine's shared memory but not the
// core that runs the job system. A job worker without work blocks its thread in a wait. Safari
// never frees the shared memory of a thread that it stops inside such a wait, not even after a
// reload, so the page wakes the job workers and ends their loops itself, synchronously: when the
// engine stops, and when the page leaves without stopping the engine, as a page in a frame does
// when its frame goes away. A page that leaves also waits a moment for the woken workers to leave
// their loops, because the browser stops them as soon as the page has gone.

import { Slot } from '../shared/control';

/**
 * Sets the job system's stop flag, then wakes every job worker that waits for work, as the core's
 * own shutdown does. Each worker then leaves its loop instead of waiting again, and later parallel
 * loops run on the sketch thread alone. It does nothing before the sketch thread has created the
 * job system, and nothing after the first call.
 */
export function stopJobWorkers(memory: WebAssembly.Memory, slots: Int32Array): void {
	const wake = Atomics.load(slots, Slot.JobsWakeAddress);
	const stop = Atomics.load(slots, Slot.JobsStopAddress);
	if (wake === 0 || stop === 0) return;
	const buffer = memory.buffer;
	const flags = new Uint8Array(buffer);
	if (Atomics.load(flags, stop) !== 0) return;
	Atomics.store(flags, stop, 1);
	const words = new Int32Array(buffer);
	const word = wake / Int32Array.BYTES_PER_ELEMENT;
	Atomics.add(words, word, 1);
	Atomics.notify(words, word);
}

/**
 * How long a page that leaves waits for the job workers to leave their loops. A woken worker that
 * has no chunk to finish leaves within microseconds; one that runs a chunk finishes it first.
 */
export const LEAVE_WAIT_MS = 100;

/**
 * Waits, without yielding, until no job worker is inside the job system's loop, or until `ms` have
 * passed. A page that leaves has no later task in which to wait. Returns true when none is.
 */
export function waitForJobWorkersToLeave(slots: Int32Array, ms = LEAVE_WAIT_MS): boolean {
	const deadline = performance.now() + ms;
	while (Atomics.load(slots, Slot.JobsServing) > 0) if (performance.now() > deadline) return false;
	return true;
}
