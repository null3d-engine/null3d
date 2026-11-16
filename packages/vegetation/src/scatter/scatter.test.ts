import { describe, expect, test } from 'bun:test';
import type { EcoRule } from '../ecology/ecology';
import { groundMaps } from '../ground/ground';
import {
	EcoScatter,
	SCATTER_STRIDE,
	type ScatterPoints,
	scatterChecksum,
	scatterVegetation,
} from './scatter';

/**
 * The rules that the tests place by: thirteen species of a temperate valley, from the waterline to
 * the canopy and the young trees under it, with a dead-wood prop. They cover every layer, the
 * clusters and the overlaps, and their numbers set the tests' points.
 */
const RULES: readonly EcoRule[] = [
	{
		species: 'rush',
		variants: 6,
		scale: [0.8, 1.3],
		radius: 0.8800000000000001,
		layer: 'ground',
		spacing: 1.2,
		tolerances: [
			{ input: 'heightAboveWater', min: -0.75, best: -0.4, worst: 0.05, max: 0.55 },
			{ input: 'distanceToWater', min: 0, best: 0, worst: 2.5, max: 4.5 },
			{ input: 'wetness', min: 0.15, best: 0.4, worst: 1, max: 1.01 },
		],
		clump: [0.2, 1],
	},
	{
		species: 'sedge',
		variants: 6,
		scale: [0.8, 1.4],
		radius: 0.6400000000000001,
		layer: 'ground',
		spacing: 1.4,
		tolerances: [
			{ input: 'heightAboveWater', min: -0.5, best: -0.1, worst: 0.5, max: 1.1 },
			{ input: 'distanceToWater', min: 0, best: 0.5, worst: 3.5, max: 6 },
			{ input: 'wetness', min: 0.1, best: 0.3, worst: 1, max: 1.01 },
		],
		clump: [0.2, 1],
	},
	{
		species: 'willow',
		variants: 6,
		scale: [0.8, 1.4],
		radius: 4.42,
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.05, best: 0.3, worst: 1.5, max: 3 },
			{ input: 'distanceToWater', min: 0.5, best: 1.5, worst: 6, max: 10 },
			{ input: 'wetness', min: 0.05, best: 0.2, worst: 1, max: 1.01 },
			{ input: 'slope', min: 0, best: 0, worst: 0.5, max: 0.85 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'alder',
		variants: 6,
		scale: [0.8, 1.3],
		radius: 4.1000000000000005,
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.15, best: 0.5, worst: 2.2, max: 5 },
			{ input: 'distanceToWater', min: 1.5, best: 4, worst: 10, max: 18 },
			{ input: 'wetness', min: 0.04, best: 0.15, worst: 1, max: 1.01 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'oak',
		variants: 6,
		scale: [0.8, 1.35],
		radius: 5.7,
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.6, best: 1.8, worst: 11, max: 20 },
			{ input: 'slope', min: 0, best: 0.15, worst: 0.55, max: 0.95 },
			{ input: 'northness', min: -1, best: -1, worst: 0.15, max: 1.01 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'beech',
		variants: 6,
		scale: [0.8, 1.3],
		radius: 6.000000000000001,
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.6, best: 1.8, worst: 10, max: 18 },
			{ input: 'northness', min: -0.3, best: 0.25, worst: 1, max: 1.01 },
			{ input: 'wetness', min: 0.02, best: 0.1, worst: 1, max: 1.01 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'birch',
		variants: 6,
		scale: [0.75, 1.25],
		radius: 5.500000000000001,
		layer: 'canopy',
		spacing: 8,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.4, best: 1.2, worst: 8, max: 14 },
			{ input: 'distanceToWater', min: 4, best: 9, worst: 40, max: 70 },
			{ input: 'openness', min: 0.05, best: 0.35, worst: 1, max: 1.01 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'conifer',
		variants: 6,
		scale: [0.7, 1.25],
		radius: 7.1,
		layer: 'canopy',
		spacing: 7,
		tolerances: [
			{ input: 'heightAboveWater', min: 3, best: 7, worst: 22, max: 40 },
			{ input: 'slope', min: 0.18, best: 0.3, worst: 1.4, max: 2.2 },
			{ input: 'northness', min: -0.6, best: 0, worst: 1, max: 1.01 },
		],
		clump: [0.2, 1],
	},
	{
		species: 'broadleaf',
		variants: 6,
		scale: [0.8, 1.3],
		radius: 4.6,
		layer: 'canopy',
		spacing: 9,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.6, best: 1.8, worst: 13, max: 26 },
			{ input: 'distanceToWater', min: 2, best: 6, worst: 70, max: 140 },
		],
		clump: [0.25, 1],
	},
	{
		species: 'oak',
		variants: 6,
		scale: [0.8, 1.35],
		radius: 1.2,
		layer: 'young',
		spacing: 4,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.4, best: 1.8, worst: 11, max: 20 },
			{ input: 'slope', min: 0, best: 0.2, worst: 0.7, max: 1.2 },
		],
		cluster: { species: ['oak', 'beech', 'broadleaf'], radius: 7, min: 1, max: 3 },
		overlaps: ['young'],
	},
	{
		species: 'birch',
		variants: 6,
		scale: [0.75, 1.25],
		radius: 1.1,
		layer: 'young',
		spacing: 4,
		tolerances: [
			{ input: 'heightAboveWater', min: 0.3, best: 1.2, worst: 8, max: 14 },
			{ input: 'openness', min: 0.02, best: 0.25, worst: 1, max: 1.01 },
		],
		cluster: { species: ['birch', 'willow', 'alder'], radius: 6, min: 1, max: 3 },
		overlaps: ['young'],
	},
	{
		species: 'alder',
		variants: 6,
		scale: [0.8, 1.3],
		radius: 1,
		layer: 'young',
		spacing: 4,
		tolerances: [{ input: 'heightAboveWater', min: 0.15, best: 0.5, worst: 2.2, max: 5 }],
		cluster: { species: ['alder', 'willow'], radius: 6, min: 1, max: 2 },
		overlaps: ['young'],
	},
	{
		species: 'fern',
		variants: 6,
		scale: [0.7, 1.4],
		radius: 0.7200000000000001,
		layer: 'understory',
		spacing: 1.8,
		tolerances: [
			{ input: 'canopy', min: 0.08, best: 0.3, worst: 1, max: 1.01 },
			{ input: 'wetness', min: 0.05, best: 0.2, worst: 1, max: 1.01 },
			{ input: 'heightAboveWater', min: 0.15, best: 0.5, worst: 6, max: 12 },
		],
		clump: [0.25, 1],
		overlaps: ['understory'],
	},
	{
		species: 'hosta',
		variants: 6,
		scale: [0.75, 1.35],
		radius: 0.44000000000000006,
		layer: 'ground',
		spacing: 2.4,
		tolerances: [
			{ input: 'canopy', min: 0.06, best: 0.25, worst: 1, max: 1.01 },
			{ input: 'wetness', min: 0.05, best: 0.2, worst: 1, max: 1.01 },
			{ input: 'distanceToWater', min: 0.4, best: 1.5, worst: 14, max: 26 },
		],
		clump: [0.3, 1],
		overlaps: ['ground'],
	},
	{
		species: 'meadow-grass',
		variants: 6,
		scale: [0.8, 1.5],
		radius: 0.4,
		layer: 'ground',
		spacing: 1,
		tolerances: [
			{ input: 'openness', min: 0.3, best: 0.6, worst: 1, max: 1.01 },
			{ input: 'slope', min: 0, best: 0, worst: 0.6, max: 1.1 },
			{ input: 'heightAboveWater', min: 0, best: 0.3, worst: 11, max: 20 },
		],
		clump: [0.25, 1],
		overlaps: ['ground'],
	},
	{
		species: 'shrub',
		variants: 6,
		scale: [0.7, 1.4],
		radius: 1.16,
		layer: 'shrub',
		spacing: 2.6,
		tolerances: [
			{ input: 'edge', min: 0.1, best: 0.4, worst: 1, max: 1.01 },
			{ input: 'heightAboveWater', min: 0.2, best: 0.5, worst: 8, max: 15 },
			{ input: 'slope', min: 0, best: 0, worst: 0.6, max: 1.1 },
		],
		clump: [0.2, 1],
		overlaps: ['shrub'],
	},
	{
		species: 'deadwood',
		layer: 'deadwood',
		spacing: 11,
		radius: 2.5,
		overlaps: ['deadwood'],
		tolerances: [
			{ input: 'canopy', min: 0.2, best: 0.5, worst: 1, max: 1.01 },
			{ input: 'slope', min: 0, best: 0, worst: 0.4, max: 0.8 },
		],
		clump: [0.3, 1],
	},
];

