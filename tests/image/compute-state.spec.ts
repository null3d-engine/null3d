// A compute pass that keeps its state between runs, and the reads of its texels, on every GPU path.
// The pass adds one to the state of the run before, so its value counts the runs: 100 runs read
// 100, 40 runs in one frame read the same as 40 frames of one run, and a stopped pass keeps the
// value it had. A reset and a lost device both start the state again from zero. Each read answers
// through a promise a frame or more after the call, and the page reports that delay.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

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
	/** The cost case's figures: the frame probe's medians, and the pass's texel memory. */
	seconds?: number;
	measuredFrames?: number;
	interval?: number;
	cpu?: number;
	gpu?: number | null;
	passBytes?: number;
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

	test(`a 40-step history pass measures on ${tier}`, async ({ page }) => {
		const result = await stateCase(page, query, 'cost', 120_000);
		expect(result.measuredFrames).toBeGreaterThan(0);
		expect(result.interval).toBeGreaterThan(0);
		expect(result.passBytes).toBe(256 * 256 * 8 * 4);
		// The line the run records: frame interval, CPU, GPU where timed, and the pass's memory.
		console.log(
			`cost ${tier}: ${result.interval?.toFixed(2)} ms frame, ${result.cpu?.toFixed(2)} ms CPU, ` +
				`${result.gpu === null || result.gpu === undefined ? 'no GPU timer' : `${result.gpu.toFixed(2)} ms GPU`}, ` +
				`${result.measuredFrames} frames in ${result.seconds?.toFixed(1)} s, ${result.passBytes} bytes`,
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
}

for (const { tier, query } of TIERS) {
	test(`a pass of three layers reads back each layer as it wrote it on ${tier}`, async ({
		page,
	}) => {
		const result = await stateCase(page, query, 'layers');
		expect(result.values).toEqual([1, 2, 3]);
	});
}
