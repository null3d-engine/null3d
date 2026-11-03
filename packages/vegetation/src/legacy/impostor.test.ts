import { describe, expect, test } from 'bun:test';
import type { Textures } from '@null3d/engine';
import { bakePlantAtlases } from './atlas';
import { builtInSpecies } from './builtin';
import { generatePlant } from './generate';
import { bakeFarTree, handOverToCards } from './impostor';

/** A stand-in for the sketch's texture factory: it records what each upload holds. */
function fakeTextures() {
	const made: { colorSpace: string; width: number; height: number; bytes: number }[] = [];
	const textures = {
		fromData(options: { colorSpace: string; width: number; height: number; data: Uint8Array }) {
			made.push({
				colorSpace: options.colorSpace,
				width: options.width,
				height: options.height,
				bytes: options.data.length,
			});
			return {} as never;
		},
	} as unknown as Textures;
	return { textures, made };
}

describe('bakeFarTree', () => {
	test('bakes the plant’s level 0 into two atlases that hold its colour', () => {
		const { textures, made } = fakeTextures();
		const atlases = bakePlantAtlases({ textures });
		const asset = generatePlant(builtInSpecies('oak')!, { seed: 7, levels: 1 });
		const far = bakeFarTree({ textures }, { asset, atlases, views: 4, texels: 16 });
		expect(far.atlas).toEqual({ columns: 2, rows: 2 });
		// The bark and leaf atlases come first, then the card's two atlases: each pair is sRGB
		// colour and a linear surface.
		expect(made.map((one) => one.colorSpace)).toEqual([
			'srgb',
			'linear',
			'srgb',
			'linear',
			'srgb',
			'linear',
		]);
		expect(made.at(-2)?.bytes).toBe(32 * 32 * 4);
		// The plant's widest reach and its height decide the card's size.
		const bounds = asset.impostorSource.bounds;
		expect(far.size[1]).toBeCloseTo(bounds.max[1] - bounds.min[1]);
		expect(far.size[0]).toBeGreaterThan(0);
		expect(far.base).toBeCloseTo(bounds.min[1]);
	});

	test('reuses the baked pixels for the same plant and grid', () => {
		const { textures } = fakeTextures();
		const atlases = bakePlantAtlases({ textures });
		const asset = generatePlant(builtInSpecies('oak')!, { seed: 7, levels: 1 });
		const first = bakeFarTree({ textures }, { asset, atlases, views: 4, texels: 16 });
		const second = bakeFarTree({ textures }, { asset, atlases, views: 4, texels: 16 });
		expect(second.color).not.toBe(first.color);
	});
});

describe('handOverToCards', () => {
	/** The engine's fade band as a share of an edge's distance (see `FADE_BAND` in levels.rs). */
	const BAND = 0.08;

	test.each([
		['small', 4, 6],
		['large', 18, 28],
		['larger than the switch allows', 60, 200],
	])("stands a %s tree's card at full coverage before its mesh thins", (_, width, height) => {
		const ranges: [number, number][] = [];
		const batch = {
			scales: new Float32Array([width, height, 1]),
			setDrawRange(start: number, end: number) {
				ranges.push([start, end]);
			},
		} as never;
		handOverToCards(batch, batch, 100);
		expect(ranges[0]).toEqual([0, 100]);
		const cardStart = ranges[1]?.[0] ?? 0;
		expect(ranges[1]?.[1]).toBeGreaterThanOrEqual(1e9 - 1);
		// The engine fades a range's near edge in from the start to the start plus one band, and
		// its far edge out from the end less one band to the end, each measured to a bound's nearest
		// point. A card's bound reaches to its top corner, so its distance can fall short of its
		// mesh's by that reach. The two batches' dither phases differ, so the card must reach full
		// coverage before the mesh starts to thin.
		const reach = Math.hypot(width / 2, height);
		expect(cardStart).toBeGreaterThanOrEqual(0);
		if (cardStart > 0)
			expect(cardStart * (1 + BAND) + reach).toBeLessThanOrEqual(100 / (1 + BAND) + 1e-6);
	});

	test('refuses a switch distance that is not above 0', () => {
		const batch = { scales: new Float32Array(3), setDrawRange() {} } as never;
		expect(() => handOverToCards(batch, batch, 0)).toThrow(RangeError);
	});
});
