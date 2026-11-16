// Levels of detail of meshes made in code, planned on the job workers, on both GPU paths and in the
// thread modes with job workers and without. The test page's sketch makes a bumpy grid that plans
// by default, a smaller one and one that opts out, which plan nothing, a grid past 65,535 vertices
// and a generator's sphere (tests/pages/sketches/runtime-levels-sketch.ts). The test checks that
// the planner on a job worker gives the levels that Node's planner gives for the same grid, triangle
// for triangle, that each mesh gets the levels it should, and that the frames draw far fewer
// triangles far from the grid than near it. At a corner of the grid in parts, looking out past it,
// the grid's pieces draw a few of its triangles where the same grid without them draws them all.
// The production build project runs it too. There the sketch's bundle holds a copy of the engine of
// its own beside the sketch worker's, and the plans go through one copy and the sketch's direct
// task through the other, to the same job workers: each copy's tasks must get their own answers.
import { LOD_MAX_LEVELS } from '@null3d/engine/levels-planner';
import { expect, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems } from '../lib/engine-checks.ts';
import { bumpyGrid, indicesHash } from '../lib/level-meshes.ts';
import { nodeLevels } from '../lib/level-plans.ts';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	mode: { build: string; sketchThread: string; latency: string; renderThread: string };
	levels: {
		planned: number[];
		small: number;
		off: number;
		split: number[];
		sphere: number[];
		direct: { triangles: number; hash: number; error: number }[];
	};
	triangles: Record<string, number>;
}

/** The grid's cells along a side, as the sketch makes it. */
const CELLS = 128;
/** The grid's triangles. */
const TRIANGLES = CELLS * CELLS * 2;
/** The triangles of the grid in parts, which the sketch draws with pieces and without. */
const LARGE_TRIANGLES = 300 * 300 * 2;

const PATHS = [
	{ tier: 'webgpu', query: '' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
];
const MODES = ENGINE_MODES.filter(({ name }) => name === 'pipelined' || name === 'single-threaded');

/** The levels that Node's planner gives the sketch's grid, made once for every run. */
let expected: { triangles: number; hash: number; error: number }[] | undefined;

for (const path of PATHS)
	for (const mode of MODES)
		test(`meshes made in code plan their levels on the job workers, ${path.tier}, ${mode.name}`, async ({
			page,
		}) => {
			test.setTimeout(360_000);
			expected ??= (await nodeLevels(bumpyGrid(CELLS), false, LOD_MAX_LEVELS)).map((level) => ({
				triangles: (level.indices[0] as Uint32Array).length / 3,
				hash: indicesHash(level.indices[0] as Uint32Array),
				error: level.error,
			}));
			await page.goto(`runtime-levels.html?${[path.query, mode.query].filter(Boolean).join('&')}`);
			const result = await pageResult<Result>(page, 300_000);
			expect(result.error).toBeUndefined();
			test.skip(result.tier !== path.tier, `this browser has no ${path.tier}`);
			expect(modeProblems(result.mode, mode)).toEqual([]);
			const { levels, triangles } = result;
			test.info().annotations.push({
				type: 'triangles drawn, near and far',
				description: JSON.stringify(triangles),
			});
			// The task on a job worker gives the levels of Node's planner, triangle for triangle.
			expect(levels.direct).toEqual(expected);
			// The grid that planned by default took those levels, with the planner's errors.
			expect(levels.planned).toEqual(expected.map((level) => level.error));
			expect(levels.small).toBe(0);
			expect(levels.off).toBe(0);
			expect(levels.split.length).toBeGreaterThanOrEqual(4);
			expect(levels.sphere.length).toBeGreaterThanOrEqual(3);
			// Near the grid the frames draw most of its triangles; far from it, a few levels down. A
			// path that draws a depth prepass counts each triangle twice.
			const near = triangles['6'] as number;
			const far = triangles['400'] as number;
			expect(near).toBeGreaterThan(TRIANGLES / 2);
			expect(far).toBeLessThan(near / 16);
			// The view takes in a corner of the grid in parts, whose pieces cull the rest of it.
			const whole = triangles.whole as number;
			expect(whole).toBeGreaterThanOrEqual(LARGE_TRIANGLES);
			expect(triangles.pieces as number).toBeLessThan(whole / 4);
		});
