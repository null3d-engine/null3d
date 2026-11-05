// The on-demand loader's tasks on the job workers: they ask for job workers as they pile up, they
// go only to the workers that run, and when the engine on the thread stops, tasks that wait fail,
// the stopped engine's ports lose their handlers, and the next engine's tasks go to its own job
// workers. While an engine runs, the core can ask for the first job workers. The public task hook
// shares a buffer with its worker rather than copying it, and two tasks that name a WebAssembly
// file alike each keep their own module.
import { afterEach, describe, expect, test } from 'bun:test';
import { serveTasks, type TaskAnswer, type TaskRequest } from '../workers/tasks';
import { stopHelperWorkers } from './helper-workers';
import { runTask } from './run-task';
import { TaskFailure } from './task-failure';
import { clearJobTasks, jobAsker, setJobTasks } from './task-host';
import { moduleKey } from './task-modules';
import { tasksPending } from './task-pending';
import {
	compiledModule,
	compileOnce,
	hrefOf,
	keyOf,
	runTaskWithError,
	type Task,
	type WasmFile,
} from './tasks';
import type { WasmError } from './wasm';

const error: WasmError = (code, message) => new Error(`${code}: ${message}`) as never;

/** The bytes of the smallest valid WebAssembly module, and the module they compile to. */
const EMPTY_BYTES = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const EMPTY_MODULE = new WebAssembly.Module(EMPTY_BYTES);

const channels: MessageChannel[] = [];

/** A job worker's task port that answers every request with `output`, or never answers. */
function jobPort(output?: string): MessagePort {
	const channel = new MessageChannel();
	channels.push(channel);
	if (output !== undefined)
		channel.port1.onmessage = (event: MessageEvent<TaskRequest>) =>
			channel.port1.postMessage({ id: event.data.id, output } satisfies TaskAnswer);
	return channel.port2;
}

afterEach(() => {
	stopHelperWorkers();
	for (const { port1, port2 } of channels.splice(0)) {
		port1.close();
		port2.close();
	}
});

