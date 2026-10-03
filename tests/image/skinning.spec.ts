// The skinning pages, which measure two ways to skin characters: in the vertex shader of every
// pass, or once per frame, with transform feedback on WebGL2 and with a compute pass on WebGPU.
// Phones and tablets run their timings through the runner's skinning plans. Here a small crowd
// checks that both paths of each page draw the same image and that both get timed.
import { expect, test } from '@playwright/test';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import {
	pathTiming,
	SKIN_ONCE,
	type SkinningGpu,
	type SkinningResult,
	skinningPaths,
	skinningProblems,
} from '../pages/lib/skinning.ts';

const PAGES: Record<SkinningGpu, string> = {
	webgl2: 'skinning.html',
	webgpu: 'skinning-webgpu.html',
};

for (const gpu of ['webgl2', 'webgpu'] as const) {
	test(`skinning once with ${SKIN_ONCE[gpu]} draws what skinning in every pass draws, on ${gpu}`, async ({
		page,
	}) => {
		const result = await loadResult(
			page,
			`${PAGES[gpu]}?characters=20&cascades=2&rounds=2&warmup=100`,
			60_000,
		);
		expect(result.ok ? [] : [failureText(result)]).toEqual([]);
		const skinning = result as typeof result & SkinningResult;
		expect(skinning.gpu).toBe(gpu);
		expect(skinningProblems(skinning)).toEqual([]);
		// Every character stands in view and in the far cascade, and the path that skins once skins
		// each once.
		expect(skinning.drawn[0]).toBe(20);
		expect(skinning.skinned).toBe(20);
		const [each, once] = skinningPaths(gpu).map((path) => pathTiming(skinning, path));
		for (const timing of [each, once]) expect(timing?.batches).toBe(2);
		expect(once?.skinnedVertices).toBe(20 * skinning.vertices);
		expect(each?.skinnedVertices).toBe(
			skinning.drawn.reduce((sum, count) => sum + count, 0) * skinning.vertices,
		);
	});
}
