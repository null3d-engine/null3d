import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOOM_IMAGE, BLOOM_MAPPED, BLOOM_SETTINGS } from '../../bench/scenes/bloom';
import {
	bloomTables,
	chainFor,
	compareGlows,
	mapBloomNode,
	mapPmndrsBloom,
	mapUnrealBloomPass,
	mipLevels,
	pmndrsGlow,
	SMOOTHING,
	unrealGlow,
	unrealLevelWeights,
	weighted,
} from '../../skills/null3d-port-threejs/scripts/map-bloom.mjs';

/** The bloom scene's settings in UnrealBloomPass's meanings, and three.js's bloom example. */
const SOFT = { strength: 0.5, radius: 0.2, threshold: 1 };
const STRONG = { strength: 1, radius: 0.8, threshold: 0.8 };
const EXAMPLE = { strength: 1.5, radius: 0.4, threshold: 0.85 };
/** Short sides of canvases, in device pixels, at which the glows must match. */
const CANVASES = [360, 540, 720, 1080, 1440, 1668, 2160];

const REFERENCE = join(
	import.meta.dir,
	'../../skills/null3d-port-threejs/references/post-processing.md',
);
const SMOOTHING_GAP = 0.005;

type Fit = ReturnType<typeof mapUnrealBloomPass>['fit'];

const START = '<!-- null3d:bloom-table:start -->';
const END = '<!-- null3d:bloom-table:end -->';

const PLAIN = { smooth: false, trim: false };

const sum = (values: ArrayLike<number>) => Array.from(values).reduce((a, b) => a + b, 0);

/** The sum of the squared second differences of the weights: 0 for weights on a straight line. */
const roughness = (weights: number[]) =>
	sum(weights.slice(2).map((w, k) => (w - 2 * (weights[k + 1] ?? 0) + (weights[k] ?? 0)) ** 2));

/**
 * The default fit stays within the smoothing's allowance of the plain fit, unless trimming dropped
 * levels. The plain fit matches the source within 3%.
 */
function expectFits(plain: { fit: Fit }, smooth: { fit: Fit }) {
	expect(plain.fit.gap).toBeLessThan(0.03);
	expect(plain.fit.smoothing).toBe(0);
	expect(plain.fit.trimmed).toBe(0);
	expectDistances(plain.fit);
	expectDistances(smooth.fit);
	if (smooth.fit.trimmed === 0)
		expect(smooth.fit.gap).toBeLessThanOrEqual(plain.fit.gap + SMOOTHING_GAP + 1e-9);
}

/** The weights sum to 1, and the reference levels that the canvas's chain lacks have none. */
function expectWeights(weights: number[], canvas: number) {
	const { offset } = chainFor(canvas);
	expect(weights).toHaveLength(10);
	expect(Math.abs(sum(weights) - 1)).toBeLessThan(1e-3);
	expect(weights.slice(0, offset)).toEqual(new Array(offset).fill(0));
	for (const w of weights) expect(w).toBeGreaterThanOrEqual(0);
}

/** The distances that hold half and 90% of the light differ by under 5%, or by 1 pixel. */
function expectDistances(fit: { half: number[]; most: number[] }) {
	for (const [chain = 0, source = 0] of [fit.half, fit.most])
		expect(Math.abs(chain - source)).toBeLessThanOrEqual(Math.max(1, 0.05 * source));
}

describe('the mip chain', () => {
	test('has a 512-texel base and 10 levels on a canvas whose short side is 1080 pixels', () => {
		expect(chainFor(1080)).toEqual({ base: 512, levels: 10, offset: 0 });
	});

	test('halves the base and drops a level at 720 and 540 pixels, and two at 360', () => {
		expect(chainFor(720)).toEqual({ base: 256, levels: 9, offset: 1 });
		expect(chainFor(540)).toEqual({ base: 256, levels: 9, offset: 1 });
		expect(chainFor(360)).toEqual({ base: 128, levels: 8, offset: 2 });
	});

	test('keeps at least one level on a tiny canvas', () => {
		expect(chainFor(2)).toEqual({ base: 1, levels: 1, offset: 9 });
	});

	// A line one pixel thick loses or gains some light in the first step down, by where it falls
	// between the step's texels. The loss is the same for every level, so the shares still hold.
	// The widest level spreads to the row's ends and loses a little more there.
	test('gives each level the same light within 4%, so its shares split the glow', () => {
		for (const canvas of [360, 720, 1080, 2160]) {
			const light = mipLevels(canvas).map(sum);
			expect(Math.max(...light) / Math.min(...light)).toBeLessThan(1.04);
			for (const l of light) expect(Math.abs(l - 1)).toBeLessThan(0.2);
		}
	});
});

