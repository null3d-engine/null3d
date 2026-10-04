// The tasks that the on-demand loader (shared/tasks.ts) sends to a job worker, or in the
// single-threaded build to the task worker: decoders and other code that loads on first use. Each
// request names its task, brings the compiled WebAssembly modules that this worker has not had yet,
// and the task's input. The worker imports the task's module once, runs it, and answers with its
// output or the reason it failed. The engine's own tasks are imported by name below; an add-on's
// task comes by the address of its module.

/** A request of the loader. */
export interface TaskRequest {
	id: number;
	/** The task's name. */
	task: string;
	/** The address of the task's module, for a task that the engine does not hold. */
	script?: string;
	/** Compiled modules that this worker has not had before, by name. */
	modules?: [string, WebAssembly.Module][];
	input: unknown;
}

/** Where a task failed: loading its module or its WebAssembly, or running it. */
export type TaskStage = 'load' | 'run';

/** An answer: the task's output, or where and why it failed. */
export type TaskAnswer =
	| { id: number; output: unknown }
	| { id: number; failed: { stage: TaskStage; message: string } };

/** What a task's module runs. */
export interface TaskModule {
	/**
	 * Runs the task on `input`, with the compiled modules the loader sent by name. Throws a
	 * `TaskLoadError` when its code or WebAssembly cannot start.
	 */
	run(input: unknown, wasm: (name: string) => WebAssembly.Module): TaskResult | Promise<TaskResult>;
}

/** A task's output, and the objects that move to the loader with it rather than being copied. */
export interface TaskResult {
	output: unknown;
	transfer?: Transferable[];
}

/**
 * A failure to start a task's code or WebAssembly, as against a failure on the task's input. The
 * worker knows it by its name, which every copy of this module gives it.
 */
export class TaskLoadError extends Error {
	override name = 'TaskLoadError';
}

/** The engine's own tasks, which each load the first time this worker runs one. */
const ENGINE_TASKS: Record<string, () => Promise<TaskModule>> = {
	ktx2: () => import('../scene/ktx2-transcode'),
};

/** The receiving end of the loader's requests. */
export interface TaskSource {
	onmessage: ((event: MessageEvent<TaskRequest>) => unknown) | null;
	postMessage(message: TaskAnswer, transfer: Transferable[]): void;
}

/**
 * Serves the loader's tasks from `source`, and calls `finished` after each one. `whenIdle` resolves
 * once `idle` holds, checked after each task: a job worker waits there until it has run every task
 * that it was called for.
 */
export function serveTasks(
	source: TaskSource,
	finished: () => void = () => {},
): { whenIdle(idle: () => boolean): Promise<void> } {
	const modules = new Map<string, WebAssembly.Module>();
	const loaded = new Map<string, Promise<TaskModule>>();
	let waiters: (() => void)[] = [];
	const wasm = (name: string) => {
		const module = modules.get(name);
		if (!module) throw new TaskLoadError(`the loader sent no ${name} module`);
		return module;
	};
	const load = (request: TaskRequest): Promise<TaskModule> => {
		const key = request.script ?? request.task;
		let module = loaded.get(key);
		if (!module) {
			const engineTask = ENGINE_TASKS[request.task];
			module = request.script
				? (import(/* @vite-ignore */ request.script) as Promise<TaskModule>)
				: engineTask
					? engineTask()
					: Promise.reject(new TaskLoadError(`the engine has no task ${request.task}`));
			// A module that did not load lets the next request try again.
			module.catch(() => loaded.delete(key));
			loaded.set(key, module);
		}
		return module;
	};
	const run = async (request: TaskRequest) => {
		for (const [name, module] of request.modules ?? []) modules.set(name, module);
		let stage: TaskStage = 'load';
		try {
			const task = await load(request);
			stage = 'run';
			const { output, transfer = [] } = await task.run(request.input, wasm);
			source.postMessage({ id: request.id, output }, transfer);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (error instanceof Error && error.name === 'TaskLoadError') stage = 'load';
			source.postMessage({ id: request.id, failed: { stage, message } }, []);
		} finally {
			finished();
			const woken = waiters;
			waiters = [];
			for (const wake of woken) wake();
		}
	};
	source.onmessage = (event) => void run(event.data);
	return {
		async whenIdle(idle) {
			while (!idle()) await new Promise<void>((resolve) => waiters.push(resolve));
		},
	};
}
