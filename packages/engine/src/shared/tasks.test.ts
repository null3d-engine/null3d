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
import { runTaskWithError } from './tasks';
import type { WasmError } from './wasm';

const error: WasmError = (code, message) => new Error(`${code}: ${message}`) as never;

/** The smallest valid WebAssembly module, which a task runs as a file of its own. */
const EMPTY_MODULE = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

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
