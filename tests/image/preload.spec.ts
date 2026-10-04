// Shader files that load before play (decision record D-56). With a preload list, the features'
// files download before the first frame, so turning skinned characters, bloom and lines on during
// play downloads no shader file. A glTF file with skins starts the skinning
// file's download while the file is read, before the sketch adds the model, and the first frame
// shows the model in its pose. An unknown name fails the start with E1421.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface PreloadResult {
	error?: string;
	tier: string;
	first: string;
	later: string;
	acrossSkippedDraws: number;
	failures: string[];
}

/** The address of a shader file of a feature that loads on first use, with its feature. */
const FEATURE_FILE = /\/shaders-(ao|background|bloom|lines|skinning|sprites|texcoords)-[^/]*$/;

/** The most a channel may differ for two pixels to count as the same. */
const CHANNEL = 8;

/** The share of pixels of `a` and `b` that differ in a channel by more than the tolerance. */
function differentShare(a: Uint8Array, b: Uint8Array): number {
	let different = 0;
	for (let i = 0; i < a.length; i += 4)
		for (let c = 0; c < 3; c++)
			if (Math.abs((a[i + c] as number) - (b[i + c] as number)) > CHANNEL) {
				different++;
				break;
			}
	return different / (a.length / 4);
}

/**
 * Loads the page in `mode` on `gpu`, and returns its result with the page's events in order: the
 * name of each feature whose shader file the engine asked for, and each moment the page marked.
 */
async function load(page: Page, mode: string, gpu: string) {
	const events: string[] = [];
	page.context().on('request', (request) => {
		const feature = FEATURE_FILE.exec(new URL(request.url()).pathname)?.[1];
		if (feature) events.push(feature);
	});
	await page.exposeBinding('__mark', (_, name: string) => events.push(`mark:${name}`));
	await page.goto(`preload.html?mode=${mode}&gpu=${gpu}`);
	const result = await pageResult<PreloadResult>(page, 60_000);
	return { result, events };
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	test(`a preload list fetches every feature's shader file before the first frame on ${gpu}`, async ({
		page,
	}) => {
		const { result, events } = await load(page, 'list', gpu);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		const first = events.indexOf('mark:first-frame');
		expect(first).toBeGreaterThan(0);
		expect(new Set(events.slice(0, first))).toEqual(new Set(['skinning', 'bloom', 'lines']));
		const after = events.slice(first + 1);
		expect(after).toContain('mark:added');
		expect(after.filter((event) => !event.startsWith('mark:'))).toEqual([]);
		// The line batch draws once its pipeline is built, as every new object does, so a frame may
		// skip its draw. The skinned characters and bloom skip none: their tests check that.
		console.log(`skipped draws across the change on ${gpu}: ${result.acrossSkippedDraws}`);
	});

	test(`a glTF file with skins fetches the skinning file before its model is added on ${gpu}`, async ({
		page,
	}) => {
		const { result, events } = await load(page, 'gltf', gpu);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		const skinning = events.indexOf('skinning');
		expect(skinning).toBeGreaterThanOrEqual(0);
		expect(skinning).toBeLessThan(events.indexOf('mark:instantiate'));
		// The characters stand still, so the first frame shows the pose of every later one.
		const first = Buffer.from(result.first, 'base64');
		const later = Buffer.from(result.later, 'base64');
		const background = new Uint8Array(first.length);
		for (let i = 0; i < background.length; i += 4) background.set(first.subarray(0, 4), i);
		expect(differentShare(first, background)).toBeGreaterThan(0.02);
		expect(differentShare(first, later)).toBeLessThanOrEqual(0.002);
	});
}

test('a preload list that names an unknown feature fails the start with E1421', async ({
	page,
}) => {
	const { result } = await load(page, 'unknown', 'webgl2');
	expect(result.error).toContain('E1421');
	expect(result.error).toContain("'skining'");
});
