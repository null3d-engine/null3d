// The skinning page, which measures two ways to skin characters on WebGL2: in the vertex shader of
// every pass, or once per frame with transform feedback. Phones and tablets run its timings through
// the runner's skinning plan. Here a small crowd checks that both paths draw the same image and
// that both get timed.
import { expect, test } from '@playwright/test';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { SKINNING_PATHS, type SkinningResult, skinningProblems } from '../pages/lib/skinning.ts';

test('skinning once with transform feedback draws what skinning in every pass draws', async ({
	page,
}) => {
	const result = await loadResult(
		page,
		'skinning.html?characters=20&cascades=2&rounds=2&warmup=100',
		60_000,
	);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const skinning = result as typeof result & SkinningResult;
	expect(skinningProblems(skinning)).toEqual([]);
	// Every character stands in view and in the far cascade, and transform feedback skins each once.
	expect(skinning.drawn[0]).toBe(20);
	expect(skinning.skinned).toBe(20);
	for (const path of SKINNING_PATHS) expect(skinning.paths[path].batches).toBe(2);
	const { 'vertex-shader': each, 'transform-feedback': once } = skinning.paths;
	expect(once.skinnedVertices).toBe(20 * skinning.vertices);
	expect(each.skinnedVertices).toBe(
		skinning.drawn.reduce((sum, count) => sum + count, 0) * skinning.vertices,
	);
});
