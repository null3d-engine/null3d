// The near band's hand-over on every GPU path: a walk through a stand of grown oaks, drawn black
// on a white sky by `plant-near-band-sketch.ts`. At each spot the stand draws three ways: with the
// plant core's split, where each near copy draws real shoots inside its split and its cards beyond;
// with the near shoots alone; and with the cards alone. Wherever the shoots and the cards both
// cover a pixel, the split must cover it too, so the shell where the two meet never shows sky.
//
// The near pool's own figures come back with each picture: the shoots' triangles stay within the
// preset's budget, the copies within the preset's cap, and the split draws real shoots at all.
import { writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { writePng } from '../../packages/cli/src/png.js';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/plant-near-band-sketch.ts';
const WIDTH = 480;
const HEIGHT = 270;
/** The walk's spots, as the sketch names them. */
const STEPS = [0, 1, 2] as const;

/** The copies that each preset's near pool draws real shoots for, as the owner's caps give them. */
const NEAR_COPIES: Record<string, number> = { low: 1, medium: 3, high: 6, ultra: 10 };

/**
 * The share of the picture's pixels that the shoots and the cards both cover and the split leaves
 * open, which a leaf's antialiased edge alone can make: a pixel that half a leaf covers draws grey,
 * and which side of the threshold it falls depends on the other draws in the pixel.
 */
const EDGE_SHARE = 0.002;

/** What the sketch posts about its near pool. */
interface Near {
	readonly draw: string;
	readonly preset: string;
	readonly split: number;
	readonly copies: number;
	readonly triangles: number;
	readonly budget: number;
}

/** Draws one picture of the stand and returns which pixels the plants cover, and the pool's figures. */
async function draw(
	page: Page,
	tier: Tier,
	step: number | 'shadow',
	what: 'split' | 'shoots' | 'cards',
): Promise<{ covered: Uint8Array; near: Near }> {
	const name = `plant-near-band-${step}-${what}`;
	const spot = step === 'shadow' ? 'view=shadow' : `step=${step}`;
	const [run] = imageRuns([
		{
			name,
			sketch: `${SKETCH}?${spot}&draw=${what}`,
			hold: 0,
			tiers: [tier],
			size: [WIDTH, HEIGHT],
			// The first page of a run compiles the plant shader's builds and grows two oaks.
			timeoutSeconds: 500,
		},
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const bytes = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
	writePng(test.info().outputPath(`${name}.png`), { width: WIDTH, height: HEIGHT, data: bytes });
	const covered = new Uint8Array(WIDTH * HEIGHT);
	for (let i = 0; i < covered.length; i++) {
		const luminance =
			0.2126 * (bytes[i * 4] as number) +
			0.7152 * (bytes[i * 4 + 1] as number) +
			0.0722 * (bytes[i * 4 + 2] as number);
		covered[i] = luminance < 128 ? 1 : 0;
	}
	const near = (result as { sketch?: { near?: Near } }).sketch?.near;
	if (!near) throw new Error(`${name} posted no figures of its near pool`);
	writeFileSync(test.info().outputPath(`${name}.json`), `${JSON.stringify(near, null, '\t')}\n`);
	return { covered, near };
}

for (const tier of TIERS)
	for (const step of STEPS)
		test(`the near band hands over with no hole at spot ${step} on ${tier}`, async ({ page }) => {
			test.setTimeout(1_500_000);
			const split = await draw(page, tier, step, 'split');
			const shoots = await draw(page, tier, step, 'shoots');
			const cards = await draw(page, tier, step, 'cards');
			let both = 0;
			let open = 0;
			for (let i = 0; i < WIDTH * HEIGHT; i++) {
				if (!(shoots.covered[i] && cards.covered[i])) continue;
				both++;
				if (!split.covered[i]) open++;
			}
			expect(both).toBeGreaterThan(WIDTH * HEIGHT * 0.05);
			expect(open / (WIDTH * HEIGHT)).toBeLessThanOrEqual(EDGE_SHARE);
			const near = split.near;
			expect(near.split).toBeGreaterThan(0);
			expect(near.copies).toBeGreaterThan(0);
			expect(near.copies).toBeLessThanOrEqual(NEAR_COPIES[near.preset] ?? 0);
			expect(near.triangles).toBeGreaterThan(0);
			expect(near.triangles).toBeLessThanOrEqual(near.budget);
			expect(shoots.near.triangles).toBe(near.triangles);
		});

/** The share of pixels in which two pictures of the ground differ: lit in one, shadowed in the other. */
function differing(a: Uint8Array, b: Uint8Array): number {
	let count = 0;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
	return count / a.length;
}

for (const tier of TIERS)
	test(`a near copy's cards cast no shadow inside its split on ${tier}`, async ({ page }) => {
		test.setTimeout(1_500_000);
		// The ground under one oak whose whole crown stands inside the split, from above beside the
		// trunk. Inside the split the shoots cast the shadow and the cards cast none, so the split
		// casts what the shoots alone cast, and the cards alone cast another shadow.
		const split = await draw(page, tier, 'shadow', 'split');
		const shoots = await draw(page, tier, 'shadow', 'shoots');
		const cards = await draw(page, tier, 'shadow', 'cards');
		expect(split.near.copies).toBe(1);
		expect(differing(split.covered, shoots.covered)).toBeLessThanOrEqual(EDGE_SHARE);
		expect(differing(cards.covered, shoots.covered)).toBeGreaterThan(0.02);
	});
