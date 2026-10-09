// The on-demand loader: one way to load WebAssembly and code that a page needs only on first use,
// for the engine's own decoders and for add-ons alike. It runs in the thread that runs the sketch.
//
// It compiles each WebAssembly module once per page with WebAssembly.compileStreaming, and posts
// the compiled module to each worker that runs it, which only instantiates it. Tasks run in the
// engine's job workers: a job worker leaves the job loop between frame jobs to run its tasks, and
// with two or more job workers the first never takes tasks, so one always serves frames. Where the
// engine has no job workers, the loader starts one task worker with its first task. The glTF
// worker takes compiled modules from the loader too (scene/gltf.ts). When the engine on this thread
// stops, the loader stops its task worker and fails the tasks that wait, and the next engine's
// tasks start afresh.

import type { TaskAnswer, TaskRequest, TaskStage } from '../workers/tasks';
import { onEngineStop } from './helper-workers';
import { type JobTaskHost, jobTasks } from './task-host';
import { compileWasm, type WasmError } from './wasm';
import { bootstrapFailure, spawnWorker } from './worker-start';

/** A WebAssembly file that loads on first use. */
export interface WasmFile {
	/** The name that the module goes by in the workers. */
	name: string;
	/** The file's address, written as `new URL('<file>', import.meta.url)` so bundlers ship it. */
	url: URL;
	/** What the file is, as error messages name it, such as "the KTX2 transcoder". */
	what: string;
}

/** A task that runs in the job workers. */
export interface Task {
	/** The engine task's name, or an add-on's name for its task. */
	name: string;
	/** The address of an add-on task's module; the engine's own tasks have none. */
	script?: URL;
	/** The WebAssembly files that the task's module runs. */
	wasm?: readonly WasmFile[];
}

/**
 * A task that failed in its worker, loading its code or WebAssembly or running on its input, or
 * that still waited when the engine stopped.
 */
export class TaskFailure extends Error {
	constructor(
		readonly stage: TaskStage | 'stopped',
		message: string,
	) {
		super(message);
	}
}

/** The thread's compiled modules, by name, which stays the same in every copy of this module. */
const COMPILED = Symbol.for('null3d.compiledModules');
const thread = globalThis as { [COMPILED]?: Map<string, Promise<WebAssembly.Module>> };

/**
 * Downloads and compiles a WebAssembly file once per thread: every later call gets the same
 * module. A failed download or compile lets a later call try again.
 */
export function compileOnce(file: WasmFile, error: WasmError): Promise<WebAssembly.Module> {
	thread[COMPILED] ??= new Map();
	const compiled = thread[COMPILED];
	let module = compiled.get(file.name);
	if (!module) {
		module = compileWasm(file.url, file.what, error).then((result) => result.module);
		module.catch(() => compiled.delete(file.name));
		compiled.set(file.name, module);
	}
	return module;
}

/** A worker that runs tasks, as the loader sees it. */
interface Runner {
	send(request: TaskRequest, transfer: Transferable[]): void;
	/** The modules this worker already has. */
	readonly modules: Set<string>;
	/** Its tasks that have not answered. */
	running: number;
}

/** A task that waits for its answer. */
interface Waiting {
	resolve(output: unknown): void;
	reject(error: Error): void;
	runner: Runner;
}

/** The workers that run this thread's tasks, and the tasks that wait for them. */
class Runners {
	private readonly waiting = new Map<number, Waiting>();
	private next = 0;
	/** The job workers that take tasks, or the task worker once it has started. */
	private runners: Runner[] | undefined;
	/** The job workers' ports that `runners` were made from. */
	private host: JobTaskHost | undefined;
	/** The task worker, once a task has started it on a thread without job workers. */
	private worker: Worker | undefined;
	/** True once the engine on this thread has stopped. */
	private ended = false;

	constructor(private readonly stopped: () => void) {}