describe('runTask', () => {
	test('fails a task that waits when the engine stops, lets go of its ports, and sends later tasks to the next engine', async () => {
		const calls: number[] = [];
		const stoppedPort = jobPort();
		setJobTasks({
			ports: [stoppedPort],
			running: [0],
			call: (index) => calls.push(index),
			want: jobAsker(1, () => {}),
		});
		const waiting = runTaskWithError({ name: 'ktx2' }, 1, [], error);
		await new Promise((resolve) => setTimeout(resolve, 0));
		stopHelperWorkers();
		const failure = await waiting.catch((thrown: unknown) => thrown);
		expect(failure).toBeInstanceOf(TaskFailure);
		expect((failure as TaskFailure).stage).toBe('stopped');
		expect(calls).toEqual([0]);
		expect(stoppedPort.onmessage).toBeNull();

		setJobTasks({
			ports: [jobPort('next engine')],
			running: [0],
			call: () => {},
			want: jobAsker(1, () => {}),
		});
		expect(await runTaskWithError<string>({ name: 'ktx2' }, 2, [], error)).toBe('next engine');
	});

	test('starts the tasks on the second of two job workers, and asks for twice the job workers while each has a task', async () => {
		const asked: number[] = [];
		const calls: number[] = [];
		setJobTasks({
			ports: Array.from({ length: 5 }, () => jobPort()),
			running: [0, 1, 2, 3, 4],
			call: (index) => calls.push(index),
			want: jobAsker(5, (count) => asked.push(count)),
		});
		for (let k = 0; k < 5; k++) runTaskWithError({ name: 'ktx2' }, k, [], error).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(asked).toEqual([2, 4, 5]);
		expect(calls).toEqual([1, 2, 3, 4, 1]);
	});

	test('sends no task to a job worker that did not start', async () => {
		const calls: number[] = [];
		// Job worker 2 did not start, so the tasks go to workers 1 and 3.
		setJobTasks({
			ports: Array.from({ length: 5 }, () => jobPort()),
			running: [0, 1, 3, 4],
			call: (index) => calls.push(index),
			want: jobAsker(5, () => {}),
		});
		runTaskWithError({ name: 'ktx2' }, 0, [], error).catch(() => {});
		runTaskWithError({ name: 'ktx2' }, 1, [], error).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toEqual([1, 3]);
	});

	test('lowers the count when a task never reaches its worker', async () => {
		setJobTasks({
			ports: [jobPort()],
			running: [0],
			call: () => {
				throw new Error('the job worker is gone');
			},
			want: jobAsker(1, () => {}),
		});
		const failure = await runTaskWithError({ name: 'ktx2' }, 0, [], error).catch(
			(thrown: unknown) => thrown,
		);
		expect((failure as Error).message).toBe('the job worker is gone');
		// Hold mode waits for this count to reach zero, so a task that never left cannot leave it up.
		expect(tasksPending()).toBe(0);
	});

	test('counts a task while its WebAssembly file compiles, and lowers the count when the file fails', async () => {
		// Hold mode takes its frame once the count is zero, so a task whose first compile is still
		// running must count, or the frame misses what the task draws.
		const original = globalThis.fetch;
		let answer: (response: Response) => void = () => undefined;
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => (answer = resolve))) as unknown as typeof fetch;
		try {
			setJobTasks({
				ports: [jobPort('built')],
				running: [0],
				call: () => {},
				want: jobAsker(1, () => {}),
			});
			const file: WasmFile = {
				name: 'slow',
				url: new URL('http://localhost/tasks-slow-compile.wasm'),
				what: 'the slow module',
			};
			const building = runTaskWithError<string>({ name: 'slow', wasm: [file] }, 0, [], error);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(tasksPending()).toBe(1);
			answer(new Response(EMPTY_BYTES, { headers: { 'Content-Type': 'application/wasm' } }));
			expect(await building).toBe('built');
			expect(tasksPending()).toBe(0);

			globalThis.fetch = (async () =>
				new Response(null, { status: 500 })) as unknown as typeof fetch;
			const broken: WasmFile = {
				name: 'broken',
				url: new URL('http://localhost/tasks-broken-compile.wasm'),
				what: 'the broken module',
			};
			const failing = runTaskWithError({ name: 'broken', wasm: [broken] }, 0, [], error);
			expect(tasksPending()).toBe(1);
			await expect(failing).rejects.toBeDefined();
			expect(tasksPending()).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});

	test('waits for the page to say which job workers run before it sends a task', async () => {
		const calls: number[] = [];
		const host = {
			ports: Array.from({ length: 2 }, () => jobPort()),
			running: undefined as readonly number[] | undefined,
			call: (index: number) => calls.push(index),
			want: jobAsker(2, () => {}),
		};
		setJobTasks(host);
		void runTaskWithError({ name: 'ktx2' }, 0, [], error).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toEqual([]);
		// The page says only the first worker runs: the task goes to it, as the only one that can.
		host.running = [0];
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toEqual([0]);
	});

	test('lets the core ask for the first job workers while an engine runs', () => {
		const asked: number[] = [];
		const host = {
			ports: [jobPort()],
			running: [0],
			call: () => {},
			want: jobAsker(4, (count) => asked.push(count)),
		};
		const want = (globalThis as { __null3dWantJobWorkers?: () => void }).__null3dWantJobWorkers;
		setJobTasks(host);
		want?.();
		want?.();
		clearJobTasks(host);
		want?.();
		expect(asked).toEqual([2]);
	});

	test('calls no job worker when the page says that none of them run', async () => {
		const calls: number[] = [];
		// No job worker started, so a task worker answers this thread's tasks instead. The loader
		// starts it itself, and calls no job worker that the page left out.
		setJobTasks({
			ports: Array.from({ length: 2 }, () => jobPort()),
			running: [],
			call: (index) => calls.push(index),
			want: jobAsker(2, () => {}),
		});
		void runTaskWithError({ name: 'ktx2' }, 0, [], error).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toEqual([]);
	});
});

