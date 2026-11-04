// The failure of a task that ran in a job worker. It lives apart from the loader, so an add-on can
// tell a failure by its class without loading the loader's code. A thread can hold two copies of
// this module, as it can of the engine's error class, and the one loader that they share makes the
// failures of both with one copy's class. So each copy marks its failures under a registered
// symbol, which every copy shares, and instanceof accepts the failures of every copy.

import type { TaskStage } from '../workers/tasks';

/** The mark that every copy of TaskFailure puts on its failures. */
const TASK_FAILURE = Symbol.for('null3d.taskFailure');

/**
 * A task that failed in its worker, loading its code or WebAssembly or running on its input, or
 * that still waited when the engine stopped.
 *
 * @category api/tasks
 */
export class TaskFailure extends Error {
	constructor(
		/** Where the task failed, or that the engine stopped before it answered. */
		readonly stage: TaskStage | 'stopped',
		message: string,
	) {
		super(message);
	}

	/**
	 * True for a failure from any copy of this class in the thread, by the mark that each copy puts
	 * on its failures. A subclass keeps the usual check of the prototype chain.
	 */
	static [Symbol.hasInstance](value: unknown): value is TaskFailure {
		// biome-ignore lint/complexity/noThisInStatic: this is the class that instanceof names
		if (this !== TaskFailure) return Function.prototype[Symbol.hasInstance].call(this, value);
		return typeof value === 'object' && value !== null && TASK_FAILURE in value;
	}

	/** Marks every failure of this class as a task's failure. */
	get [TASK_FAILURE](): true {
		return true;
	}
}
