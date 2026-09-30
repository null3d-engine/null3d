import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface BatchResult {
	ok: boolean;
	code?: string;
	message?: string;
}

interface LimitsResult {
	error?: string;
	mode: { build: string };
	maxInstances: number;
	pastPortable: BatchResult;
	pastPortableDrawn: number;
	full: BatchResult;
	after: BatchResult;
	afterDrawn: number;
	failures: string[];
}

/** Objects and instance rows that every WebGPU device draws. */
const PORTABLE = 2_097_152;
/** The most objects and instance rows one culling pass covers. */
const ONE_PASS = 8_388_480;
/** Engine memory one instance row without colors takes, and the most a threaded page has. */
const ROW_BYTES = 168;
const THREADED_MEMORY = 1024 ** 3;

test('a scene holds as many rows as the device draws, and running out of memory is an error', async ({
	page,
}) => {
	test.setTimeout(180_000);
	const warnings: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'warning' && message.text().includes('objects and instance rows'))
			warnings.push(message.text());
	});
	await page.goto('limits.html?gpu=webgpu');
	const result = await pageResult<LimitsResult>(page, 170_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.maxInstances).toBeGreaterThanOrEqual(PORTABLE);
	expect(result.maxInstances).toBeLessThanOrEqual(ONE_PASS);

	if (result.maxInstances >= 3_000_000 + 16_384) {
		// The device draws more than every WebGPU device does: the batch's last row, past the
		// portable limit, is on screen, and development builds warn once.
		expect(result.pastPortable).toEqual({ ok: true });
		expect(result.pastPortableDrawn).toBeGreaterThan(0);
		expect(warnings).toHaveLength(1);
	} else {
		expect(result.pastPortable.code).toBe('E1501');
		expect(result.pastPortable.message).toContain(
			`${result.maxInstances.toLocaleString('en-US')} at most`,
		);
		expect(warnings).toHaveLength(0);
	}

	// A batch as large as the GPU allows either fits engine memory, or fails with E1109.
	const fullBytes = (result.maxInstances - 16_384) * ROW_BYTES;
	if (result.mode.build === 'threaded' && fullBytes > THREADED_MEMORY)
		expect(result.full.code).toBe('E1109');
	else expect(result.full.ok || result.full.code === 'E1109').toBe(true);

	// Neither refusal harms the engine: a small batch still draws.
	expect(result.after).toEqual({ ok: true });
	expect(result.afterDrawn).toBeGreaterThan(0);
});
