// The environment maps that the engine makes on the GPU, against the asset tool's maps, on every GPU
// path: the built-in room, and the panoramas of HDR files that `assets.loadEnvironment` reads. Both
// follow the same steps (D-19). The room starts with a trace and a blur of 0.04 radians, and a
// panorama with its light mapped onto the cube; then come the chain of halved levels and the GGX
// filter of each level. The tool works in 32-bit floats on the CPU, and the GPU keeps each step's
// texels as shared-exponent floats and filters with the GPU's own precision, so the two differ by
// small steps. The comparison tone maps each texel first, as the parity test does, so it counts a
// difference as much as a picture shows it.
//
// The HDR files are Venice Sunset (a low sun), Kloofendal (a sky whose sun passes the largest
// shared-exponent value, so the panorama holds its light halved) and the studio as OpenEXR with PIZ
// compression. The page reads each with the engine's readers, as the panorama worker does, and the
// test compares their diffuse light with the tool's too.
//
// The generator makes the whole map in one go, as the engine does at load (D-66). The test prints
// the first map's time, as at load, and the time that the readers took. NULL3D_ENV_RUNS=<n> times
// n more maps after it, for the generator's cost in D-19.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readEnvironment } from '../../packages/cli/src/assets/env.js';
import { environmentMap } from '../../packages/cli/src/assets/formats.js';
import { sampleUrl } from '../../tools/lib/sample-url.ts';
import { samplePath } from '../../tools/lib/samples.ts';
import { compareLevels, reinhardSteps, words } from '../lib/environment-maps.ts';
import { pageResult } from '../lib/page-result.ts';

interface GeneratorResult {
	ok: boolean;
	error?: string;
	tier: string;
	errors: string[];
	prepareTime: number;
	times: number[];
	callTimes: number[];
	gpuTimes: number[];
	size: number;
	levels: string[];
	/** The readers' diffuse light and time, and the panorama's gain, for a file. */
	sh: number[];
	readTime: number;
	gain: number;
}

/**
 * How far each level may lie from the tool's, in steps of 1/255 after tone mapping, as mean / p99,
 * and how far its total light may lie from the tool's.
 */
interface Tolerance {
	mean: number;
	p99: number;
	ratio: number;
}

/** A map to make: the room, or a sample HDR file, with its address on the dev server. */
interface Source {
	name: string;
	/** The file's address for the page, and its bytes for the tool. */
	file?: { url: string; path: string };
	tolerance: Tolerance;
}

const ROOM: Tolerance = { mean: 0.25, p99: 1, ratio: 0.005 };
const PANORAMA: Tolerance = { mean: 0.25, p99: 1, ratio: 0.005 };

const SOURCES: Source[] = [
	{ name: 'the built-in room', tolerance: ROOM },
	{
		name: 'Venice Sunset from its .hdr file',
		file: {
			url: sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr'),
			path: samplePath('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr'),
		},
		tolerance: PANORAMA,
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
		tolerance: PANORAMA,
	},
	{
		name: 'the studio from its PIZ .exr file',
		file: {
			url: sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
			path: samplePath('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
		},
		tolerance: PANORAMA,
	},
];

/** How far the readers' diffuse light may lie from the tool's: a share of the first coefficient. */
const SH_TOLERANCE = 0.01;

const runs = Number(process.env.NULL3D_ENV_RUNS ?? '0');

/** The tool's map of each source, made once, on the first test that needs it. */
const toolMaps = new Map<string, Uint8Array>();

function toolMap(source: Source): Uint8Array {
	let map = toolMaps.get(source.name);
	if (!map) {
		const from = source.file ? { file: readFileSync(source.file.path) } : { builtin: 'room' };
		map = environmentMap(from, { size: 256, format: 'rgb9e5ufloat' });
		toolMaps.set(source.name, map);
	}
	return map;
}

for (const source of SOURCES)
	for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
		test(`${source.name}, made on ${gpu}, matches the asset tool's map`, async ({ page }) => {
			test.setTimeout(240_000);
			const query = source.file ? `&source=${encodeURIComponent(source.file.url)}` : '';
			await page.goto(`environment-generator.html?gpu=${gpu}&runs=${runs}${query}`);
			const result = await pageResult<GeneratorResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			expect(result.errors).toEqual([]);
			const tool = toolMap(source);
			const env = readEnvironment(tool);
			const { mean: meanLimit, p99: p99Limit, ratio: ratioLimit } = source.tolerance;
			const lines: string[] = [];
			const failures: string[] = [];
			const levels = result.levels.map((base64) => words(base64));
			compareLevels(levels, tool, env, reinhardSteps(env.sh)).forEach(
				({ mean, p99, ratio }, level) => {
					lines.push(
						`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}, ratio ${ratio.toFixed(4)}`,
					);
					if (mean > meanLimit || p99 > p99Limit)
						failures.push(`level ${level}: ${mean.toFixed(3)} / ${p99.toFixed(2)}`);
					if (Math.abs(ratio - 1) > ratioLimit)
						failures.push(`level ${level}: the total light differs by ${ratio.toFixed(4)}`);
				},
			);
			if (source.file) {
				const scale = Math.abs(env.sh[0] as number);
				const most = Math.max(...result.sh.map((c, k) => Math.abs(c - (env.sh[k] as number))));
				lines.push(
					`diffuse light: largest difference ${(most / scale).toFixed(4)} of the first coefficient; gain ${result.gain}; readers ${result.readTime.toFixed(0)} ms`,
				);
				if (most > SH_TOLERANCE * scale)
					failures.push(`the diffuse light differs by ${(most / scale).toFixed(4)}`);
			}
			const ms = (times: number[]) => times.map((t) => t.toFixed(1)).join(', ');
			lines.push(
				`pipelines in the background: ${result.prepareTime.toFixed(1)} ms; maps, first at load, in ms: ${ms(result.times)}`,
				`the thread's time in each call, ms: ${ms(result.callTimes)}; GPU times in ms: ${ms(result.gpuTimes)}`,
			);
			console.log(`${source.name}, ${result.tier}\n${lines.join('\n')}`);
			expect(failures).toEqual([]);
		});