	/** Runs `task` on `input` in the least busy worker, and resolves with its output. */
	async run(
		task: Task,
		input: unknown,
		transfer: Transferable[],
		error: WasmError,
	): Promise<unknown> {
		const modules = await Promise.all((task.wasm ?? []).map((file) => compileOnce(file, error)));
		if (this.ended) throw new TaskFailure('stopped', 'the engine stopped');
		const runner = this.leastBusy(error);
		const id = ++this.next;
		const request: TaskRequest = { id, task: task.name, input };
		if (task.script) request.script = task.script.href;
		const newModules = (task.wasm ?? []).flatMap((file, k) =>
			runner.modules.has(file.name)
				? []
				: [[file.name, modules[k]] as [string, WebAssembly.Module]],
		);
		if (newModules.length > 0) request.modules = newModules;
		for (const [name] of newModules) runner.modules.add(name);
		runner.running++;
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject, runner });
			runner.send(request, transfer);
		});
	}

	private leastBusy(error: WasmError): Runner {
		// A later engine on this thread brings job workers of its own.
		const host = jobTasks();
		if (host !== this.host) {
			this.host = host;
			this.runners = undefined;
		}
		this.runners ??= this.start(error);
		let best = this.runners[0] as Runner;
		for (const runner of this.runners) if (runner.running < best.running) best = runner;
		return best;
	}

	/** The job workers that take tasks; or, without job workers, a task worker that starts now. */
	private start(error: WasmError): Runner[] {
		const host = this.host;
		if (host) {
			// With two or more job workers, the first stays in the job loop for the frames. Where the
			// page starts them as the work grows, the tasks take the ones it was asked for.
			const usable = host.ensure ? host.ports.slice(0, host.ensure(2)) : host.ports;
			const ports = usable.length > 1 ? usable.slice(1) : usable;
			return ports.map((port) => {
				const index = host.ports.indexOf(port);
				port.onmessage = (event: MessageEvent<TaskAnswer>) => this.answer(event.data);
				return {
					modules: new Set(),
					running: 0,
					send(request, transfer) {
						// The call comes first, so the count covers the request by the time it arrives.
						host.call(index);
						port.postMessage(request, transfer);
					},
				};
			});
		}
		const worker = spawnWorker(
			() =>
				new Worker(new URL('../workers/task-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-tasks',
				}),
			error,
		);
		this.worker = worker;
		worker.onmessage = (event: MessageEvent<TaskAnswer>) => this.answer(event.data);
		worker.onerror = (event) => {
			event.preventDefault();
			worker.terminate();
			this.fail(event.message || 'its script did not load', error);
		};
		return [
			{
				modules: new Set(),
				running: 0,
				send: (request, transfer) => worker.postMessage(request, transfer),
			},
		];
	}

	private answer(answer: TaskAnswer): void {
		const waiting = this.waiting.get(answer.id);
		if (!waiting) return;
		this.waiting.delete(answer.id);
		waiting.runner.running--;
		if ('failed' in answer)
			waiting.reject(new TaskFailure(answer.failed.stage, answer.failed.message));
		else waiting.resolve(answer.output);
	}

	/**
	 * Fails every waiting task after the task worker failed to start: with the engine error that
	 * the worker's start gave, or E1406. A later task starts the worker again.
	 */
	private fail(message: string, error: WasmError): void {
		this.end(
			bootstrapFailure(message, error) ??
				error('E1406', `the engine's task worker did not start: ${message.replace(/\.$/, '')}.`),
		);
	}

	/**
	 * Ends these runners when the engine on this thread stops: stops the task worker, and fails every
	 * waiting task. The job workers leave with the engine, so their tasks would never answer.
	 */
	stop(): void {
		this.ended = true;
		this.worker?.terminate();
		// A port that still has a handler can keep these runners, and through them the core's call
		// and its memory, in a browser that is slow to see that the job worker has gone.
		for (const port of this.host?.ports ?? []) {
			port.onmessage = null;
			port.close();
		}
		this.host = undefined;
		this.runners = undefined;
		this.end(new TaskFailure('stopped', 'the engine stopped'));
	}

	/** Forgets these runners, so a later task starts afresh, and fails every waiting task. */
	private end(reason: Error): void {
		this.stopped();
		for (const { reject } of this.waiting.values()) reject(reason);
		this.waiting.clear();
	}
}

/** This thread's task runners, which start with the first task. */
let runners: Runners | undefined;

/**
 * Runs `task` on `input` in a job worker, or in the task worker where the engine has no job
 * workers, moving the `transfer` objects there. The task's WebAssembly files compile once per page,
 * here. Rejects with the engine error of a file that does not download or compile, made by
 * `error`, and with a `TaskFailure` when the task fails in its worker or the engine stops first.
 */
export function runTask<T>(
	task: Task,
	input: unknown,
	transfer: Transferable[],
	error: WasmError,
): Promise<T> {
	if (!runners) {
		const made: Runners = new Runners(() => {
			forget();
			if (runners === made) runners = undefined;
		});
		const forget = onEngineStop(() => made.stop());
		runners = made;
	}
	return runners.run(task, input, transfer, error) as Promise<T>;
}
