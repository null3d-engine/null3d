// The on-demand loader's tasks when the engine on the thread stops: tasks that wait fail, the
// stopped engine's ports lose their handlers, and the next engine's tasks go to its own job workers.
import { afterEach, describe, expect, test } from 'bun:test';
import type { TaskAnswer, TaskRequest } from '../workers/tasks';
import { stopHelperWorkers } from './helper-workers';
import { setJobTasks } from './task-host';
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
		setJobTasks({ ports: [stoppedPort], call: (index) => calls.push(index) });
		const waiting = runTask({ name: 'ktx2' }, 1, [], error);
		await new Promise((resolve) => setTimeout(resolve, 0));
		stopHelperWorkers();
		const failure = await waiting.catch((thrown: unknown) => thrown);
		expect(failure).toBeInstanceOf(TaskFailure);
		expect((failure as TaskFailure).stage).toBe('stopped');
		expect(calls).toEqual([0]);
		expect(stoppedPort.onmessage).toBeNull();

		setJobTasks({ ports: [jobPort('next engine')], call: () => {} });
		expect(await runTask<string>({ name: 'ktx2' }, 2, [], error)).toBe('next engine');
	});
});
