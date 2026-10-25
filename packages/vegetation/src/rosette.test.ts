import { describe, expect, test } from 'bun:test';
import { builtInSpecies } from './builtin';
import type { CrownField } from './crown';
import { generatePlant } from './generate';
import { rosetteLeaves, rosetteLevel } from './rosette';
import type { Species } from './species';

const field = (species: Species): CrownField => ({
	radius: species.rosette?.length ?? 1,
	start: 0,
	height: species.height,
	shape: species.crown.shape,
});

describe('the rosette generator', () => {
	test('places one leaf for each blade, all rising from the base', () => {
		for (const id of ['fern', 'hosta', 'sedge', 'rush', 'meadow-grass']) {
			const species = builtInSpecies(id) as Species;
			const leaves = rosetteLeaves(species, 3, 0, field(species));
			expect(leaves.length).toBe(species.rosette?.blades as number);
			for (const leaf of leaves) {
				expect(Math.hypot(leaf.tip[0], leaf.tip[2])).toBeLessThan(
					(species.rosette?.length as number) * 1.2,
				);
				expect(leaf.length).toBeGreaterThan(0);
				expect(leaf.width).toBeGreaterThan(0);
			}
		}
	});

	test('thins the leaves by half at each level and grows the rest', () => {
		const fern = builtInSpecies('fern') as Species;
		const leaves = rosetteLeaves(fern, 3, 0, field(fern));
		const first = rosetteLevel(leaves, 1);
		const second = rosetteLevel(leaves, 2);
		expect(first.leaves.length).toBe(Math.ceil(leaves.length / 2));
		expect(second.leaves.length).toBe(Math.ceil(leaves.length / 4));
		expect(first.grow).toBeCloseTo(Math.SQRT2, 6);
		expect(second.grow).toBe(2);
		expect(first.error).toBeGreaterThan(0);
	});

	test('gives the hosta flowers and the grass none', () => {
		const hosta = generatePlant(builtInSpecies('hosta') as Species, { seed: 1 });
		const meadow = generatePlant(builtInSpecies('meadow-grass') as Species, { seed: 1 });
		expect(hosta.levels[0]?.parts.map((part) => part.name)).toContain('flower');
		expect(meadow.levels[0]?.parts.map((part) => part.name)).not.toContain('flower');
		expect(meadow.levels[0]?.parts.map((part) => part.name)).toContain('blade');
	});

	test('draws a fern frond with more triangles than a plain blade of the same blades', () => {
		const fern = generatePlant(builtInSpecies('fern') as Species, { seed: 1 });
		const meadow = generatePlant(builtInSpecies('meadow-grass') as Species, { seed: 1 });
		expect(fern.levels[0]?.parts[0]?.name).toBe('frond');
		expect(fern.levels[0]?.triangles).toBeGreaterThan(meadow.levels[0]?.triangles as number);
	});

	test('keeps every rosette level inside the crown', () => {
		for (const id of ['fern', 'hosta', 'sedge', 'rush', 'meadow-grass']) {
			const species = builtInSpecies(id) as Species;
			const asset = generatePlant(species, { seed: 2 });
			const { min, max } = asset.crown;
			for (const level of asset.levels)
				for (const part of level.parts) {
					const positions = part.arrays.positions;
					for (let i = 0; i < positions.length; i += 3) {
						expect(positions[i] as number).toBeGreaterThanOrEqual(min[0] - 1e-3);
						expect(positions[i] as number).toBeLessThanOrEqual(max[0] + 1e-3);
						expect(positions[i + 1] as number).toBeGreaterThanOrEqual(min[1] - 1e-3);
						expect(positions[i + 1] as number).toBeLessThanOrEqual(max[1] + 1e-3);
					}
				}
		}
	});
});
