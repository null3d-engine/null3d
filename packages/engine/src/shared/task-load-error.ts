// The error that a task's module throws when its code or WebAssembly cannot start, as against a
// failure on the task's input. It lives apart from the worker's task server, so the public entry
// point exports it without the worker's code.

/**
 * A failure to start a task's code or WebAssembly, as against a failure on the task's input. The
 * worker knows it by its name, which every copy of this module gives it.
 *
 * @category api/tasks
 */
export class TaskLoadError extends Error {
	/** The name that marks a failed start, which the worker reads. */
	override name = 'TaskLoadError';
}
