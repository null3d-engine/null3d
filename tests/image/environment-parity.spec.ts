// The asset tool's environment maps against three.js's PMREMGenerator for the same HDR file. Both
// sides are read in the same directions: the tool's file on the CPU, as a shader samples the cube
// map, and three.js's PMREM through textureCubeUV in the browser. The comparison tone maps each
// value first, so it measures what a picture shows, and a bright sun counts only as much as it
// shows on screen. D-19 records the tolerances and the figures.
//
// NULL3D_ENV_PARITY_FIT=1 also prints, for each roughness, the GGX roughness that matches three.js
// best (the source of THREE_PMREM_ROUGHNESS), and the figures of other sizes and texel formats.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type EnvironmentFile, readEnvironment } from '../../packages/cli/src/assets/env.js';
import { environmentMap } from '../../packages/cli/src/assets/formats.js';
import { samplePath } from '../../tools/lib/samples.ts';
import {
	averageLight,
	roughnessLod,
	sampleEnvironment,
	shIrradiance,
	threePmremRoughness,
} from '../lib/environment-maps.ts';
import { pageResult } from '../lib/page-result.ts';

/** How far a map may lie from three.js's PMREM: D-19's tolerances, or its own where it names them. */
type Tolerances = typeof TOLERANCE;

/**
 * HDR files with and without a sun, each on disk for the tool and on the dev server for three.js,
 * and the engine's built-in room beside three.js's RoomEnvironment, prefiltered with the blur of
 * three.js's examples. The room's panels are small and far brighter than its walls, so the edges
 * of their reflections take looser limits than an HDR file's (D-19).
 */
const FILES: Record<
	string,
	{ path: string; url: string; builtin?: boolean; sigma?: number; tolerance?: Partial<Tolerances> }
> = {
	'a sunset': {
		path: samplePath('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr'),
		url: '/samples/sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr',
	},
	'a street': {
		path: samplePath('sources/hdri/polyhaven/potsdamer_platz/potsdamer_platz_2k.hdr'),
		url: '/samples/sources/hdri/polyhaven/potsdamer_platz/potsdamer_platz_2k.hdr',
	},
	'the built-in room': {
		path: join(import.meta.dirname, '../../packages/engine/environments/room.ktx2'),
		url: 'room',
		builtin: true,
		sigma: 0.04,
		tolerance: {
			same: { mean: 9, p99: 40 },
			matched: { mean: 4.5, p99: 25 },
		},
	},
};

/** The call that the parity page offers: three.js's PMREM light in each direction at each roughness. */
interface PmremPage {
	pmremLight?: (request: {
		url: string;
		sigma?: number;
		directions: number[];
		roughness: number[];
	}) => Promise<{ cubeSize: number; light: number[] }>;
}

/** Material roughness from 0 to 1 in steps of 0.05. */
const ROUGHNESS = Array.from({ length: 21 }, (_, i) => i / 20);

/** The tolerances, in steps of 1/255 after tone mapping, that D-19 records. */
const TOLERANCE = {
	/** The tool's levels read at the material's own roughness. */
	same: { mean: 6, p99: 24 },
	/** The levels read at the GGX roughness that matches three.js (THREE_PMREM_ROUGHNESS). */
	matched: { mean: 3.5, p99: 14 },
	/** The diffuse light of the nine coefficients against three.js's PMREM at roughness 1. */
	diffuse: { mean: 4, p99: 14 },
	/** The total light of the tool's levels over three.js's, from roughness 0.1 up. */
	ratio: 0.02,
};

/** Directions spread evenly over the sphere, on a Fibonacci spiral. */
function directions(count: number): number[] {
	const out: number[] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < count; i++) {
		const y = 1 - (2 * (i + 0.5)) / count;
		const r = Math.sqrt(1 - y * y);
		out.push(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r);
	}
	return out;
}

interface Difference {
	/** The mean difference after tone mapping, in steps of 1/255. */
	mean: number;
	/** The difference that 99% of values stay within, in steps of 1/255. */
	p99: number;
	/** The sum of `values` over the sum of `reference`, before tone mapping. */
	ratio: number;
}

/**
 * How far `values` lie from `reference` after Reinhard's tone mapping, at an exposure that puts
 * the environment's average light at a third of white.
 */
function compare(values: number[], reference: number[], average: number): Difference {
	const exposure = 0.5 / average;
	const tone = (x: number) => (255 * x * exposure) / (1 + x * exposure);
	const steps = values.map((v, i) => Math.abs(tone(v) - tone(reference[i] as number)));
	const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
	const sorted = [...steps].sort((a, b) => a - b);
	return {
		mean: sum(steps) / steps.length,
		p99: sorted[Math.floor(0.99 * (sorted.length - 1))] as number,
		ratio: sum(values) / sum(reference),
	};
}

