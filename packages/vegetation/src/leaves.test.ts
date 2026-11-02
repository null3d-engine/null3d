import { describe, expect, test } from 'bun:test';
import { builtInSpecies } from './builtin';
import { generatePlant } from './generate';
import { buildLeaves, leafCards } from './leaves';
import type { LeafCard } from './levels';
import { growSkeleton } from './skeleton';
import type { Species } from './species';

/** A cluster card with its own middle, and axes lined up with the world so its corners read plainly. */
function card(x: number, y: number, z: number): LeafCard {
	return {
		center: [x, y, z],
		normal: [0, 0, 1],
		right: [1, 0, 0],
		up: [0, 1, 0],
		width: 0.3,
		height: 0.2,
		branch: 0,
		flutter: 3,
		stiffness: 128,
		occlusion: 0.25,
		kind: 'cluster',
	};
}

describe('leaf target records', () => {
	test('grows a kept card and folds a dropped card toward the next level', () => {
		const kept = card(0, 0, 0);
		const dropped = card(2, 1, 0);
		const part = buildLeaves([kept, dropped], 1, {
			keep: new Set([kept]),
			grow: Math.SQRT2,
			error: 0.5,
		});
		const targets = part.targets as Float32Array;
		const vertices = part.positions.length / 3;
		expect(targets.length).toBe(vertices * 4);
		// The kept card's six corners each move out by the growth's ratio about its middle.
		for (let v = 0; v < 6; v++) {
			for (let axis = 0; axis < 3; axis++)
				expect(targets[v * 4 + axis]).toBeCloseTo(
					(kept.center[axis] as number) +
						((part.positions[v * 3 + axis] as number) - (kept.center[axis] as number)) * Math.SQRT2,
					5,
				);
			expect(targets[v * 4 + 3]).toBe(0.5);
		}
		// The dropped card's four corners fall to its middle, so it shrinks to nothing there.
		for (let v = 6; v < vertices; v++) {
			expect(targets[v * 4]).toBeCloseTo(dropped.center[0] as number, 6);
			expect(targets[v * 4 + 1]).toBeCloseTo(dropped.center[1] as number, 6);
			expect(targets[v * 4 + 2]).toBeCloseTo(dropped.center[2] as number, 6);
			expect(targets[v * 4 + 3]).toBe(0.5);
		}
	});

	test('names the coarsest level own place with no error, so it never moves', () => {
		const part = buildLeaves([card(1, 2, 3)], 2);
		const targets = part.targets as Float32Array;
		for (let v = 0; v < targets.length / 4; v++) expect(targets[v * 4 + 3]).toBe(0);
	});
});

describe('card coverage', () => {
	/** The vertices and triangles of one level's leaf part. */
	function leafSize(species: Species): { vertices: number; triangles: number } {
		const asset = generatePlant(species, { seed: 3 });
		const leaves = asset.levels[0]?.parts.find((part) => part.name === 'leaves');
		if (!leaves) throw new Error('the plant has no leaves');
		return {
			vertices: leaves.arrays.positions.length / 3,
			triangles: leaves.arrays.indices.length / 3,
		};
	}

	test('fills the inner branches when a record names a greater depth', () => {
		const base = builtInSpecies('conifer') as Species;
		const leaf = base.leaf as NonNullable<Species['leaf']>;
		const shallow = leafSize({ ...base, leaf: { ...leaf, depth: 2 } });
		const deep = leafSize({ ...base, leaf: { ...leaf, depth: 3 } });
		expect(deep.vertices).toBeGreaterThan(shallow.vertices);
		expect(deep.triangles).toBeGreaterThan(shallow.triangles);
	});

	test('draws a crossed card as two panels, so a spray keeps its coverage edge-on', () => {
		const base = builtInSpecies('conifer') as Species;
		const leaf = base.leaf as NonNullable<Species['leaf']>;
		const flat = leafSize({ ...base, leaf: { ...leaf, cross: false } });
		const crossed = leafSize({ ...base, leaf: { ...leaf, cross: true } });
		expect(crossed.vertices).toBe(flat.vertices * 2);
		expect(crossed.triangles).toBe(flat.triangles * 2);
	});

	test('fills a crown with cards inside its outline when a record names a fill', () => {
		const base = builtInSpecies('conifer') as Species;
		const leaf = base.leaf as NonNullable<Species['leaf']>;
		const open = leafSize({ ...base, leaf: { ...leaf, depth: 4, fill: 0 } });
		const filled = leafSize({ ...base, leaf: { ...leaf, depth: 4, fill: 0.5 } });
		expect(filled.vertices).toBeGreaterThan(open.vertices);
		expect(filled.triangles).toBeGreaterThan(open.triangles);
	});

	test('carries no card below a floor that stands above the ground', () => {
		const base = builtInSpecies('conifer') as Species;
		const skeleton = growSkeleton(base, 3, 0);
		const floor = base.height * base.crown.start;
		/** The lowest card middle that the plant grows for a given foliage floor. */
		const lowest = (leafFloor?: number): number => {
			const crown = {
				radius: base.height,
				start: floor,
				height: base.height,
				shape: base.crown.shape,
				...(leafFloor === undefined ? {} : { leafFloor }),
			};
			return Math.min(...leafCards(base, skeleton, 3, 0, crown).map((card) => card.center[1]));
		};
		expect(lowest()).toBeGreaterThanOrEqual(floor);
		// The conifer's foliage reaches the ground, so a floor of zero keeps the skirt well below its
		// crown. Half a metre below the floor is enough to tell the two apart without fixing where one
		// bough's tip happens to end.
		expect(lowest(0)).toBeLessThan(floor - 0.5);
	});

	test('keeps every filled card inside the crown and names a branch that exists', () => {
		const base = builtInSpecies('conifer') as Species;
		const leaf = base.leaf as NonNullable<Species['leaf']>;
		const species = {
			...base,
			leaf: { ...leaf, depth: 4, fill: 0.5, cross: true, hang: true },
		} as Species;
		const asset = generatePlant(species, { seed: 3 });
		const leaves = asset.levels[0]?.parts.find((part) => part.name === 'leaves');
		if (!leaves) throw new Error('the plant has no leaves');
		const { normals, colors } = leaves.arrays;
		const vertices = normals.length / 3;
		expect(colors.length).toBe(vertices * 4);
		for (let v = 0; v < vertices; v++) {
			expect(colors[v * 4] as number).toBeLessThan(asset.wind.branches);
			expect(
				Math.hypot(
					normals[v * 3] as number,
					normals[v * 3 + 1] as number,
					normals[v * 3 + 2] as number,
				),
			).toBeGreaterThan(0.9);
		}
	});
});