// A production build can hold two copies of the loader's modules in one thread: the sketch worker
// runs the engine's worker code, and the sketch's bundle imports the engine again from the page's
// file. A query string gives a test a second copy of a module, as such a build does.
describe('two copies of the loader in one thread', () => {
	const copyOf = <T>(file: string): Promise<T> => import(`./${file}.ts?second-copy`);

	/** A job worker's task port that answers each request with its input, or fails it at run. */
	function echoPort(): MessagePort {
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.onmessage = (event: MessageEvent<TaskRequest>) => {
			const { id, input } = event.data;
			channel.port1.postMessage(
				(input === 'fail'
					? { id, failed: { stage: 'run', message: 'the task threw' } }
					: { id, output: input }) satisfies TaskAnswer,
			);
		};
		return channel.port2;
	}

	/** The task's answer, or `'no answer'` when none comes in a moment. */
	const settled = (task: Promise<unknown>) =>
		Promise.race([
			task.catch((thrown: unknown) => thrown),
			new Promise((resolve) => setTimeout(() => resolve('no answer'), 200)),
		]);

	test("answers each copy's tasks on the job workers that both share, and fails each with a failure that both copies know", async () => {
		const second = await copyOf<typeof import('./tasks')>('tasks');
		const SecondFailure = (await copyOf<typeof import('./task-failure')>('task-failure'))
			.TaskFailure;
		setJobTasks({
			ports: [echoPort()],
			running: [0],
			call: () => {},
			want: jobAsker(1, () => {}),
		});
		const task = { name: 'ktx2' };
		// Each copy numbers its tasks from the same start, so the answers name the same numbers.
		const fromFirst = runTaskWithError(task, 'first', [], error);
		const fromSecond = second.runTaskWithError(task, 'second', [], error);
		const failed = runTaskWithError(task, 'fail', [], error);
		expect(await settled(fromFirst)).toBe('first');
		expect(await settled(fromSecond)).toBe('second');
		const failure = await settled(failed);
		expect(failure).toBeInstanceOf(TaskFailure);
		expect(failure).toBeInstanceOf(SecondFailure);
		expect((failure as TaskFailure).stage).toBe('run');
		expect(new SecondFailure('run', 'made by the second copy')).toBeInstanceOf(TaskFailure);
	});

	test("counts every copy's tasks and level plans, which hold mode waits for", async () => {
		const second = await copyOf<typeof import('./task-pending')>('task-pending');
		second.taskStarted();
		const plan = second.planStarted('a mesh of 2 triangles (createMesh)');
		expect(tasksPending()).toBe(2);
		second.planEnded(plan);
		second.taskEnded();
		expect(tasksPending()).toBe(0);
	});

	test('stops the helpers that every copy started when the engine stops', async () => {
		const second = await copyOf<typeof import('./helper-workers')>('helper-workers');
		let stopped = false;
		second.onEngineStop(() => {
			stopped = true;
		});
		stopHelperWorkers();
		expect(stopped).toBe(true);
	});
});

