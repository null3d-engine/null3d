// The math helpers allocate nothing. A page runs each helper in a loop of its own, and Chrome's heap
// profiler samples long runs of the loops once Chrome has optimized them (tests/lib/allocations.ts).
// It finds no allocation in the helpers or in the loops that call them.
import { expect, test } from '@playwright/test';
import * as color from '../../packages/engine/src/math/color.ts';
import * as mat4 from '../../packages/engine/src/math/mat4.ts';
import * as math from '../../packages/engine/src/math/math.ts';
import * as quat from '../../packages/engine/src/math/quat.ts';
import * as vec3 from '../../packages/engine/src/math/vec3.ts';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { pageResult } from '../lib/page-result.ts';

/** Every helper that writes into an array or returns a number: all but the ones that create arrays. */
const HELPERS = Object.entries({ color, mat4, math, quat, vec3 })
	.flatMap(([module, helpers]) =>
		Object.keys(helpers)
			.filter((name) => name !== 'create')
			.map((name) => `${module}.${name}`),
	)
	.sort();

test('each math helper allocates nothing in a loop of calls', ALONE, async ({ page }) => {
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
	const plan = {
		warmUpRuns: 400,
		warmUpIterations: 2_500,
		sampledIterations: 200_000,
		// The math helpers and the page's loops.
		counted: /\/packages\/engine\/src\/math\/|\/tests\/pages\/math\.ts/,
	};
	expect(await allocatingPlaces(page, plan, runAll)).toEqual([]);
});
