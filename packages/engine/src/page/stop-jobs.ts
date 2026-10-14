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
import { MemoryViews } from '../shared/memory-views';

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
	// The addresses sit in the shared Int32 slots, so above 2 GiB each reads signed (hard rule 31).
	stopJobWorkersAt(
		memory,
		Atomics.load(slots, Slot.JobsWakeAddress) >>> 0,
		Atomics.load(slots, Slot.JobsStopAddress) >>> 0,
	);
}

/**
 * Like `stopJobWorkers`, with the addresses of the job system's wake word and stop flag, which the
 * core's `jobsWakeAddress` and `jobsStopAddress` give.
 */
export function stopJobWorkersAt(memory: WebAssembly.Memory, wake: number, stop: number): void {
	if (wake === 0 || stop === 0) return;
	const views = new MemoryViews(memory);
	const flag = views.view(Uint8Array, stop, 1);
	if (Atomics.load(flag, 0) !== 0) return;
	Atomics.store(flag, 0, 1);
	const word = views.view(Int32Array, wake, 1);
	Atomics.add(word, 0, 1);
	Atomics.notify(word, 0);
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
	// The addresses sit in the shared Int32 slots, so above 2 GiB each reads signed (hard rule 31).
	const wake = Atomics.load(slots, Slot.JobsWakeAddress) >>> 0;
	const word = Atomics.load(slots, Slot.JobsYieldAddress) >>> 0;
	if (wake === 0 || word === 0) return () => {};
	// Each step makes its own view and keeps none, since the memory may grow meanwhile.
	const views = new MemoryViews(memory);
	Atomics.add(views.i32(word, 1), 0, 1);
	const woken = views.i32(wake, 1);
	Atomics.add(woken, 0, 1);
	Atomics.notify(woken, 0);
	return () => {
		Atomics.sub(views.i32(word, 1), 0, 1);
	};
}