describe('the public task hook', () => {
	// A job worker that writes `written` into the shared buffer that it gets, and answers `output`.
	function sharedPort(written: number, output: string): MessagePort {
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.onmessage = (event: MessageEvent<TaskRequest>) => {
			const { id, input } = event.data;
			const view = (input as { view?: Int32Array }).view;
			if (view) Atomics.store(view, 0, written);
			channel.port1.postMessage({ id, output } satisfies TaskAnswer);
		};
		return channel.port2;
	}

	function hostFor(port: MessagePort): void {
		setJobTasks({
			ports: [port],
			running: [0],
			call: () => {},
			want: jobAsker(1, () => {}),
		});
	}

	test('shares a buffer with its worker rather than copying it, and resolves with the output', async () => {
		hostFor(sharedPort(7, 'sorted'));
		const shared = new SharedArrayBuffer(4);
		const view = new Int32Array(shared);
		const output = await runTask<string>({ name: 'probe' }, { view }, []);
		expect(output).toBe('sorted');
		// The worker's writes reach this thread's own view of the same buffer.
		expect(Atomics.load(view, 0)).toBe(7);
	});

	test('rejects with the stage where the task failed', async () => {
		const channel = new MessageChannel();
		channels.push(channel);
		channel.port1.onmessage = (event: MessageEvent<TaskRequest>) =>
			channel.port1.postMessage({
				id: event.data.id,
				failed: { stage: 'run', message: 'the sort ran out of room' },
			} satisfies TaskAnswer);
		hostFor(channel.port2);
		const failure = await runTask({ name: 'probe' }, 0).catch((thrown: unknown) => thrown);
		expect(failure).toBeInstanceOf(TaskFailure);
		expect((failure as TaskFailure).stage).toBe('run');
		expect((failure as TaskFailure).message).toBe('the sort ran out of room');
	});

	test('keys a WebAssembly file by its task, so two tasks may name a file alike', () => {
		expect(moduleKey('https://a.example/sort.js', 'splat')).not.toBe(
			moduleKey('https://b.example/sort.js', 'splat'),
		);
		// The engine's own tasks have no script, and keep their names alone.
		expect(moduleKey(undefined, 'basis')).toBe('basis');
	});

	test('gives each task its own module in the worker, and keeps it for the tasks that follow', async () => {
		const answers: TaskAnswer[] = [];
		let woken = () => {};
		const source = {
			onmessage: null as ((event: MessageEvent<TaskRequest>) => unknown) | null,
			postMessage(answer: TaskAnswer) {
				answers.push(answer);
				woken();
			},
		};
		const answered = () => new Promise<void>((resolve) => (woken = resolve));
		serveTasks(source);
		const task = (tag: string) =>
			`data:text/javascript,export function run(input, wasm) { return { output: wasm("shared")/*${tag}*/ }; }`;
		const send = async (script: string, modules?: [string, WebAssembly.Module][]) => {
			const done = answered();
			const request = { id: answers.length + 1, task: script, script, modules };
			source.onmessage?.({ data: request } as MessageEvent<TaskRequest>);
			await done;
		};
		const first = task('a');
		const second = task('b');
		const moduleOfFirst = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		// Both tasks name their file `shared`, and each worker keeps them apart.
		await send(first, [[moduleKey(first, 'shared'), moduleOfFirst]]);
		await send(second, [[moduleKey(second, 'shared'), EMPTY_MODULE]]);
		// A later task of the first module gets its file again, with none sent this time.
		await send(first);
		expect(answers.map((answer) => ('output' in answer ? answer.output : undefined))).toEqual([
			moduleOfFirst,
			EMPTY_MODULE,
			moduleOfFirst,
		]);
	});
});

describe("the task loader's caches", () => {
	/** A file of its own for each test, so a cache that one test filled never answers another. */
	const fileOf = (name: string): WasmFile => ({
		name: 'test',
		url: new URL(`http://localhost/tasks-${name}.wasm`),
		what: 'the test module',
	});
	const original = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = original;
	});

	test("reads a URL's text and a task's module key once", () => {
		const url = new URL('http://localhost/cache-test.wasm');
		expect(hrefOf(url)).toBe(hrefOf(url));
		expect(hrefOf(url)).not.toBe(hrefOf(new URL('http://localhost/other.wasm')));
		const task: Task = { name: 'cache-test' };
		expect(keyOf(task, 'a', 'one')).toBe(keyOf(task, 'a', 'one'));
		expect(keyOf(task, 'a', 'one')).not.toBe(keyOf(task, 'a', 'two'));
	});

	test('tries a failed download again, and reads the resolved module without another ask', async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			if (calls === 1) return new Response(null, { status: 500 });
			return new Response(EMPTY_BYTES, {
				headers: { 'Content-Type': 'application/wasm' },
			});
		}) as unknown as typeof fetch;
		const file = fileOf('retry');
		await expect(compileOnce(file, error)).rejects.toBeDefined();
		expect(compiledModule(file)).toBeUndefined();
		const module = await compileOnce(file, error);
		expect(compiledModule(file)).toBe(module);
		// The third ask takes the kept promise, so the file downloads once more.
		expect(await compileOnce(file, error)).toBe(module);
		expect(calls).toBe(2);
	});

	test('gives two concurrent asks the one pending download', async () => {
		const file = fileOf('concurrent');
		let calls = 0;
		let answer: (response: Response) => void = () => undefined;
		globalThis.fetch = (() => {
			calls++;
			return new Promise<Response>((resolve) => (answer = resolve));
		}) as unknown as typeof fetch;
		const first = compileOnce(file, error);
		const second = compileOnce(file, error);
		expect(second).toBe(first);
		answer(
			new Response(EMPTY_BYTES, {
				headers: { 'Content-Type': 'application/wasm' },
			}),
		);
		expect(await first).toBe(await second);
		expect(compiledModule(file)).toBe(await first);
		expect(calls).toBe(1);
	});
});
