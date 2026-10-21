// The public task hook: an add-on declares work that runs in a job worker, beside the frames. The
// loader that runs it loads on first use, so a page that runs no task downloads none of it, and its
// worker.

import { EngineError } from '../errors/engine-error';
import type { Task } from './tasks';

/**
 * Runs a task in a job worker, beside the frames, and resolves with its output.
 *
 * The task's module is imported once in each worker that runs it, so a module keeps its state
 * between tasks, and each of its WebAssembly files compiles once per page. A module exports `run`,
 * which gets the task's input and a function that returns each compiled module by the name that the
 * task gives it.
 *
 * The task runs in a job worker, never in the thread that ran the sketch. A job worker leaves the
 * job system only between the chunks of a frame, so a frame never waits for a task, and with two or
 * more job workers one stays for the frames.
 *
 * The engine resolves the promise between two frames, so code in its `then` runs before the next
 * frame's `onUpdate`, and that frame draws what the task wrote. Tasks run at the same time in
 * different job workers, so their answers come in no fixed order. Await one task's answer before
 * you queue the next when the order matters.
 *
 * A `SharedArrayBuffer` in the input reaches the worker shared rather than copied, and the task
 * writes into it. While the task runs, order the writes that both threads read with `Atomics`.
 * Once the promise resolves, the worker has stopped writing, and the thread that ran the task reads
 * the buffer as it stands. Such a buffer suits data too large to copy, such as the depths and order
 * of many instances sorted in every frame.
 *
 * The engine asks the page for job workers with the first task, and sends no task to one that did
 * not start. Where no job worker takes the tasks, the engine starts a task worker for them, as on a
 * page without worker threads.
 *
 * The promise rejects with a `TaskFailure` when the task's module or WebAssembly fails to start,
 * when its `run` throws, or when the engine stops before the answer arrives. A WebAssembly file
 * that does not download or compile rejects with the engine's error.
 *
 * Call it from the code that runs the sketch: the setup function or a callback. A task's input and
 * output must pass to another worker: numbers, strings, plain objects and arrays, typed arrays,
 * `ArrayBuffer`s, `SharedArrayBuffer`s and the objects that the transfer list names.
 *
 * @category api/tasks
 */
export function runTask<T>(task: Task, input: unknown, transfer: Transferable[] = []): Promise<T> {
	return import('./tasks').then(({ runTaskWithError }) =>
		runTaskWithError<T>(task, input, transfer, (code, message) => new EngineError(code, message)),
	);
}
