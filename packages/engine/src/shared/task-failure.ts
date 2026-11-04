// The failure of a task that ran in a job worker. It lives apart from the loader, so an add-on can
// tell a failure by its class without loading the loader's code.

import type { TaskStage } from '../workers/tasks';

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
}
