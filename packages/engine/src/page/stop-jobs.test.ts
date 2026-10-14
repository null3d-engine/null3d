import { describe, expect, it } from 'bun:test';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { stopJobWorkers, waitForJobWorkersToLeave, yieldJobWorkers } from './stop-jobs';

/** Where the test's job system keeps its wake word, its stop flag and its yield word. */
const WAKE = 64;
const STOP = 70;
const YIELD = 72;

function engine(withJobs: boolean) {
	const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
	const { slots } = controlViews(createControlBuffer(true));
	if (withJobs) {
		Atomics.store(slots, Slot.JobsWakeAddress, WAKE);
		Atomics.store(slots, Slot.JobsStopAddress, STOP);
		Atomics.store(slots, Slot.JobsYieldAddress, YIELD);
	}
	const words = new Int32Array(memory.buffer);
	const flags = new Uint8Array(memory.buffer);
	return {
		memory,
		slots,
		wake: () => words[WAKE / 4],
		stopped: () => flags[STOP],
		yielding: () => words[YIELD / 4],
	};
}

describe('stopJobWorkers', () => {
	it('sets the stop flag and bumps the wake word once', () => {
		const { memory, slots, wake, stopped } = engine(true);
		stopJobWorkers(memory, slots);
		expect(stopped()).toBe(1);
		expect(wake()).toBe(1);
		stopJobWorkers(memory, slots);
		expect(wake()).toBe(1);
	});

	it('does nothing before the job system exists', () => {
		const { memory, slots, wake, stopped } = engine(false);
		stopJobWorkers(memory, slots);
		expect(stopped()).toBe(0);
		expect(wake()).toBe(0);
	});

	it('waits for the job workers to leave their loop, within a bound', () => {
		const { slots } = engine(true);
		expect(waitForJobWorkersToLeave(slots, 1)).toBe(true);
		Atomics.store(slots, Slot.JobsServing, 1);
		expect(waitForJobWorkersToLeave(slots, 1)).toBe(false);
	});

	it('wakes a thread that waits on the wake word', async () => {
		const { memory, slots, wake } = engine(true);
		const source = `onmessage = ({ data }) => {
			const words = new Int32Array(data.buffer);
			const flags = new Uint8Array(data.buffer);
			postMessage('waiting');
			while (Atomics.load(flags, ${STOP}) === 0) Atomics.wait(words, ${WAKE / 4}, 0);
			postMessage('left');
		};`;
		const worker = new Worker(URL.createObjectURL(new Blob([source])));
		const replies: string[] = [];
		const left = new Promise<void>((resolve) => {
			worker.onmessage = ({ data }) => {
				replies.push(data);
				if (data === 'left') resolve();
			};
		});
		worker.postMessage({ buffer: memory.buffer });
		while (replies.length === 0) await Bun.sleep(1);
		await Bun.sleep(20);
		expect(wake()).toBe(0);
		stopJobWorkers(memory, slots);
		await left;
		worker.terminate();
		expect(replies).toEqual(['waiting', 'left']);
	});
});

describe('yieldJobWorkers', () => {
	it('raises the yield word and wakes the workers, and its end lowers the word again', () => {
		const { memory, slots, wake, yielding } = engine(true);
		const end = yieldJobWorkers(memory, slots);
		const other = yieldJobWorkers(memory, slots);
		expect(yielding()).toBe(2);
		expect(wake()).toBe(2);
		end();
		expect(yielding()).toBe(1);
		other();
		expect(yielding()).toBe(0);
		expect(wake()).toBe(2);
	});

	it('ends a yield after the shared memory grows', () => {
		const { memory, slots, yielding } = engine(true);
		const end = yieldJobWorkers(memory, slots);
		memory.grow(1);
		end();
		expect(yielding()).toBe(0);
	});

	it('does nothing before the job system exists, and nor does its end', () => {
		const { memory, slots, wake, yielding } = engine(false);
		const end = yieldJobWorkers(memory, slots);
		Atomics.store(slots, Slot.JobsWakeAddress, WAKE);
		Atomics.store(slots, Slot.JobsYieldAddress, YIELD);
		end();
		expect(yielding()).toBe(0);
		expect(wake()).toBe(0);
	});
});
