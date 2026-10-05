// The poses page, which plays the clips of glTF sample models in the engine core and compares the
// skinning matrices with three.js's (tests/pages/gltf-poses.ts). Each model's clips are resampled
// on the job workers between frames, as the glTF loader has them resampled. Each model's clips
// also load after the asset tool, which puts them on the core's frames, so the core copies them.
import { expect, test } from '@playwright/test';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { type PoseResult, TOOL_SUFFIX } from '../pages/lib/gltf-poses.ts';

/**
 * The largest differences allowed: in the rotation and scale part of a skinning matrix, and in a
 * translation, as a share of the model's largest translation. Clips whose keys lie on one grid of
 * up to 30 keys a second keep their keys, and stay within 3e-4 of three.js.
 */
const TOLERANCE = { linear: 1e-3, translation: 1e-3 };
/**
 * Fox's Run clip changes its key spacing at 0.87 s, so its keys lie on no single grid and the core
 * resamples it at 30 keys a second. Its joints turn up to 1.5 radians between keys, and the
 * resampled curve cuts their corners by up to 5e-3. The asset tool stores the same curve.
 */
const OFF_GRID = { linear: 6e-3, translation: 4e-3 };
const FOX = '/samples/sources/khronos/Fox/glTF-Binary/Fox.glb';
const LIMITS: Readonly<Record<string, typeof TOLERANCE>> = {
	[FOX]: OFF_GRID,
	[`${FOX}${TOOL_SUFFIX}`]: OFF_GRID,
};

test("skins and clips from glTF sample models pose their joints as three.js's", async ({
	page,
}) => {
	const result = await loadResult(page, 'gltf-poses.html', 120_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const models = (result as typeof result & { models: PoseResult[] }).models;
	for (const model of models)
		console.log(
			`${model.url}: ${model.joints} joints; parsed in ${model.parseMs.toFixed(1)} ms; ${model.clips} clips built in ${model.resampleMs.toFixed(1)} ms, ${model.resampled} resampled; ${model.matrices} matrices, rotation and scale within ${model.linear.toExponential(2)}, translation within ${model.translation.toExponential(2)} of the largest; worst ${model.worst}`,
		);
	for (const model of models) {
		expect(model.matrices, model.url).toBeGreaterThan(0);
		const limit = LIMITS[model.url] ?? TOLERANCE;
		expect(model.linear, model.url).toBeLessThanOrEqual(limit.linear);
		expect(model.translation, model.url).toBeLessThanOrEqual(limit.translation);
		// The asset tool's clips load with a copy of their keys, never a resample.
		if (model.url.endsWith(TOOL_SUFFIX)) expect(model.resampled, model.url).toBe(0);
	}
	expect(models).toHaveLength(14);
});
