// The environment maps that the engine makes on the GPU, against the asset tool's maps, on every GPU
// path, as environment-generator-checks.ts compares them: the built-in room, and the panoramas of
// HDR files that `assets.loadEnvironment` reads. The real-browser runner runs the same page and
// checks in each browser, for the room.
//
// The HDR files are Venice Sunset (a low sun), Kloofendal (a sky whose sun passes the largest
// shared-exponent value, so the panorama holds its light halved) and the studio as OpenEXR with PIZ
// compression. The page reads each with the engine's readers, as the panorama worker does.
//
// The generator makes the whole map in one go, as the engine does at load (D-66). The test prints
// the first map's time, as at load, and the time that the readers took. NULL3D_ENV_RUNS=<n> times
// n more maps after it, for the generator's cost in D-19.
import { expect, test } from '@playwright/test';
import { sampleUrl } from '../../tools/lib/sample-url.ts';
import { samplePath } from '../../tools/lib/samples.ts';
import { type GeneratorResult, generatorReport } from '../lib/environment-generator-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** A map to make: the room, or a sample HDR file, with its address on the dev server and its path. */
interface Source {
	name: string;
	file?: { url: string; path: string };
}

const SOURCES: Source[] = [
	{ name: 'the built-in room' },
	{
		name: 'Venice Sunset from its .hdr file',
		file: {
			url: sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr'),
			path: samplePath('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr'),
		},
	},
	{
		name: 'Kloofendal, brighter than a shared-exponent texel, from its .hdr file',
		file: {
			url: sampleUrl(
				'sources/hdri/polyhaven/kloofendal_48d_partly_cloudy_puresky/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
			),
			path: samplePath(
				'sources/hdri/polyhaven/kloofendal_48d_partly_cloudy_puresky/kloofendal_48d_partly_cloudy_puresky_2k.hdr',
			),
		},
	},
	{
		name: 'the studio from its PIZ .exr file',
		file: {
			url: sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
			path: samplePath('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
		},
	},
];

const runs = Number(process.env.NULL3D_ENV_RUNS ?? '0');

for (const { name, file } of SOURCES)
	for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
		test(`${name}, made on ${gpu}, matches the asset tool's map`, async ({ page }) => {
			test.setTimeout(240_000);
			const query = file ? `&source=${encodeURIComponent(file.url)}` : '';
			await page.goto(`environment-generator.html?gpu=${gpu}&runs=${runs}${query}`);
			const result = await pageResult<GeneratorResult>(page, 200_000);
			const { lines, problems } = generatorReport(result, file?.path);
			const ms = (times: number[]) => times.map((t) => t.toFixed(1)).join(', ');
			lines.push(
				`pipelines in the background: ${result.prepareTime.toFixed(1)} ms; maps, first at load, in ms: ${ms(result.times)}`,
				`the thread's time in each call, ms: ${ms(result.callTimes)}; GPU times in ms: ${ms(result.gpuTimes)}`,
			);
			console.log(`${name}, ${result.tier}\n${lines.join('\n')}`);
			expect(problems).toEqual([]);
		});
