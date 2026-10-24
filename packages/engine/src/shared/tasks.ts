// The on-demand loader: one way to load WebAssembly and code that a page needs only on first use,
// for the engine's own decoders and for add-ons alike. It runs in the thread that runs the sketch,
// and an add-on declares its tasks through the public runTask (shared/run-task.ts), which loads
// this module on first use.
//
// It compiles each WebAssembly module once per page with WebAssembly.compileStreaming, and posts
// the compiled module to each worker that runs it, which only instantiates it. Tasks run in the
// engine's job workers: a job worker leaves the job loop between frame jobs to run its tasks, and
// with two or more job workers the first never takes tasks, so one always serves frames. The page
// says which job workers run. A worker whose script or its core did not load is left out of the
// tasks, because it would never answer, and where no job worker is left to take them the loader
// starts one task worker with its first task. The glTF worker takes compiled modules from the
// loader too (scene/gltf.ts). When the engine on this thread stops, the loader stops its task
// worker and fails the tasks that wait, and the next engine's tasks start afresh.

import type { TaskAnswer, TaskRequest } from '../workers/tasks';
import { onEngineStop } from './helper-workers';
import { TaskFailure } from './task-failure';
import { type JobTaskHost, jobTasks, taskTakers } from './task-host';
import { moduleKey } from './task-modules';
import { compileWasm, type WasmError } from './wasm';
import { bootstrapFailure, spawnWorker, watchWorkerError } from './worker-start';

/**
 * How long the first task waits for the page's word on which job workers run, in ms. The word comes
 * once the workers that the thread asked for have started, so it follows their downloads. A page
 * that never says gives the workers the thread asked for, as before the page could say at all.
 */
const ANNOUNCE_WAIT_MS = 10_000;

/** How often it looks for the page's word while it waits, in ms. */
const ANNOUNCE_POLL_MS = 4;

/**
 * A WebAssembly file that a task runs. The engine compiles it once per page and sends the compiled
 * module to each worker that runs the task, which instantiates it there.
 *
 * @category api/tasks
 */
export interface WasmFile {
	/** The name that the module goes by in the task's `run`, and in error messages. */
	name: string;
	/** The file's address, written as `new URL('<file>', import.meta.url)` so bundlers ship it. */
	url: URL;
	/** What the file is, as error messages name it, such as "the splat sorter". */
	what: string;
}

/**
 * Work that runs in a job worker, beside the frames.
 *
 * @category api/tasks
 */
export interface Task {
	/**
	 * The task's name. The engine's own tasks have names of their own, so give an add-on's task
	 * another one.
	 */
	name: string;
	/**
	 * The address of the task's module, written as `new URL('<file>', import.meta.url)` so bundlers
	 * ship it. The module exports `run`, which the worker calls once per task. A task without a
	 * script names one of the engine's own tasks.
	 */
	script?: URL;
	/** The WebAssembly files that the task's module runs, each with a name of its own. */
	wasm?: readonly WasmFile[];
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
	let module = compiled.get(file.url.href);
	if (!module) {
		module = compileWasm(file.url, file.what, error).then((result) => result.module);
		module.catch(() => compiled.delete(file.url.href));
		compiled.set(file.url.href, module);
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
	/** The request that the runner sends, which each call refills rather than making another. */
	request?: TaskRequest;
}

/** A task that waits for its answer. */
interface Waiting {
	resolve(output: unknown): void;
	reject(error: Error): void;
	runner: Runner;
}

/** The task's compiled modules, which a task without WebAssembly matches. */
const NO_MODULES: readonly WebAssembly.Module[] = [];
/** The modules that a runner lacks, for a task without WebAssembly. */
const NO_NEW_MODULES: readonly [string, WebAssembly.Module][] = [];
/** A waiting record's settle function before a task fills it. */
const NO_SETTLE = (): void => {};

/** The tasks that this thread has run, which the allocation check reads to judge one call. */
let taskCalls = 0;
(globalThis as { __null3dTaskCalls?: () => number }).__null3dTaskCalls = () => taskCalls;

/** The workers that run this thread's tasks, and the tasks that wait for them. */
class Runners {
	private readonly waiting = new Map<number, Waiting>();
	/** The records of answered tasks, which a later task fills again instead of making one. */
	private readonly free: Waiting[] = [];
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
		const files = task.wasm;
		const modules =
			files && files.length > 0
				? await Promise.all(files.map((file) => compileOnce(file, error)))
				: NO_MODULES;
		if (this.ended) throw new TaskFailure('stopped', 'the engine stopped');
		const starting = this.starting();
		if (starting) await starting;
		if (this.ended) throw new TaskFailure('stopped', 'the engine stopped');
		const runner = this.leastBusy(error);
		const id = ++this.next;
		let request = runner.request;
		if (!request) {
			request = { id: 0, task: '', input: undefined };
			runner.request = request;
		}
		request.id = id;
		request.task = task.name;
		request.input = input;
		const script = task.script?.href;
		request.script = script;
		const newModules =
			files && files.length > 0
				? files.flatMap((file, k) =>
						runner.modules.has(moduleKey(script, file.name))
							? []
							: [[moduleKey(script, file.name), modules[k]] as [string, WebAssembly.Module]],
					)
				: NO_NEW_MODULES;
		request.modules =
			newModules.length > 0 ? (newModules as [string, WebAssembly.Module][]) : undefined;
		for (const [key] of newModules) runner.modules.add(key);
		runner.running++;
		taskCalls++;
		const waiting = this.free.pop() ?? { resolve: NO_SETTLE, reject: NO_SETTLE, runner };
		return new Promise((resolve, reject) => {
			waiting.resolve = resolve;
			waiting.reject = reject;
			waiting.runner = runner;
			this.waiting.set(id, waiting);
			runner.send(request, transfer);
		});
	}

