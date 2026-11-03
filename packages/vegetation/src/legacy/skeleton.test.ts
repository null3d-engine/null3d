import { describe, expect, test } from 'bun:test';
import { ALL_SPECIES, builtInSpecies } from './builtin';
import { growSkeleton } from './skeleton';
import { type BranchLevel, branchLevel, MAX_BRANCHES, type Species } from './species';

const oak = builtInSpecies('oak') as Species;

/** Oak's record with its branch levels replaced, for a test that reads one rule alone. */
function withLevels(levels: Species['branchLevels']): Species {
	return { ...oak, branchLevels: levels };
}

/** The height of a branch's first sample, which is where it leaves its parent. */
function firstRise(points: Float32Array): number {
	return (points[4] as number) - (points[1] as number);
}

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

	test('runs the trunk to the height unless the record names a leader', () => {
		const trunkTop = (species: Species) => {
			const trunk = growSkeleton(species, 5, 0).branches[0];
			return trunk?.points[trunk.points.length - 2] as number;
		};
		const full = trunkTop(oak);
		const divided = trunkTop({ ...oak, leader: 0.3 } as Species);
		expect(divided).toBeGreaterThan(0);
		expect(divided).toBeLessThan(full * 0.5);
	});

	test('turns the upper limbs toward the trunk as the crown rises', () => {
		const small = {
			...oak,
			height: 10,
			crown: { ...oak.crown, start: 0.1 },
			branchLevels: [
				branchLevel(oak.branchLevels[0] as BranchLevel, {
					children: 6,
					angle: 0,
					angleVariance: 0,
					curve: 0,
					curveVariance: 0,
					length: 10,
					start: 0,
					end: 1,
				}),
				branchLevel(oak.branchLevels[1] as BranchLevel, {
					children: 0,
					angle: 80,
					angleVariance: 0,
					curve: 0,
					curveVariance: 0,
					length: 2,
					start: 0.1,
					end: 1,
					upright: 80,
				}),
			],
		} as Species;
		const boughs = growSkeleton(small, 3, 0).branches.filter((branch) => branch.level === 1);
		const rise = (branch: (typeof boughs)[number]) =>
			firstRise(branch.points) / (Math.max(1e-6, branch.length) / (branch.points.length / 3 - 1));
		const sorted = [...boughs].sort((a, b) => (a.points[1] as number) - (b.points[1] as number));
		const lowest = sorted[0] as (typeof boughs)[number];
		const highest = sorted[sorted.length - 1] as (typeof boughs)[number];
		expect(rise(lowest)).toBeLessThan(0.35);
		expect(rise(highest)).toBeGreaterThan(0.65);
	});

	test('drops more children toward the crown top when a level thins', () => {
		const record = (thin: number) =>
			withLevels(
				oak.branchLevels.map((level, index) =>
					index === 1 ? { ...level, thin } : level,
				) as Species['branchLevels'],
			);
		const kept = (thin: number) =>
			growSkeleton(record(thin), 4, 0).branches.filter((branch) => branch.level === 1).length;
		expect(kept(0.9)).toBeLessThan(kept(0));
	});

	test('spreads the stems of a multi-stem plant', () => {
		const clump = { ...oak, trunks: 4, height: 8, leader: 0.5 } as Species;
		const reach = (stemLean: number) => {
			const skeleton = growSkeleton({ ...clump, stemLean } as Species, 6, 0);
			const trunks = skeleton.branches.filter((branch) => branch.parent === -1);
			return Math.max(
				...trunks.map((trunk) =>
					Math.hypot(
						trunk.points[trunk.points.length - 3] as number,
						trunk.points[trunk.points.length - 1] as number,
					),
				),
			);
		};
		expect(reach(0.7)).toBeGreaterThan(reach(0.18));
	});
});