/** A valley for the tests: a channel along z = 0, rising to both sides and at the ends. */
function valley() {
	return groundMaps({
		size: 96,
		resolution: 97,
		water: 0,
		height: (x, z) => 0.003 * x * x + Math.abs(z) * 0.3,
	});
}

/** One field of one point. */
function field(points: ScatterPoints, index: number, name: 'x' | 'y' | 'z' | 'rule'): number {
	const column = { x: 0, y: 1, z: 2, rule: 3 }[name];
	return points.data[index * SCATTER_STRIDE + column] as number;
}

/** Whether two point sets hold the same bytes. */
function samePoints(a: ScatterPoints, b: ScatterPoints): boolean {
	if (a.count !== b.count) return false;
	if (a.data.length !== b.data.length) return false;
	for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
	return true;
}

/** The indices of the points that one layer placed. */
function layerPoints(points: ScatterPoints, layer: string): number[] {
	const found: number[] = [];
	for (let index = 0; index < points.count; index++) {
		const rule = points.rules[field(points, index, 'rule')] as (typeof points.rules)[number];
		if (rule.layer === layer) found.push(index);
	}
	return found;
}

describe('the scatter', () => {
	test('places the same plants from the same seed', () => {
		const ground = valley();
		const first = scatterVegetation({ seed: 7, ground, rules: RULES });
		const second = scatterVegetation({ seed: 7, ground, rules: RULES });
		expect(first.count).toBeGreaterThan(100);
		expect(samePoints(first, second)).toBe(true);
	});

	test('places the same plants whatever order the tiles arrive in', () => {
		const ground = valley();
		const reference = scatterVegetation({ seed: 7, ground, rules: RULES });
		const scatter = new EcoScatter({ seed: 7, ground, rules: RULES });
		const tiles = scatter.tilesPerSide;
		for (let row = tiles - 1; row >= 0; row--)
			for (let column = tiles - 1; column >= 0; column--) scatter.addTile(column, row);
		expect(samePoints(scatter.build(), reference)).toBe(true);
	});

	test('places the same plants whatever the tile size', () => {
		const ground = valley();
		const reference = scatterVegetation({ seed: 7, ground, rules: RULES, tileSize: 32 });
		const small = scatterVegetation({ seed: 7, ground, rules: RULES, tileSize: 7 });
		const large = scatterVegetation({ seed: 7, ground, rules: RULES, tileSize: 45 });
		expect(samePoints(small, reference)).toBe(true);
		expect(samePoints(large, reference)).toBe(true);
	});

	test('places the plants of only the tiles that arrived', () => {
		const ground = valley();
		const whole = scatterVegetation({ seed: 7, ground, rules: RULES });
		const scatter = new EcoScatter({ seed: 7, ground, rules: RULES });
		scatter.addTile(0, 0);
		const one = scatter.build();
		expect(one.count).toBeGreaterThan(0);
		expect(one.count).toBeLessThan(whole.count);
	});

	test('places other plants from another seed', () => {
		const ground = valley();
		const first = scatterVegetation({ seed: 7, ground, rules: RULES });
		const second = scatterVegetation({ seed: 8, ground, rules: RULES });
		expect(samePoints(first, second)).toBe(false);
	});

	test('gives the same checksum from the same seed', () => {
		const ground = valley();
		const first = scatterChecksum(scatterVegetation({ seed: 7, ground, rules: RULES }));
		const second = scatterChecksum(scatterVegetation({ seed: 7, ground, rules: RULES }));
		expect(first).toBe(second);
	});

	test('gives another checksum when one point moves by a tenth of a millimetre', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 7, ground, rules: RULES });
		const moved: ScatterPoints = { ...points, data: points.data.slice() };
		moved.data[1] = (moved.data[1] as number) + 1e-4;
		expect(scatterChecksum(moved)).not.toBe(scatterChecksum(points));
	});

	test('stands every plant on the ground', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 3, ground, rules: RULES });
		for (let index = 0; index < points.count; index++)
			expect(field(points, index, 'y')).toBeCloseTo(
				ground.heightAt(field(points, index, 'x'), field(points, index, 'z')),
				3,
			);
	});

	test('keeps two plants out of each other’s room', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 5, ground, rules: RULES });
		const canopy = layerPoints(points, 'canopy');
		expect(canopy.length).toBeGreaterThan(10);
		for (let a = 0; a < canopy.length; a++)
			for (let b = a + 1; b < canopy.length; b++) {
				const first = canopy[a] as number;
				const second = canopy[b] as number;
				const ruleA = points.rules[field(points, first, 'rule')] as (typeof points.rules)[number];
				const ruleB = points.rules[field(points, second, 'rule')] as (typeof points.rules)[number];
				const dx = field(points, first, 'x') - field(points, second, 'x');
				const dz = field(points, first, 'z') - field(points, second, 'z');
				const room = ruleA.radius + ruleB.radius;
				expect(dx * dx + dz * dz).toBeGreaterThanOrEqual(room * room);
			}
	});

	test('gathers the young plants around their adults', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 5, ground, rules: RULES });
		const canopy = layerPoints(points, 'canopy');
		const young = layerPoints(points, 'young');
		expect(young.length).toBeGreaterThan(0);
		for (const index of young) {
			const rule = points.rules[field(points, index, 'rule')] as (typeof points.rules)[number];
			const radius = rule.cluster?.radius ?? 0;
			let nearest = Number.POSITIVE_INFINITY;
			for (const adult of canopy) {
				const dx = field(points, index, 'x') - field(points, adult, 'x');
				const dz = field(points, index, 'z') - field(points, adult, 'z');
				nearest = Math.min(nearest, Math.sqrt(dx * dx + dz * dz));
			}
			expect(nearest).toBeLessThanOrEqual(radius + 1e-6);
		}
	});

	test('keeps the plants off a path', () => {
		const height = (x: number, z: number) => 0.003 * x * x + Math.abs(z) * 0.3;
		const paths = [{ kind: 'line' as const, ax: 0, az: -48, bx: 0, bz: 48, width: 12 }];
		const open = scatterVegetation({
			seed: 5,
			ground: groundMaps({ size: 96, resolution: 97, height }),
			rules: RULES,
		});
		const blocked = scatterVegetation({
			seed: 5,
			ground: groundMaps({ size: 96, resolution: 97, height, paths }),
			rules: RULES,
		});
		expect(blocked.count).toBeLessThan(open.count);
		for (let index = 0; index < blocked.count; index++)
			expect(Math.abs(field(blocked, index, 'x'))).toBeGreaterThan(5);
	});

	test('thins a species that grows in clumps, so gaps appear', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 11, ground, rules: RULES });
		// The clump field is tens of metres wide, so a whole strip of the ground stays bare.
		const strips = new Array(8).fill(0) as number[];
		for (let index = 0; index < points.count; index++) {
			const x = field(points, index, 'x');
			const strip = Math.min(7, Math.max(0, Math.floor(((x + 48) / 96) * 8)));
			strips[strip] = (strips[strip] as number) + 1;
		}
		const most = Math.max(...strips);
		const least = Math.min(...strips);
		expect(least).toBeLessThan(most * 0.6);
	});

	test('varies the type, the colour and the lichen at a metre or two', () => {
		const ground = valley();
		const points = scatterVegetation({ seed: 5, ground, rules: RULES });
		const variants = new Set<number>();
		const tints = new Set<number>();
		const lichens = new Set<number>();
		for (let index = 0; index < points.count; index++) {
			const rule = points.rules[field(points, index, 'rule')] as (typeof points.rules)[number];
			if ((rule.variants ?? 1) > 1) variants.add(points.data[index * SCATTER_STRIDE + 4] as number);
			tints.add(points.data[index * SCATTER_STRIDE + 7] as number);
			lichens.add(points.data[index * SCATTER_STRIDE + 8] as number);
		}
		expect(variants.size).toBeGreaterThan(1);
		expect(tints.size).toBeGreaterThan(1);
		expect(lichens.size).toBeGreaterThan(1);
	});
});