const shown = (d: Difference) => `${d.mean.toFixed(2)} / ${d.p99.toFixed(1)}`;

/** The light of a map in each direction at a roughness. */
function lookup(file: Uint8Array, env: EnvironmentFile, dirs: number[], roughness: number) {
	const lod = roughnessLod(env, roughness);
	const out: number[] = [];
	for (let i = 0; i < dirs.length; i += 3)
		out.push(...sampleEnvironment(file, env, dirs.slice(i, i + 3), lod));
	return out;
}

for (const [name, source] of Object.entries(FILES))
	test(`the environment map of ${name} matches three.js's PMREM`, async ({ page }) => {
		test.setTimeout(240_000);
		await page.goto('environment-parity.html');
		await pageResult(page, 30_000);
		const dirs = directions(4096);
		const count = dirs.length / 3;
		const three = await page.evaluate(
			(request) => (globalThis as PmremPage).pmremLight?.(request),
			{
				url: source.url,
				sigma: source.sigma,
				directions: dirs,
				roughness: ROUGHNESS,
			},
		);
		if (!three) throw new Error('the page offers no pmremLight');
		const theirs = (k: number) => three.light.slice(k * 3 * count, (k + 1) * 3 * count);
		const limits = { ...TOLERANCE, ...source.tolerance };
		const hdr = new Uint8Array(readFileSync(source.path));
		const file = source.builtin
			? hdr
			: environmentMap({ file: hdr }, { size: 256, format: 'rgb9e5ufloat' });
		const env = readEnvironment(file);
		const average = averageLight(env.sh);
		const lines: string[] = [];
		const failures: string[] = [];
		const check = (what: string, d: Difference, limit: { mean: number; p99: number }) => {
			if (d.mean > limit.mean || d.p99 > limit.p99)
				failures.push(`${what}: ${shown(d)} is over ${limit.mean} / ${limit.p99}`);
		};
		ROUGHNESS.forEach((r, k) => {
			const same = compare(lookup(file, env, dirs, r), theirs(k), average);
			const matched = compare(lookup(file, env, dirs, threePmremRoughness(r)), theirs(k), average);
			check(`roughness ${r}`, same, limits.same);
			check(`roughness ${r} matched`, matched, limits.matched);
			if (r >= 0.1 && Math.abs(same.ratio - 1) > limits.ratio)
				failures.push(`roughness ${r}: the total light differs by ${same.ratio.toFixed(3)}`);
			lines.push(
				`${r.toFixed(2)}: same ${shown(same)}, ratio ${same.ratio.toFixed(3)}; matched ${shown(matched)}`,
			);
		});
		// three.js takes pi times its PMREM at roughness 1 as the irradiance, and the engine takes the
		// irradiance of the nine coefficients.
		const irradiance: number[] = [];
		for (let i = 0; i < dirs.length; i += 3)
			irradiance.push(...shIrradiance(env.sh, dirs.slice(i, i + 3)).map((c) => c / Math.PI));
		const diffuse = compare(irradiance, theirs(ROUGHNESS.length - 1), average);
		check('diffuse', diffuse, limits.diffuse);
		lines.push(`diffuse: ${shown(diffuse)}, ratio ${diffuse.ratio.toFixed(3)}`);

		if (process.env.NULL3D_ENV_PARITY_FIT && !source.builtin) {
			const grid = Array.from({ length: 101 }, (_, x) => lookup(file, env, dirs, x / 100));
			ROUGHNESS.forEach((r, k) => {
				let best = 0;
				let bestMean = Number.POSITIVE_INFINITY;
				grid.forEach((values, x) => {
					const { mean } = compare(values, theirs(k), average);
					if (mean < bestMean) [best, bestMean] = [x / 100, mean];
				});
				lines.push(`fit ${r.toFixed(2)}: best at ${best.toFixed(2)}, ${bestMean.toFixed(2)}`);
			});
			for (const [size, format] of [
				[128, 'rgb9e5ufloat'],
				[512, 'rgb9e5ufloat'],
				[256, 'rgba16float'],
			] as const) {
				const other = environmentMap({ file: hdr }, { size, format });
				const otherEnv = readEnvironment(other);
				for (const r of [0, 0.1, 0.3, 0.6, 1]) {
					const values = lookup(other, otherEnv, dirs, r);
					const k = ROUGHNESS.indexOf(r);
					lines.push(
						`${size} ${format} at ${r}: against three.js ${shown(compare(values, theirs(k), average))}; against 256 rgb9e5ufloat ${shown(compare(values, lookup(file, env, dirs, r), average))}`,
					);
				}
			}
		}
		console.log(`${name}, average light ${average.toFixed(3)}\n${lines.join('\n')}`);
		expect(failures).toEqual([]);
	});
