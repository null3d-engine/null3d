// The full-screen feature adapter draws its pass on both GPU paths, and it draws nothing while the
// feature is not ready. The sketch declares a depth of field with a feature description and places
// it with post.addFeatureEffect. Each test compares the held frames of one browser, so it needs no
// reference picture: a path whose pass is missing or wrong fails here even on a device whose
// pictures were never saved. A picture that the two paths share is not required, because each GPU
// path draws its own edges and each tier keeps its own references.
import { expect, type Page, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';

/** The sketch that declares the feature and draws the depth of field through its adapter. */
const SKETCH = '/tests/pages/sketches/feature-effect-sketch.ts';

/** The GPU paths that the description and its adapter must place the pass on. */
const TIERS = ['webgpu', 'webgl2'] as const;

/**
 * The image page of one run, held at 0 seconds. `switches` are the sketch's own query, so the page
 * hands them to the sketch module rather than reading them itself. Medium is a preset that every
 * path runs, so a run never compares two different presets by accident.
 */
function addressOf(gpu: string, preset: string, switches = ''): string {
	const sketch = encodeURIComponent(`${SKETCH}${switches}`).replaceAll('%2F', '/');
	return `image.html?gpu=${gpu}&hold=0&preset=${preset}&size=320x180&sketch=${sketch}`;
}

/**
 * The share that the pass must change: in focus the picture keeps its pixels, so the blur moves a
 * part of the frame and never less than this. The run prints the share, which a reader compares
 * with the other path's and with the record.
 */
const MIN_EFFECT_DIFF = 0.02;

/** Held frames at Low must match, because the preset's dofSamples is 0 and the pass does not draw. */
const MAX_NOT_READY_DIFF = 0.0005;

/** A held frame, as the image page publishes it. */
interface HeldFrame {
	ok: boolean;
	error?: string;
	tier: string;
	width: number;
	height: number;
	/** The frame's pixels, base64 of RGBA rows. */
	pixels: string;
}

/** Draws the page at `address` and gives its held frame. */
async function held(pageUnderTest: Page, address: string): Promise<HeldFrame> {
	await pageUnderTest.goto(address);
	await pageUnderTest.waitForFunction('globalThis.__null3dHold !== undefined', undefined, {
		timeout: 120_000,
	});
	return pageUnderTest.evaluate(() => {
		const globe = globalThis as Record<string, unknown>;
		const hold = globe.__null3dHold as {
			ok: boolean;
			error?: string;
			tier: string;
			width: number;
			height: number;
			pixels: Uint8Array;
		};
		let binary = '';
		for (let at = 0; at < hold.pixels.length; at += 0x8000)
			binary += String.fromCharCode(...hold.pixels.subarray(at, at + 0x8000));
		return {
			ok: hold.ok,
			error: hold.error,
			tier: hold.tier,
			width: hold.width,
			height: hold.height,
			pixels: btoa(binary),
		};
	});
}

/** The share of pixels that differ between two held frames, past a tenth of a step of 255. */
function share(a: HeldFrame, b: HeldFrame): number {
	return differentShare(
		Uint8Array.from(Buffer.from(a.pixels, 'base64')),
		Uint8Array.from(Buffer.from(b.pixels, 'base64')),
		0.1,
	);
}

/** The share as a percentage of the frame's pixels, for the line that a run prints. */
const percent = (value: number) => `${(value * 100).toFixed(4)}%`;

test('the pass changes the frame on both GPU paths', async ({ page: browserPage }) => {
	// Each held frame may take its own wait of 120 seconds on a software GPU, so the test needs
	// longer than the default minute.
	test.setTimeout(600_000);
	for (const tier of TIERS) {
		const drawn = await held(browserPage, addressOf(tier, 'medium'));
		const plain = await held(browserPage, addressOf(tier, 'medium', '?dof=off'));
		expect(drawn.ok, drawn.error).toBe(true);
		expect(plain.ok, plain.error).toBe(true);
		expect(drawn.tier).toBe(tier);
		expect([drawn.width, drawn.height]).toEqual([plain.width, plain.height]);
		const changed = share(drawn, plain);
		console.log(`feature-effect: on ${tier} the pass changes ${percent(changed)} of the pixels`);
		expect(changed).toBeGreaterThan(MIN_EFFECT_DIFF);
	}
});

test('a not-ready feature changes nothing, so it costs nothing', async ({ page: browserPage }) => {
	test.setTimeout(600_000);
	// Low's dofSamples is 0, so the description's ready callback keeps the effect out of the chain.
	for (const tier of TIERS) {
		const drawn = await held(browserPage, addressOf(tier, 'low'));
		const plain = await held(browserPage, addressOf(tier, 'low', '?dof=off'));
		expect(drawn.ok, drawn.error).toBe(true);
		expect(plain.ok, plain.error).toBe(true);
		const idle = share(drawn, plain);
		console.log(`feature-effect: on ${tier} at Low the feature changes ${percent(idle)}`);
		expect(idle).toBeLessThan(MAX_NOT_READY_DIFF);
	}
});
