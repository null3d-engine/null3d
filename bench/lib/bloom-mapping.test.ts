import { describe, expect, test } from 'bun:test';
import {
	compareGlows,
	mapBloomNode,
	mapPmndrsBloom,
	mappedBaseRows,
	mapUnrealBloomPass,
	mipGlow,
	mipLevels,
	mixesToShares,
	pmndrsGlow,
	sharesToMixes,
	unrealGlow,
	unrealLevelWeights,
} from './bloom-mapping';

const SOFT = { strength: 0.5, radius: 0.2, threshold: 1 };
const STRONG = { strength: 1, radius: 0.8, threshold: 0.8 };

const sum = (row: Float64Array) => row.reduce((a, b) => a + b, 0);

describe('the mip chain', () => {
	test('keeps the light of each level whole within 3%, so its shares split the glow', () => {
		for (const row of mipLevels(720, 512, 8)) expect(Math.abs(sum(row) - 1)).toBeLessThan(0.03);
	});

	test('turns shares into mixes and back', () => {
		const shares = [0.4, 0.2, 0.1, 0.1, 0.1, 0.05, 0.03, 0.02];
		const back = mixesToShares(sharesToMixes(shares), shares.length);
		for (const [i, share] of back.entries()) expect(share).toBeCloseTo(shares[i] as number, 9);
	});
});

describe('UnrealBloomPass', () => {
	test('moves weight between its levels by the radius, keeping the sum', () => {
		for (const radius of [0, 0.5, 1])
			expect(unrealLevelWeights(radius).reduce((a, b) => a + b)).toBeCloseTo(3, 9);
	});

	for (const height of [360, 720, 1080, 1668, 2160])
		for (const [name, settings] of [
			['soft', SOFT],
			['strong', STRONG],
		] as const)
			test(`maps its ${name} glow onto the chain at a canvas of ${height} rows`, () => {
				const mapped = mapUnrealBloomPass(settings, { canvasHeight: height });
				const glow = compareGlows(mipGlow(mapped, height), unrealGlow(settings, height));
				// The shares of light within any distance of a bright line differ by under 3%, and
				// the distances that hold half and 90% of the light by under 5%.
				expect(glow.gap).toBeLessThan(0.03);
				for (const [a, b] of [glow.half, glow.most])
					expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(1, 0.05 * b));
				expect(mapped.intensity).toBeCloseTo(sum(unrealGlow(settings, height)), 6);
				expect(mapped.composite).toBe('add');
				expect(mapped.threshold).toBe(settings.threshold);
				expect(mapped.mixes).toHaveLength(7);
			});

	test('gives the bloom() node a third of the intensity, as the node drops the factor of 3', () => {
		const pass = mapUnrealBloomPass(STRONG);
		const node = mapBloomNode(STRONG);
		expect(node.intensity * 3).toBeCloseTo(pass.intensity, 9);
		expect(node.mixes).toEqual(pass.mixes);
	});

	test('scales the threshold with the exposure once bloom sees exposed light', () => {
		expect(mapUnrealBloomPass(STRONG, { exposure: 2 }).threshold).toBe(1.6);
	});
});

describe('pmndrs BloomEffect', () => {
	for (const height of [360, 720, 1080, 1668, 2160])
		test(`maps its defaults onto the chain at a canvas of ${height} rows`, () => {
			const mapped = mapPmndrsBloom({}, { canvasHeight: height });
			const glow = compareGlows(mipGlow(mapped, height), pmndrsGlow(height, 8, 0.85));
			expect(glow.gap).toBeLessThan(0.04);
			expect(mapped.composite).toBe('screen');
			expect(mapped.threshold).toBe(1);
			expect(mapped.knee).toBe(0.03);
			expect(mapped.intensity).toBeCloseTo(1, 1);
		});
});

test('a mapping takes half the canvas height as the base, from 128 to 512 rows', () => {
	expect([200, 360, 720, 1080, 2160].map(mappedBaseRows)).toEqual([128, 180, 360, 512, 512]);
});
