// A compute pass that keeps its state between runs, and the reads of its texels, on every GPU path.
// The pass adds one to the state of the run before, so its value counts the runs: 100 runs read
// 100, 40 runs in one frame read the same as 40 frames of one run, and a stopped pass keeps the
// value it had. A reset and a lost device both start the state again from zero. Each read answers
// through a promise a frame or more after the call, and the page reports that delay.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** One side of the cost case: the frame probe's medians and the format the pass got. */
interface CostFigures {
	frames: number;
	seconds: number;
	interval: number;
	cpu: number;
	gpu: number | null;
	format: string | null;
}

interface StateResult {
	ok: boolean;
	tier: string;
	mode: unknown;
	case: string;
	values: number[];
	frames: number;
	/** The left and right pixels of the stopped-pass picture, and whether the two captures match. */
	left?: [number, number, number, number];
	right?: [number, number, number, number];
	same?: boolean;
	/** The cost case's figures: the frame probe's medians with the pass on and off. */
	on?: CostFigures;
	off?: CostFigures;
	passBytes?: number;
	/** Milliseconds that the read call took to return, in the slow-frame case. */
	callMs?: number;
	/** The four numbers of each texel of a region read, top row first. */
	texels?: number[];
	error?: string;
}

/** The GPU paths that the page runs, and the switch that chooses each. */
const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

/** Asks the page for one case on one tier, and fails with the page's own error when it gives one. */
async function stateCase(
	page: Page,
	query: string,
	state: string,
	timeoutMs = 60_000,
): Promise<StateResult> {
	await page.goto(`compute-state.html?${query}&case=${state}`);
	const result = await pageResult<StateResult>(page, timeoutMs);
	expect(result.error).toBeUndefined();
	return result;
}

for (const { tier, query } of TIERS) {
	test(`a history pass reads 100 after 100 runs on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'steps');
		expect(result.ok).toBe(true);
		expect(result.tier).toBe(tier);
		expect(result.values[0]).toBe(100);
		expect(result.frames).toBeGreaterThanOrEqual(1);
		// The field names each texel in green and blue, so a wrong row, column or flip shows.
		expect(result.texels).toEqual([100, 1, 1, 1, 100, 2, 1, 1, 100, 1, 2, 1, 100, 2, 2, 1]);
		console.log(`read ${tier}: ${result.frames} frames for the region`);
	});

	test(`a history pass of 40 runs reads what 40 frames of one run read on ${tier}`, async ({
		page,
	}) => {
		const row = await stateCase(page, query, 'forty-row');
		const passes = await stateCase(page, query, 'forty-passes');
		expect(row.values[0]).toBe(40);
		expect(passes.values[0]).toBe(40);
		expect(row.values[0]).toBe(passes.values[0]);
	});

	test(`a stopped history pass keeps its texture on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'stopped');
		expect(result.values[0]).toBe(3);
	});

	test(`a reset starts a history pass again from zero on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'reset');
		expect(result.values).toEqual([0, 1]);
	});

	test(`a lost device starts a history pass again from zero on ${tier}`, async ({ page }) => {
		// The engine rebuilds the device and every texture; the counter then starts from empty.
		const result = await stateCase(page, query, 'loss', 90_000);
		expect(result.values).toEqual([2, 1]);
	});

	test(`a slow frame delays a read and never blocks it on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'slow', 90_000);
		expect(result.values[0]).toBe(1);
		// The call returns at once; the 150 ms update delays the frame that answers it.
		expect(result.callMs ?? 1000).toBeLessThan(50);
		expect(result.frames).toBeGreaterThanOrEqual(1);
	});

	test(`an out-of-range read is refused on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'refuse');
		expect(result.values[0]).toBe(1);
	});

	test(`a 40-step history pass measures on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'cost', 150_000);
		const on = result.on as CostFigures;
		const off = result.off as CostFigures;
		expect(on.frames).toBeGreaterThan(0);
		expect(off.frames).toBeGreaterThan(0);
		expect(on.interval).toBeGreaterThan(0);
		// The frame stays within the weakest tier's 33.3 ms floor with the pass on.
		expect(on.interval).toBeLessThanOrEqual(33.4);
		if (on.gpu !== null) expect(on.gpu).toBeLessThanOrEqual(33.4);
		// The compute paths hold four rgba16float copies of one state's texels; WebGL2 holds three
		// in the scene color's format.
		const copies = tier === 'webgl2' ? 3 : 4;
		const texel = tier === 'webgl2' && on.format !== 'rgba16float' ? 4 : 8;
		expect(result.passBytes).toBe(256 * 256 * copies * texel);
		const side = (figures: CostFigures) =>
			`${figures.interval.toFixed(2)} ms frame, ${figures.cpu.toFixed(2)} ms CPU, ` +
			`${figures.gpu === null ? 'no GPU timer' : `${figures.gpu.toFixed(2)} ms GPU`}, ` +
			`${figures.frames} frames`;
		console.log(
			`cost ${tier} (${on.format}, ${result.passBytes} bytes): on ${side(on)}; off ${side(off)}`,
		);
	});

	test(`a stopped pass keeps its image and its alpha on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'kept');
		// The left half shows the pass's white image, and the right half its zero coverage as light:
		// a pass texture that lost its alpha would show white there.
		expect(result.left?.[0] ?? 0).toBeGreaterThan(120);
		expect(result.right?.[0] ?? 255).toBeLessThan(40);
		expect(result.same).toBe(true);
	});

	test(`a stopped full-screen pass keeps its image and its alpha on ${tier}`, async ({ page }) => {
		// The M3-V5 fault, on a full-screen pass rather than a compute pass.
		const result = await stateCase(page, query, 'fs-kept');
		expect(result.left?.[0] ?? 0).toBeGreaterThan(120);
		expect(result.right?.[0] ?? 255).toBeLessThan(40);
		expect(result.same).toBe(true);
	});
}

for (const { tier, query } of TIERS) {
	test(`a pass of three layers reads back each layer as it wrote it on ${tier}`, async ({
		page,
	}) => {
		const result = await stateCase(page, query, 'layers');
		expect(result.values).toEqual([1, 2, 3]);
	});
}
