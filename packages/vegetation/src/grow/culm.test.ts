// The culm grower on the bamboo: a clump of jointed culms rooted at the ground, a branch complement
// only above the first branching height, every branch joined to the culm node it leaves, a leafy
// bud at each branch joint and at the culm's tip, the same bytes twice, and a height inside the
// record's own spread with the branches that rise past the culm tips.
import { describe, expect, it } from 'bun:test';
import { AXIS_CULM, AXIS_LIMB, type MacroSkeleton, skeletonBuffers } from '../core/graph';
import { hashAt, hashBytes } from '../core/hash';
import { spreadMax, spreadMean } from '../core/types';
import { record as bambooRecord } from '../species/bamboo/record';
import { growCulm } from './culm';

function grow(variant = 0, seed = 11): MacroSkeleton {
	return growCulm({ record: bambooRecord, seed, variant, season: 'summer' });
}

/** A hash of every array a skeleton holds. */
function digest(skeleton: MacroSkeleton): number {
	let hash = hashAt(skeleton.nodeCount, skeleton.axes.count, skeleton.buds.count);
	for (const buffer of skeletonBuffers(skeleton)) hash = hashBytes(new Uint8Array(buffer), hash);
	return hash;
}

describe('the culm grower on the bamboo', () => {
	const skeleton = grow();

	it('grows a clump of rooted culms, and finer axes that hang on them', () => {
		let culms = 0;
		for (let a = 0; a < skeleton.axes.count; a++) {
			const parent = skeleton.axes.parent[a] as number;
			const kind = skeleton.axes.kind[a] as number;
			if (parent < 0) {
				expect(kind).toBe(AXIS_CULM);
				culms++;
			} else expect(kind).toBe(AXIS_LIMB);
			expect(parent).toBeLessThan(a);
		}
		const growth = bambooRecord.growth;
		if (growth.model !== 'culm') throw new Error('the bamboo grows by another model');
		expect(culms).toBeGreaterThanOrEqual(Math.round(spreadMean(growth.culms) - 3));
		expect(culms).toBeLessThanOrEqual(Math.round(spreadMean(growth.culms) + 3));
	});

	it('joins every branch to the culm node it leaves', () => {
		for (let a = 0; a < skeleton.axes.count; a++) {
			const parent = skeleton.axes.parent[a] as number;
			if (parent < 0) continue;
			const node = skeleton.axes.parentNode[a] as number;
			expect(node).toBeGreaterThanOrEqual(0);
			expect(skeleton.axisOf[node] as number).toBe(parent);
			const first = skeleton.axes.first[a] as number;
			for (let k = 0; k < 3; k++)
				expect(skeleton.position[first * 3 + k] as number).toBeCloseTo(
					skeleton.position[node * 3 + k] as number,
					5,
				);
		}
	});

	it('stands every bud on its own axis', () => {
		for (let b = 0; b < skeleton.buds.count; b++) {
			const node = skeleton.buds.node[b] as number;
			expect(node).toBeLessThan(skeleton.nodeCount);
			expect(skeleton.axisOf[node] as number).toBe(skeleton.buds.axis[b] as number);
			for (let k = 0; k < 3; k++)
				expect(skeleton.buds.position[b * 3 + k] as number).toBeCloseTo(
					skeleton.position[node * 3 + k] as number,
					5,
				);
		}
	});

	it('branches only above the record’s first branching height', () => {
		const growth = bambooRecord.growth;
		if (growth.model !== 'culm') throw new Error('the bamboo grows by another model');
		for (let a = 0; a < skeleton.axes.count; a++) {
			const node = skeleton.axes.parentNode[a] as number;
			if (node < 0) continue;
			const host = skeleton.axisOf[node] as number;
			const culmTop = skeleton.position[(skeleton.axes.last[host] as number) * 3 + 1] as number;
			const share = (skeleton.position[node * 3 + 1] as number) / culmTop;
			expect(share).toBeGreaterThanOrEqual(growth.branches.from - 0.02);
		}
	});

	it('grows a plant of its record’s height, with no part out of place', () => {
		const growth = bambooRecord.growth;
		if (growth.model !== 'culm') throw new Error('the bamboo grows by another model');
		const tallest = spreadMax(growth.height);
		// Branches near the top rise a little past the culm tips, which the reference's plume does too.
		expect(skeleton.height).toBeGreaterThan(spreadMean(growth.height) * 0.6);
		expect(skeleton.height).toBeLessThan(tallest * 1.15);
		for (let i = 0; i < skeleton.nodeCount; i++) {
			expect(Number.isFinite(skeleton.position[i * 3] as number)).toBe(true);
			expect(Number.isFinite(skeleton.position[i * 3 + 1] as number)).toBe(true);
			expect(Number.isFinite(skeleton.position[i * 3 + 2] as number)).toBe(true);
			expect(skeleton.radius[i] as number).toBeGreaterThan(0);
		}
	});

	it('draws the same bytes twice', () => {
		expect(digest(grow())).toBe(digest(grow()));
		expect(digest(grow(1))).not.toBe(digest(grow(2)));
	});
});
