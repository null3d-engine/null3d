// The ocean add-on's wave transform, compared with the transform that the add-on runs on this
// thread from the same spectra. The page reads a small square of each band's heights back through
// the engine, so a chain that lost a stage, read the wrong texel or turned the tile over shows on
// every GPU path.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ mode: 'parallel' });

/** What the page reports once its reads have landed. */
interface WavesResult {
	ok?: boolean;
	tier: string;
	mode: unknown;
	time: number;
	stamps: number[];
	gpu: number[][];
	cpu: number[][];
	/** Each band's slopes at the read square: one along the row, then one along the column. */
	slopes: number[][];
	cpuSlopes: number[][];
	frames: number[];
	later: { time: number; gpu: number[][]; stamps: number[] };
	tiles: number[];
	grid: number;
	error?: string;
}

/** The GPU paths that the page runs, and the switch that chooses each. */
const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

/** The heights that the two forms may differ by, in meters: the transform runs in 16-bit floats. */
const TOLERANCE = 0.05;
/** The slopes that the two forms may differ by, in meters a meter: the heights' own step. */
const SLOPE_TOLERANCE = 0.05;

/**
 * The orders that a pass's read may come back in: the rows as the transform wrote them, and the
 * turns and flips that a read of a pass can give, since a read counts its rows from the image's
 * top and a fragment form writes them from the bottom. The sea is statistically the same under
 * any of them.
 */
const ORDERS = [
	{ name: 'as written', at: (x: number, y: number, n: number) => y * n + x },
	{ name: 'rows turned', at: (x: number, y: number, n: number) => (n - 1 - y) * n + x },
	{ name: 'columns turned', at: (x: number, y: number, n: number) => y * n + (n - 1 - x) },
	{ name: 'both turned', at: (x: number, y: number, n: number) => (n - 1 - y) * n + (n - 1 - x) },
	{ name: 'across the diagonal', at: (x: number, y: number, n: number) => x * n + y },
	{
		name: 'a quarter turn',
		at: (x: number, y: number, n: number) => x * n + (n - 1 - y),
	},
	{
		name: 'three quarter turns',
		at: (x: number, y: number, n: number) => (n - 1 - x) * n + y,
	},
	{
		name: 'across the other diagonal',
		at: (x: number, y: number, n: number) => (n - 1 - x) * n + (n - 1 - y),
	},
] as const;

async function waves(page: Page, query: string): Promise<WavesResult> {
	await page.goto(`ocean-waves.html?${query}`);
	const result = await pageResult<WavesResult>(page, 120_000);
	expect(result.ok).toBe(true);
	expect(result.error).toBeUndefined();
	return result;
}

for (const { tier, query } of TIERS) {
	test(`the ocean's transform draws the heights of its spectrum on ${tier}`, async ({ page }) => {
		const result = await waves(page, query);
		expect(result.tier).toBe(tier);
		expect(result.gpu.length).toBe(2);
		expect(result.cpu.length).toBe(2);
		// The sea must move between the two reads: a field that stays still means the transform
		// reads no new time, or nothing new at all.
		let moved = 0;
		for (let at = 0; at < (result.gpu[0] as number[]).length; at++)
			moved = Math.max(
				moved,
				Math.abs(
					((result.gpu[0] as number[])[at] as number) -
						((result.later.gpu[0] as number[])[at] as number),
				),
			);
		console.log(
			`${tier}: the sea moved by ${moved.toFixed(4)} m between ${(result.stamps[0] as number).toFixed(2)} s and ${(result.later.stamps[0] as number).toFixed(2)} s`,
		);
		expect(moved).toBeGreaterThan(0.01);
		const side = 4;
		for (let band = 0; band < result.cpu.length; band++) {
			const gpu = result.gpu[band] as number[];
			const cpu = result.cpu[band] as number[];
			expect(gpu.length).toBe(cpu.length);
			let best = { name: '', worst: Number.POSITIVE_INFINITY };
			let largest = 0;
			for (const order of ORDERS) {
				let worst = 0;
				for (let row = 0; row < side; row++)
					for (let column = 0; column < side; column++) {
						const at = order.at(column, row, side);
						worst = Math.max(
							worst,
							Math.abs((gpu[at] as number) - (cpu[row * side + column] as number)),
						);
					}
				if (worst < best.worst) best = { name: order.name, worst };
			}
			for (const value of cpu) largest = Math.max(largest, Math.abs(value));
			console.log(
				`${tier} band ${band}: heights to ${largest.toFixed(3)} m, ${best.name}, the worst texel differs by ${best.worst.toFixed(4)} m, ${result.frames[band]} frames, at ${(result.stamps[band] as number).toFixed(3)} s`,
			);
			console.log(
				`  gpu ${gpu
					.slice(0, 8)
					.map((value) => value.toFixed(3))
					.join(' ')}`,
			);
			console.log(
				`  cpu ${cpu
					.slice(0, 8)
					.map((value) => value.toFixed(3))
					.join(' ')}`,
			);
			expect(largest).toBeGreaterThan(0.02);
			expect(best.worst).toBeLessThan(TOLERANCE);
			// The surface lights and mirrors with the slopes, so a slope that the last pass lost or
			// turned shows as a flat or a reversed swell even while the heights agree.
			const gpuSlopes = result.slopes[band] as number[];
			const cpuSlopes = result.cpuSlopes[band] as number[];
			let slopeWorst = 0;
			let slopeCpu = 0;
			for (let at = 0; at < cpuSlopes.length; at++)
				slopeWorst = Math.max(
					slopeWorst,
					Math.abs((gpuSlopes[at] as number) - (cpuSlopes[at] as number)),
				);
			for (const value of cpuSlopes) slopeCpu = Math.max(slopeCpu, Math.abs(value));
			console.log(
				`${tier} band ${band}: slopes to ${slopeCpu.toFixed(3)}, the worst differs by ${slopeWorst.toFixed(4)}`,
			);
			expect(slopeWorst).toBeLessThan(SLOPE_TOLERANCE);
		}
	});
}
