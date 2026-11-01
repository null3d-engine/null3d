import { describe, expect, test } from 'bun:test';
import { ALL_SPECIES, BUILTIN_SPECIES, builtInSpecies, CREEK_SPECIES } from './builtin';
import {
	branchLevel,
	checkSpecies,
	DEFAULT_VARIANTS,
	type Species,
	speciesProblems,
} from './species';

describe('the species records', () => {
	test('every built-in species can grow', () => {
		for (const species of ALL_SPECIES) expect(speciesProblems(species)).toEqual([]);
	});

	test('ships the five families and Creek s eight', () => {
		expect(BUILTIN_SPECIES.map((species) => species.id)).toEqual([
			'broadleaf',
			'conifer',
			'shrub',
			'fern',
			'meadow-grass',
		]);
		expect(CREEK_SPECIES.map((species) => species.id)).toEqual([
			'oak',
			'beech',
			'birch',
			'willow',
			'alder',
			'hosta',
			'sedge',
			'rush',
		]);
	});

	test('gives every species an id of its own', () => {
		const ids = ALL_SPECIES.map((species) => species.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test('gives every species six to ten variants', () => {
		for (const species of ALL_SPECIES) {
			expect(species.variants).toBeGreaterThanOrEqual(6);
			expect(species.variants).toBeLessThanOrEqual(10);
			expect(species.variants).toBe(DEFAULT_VARIANTS);
		}
	});

	test('finds a species by its id', () => {
		expect(builtInSpecies('oak')?.kind).toBe('tree');
		expect(builtInSpecies('hosta')?.kind).toBe('rosette');
		expect(builtInSpecies('no-such-plant')).toBeUndefined();
	});

	test('names the field of a record that cannot grow', () => {
		const broken = {
			...builtInSpecies('oak'),
			height: -1,
			levels: 9,
		} as Species;
		const problems = speciesProblems(broken);
		expect(problems.some((problem) => problem.includes('height'))).toBe(true);
		expect(problems.some((problem) => problem.includes('levels'))).toBe(true);
		expect(() => checkSpecies(broken)).toThrow(/height/);
	});

	test('refuses a branch plant without leaf cards', () => {
		const broken = { ...builtInSpecies('oak'), leaf: undefined } as Species;
		expect(speciesProblems(broken).some((problem) => problem.includes('leaf'))).toBe(true);
	});

	test('refuses a rosette without a rosette record', () => {
		const broken = { ...builtInSpecies('fern'), rosette: undefined } as Species;
		expect(speciesProblems(broken).some((problem) => problem.includes('rosette'))).toBe(true);
	});

	test('takes zero trunks for a plant without a branch system', () => {
		expect(speciesProblems(builtInSpecies('hosta') as Species)).toEqual([]);
	});

	test('fills a branch level from the one above', () => {
		const base = {
			children: 4,
			prune: 0.1,
			length: 2,
			lengthVariance: 0.2,
			angle: 40,
			angleVariance: 10,
			curve: 8,
			curveVariance: 4,
			taper: 0.02,
			start: 0.2,
			end: 0.9,
			sides: 6,
			segments: 4,
			twist: 90,
		};
		const filled = branchLevel(base, { children: 7, length: 5 });
		expect(filled.children).toBe(7);
		expect(filled.length).toBe(5);
		expect(filled.angle).toBe(40);
		expect(filled.sides).toBe(6);
	});
});
