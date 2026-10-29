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
	test('sets a shared band so the meshes and the cards fade through each other', () => {
		const ranges: [number, number][] = [];
		const batch = {
			setDrawRange(start: number, end: number) {
				ranges.push([start, end]);
			},
		} as never;
		handOverToCards(batch, batch, 100);
		expect(ranges[0]).toEqual([0, 100]);
		// The cards start a fade band before the switch, which is the engine's 8% share.
		expect(ranges[1]?.[0]).toBeCloseTo(92);
		expect(ranges[1]?.[1]).toBeGreaterThanOrEqual(1e9 - 1);
	});

	test('refuses a switch distance that is not above 0', () => {
		const batch = { setDrawRange() {} } as never;
		expect(() => handOverToCards(batch, batch, 0)).toThrow(RangeError);
	});
});
