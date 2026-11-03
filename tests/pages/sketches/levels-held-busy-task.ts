// The task module of the held levels test: it keeps its job worker busy for the time that the
// input names, so a level plan queued after it waits that long for a worker.

import type { TaskResult } from '@null3d/engine';

export function run(input: unknown): TaskResult {
	const { ms } = input as { ms: number };
	const end = performance.now() + ms;
	let spins = 0;
	while (performance.now() < end) spins++;
	return { output: spins };
}