	/**
	 * Settles which job workers this thread's tasks go to, before the first task picks one: it asks
	 * the page for the first job workers, which start as the thread asks for them, and waits for the
	 * page's word on which of them run. Waiting keeps a task from going to a job worker that did not
	 * start, which would never answer. Nothing waits once the thread's runners are settled, and then
	 * this answers nothing, so a call in every frame allocates no promise for it.
	 */
	private starting(): Promise<void> | undefined {
		// A later engine on this thread brings job workers of its own.
		const host = jobTasks();
		if (host !== this.host) {
			this.host = host;
			this.runners = undefined;
		}
		if (this.runners || !host) return undefined;
		host.want(2);
		if (host.running) return undefined;
		return this.announce(host);
	}

	/** Waits for the page's word on which job workers run. */
	private async announce(host: JobTaskHost): Promise<void> {
		const deadline = performance.now() + ANNOUNCE_WAIT_MS;
		while (host.running === undefined && !this.ended && performance.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_POLL_MS));
	}

	private leastBusy(error: WasmError): Runner {
		this.runners ??= this.start(error);
		let best = this.runners[0] as Runner;
		for (const runner of this.runners) if (runner.running < best.running) best = runner;
		// While every job worker has a task, the tasks ask for twice the job workers.
		if (best.running > 0 && this.host) best = this.addJobRunners(this.host) ?? best;
		return best;
	}

	/**
	 * Asks for twice the job workers that take tasks, and adds a runner for each new one. Returns
	 * the first new runner, or undefined when the engine has no more job workers to start.
	 */
	private addJobRunners(host: JobTaskHost): Runner | undefined {
		const runners = this.runners as Runner[];
		const takers = taskTakers(host.running, host.want(2 * (runners.length + 1)));
		const added = this.jobRunners(host, takers, runners.length);
		runners.push(...added);
		return added[0];
	}

	/**
	 * Runners for the job workers that take tasks, from position `from` in `takers` on. A job worker
	 * that the page says did not start is left out of `takers`, so it takes no task.
	 */
	private jobRunners(host: JobTaskHost, takers: readonly number[], from: number): Runner[] {
		return takers.slice(from).map((index) => {
			const port = host.ports[index] as MessagePort;
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

	/** The job workers that take tasks; or, without one, a task worker that starts now. */
	private start(error: WasmError): Runner[] {
		const host = this.host;
		// The tasks start on the first job workers, and ask for more as they pile up.
		if (host) {
			const runners = this.jobRunners(host, taskTakers(host.running, host.want(2)), 0);
			// No job worker takes this thread's tasks, because none started: a task worker answers them
			// instead, as on a thread without job workers. The frames keep the workers they have.
			if (runners.length > 0) return runners;
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
		watchWorkerError(worker, (message) => {
			worker.terminate();
			this.fail(message || 'its script did not load', error);
		});
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
		// The record goes back for a later task, so a call makes no record of its own.
		waiting.resolve = NO_SETTLE;
		waiting.reject = NO_SETTLE;
		this.free.push(waiting);
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
 * The engine's own callers give their thread's error factory; an add-on calls `runTask`.
 */
export function runTaskWithError<T>(
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
