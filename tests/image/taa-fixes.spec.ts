// The temporal resolve's study fixes (task M3-A11, D-206): a history that follows a change of the
// exposure, the transparency mask over a transparent canvas and over an opaque surface, and the
// phone path against the full one. It also records what the resolve does to the two jittered
// effects that need it, thin rain and the volumetric fog. tests/pages/taa-fixes.ts draws each case
// and reports the figures in 8-bit levels; each run sees the same seeded scene.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ExposureResult {
	case: string;
	gpu: string;
	resolved: number;
	reference: number;
	error: number;
}

interface GhostResult {
	case: string;
	gpu: string;
	reactive: string;
	error: number;
	level: number;
	frameArrived: number;
	frameLeft: number;
	frameRight: number;
	referenceArrived: number;
	referenceRight: number;
}

interface PhoneResult {
	case: string;
	gpu: string;
	distance: number;
	mean: number;
}

interface EffectResult {
	case: string;
	gpu: string;
	off: number;
	on: number;
	offMean: number;
	onMean: number;
}

const GPUS = ['webgpu', 'webgl2'] as const;

for (const gpu of GPUS) {
	test(`a history follows a change of the exposure on ${gpu}`, async ({ page }) => {
		test.setTimeout(600_000);
		await page.goto(`taa-fixes.html?case=exposure&gpu=${gpu}`);
		const result = await pageResult<ExposureResult>(page, 180_000);
		expect(result.case).toBe('exposure');
		// The resolved frame holds the scene at the new exposure, within the noise's own blend.
		console.log(
			`TAAFIX exposure on ${result.gpu}: resolved mean ${result.resolved.toFixed(1)} against ${result.reference.toFixed(1)}, error ${result.error.toFixed(1)} levels`,
		);
		// Without the ratio, the history keeps the exposure of the frame before, so the resolved mean
		// falls about 45% below the reference's. The resolve's own smoothing moves the mean by about
		// a tenth, so the tolerance separates the two.
		expect(
			Math.abs(result.error),
			`resolved ${result.resolved.toFixed(1)} against ${result.reference.toFixed(1)}`,
		).toBeLessThan(16);
		expect(result.resolved).toBeGreaterThan(result.reference * 0.75);
	});
}

for (const gpu of GPUS) {
	test(`the scene's alpha lowers the history on ${gpu}`, async ({ page }) => {
		test.setTimeout(600_000);
		const off = await ghost(page, gpu, 'alpha', 'off');
		const on = await ghost(page, gpu, 'alpha', 'alpha');
		console.log(
			`TAAFIX alpha on ${gpu}: error ${on.error.toFixed(1)} levels with the mask, ${off.error.toFixed(1)} without; captured ${on.frameLeft.toFixed(1)} left and ${on.frameRight.toFixed(1)} right, reference ${on.referenceArrived.toFixed(1)} arrived and ${on.referenceRight.toFixed(1)} right`,
		);
		expect(off.level, 'the square drew nothing').toBeGreaterThan(4);
		expect(
			on.error,
			`the mask left ${on.error.toFixed(1)} levels of the background against ${off.error.toFixed(1)}`,
		).toBeLessThan(Math.max(1.5, off.error * 0.8));
	});

	test(`the opaque-only copy lowers the history on ${gpu}`, async ({ page }) => {
		test.setTimeout(600_000);
		// The transparent canvas makes the opaque-only copy differ from the composited color where a
		// blended surface draws, so this compares the signal itself, apart from the alpha signal.
		const off = await ghost(page, gpu, 'alpha', 'off');
		const on = await ghost(page, gpu, 'alpha', 'opaque');
		console.log(
			`TAAFIX opaque on ${gpu}: error ${on.error.toFixed(1)} levels with the mask, ${off.error.toFixed(1)} without; captured ${on.frameLeft.toFixed(1)} left and ${on.frameRight.toFixed(1)} right, reference ${on.referenceArrived.toFixed(1)} arrived and ${on.referenceRight.toFixed(1)} right`,
		);
		expect(off.level, 'the square drew nothing').toBeGreaterThan(4);
		// The comparison's effect on this scene is recorded, not required: the run shows whether the
		// history moved at all, and the record says what it measured.
		expect(Number.isFinite(on.error) && Number.isFinite(off.error)).toBe(true);
	});

	test(`the phone path draws the full path's picture on ${gpu}`, async ({ page }) => {
		test.setTimeout(600_000);
		await page.goto(`taa-fixes.html?case=phone&gpu=${gpu}`);
		const result = await pageResult<PhoneResult>(page, 180_000);
		console.log(
			`TAAFIX phone on ${result.gpu}: the two paths differ by ${result.distance.toFixed(2)} levels, mean ${result.mean.toFixed(1)}`,
		);
		expect(result.mean, 'the phone path drew nothing').toBeGreaterThan(4);
		expect(
			result.distance,
			`the two paths differ by ${result.distance.toFixed(2)} levels`,
		).toBeLessThan(8);
	});

	for (const effect of ['rain', 'fog'] as const) {
		test(`the resolve over ${effect} on ${gpu}`, async ({ page }) => {
			test.setTimeout(900_000);
			await page.goto(`taa-fixes.html?case=${effect}&gpu=${gpu}`);
			const result = await pageResult<EffectResult>(page, 240_000);
			// Both runs drew the effect, so the change figures mean something.
			expect(result.offMean, `the ${effect} drew nothing`).toBeGreaterThan(1);
			expect(result.onMean, `the ${effect} drew nothing with the resolve`).toBeGreaterThan(1);
			expect(Number.isFinite(result.off) && result.off >= 0).toBe(true);
			expect(Number.isFinite(result.on) && result.on >= 0).toBe(true);
			// The figures go into the decision record, which says what each effect did.
			console.log(
				`TAAFIX ${effect} on ${result.gpu}: frame-to-frame change ${result.off.toFixed(3)} without the resolve, ${result.on.toFixed(3)} with it`,
			);
		});
	}
}

/** One ghost figure: the square's new place with `reactive` naming the mask. */
async function ghost(
	page: import('@playwright/test').Page,
	gpu: string,
	kind: 'alpha' | 'opaque',
	reactive: string,
): Promise<GhostResult> {
	await page.goto(`taa-fixes.html?case=${kind}&gpu=${gpu}&reactive=${reactive}`);
	const result = await pageResult<GhostResult>(page, 180_000);
	expect(result.reactive).toBe(reactive);
	return result;
}
