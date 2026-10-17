// The on-demand loader's tasks on the job workers: they ask for job workers as they pile up, they
// go only to the workers that run, and when the engine on the thread stops, tasks that wait fail,
// the stopped engine's ports lose their handlers, and the next engine's tasks go to its own job
// workers. While an engine runs, the core can ask for the first job workers.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskAnswer, TaskRequest } from '../workers/tasks';
import { stopHelperWorkers } from './helper-workers';
import { clearJobTasks, jobAsker, setJobTasks } from './task-host';
import { runTask, TaskFailure } from './tasks';
import type { WasmError } from './wasm';

const error: WasmError = (code, message) => new Error(`${code}: ${message}`) as never;

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
		const waiting = runTask({ name: 'ktx2' }, 1, [], error);
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
		expect(await runTask<string>({ name: 'ktx2' }, 2, [], error)).toBe('next engine');
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
		for (let k = 0; k < 5; k++) runTask({ name: 'ktx2' }, k, [], error).catch(() => {});
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
		runTask({ name: 'ktx2' }, 0, [], error).catch(() => {});
		runTask({ name: 'ktx2' }, 1, [], error).catch(() => {});
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
		void runTask({ name: 'ktx2' }, 0, [], error).catch(() => {});
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
		void runTask({ name: 'ktx2' }, 0, [], error).catch(() => {});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toEqual([]);
	});
});
