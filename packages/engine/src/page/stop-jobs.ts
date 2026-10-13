// Ends the job workers' loops from the page, which holds the engine's shared memory but not the
// core that runs the job system. A job worker without work blocks its thread in a wait. Safari
// never frees the shared memory of a thread that it stops inside such a wait, not even after a
// reload, so the page wakes the job workers and ends their loops itself, synchronously: when the
// engine stops, and when the page leaves without stopping the engine, as a page in a frame does
// when its frame goes away. A page that leaves also waits a moment for the woken workers to leave
// their loops, because the browser stops them as soon as the page has gone.
//
// A job worker that blocks never runs its thread's tasks either. Chrome's measurement of the page's
// memory waits until every worker has run it as a task, and while it waits for a blocked job worker
// the whole page can stop answering, for minutes. So while a measurement is in flight, the page
// writes the job system's yield word, and idle job workers let their threads run tasks between
// frame jobs instead of blocking.

import { Slot } from '../shared/control';

/**
 * How long stopping the engine waits for its job workers and the worker that draws to stop. A
 * thread that has not answered by then could still run in the engine's memory, so the page keeps
 * no memory for the next engine after such a stop (D-98).
 */
export const STOP_TIMEOUT_MS = 2_000;

/**
 * Sets the job system's stop flag, then wakes every job worker that waits for work, as the core's
 * own shutdown does. Each worker then leaves its loop instead of waiting again, and later parallel
 * loops run on the sketch thread alone. It does nothing before the sketch thread has created the
 * job system, and nothing after the first call.
 */
export function stopJobWorkers(memory: WebAssembly.Memory, slots: Int32Array): void {
	stopJobWorkersAt(
		memory,
		Atomics.load(slots, Slot.JobsWakeAddress),
		Atomics.load(slots, Slot.JobsStopAddress),
	);
}

/**
 * Like `stopJobWorkers`, with the addresses of the job system's wake word and stop flag, which the
 * core's `jobsWakeAddress` and `jobsStopAddress` give.
 */
export function stopJobWorkersAt(memory: WebAssembly.Memory, wake: number, stop: number): void {
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

/**
 * Asks the job workers to let their threads run tasks, as a measurement of the page's memory
 * starts, and returns the call that ends the request as the measurement ends. It adds one to the
 * job system's yield word: while the word is not zero, each idle job worker leaves the loop to run
 * its thread's tasks, then comes back for the frame jobs. It wakes every job worker that waits for
 * work, so a sleeping worker leaves at once. Before the sketch thread has created the job system,
 * it asks nothing, and the returned call does nothing.
 */
export function yieldJobWorkers(memory: WebAssembly.Memory, slots: Int32Array): () => void {
	const wake = Atomics.load(slots, Slot.JobsWakeAddress);
	const word = Atomics.load(slots, Slot.JobsYieldAddress);
	if (wake === 0 || word === 0) return () => {};
	// Each step makes its own view and keeps none, since the memory may grow meanwhile.
	const words = () => new Int32Array(memory.buffer);
	const at = (address: number) => address / Int32Array.BYTES_PER_ELEMENT;
	Atomics.add(words(), at(word), 1);
	const woken = words();
	Atomics.add(woken, at(wake), 1);
	Atomics.notify(woken, at(wake));
	return () => {
		Atomics.sub(words(), at(word), 1);
	};
}
