// The temporal resolve's study fixes (task M3-A11, D-206): a history that follows a change of the
// exposure, the transparency mask over a transparent canvas and over an opaque surface, and the
// phone path against the full one. It also records what the resolve does to the two jittered
// effects that need it, thin rain and the volumetric fog. tests/pages/taa-fixes.ts draws each case
// and reports the figures in 8-bit levels; each run sees the same seeded scene.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/**
 * Each case's figures are measured over captures that hold back-to-back frames. A software GPU
 * draws slower than the page asks for, so a capture there can skip a frame: the figures then span
 * more frames than the run asked for, and the same case is compared with itself either way, so the
 * check that the captures were consecutive holds only where the GPU keeps up.
 */
const consecutiveHolds = (projectName: string) => projectName !== 'chromium-swiftshader';

interface ExposureResult {
	case: string;
	gpu: string;
	resolved: number;
	reference: number;
	error: number;
	offResolved: number;
	offReference: number;
	offError: number;
	overlap: number;
	consecutive: boolean;
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
	signal: number;
	skip: number;
	mean: number;
	overlap: number;
	consecutive: boolean;
}

interface EffectResult {
	case: string;
	gpu: string;
	off: number;
	on: number;
	onNoMask: number;
	jitter: number;
	offMean: number;
	onMean: number;
	onNoMaskMean: number;
	steps: number;
	consecutive: boolean;
}

const GPUS = ['webgpu', 'webgl2'] as const;