describe('UnrealBloomPass', () => {
	test('moves weight between its levels by the radius, keeping the sum', () => {
		for (const radius of [0, 0.5, 1]) expect(sum(unrealLevelWeights(radius))).toBeCloseTo(3, 9);
	});

	for (const canvas of CANVASES)
		for (const [name, settings] of [
			['soft', SOFT],
			['strong', STRONG],
		] as const)
			test(`maps its ${name} glow onto the chain at a short side of ${canvas} pixels`, () => {
				const mapped = mapUnrealBloomPass(settings, { canvas });
				const plain = mapUnrealBloomPass(settings, { canvas, ...PLAIN });
				expectFits(plain, mapped);
				expect(mapped.fit.gap).toBeLessThan(0.03);
				expectWeights(mapped.weights, canvas);
				expectWeights(plain.weights, canvas);
				const light = sum(unrealGlow(settings.radius, canvas));
				expect(mapped.intensity).toBeCloseTo(3 * settings.strength * light, 3);
				expect(mapped.blend).toBe('add');
				expect(mapped.threshold).toBe(settings.threshold);
				expect(mapped.knee).toBe(0.01);
			});

	test("fits three.js's bloom example and each radius of the table within 3% at 1080 pixels", () => {
		const radii = [0, 0.25, 0.5, 0.75, 1];
		for (const settings of [EXAMPLE, ...radii.map((radius) => ({ ...EXAMPLE, radius }))]) {
			const mapped = mapUnrealBloomPass(settings);
			expect(mapped.fit.gap).toBeLessThan(0.03);
			expectWeights(mapped.weights, 1080);
		}
	});

	test('smooths the weights from level to level by default', () => {
		const plain = mapUnrealBloomPass(STRONG, PLAIN);
		const smooth = mapUnrealBloomPass(STRONG);
		expect(SMOOTHING).toContain(smooth.fit.smoothing);
		expect(smooth.fit.smoothing).toBeGreaterThan(0);
		expect(roughness(smooth.weights)).toBeLessThan(roughness(plain.weights) / 2);
	});

	test("keeps the bloom scene's mapped settings equal to the mapping at the image's short side", () => {
		const canvas = Math.min(BLOOM_IMAGE.width, BLOOM_IMAGE.height);
		for (const name of ['soft', 'strong'] as const) {
			const { fit: _, ...mapped } = mapUnrealBloomPass(BLOOM_SETTINGS[name], { canvas });
			const rounded = {
				...mapped,
				intensity: Number(mapped.intensity.toFixed(4)),
				weights: mapped.weights.map((w) => Number(w.toFixed(4))),
			};
			expect(rounded).toEqual({ ...BLOOM_MAPPED[name], weights: [...BLOOM_MAPPED[name].weights] });
		}
	});

	test('gives the bloom() node a third of the intensity, as the node drops the factor of 3', () => {
		const pass = mapUnrealBloomPass(STRONG);
		const node = mapBloomNode(STRONG);
		expect(node.intensity * 3).toBeCloseTo(pass.intensity, 3);
		expect(node.weights).toEqual(pass.weights);
		expect(node.blend).toBe('add');
	});
});

describe('pmndrs BloomEffect', () => {
	test("reports the fit of the chain's glow with the weights it returns", () => {
		const mapped = mapPmndrsBloom({}, { canvas: 720 });
		const { offset } = chainFor(720);
		const chain = weighted(mipLevels(720), mapped.weights.slice(offset));
		expect(mapped.fit).toMatchObject(compareGlows(chain, pmndrsGlow(720, 8, 0.85)));
	});

	test('drops the widest levels with under 1% of the glow, and counts the levels saved', () => {
		const settings = { radius: 0.5 };
		const kept = mapPmndrsBloom(settings, PLAIN);
		const trimmed = mapPmndrsBloom(settings, { smooth: false });
		expect(kept.fit.levels).toBe(8);
		expect(trimmed.fit.levels).toBe(6);
		expect(trimmed.fit.trimmed).toBe(2);
		expectWeights(trimmed.weights, 1080);
		expect(trimmed.weights[5]).toBeGreaterThanOrEqual(0.01);
		expect(trimmed.weights.slice(6)).toEqual([0, 0, 0, 0]);
	});

	for (const canvas of CANVASES)
		test(`maps its defaults onto the chain at a short side of ${canvas} pixels`, () => {
			const mapped = mapPmndrsBloom({}, { canvas });
			expectFits(mapPmndrsBloom({}, { canvas, ...PLAIN }), mapped);
			expectWeights(mapped.weights, canvas);
			expect(mapped.blend).toBe('screen');
			expect(mapped.threshold).toBe(1);
			expect(mapped.knee).toBe(0.03);
			expect(mapped.intensity).toBeCloseTo(1, 1);
		});
});

const reference = readFileSync(REFERENCE, 'utf8');
const marked = reference.includes(START) && reference.includes(END);

test.skipIf(!marked)(
	`the reference's bloom tables match the script's output${marked ? '' : ' (skipped: the reference has no table markers yet)'}`,
	() => {
		const between = reference.slice(
			reference.indexOf(START) + START.length,
			reference.indexOf(END),
		);
		expect(between.trim()).toBe(bloomTables().trim());
	},
);
