import { describe, expect, test } from 'bun:test';
import type { Texture, Textures } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { builtInSpecies } from './builtin';
import { generatePlant } from './generate';
import { plantWind, treeValues } from './plant';
import type { Species } from './species';

const oak = builtInSpecies('oak') as Species;

/** A texture maker that records what a plant's wind data asked for. */
function fakeTextures() {
	const calls: {
		width: number;
		height: number;
		depth?: number;
		format?: string;
		data: ArrayLike<number>;
	}[] = [];
	const textures = {
		fromData: (options: {
			width: number;
			height: number;
			depth?: number;
			format?: string;
			data: ArrayLike<number>;
		}) => {
			calls.push(options);
			return {} as Texture;
		},
	} as unknown as Textures;
	return { textures, calls };
}

const field = { texture: {} as Texture, origin: [0, 0], size: 96 } as WindField;

describe('the plant wind data', () => {
	test('puts the branch records in one row of four texels each', () => {
		const asset = generatePlant(oak, { seed: 4 });
		const { textures, calls } = fakeTextures();
		const wind = plantWind({ textures }, asset, field, { swayDistance: 120 });
		expect(wind.branches).toBe(asset.wind.branches);
		expect(wind.height).toBe(asset.species.height);
		expect(wind.transmission).toBe(asset.species.color.transmission);
		expect(wind.swayDistance).toBe(120);
		expect(wind.field).toBe(field);
		expect(calls).toHaveLength(1);
		const [record] = calls;
		expect(record?.format).toBe('rgba16float');
		expect(record?.height).toBe(1);
		expect(record?.width).toBe(asset.wind.branches * 4);
		expect(record?.data).toBe(asset.wind.pivots);
	});

	test('sways at every distance without a sway distance', () => {
		const asset = generatePlant(oak, { seed: 4 });
		const { textures } = fakeTextures();
		expect(plantWind({ textures }, asset, field).swayDistance).toBe(0);
	});
});

describe('a copy’s row values', () => {
	test('give the same tint for the same place and seed', () => {
		expect(treeValues(12.4, -8.6, 7)).toEqual(treeValues(12.9, -8.1, 7));
	});

	test('differ between places, and between seeds', () => {
		expect(treeValues(12, -8, 7)).not.toEqual(treeValues(40, 3, 7));
		expect(treeValues(12, -8, 7)).not.toEqual(treeValues(12, -8, 8));
	});

	test('keep the tint close to white and the autumn where the scene places it', () => {
		for (let x = -50; x <= 50; x += 7) {
			for (let z = -50; z <= 50; z += 11) {
				const [r, g, b, autumn] = treeValues(x, z, 3, 0.4);
				for (const channel of [r, g, b]) {
					expect(channel).toBeGreaterThan(0.7);
					expect(channel).toBeLessThan(1.2);
				}
				expect(autumn).toBe(0.4);
			}
		}
		expect(treeValues(0, 0, 1, 2)[3]).toBe(1);
		expect(treeValues(0, 0, 1, -1)[3]).toBe(0);
	});
});
