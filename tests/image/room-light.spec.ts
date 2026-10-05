// No frame draws the scene without the built-in room's light. A sketch asks for the room during
// play, and sets it with a blue background in the same step once it resolves. The engine makes the
// whole map in one go before the first frame that uses it (D-66), so every frame with the blue
// background already shows the room's light on a metal sphere, which has no other light. Each
// GPU path, and each thread mode on WebGPU, since the generator reaches the thread that draws in
// each mode's own way.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface RoomLightResult {
	error?: string;
	tier: string;
	set: boolean;
	steadyBlue: boolean;
	pixels: number;
	blackFrames: number;
	blueFrames: number;
	blueChanged: number[];
	litMiddle: number;
	unlitMiddle: number | null;
	failures: string[];
}

const RUNS = [
	...ENGINE_MODES.map((mode) => ({ gpu: 'webgpu', tier: 'webgpu', mode })),
	{ gpu: 'compat', tier: 'webgpu-compat', mode: ENGINE_MODES[0] },
	{ gpu: 'webgl2', tier: 'webgl2', mode: ENGINE_MODES[0] },
] as const;

for (const { gpu, tier, mode } of RUNS)
	test(`every frame that uses the built-in room shows its light on ${tier}, ${mode.name}`, async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.goto(`room-light.html?gpu=${gpu}&${mode.query}`);
		const result = await pageResult<RoomLightResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		expect(result.tier).toBe(tier);
		expect(result.set, 'the room resolved').toBe(true);
		expect(result.steadyBlue).toBe(true);
		expect(result.blueFrames, 'frames that use the room were captured').toBeGreaterThan(0);
		// The room lights the sphere, which is dark without it.
		expect(result.unlitMiddle).not.toBeNull();
		expect(result.litMiddle).toBeGreaterThan((result.unlitMiddle as number) + 40);
		// Each frame that uses the room draws as the steady frame does, within a few pixels.
		const most = Math.ceil(0.001 * result.pixels);
		expect(result.blueChanged.filter((count) => count > most)).toEqual([]);
	});
