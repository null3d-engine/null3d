import { describe, expect, test } from 'bun:test';
import { ALL_SPECIES, builtInSpecies } from './builtin';
import { growSkeleton } from './skeleton';
import { MAX_BRANCHES, type Species } from './species';

const oak = builtInSpecies('oak') as Species;

describe('the skeleton', () => {
	test('grows a tree in which every branch names a parent above it', () => {
		const skeleton = growSkeleton(oak, 5, 0);
		expect(skeleton.branches.length).toBeGreaterThan(50);
		expect(skeleton.branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
		for (const [index, branch] of skeleton.branches.entries()) {
			expect(branch.parent).toBeLessThan(index);
			for (const child of branch.children) {
				expect(child).toBeGreaterThan(index);
				expect(skeleton.branches[child]?.parent).toBe(index);
			}
		}
	});

	test('stays within the branch cap that the wind bytes hold', () => {
		for (const species of ALL_SPECIES) {
			const skeleton = growSkeleton(species, 3, 0);
			expect(skeleton.branches.length).toBeLessThanOrEqual(MAX_BRANCHES);
		}
	});

	test('carries every child with the pipe model', () => {
		const skeleton = growSkeleton(oak, 5, 0);
		for (const branch of skeleton.branches)
			for (const [childIndex, child] of branch.children.entries()) {
				const childBranch = skeleton.branches[child] as (typeof skeleton.branches)[number];
				const at = branch.attach[childIndex] as number;
				expect(branch.radii[at] as number).toBeGreaterThanOrEqual(
					(childBranch.radii[0] as number) - 1e-6,
				);
			}
		for (const branch of skeleton.branches)
			for (const radius of branch.radii) expect(radius).toBeGreaterThan(0);
	});

	test('widens the trunk where it meets the ground', () => {
		const skeleton = growSkeleton(oak, 5, 0);
		const trunk = skeleton.branches[0];
		expect(trunk).toBeDefined();
		const radii = (trunk as NonNullable<typeof trunk>).radii;
		expect(radii[0] as number).toBeGreaterThan(radii[radii.length - 1] as number);
	});

	test('gives every branch a finite path that rises from its parent', () => {
		const skeleton = growSkeleton(oak, 2, 1);
		for (const branch of skeleton.branches) {
			expect(branch.points.length).toBe(
				(oak.branchLevels[branch.level]?.segments as number) * 3 + 3,
			);
			for (const value of branch.points) expect(Number.isFinite(value)).toBe(true);
			expect(branch.length).toBeGreaterThan(0);
			expect(branch.flutter).toBeGreaterThanOrEqual(0);
			expect(branch.flutter).toBeLessThanOrEqual(255);
		}
	});

	test('grows a shrub from more than one trunk', () => {
		const shrub = builtInSpecies('shrub') as Species;
		const skeleton = growSkeleton(shrub, 4, 0);
		const trunks = skeleton.branches.filter((branch) => branch.parent === -1);
		expect(trunks.length).toBe(shrub.trunks);
	});

	test('grows no branch system for a rosette', () => {
		const fern = builtInSpecies('fern') as Species;
		expect(growSkeleton(fern, 1, 0).branches).toEqual([]);
	});

	test('bends a weeping crown downward', () => {
		const willow = builtInSpecies('willow') as Species;
		const skeleton = growSkeleton(willow, 6, 0);
		let lowest = Number.POSITIVE_INFINITY;
		let highest = Number.NEGATIVE_INFINITY;
		for (const branch of skeleton.branches) {
			lowest = Math.min(lowest, branch.points[branch.points.length - 2] as number);
			highest = Math.max(highest, branch.points[branch.points.length - 2] as number);
		}
		expect(lowest).toBeLessThan(highest);
		expect(lowest).toBeLessThan(skeleton.height * 0.6);
	});
});
