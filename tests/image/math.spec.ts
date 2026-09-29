// The math helpers allocate nothing. A page runs each helper in a loop of its own. Once Chrome has
// optimized the loops, its heap profiler samples the allocations of long runs, as
// `bun run bench:allocation` samples the engine's frame code, and finds none in the helpers or in
// the loops that call them.
//
// Until Chrome fully optimizes a function, it stores fractions as number objects, so the warm-up
// calls each loop many times with short runs. Chrome optimizes in the background, and on a busy
// machine a round can still sample code that it has not finished. So the test samples again after
// more warm-up, a few times at most. A helper that allocates does so in every round.
import { expect, test } from '@playwright/test';
import * as color from '../../packages/engine/src/math/color.ts';
import * as mat4 from '../../packages/engine/src/math/mat4.ts';
import * as math from '../../packages/engine/src/math/math.ts';
import * as quat from '../../packages/engine/src/math/quat.ts';
import * as vec3 from '../../packages/engine/src/math/vec3.ts';
import { pageResult } from '../lib/page-result.ts';

/** Short runs of each loop before each round's sample, so that the browser optimizes the loops. */
const WARM_UP_RUNS = 400;
const WARM_UP_ITERATIONS = 2_500;
/** The time the browser gets to finish optimizing in the background, before each sample. */
const OPTIMIZE_MS = 500;
/** The most rounds of warm-up and sampling. */
const ROUNDS = 3;
/** Calls of each helper while the profiler samples. */
const SAMPLED_ITERATIONS = 200_000;
/** Bytes between allocation samples: small, so even one object per call shows many times. */
const SAMPLING_INTERVAL = 64;
/**
 * The most bytes per call that a place may allocate: sampling noise, a few objects in a whole run.
 * One number object per call, the smallest real allocation, is 12 bytes per call.
 */
const MAX_BYTES_PER_CALL = 0.01;
/** The source files whose allocations count: the math helpers and the page's loops. */
const COUNTED = /\/packages\/engine\/src\/math\/|\/tests\/pages\/math\.ts/;

interface ProfileNode {
	callFrame: { functionName: string; url: string; lineNumber: number };
	selfSize: number;
	children: ProfileNode[];
}

/** Every helper that writes into an array or returns a number: all but the ones that create arrays. */
const HELPERS = Object.entries({ color, mat4, math, quat, vec3 })
	.flatMap(([module, helpers]) =>
		Object.keys(helpers)
			.filter((name) => name !== 'create')
			.map((name) => `${module}.${name}`),
	)
	.sort();

/** The bytes that each place in the counted files allocated, by its function and line. */
function allocations(node: ProfileNode, found = new Map<string, number>()): Map<string, number> {
	const { functionName, url, lineNumber } = node.callFrame;
	if (node.selfSize > 0 && COUNTED.test(url)) {
		const place = `${functionName || '(anonymous)'} ${url}:${lineNumber + 1}`;
		found.set(place, (found.get(place) ?? 0) + node.selfSize);
	}
	for (const child of node.children) allocations(child, found);
	return found;
}

test('each math helper allocates nothing in a loop of calls', async ({ page }) => {
	await page.goto('math.html');
	const { cases } = await pageResult<{ cases: string[] }>(page, 30_000);
	expect([...cases].sort()).toEqual(HELPERS);
	const runAll = (iterations: number, runs: number) =>
		page.evaluate(
			({ names, iterations, runs }) => {
				const scope = globalThis as {
					__null3dMathCase?: (name: string, iterations: number) => void;
				};
				for (let run = 0; run < runs; run++)
					for (const name of names) scope.__null3dMathCase?.(name, iterations);
			},
			{ names: cases, iterations, runs },
		);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('HeapProfiler.enable');
	let over: { place: string; bytesPerCall: number }[] = [];
	for (let round = 0; round < ROUNDS; round++) {
		await runAll(WARM_UP_ITERATIONS, WARM_UP_RUNS);
		await page.waitForTimeout(OPTIMIZE_MS);
		// Garbage that a call makes dies young, so the profiler must keep the samples that
		// collections free.
		await cdp.send('HeapProfiler.startSampling', {
			samplingInterval: SAMPLING_INTERVAL,
			includeObjectsCollectedByMinorGC: true,
			includeObjectsCollectedByMajorGC: true,
		});
		await runAll(SAMPLED_ITERATIONS, 1);
		const { profile } = await cdp.send('HeapProfiler.stopSampling');
		over = [...allocations(profile.head as ProfileNode)]
			.map(([place, bytes]) => ({ place, bytesPerCall: bytes / SAMPLED_ITERATIONS }))
			.filter(({ bytesPerCall }) => bytesPerCall > MAX_BYTES_PER_CALL);
		if (over.length === 0) break;
	}
	expect(over).toEqual([]);
});