for (const gpu of GPUS) {
	test(`a history follows a change of the exposure on ${gpu}`, async ({ page }, testInfo) => {
		test.setTimeout(600_000);
		await page.goto(`taa-fixes.html?case=exposure&gpu=${gpu}&fps=4&step=8`);
		const result = await pageResult<ExposureResult>(page, 180_000);
		expect(result.case).toBe('exposure');
		if (consecutiveHolds(testInfo.project.name))
			expect(result.consecutive, 'a capture skipped a frame').toBe(true);
		expect(result.overlap, `only ${result.overlap} frames lined up`).toBeGreaterThanOrEqual(8);
		// The resolved frame holds the scene at the new exposure, within the noise's own blend.
		console.log(
			`TAAFIX exposure on ${result.gpu}: resolved mean ${result.resolved.toFixed(1)} against ${result.reference.toFixed(1)}, error ${result.error.toFixed(1)} levels; with the ratio off, ${result.offResolved.toFixed(1)} against ${result.offReference.toFixed(1)}, error ${result.offError.toFixed(1)}`,
		);
		// The exposure doubles at a frame of the sequence in every run, so the frames line up. The
		// frame's distance from the reference moves with the noise's own smoothing, so the ratio's
		// own effect is the difference of the two means: without the ratio the history holds the
		// exposure of the frame before, and the resolved frame falls below the corrected one.
		expect(
			Math.abs(result.error),
			`resolved ${result.resolved.toFixed(1)} against ${result.reference.toFixed(1)}, error ${result.error.toFixed(1)}`,
		).toBeLessThan(45);
		expect(result.resolved).toBeGreaterThan(result.reference * 0.6);
		const lift = result.resolved - result.offResolved;
		expect(
			lift,
			`the ratio lifted the frame by ${lift.toFixed(1)} levels: ${result.resolved.toFixed(1)} against ${result.reference.toFixed(1)} with it, and ${result.offResolved.toFixed(1)} against ${result.offReference.toFixed(1)} without`,
		).toBeGreaterThan(5);
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
		// The square is blended over an opaque wall, so the scene's alpha stays at one and only the
		// opaque-only copy can find the surface that moved.
		const off = await ghost(page, gpu, 'opaque', 'off');
		const on = await ghost(page, gpu, 'opaque', 'opaque');
		console.log(
			`TAAFIX opaque on ${gpu}: error ${on.error.toFixed(1)} levels with the mask, ${off.error.toFixed(1)} without; captured ${on.frameLeft.toFixed(1)} left and ${on.frameRight.toFixed(1)} right, reference ${on.referenceArrived.toFixed(1)} arrived and ${on.referenceRight.toFixed(1)} right`,
		);
		expect(off.level, 'the square drew nothing').toBeGreaterThan(4);
		// The copy holds the wall where the square arrived, and this frame's color holds the square,
		// so the comparison drops that history. Without the signal the wall stays in the square's
		// history, which the figure shows.
		expect(
			on.error,
			`the mask left ${on.error.toFixed(1)} levels of the wall against ${off.error.toFixed(1)}`,
		).toBeLessThan(Math.max(1.5, off.error * 0.8));
	});

	test(`the phone path draws the full path's picture on ${gpu}`, async ({ page }, testInfo) => {
		test.setTimeout(600_000);
		await page.goto(`taa-fixes.html?case=phone&gpu=${gpu}&fps=4`);
		const result = await pageResult<PhoneResult>(page, 180_000);
		console.log(
			`TAAFIX phone on ${result.gpu}: the two paths differ by ${result.distance.toFixed(2)} levels; the mask changes the full path by ${result.signal.toFixed(2)} levels and the phone path by ${result.skip.toFixed(2)}, mean ${result.mean.toFixed(1)}`,
		);
		if (consecutiveHolds(testInfo.project.name))
			expect(result.consecutive, 'a capture skipped a frame').toBe(true);
		expect(result.overlap, `only ${result.overlap} frames lined up`).toBeGreaterThanOrEqual(12);
		expect(result.mean, 'the phone path drew nothing').toBeGreaterThan(4);
		expect(
			result.distance,
			`the two paths differ by ${result.distance.toFixed(2)} levels`,
		).toBeLessThan(8);
		// The scene changes when the full path reads the alpha signal, so the skip below measures
		// something. The phone path reads no transparency signal, so the same setting draws the
		// same picture.
		expect(
			result.signal,
			`the alpha signal changed the full path by ${result.signal.toFixed(2)} levels`,
		).toBeGreaterThan(1);
		expect(
			result.skip,
			`the mask changed the phone path by ${result.skip.toFixed(2)} levels`,
		).toBeLessThan(0.5);
	});

	for (const effect of ['rain', 'fog'] as const) {
		test(`the resolve over ${effect} on ${gpu}`, async ({ page }, testInfo) => {
			test.setTimeout(900_000);
			await page.goto(`taa-fixes.html?case=${effect}&gpu=${gpu}&fps=4`);
			const result = await pageResult<EffectResult>(page, 240_000);
			// The figures go into the decision record, which says what each effect did.
			console.log(
				`TAAFIX ${effect} on ${result.gpu}: frame-to-frame change ${result.off.toFixed(3)} without the resolve, ${result.on.toFixed(3)} with it, and ${result.onNoMask.toFixed(3)} with its transparency signals off; the offset request alone moves it by ${result.jitter.toFixed(3)}`,
			);
			// Both runs drew the effect, so the change figures mean something.
			if (consecutiveHolds(testInfo.project.name))
				expect(result.consecutive, 'a capture skipped a frame').toBe(true);
			expect(result.offMean, `the ${effect} drew nothing`).toBeGreaterThan(1);
			expect(result.onMean, `the ${effect} drew nothing with the resolve`).toBeGreaterThan(1);
			expect(
				result.onNoMaskMean,
				`the ${effect} drew nothing with the resolve's signals off`,
			).toBeGreaterThan(1);
			expect(Number.isFinite(result.off) && result.off >= 0).toBe(true);
			expect(Number.isFinite(result.on) && result.on >= 0).toBe(true);
			expect(result.steps, `only ${result.steps} steps lined up`).toBeGreaterThanOrEqual(12);
			// The offset request draws nothing while the resolve is off, so the scene's change figure
			// stays the same.
			expect(
				result.jitter,
				`the offset request alone changed the figure by ${result.jitter.toFixed(3)}`,
			).toBeLessThan(Math.max(0.1, result.off * 0.05));
			// Neither effect is a surface that the motion target carries: the rain is a blended draw
			// with no motion, and the fog draws after the resolve. The resolve does not clean either
			// up, so its change stays near the unresolved figure. A later technique that fixes one
			// fails this and the record is revisited.
			expect(
				result.on,
				`the resolve lowered the ${effect}'s change from ${result.off.toFixed(3)} to ${result.on.toFixed(3)}`,
			).toBeGreaterThan(result.off * 0.9);
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
