// The task module of the held levels test: it counts itself started in the input's shared counter,
// then keeps its job worker busy for the time that the input names, so a level plan queued after it
// waits that long for a worker.

import type { TaskResult } from '@null3d/engine';

export function run(input: unknown): TaskResult {
	const { ms, started } = input as { ms: number; started: Int32Array };
	Atomics.add(started, 0, 1);
	const end = performance.now() + ms;
	let spins = 0;
	while (performance.now() < end) spins++;
	return { output: spins };
}
