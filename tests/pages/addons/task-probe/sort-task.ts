// The task module of the task-probe add-on. The engine imports it once in each worker that runs the
// task, and calls `run` with the task's input. It sorts the numbers in a shared buffer, smallest
// first, writes them after the input, and answers what it found and which worker ran it.

import type { TaskResult } from '@null3d/engine';

/** The task's input: the shared view and the number of the round. */
interface SortInput {
	/** The shared buffer: the count at 0, the values after it, and room for the sorted values. */
	view: Int32Array;
	round: number;
}

export function run(input: unknown): TaskResult {
	const { view, round } = input as SortInput;
	const count = Atomics.load(view, 0);
	const values: number[] = [];
	for (let i = 0; i < count; i++) values.push(Atomics.load(view, 1 + i));
	values.sort((a, b) => a - b);
	for (let i = 0; i < count; i++) Atomics.store(view, count + 1 + i, values[i] as number);
	// The worker's own name tells the test which thread ran the task.
	const worker = (globalThis as { name?: string }).name ?? '';
	return { output: { round, worker, order: values } };
}
