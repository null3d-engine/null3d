// No frame draws the scene without an environment's light: the built-in room, or an HDR file that
// the engine reads and filters at load. A sketch asks for the environment during play, and sets it
// with a blue background in the same step once it resolves. The engine makes the whole map in one
// go before the first frame that uses it (D-66), so every frame with the blue background already
// shows the light on a metal sphere, which has no other light. The room runs on each GPU path, and
// in each thread mode on WebGPU, since the generator reaches the thread that draws in each mode's
// own way. The HDR files run on each GPU path. The test prints how long each environment took.
import { expect, test } from '@playwright/test';
import { sampleUrl } from '../../tools/lib/sample-url.ts';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface RoomLightResult {
	error?: string;
	tier: string;
	set: boolean;
	steadyBlue: boolean;
	pixels: number;
	darkBlue: boolean;
	blackFrames: number;
	blueFrames: number;
	blueChanged: number[];
	litMiddle: number;
	unlitMiddle: number;
	setMs: number | null;
	lightMs: number | null;
	failures: string[];
}

/** The HDR files: a Radiance file and an OpenEXR file with PIZ compression. */
const FILES = [
	['the Radiance file', sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr')],
	['the OpenEXR file', sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr')],
] as const;

const PATHS = [
	{ gpu: 'webgpu', tier: 'webgpu', mode: ENGINE_MODES[0] },
	{ gpu: 'compat', tier: 'webgpu-compat', mode: ENGINE_MODES[0] },
	{ gpu: 'webgl2', tier: 'webgl2', mode: ENGINE_MODES[0] },
] as const;

const ROOM = 'the built-in room';

const RUNS: {
	gpu: string;
	tier: string;
	mode: (typeof ENGINE_MODES)[number];
	name: string;
	source?: string;
}[] = [
	...ENGINE_MODES.map((mode) => ({ gpu: 'webgpu', tier: 'webgpu', mode, name: ROOM })),
	...PATHS.slice(1).map((path) => ({ ...path, name: ROOM })),
	...FILES.flatMap(([name, source]) => PATHS.map((path) => ({ ...path, name, source }))),
];

for (const { gpu, tier, mode, name, source: file } of RUNS)
	test(`every frame that uses ${name} shows its light on ${tier}, ${mode.name}`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		const source = file ? `&source=${encodeURIComponent(file)}` : '';
		await page.goto(`room-light.html?gpu=${gpu}&${mode.query}${source}`);
		const result = await pageResult<RoomLightResult>(page, 200_000);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		expect(result.tier).toBe(tier);
		expect(result.set, 'the room resolved').toBe(true);
		expect(result.steadyBlue).toBe(true);
		expect(result.blueFrames, 'frames that use the room were captured').toBeGreaterThan(0);
		// The room lights the sphere, which is dark in the frame before the request.
		expect(result.darkBlue, 'the frame before the request has no room').toBe(false);
		expect(result.litMiddle).toBeGreaterThan(result.unlitMiddle + 40);
		// Each frame that uses the room draws as the steady frame does, within a few pixels.
		const most = Math.ceil(0.001 * result.pixels);
		expect(result.blueChanged.filter((count) => count > most)).toEqual([]);
		console.log(
			`${name} on ${tier}, ${mode.name}: resolved in ${result.setMs?.toFixed(0)} ms, lit the first frame at ${result.lightMs?.toFixed(0)} ms`,
		);
	});
