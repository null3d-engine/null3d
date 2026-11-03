// Cuttings: a branch or sub-branch cut from the grown skeleton stands upright on its cut at the
// origin, holds only the chosen axis's subtree, dresses into wood and merged shoots, and grows the
// same bytes on this thread and in a worker that runs the job-worker task. A leaf and a leaf cluster
// come from the kit alone.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest } from './asset';
import { AXIS_LIMB, AXIS_STEM, SkeletonBuilder } from './core/graph';
import { standInSpecies } from './core/stand-in';
import { CUTTING_LENGTH, clusterRank, cutBranch, cutFoliage } from './cutting';
import { buildKitNow, growPlantNow, loadPlantCode } from './generate';
import type { PlantTaskInput } from './generate-task';

const stub = standInSpecies('stub', { height: 12, aspect: 0.8 });
await loadPlantCode(stub.record);
const kit = buildKitNow(stub, { placeholders: true });
const whole = growPlantNow(kit, { seed: 11, variant: 0, near: true });

/** The mean of a skeleton's node positions. */
function meanNode(positions: Float32Array): [number, number, number] {
	const count = positions.length / 3;
	const mean = [0, 0, 0];
	for (let i = 0; i < count * 3; i++)
		mean[i % 3] = (mean[i % 3] as number) + (positions[i] as number) / count;
	return [mean[0] as number, mean[1] as number, mean[2] as number];
}

describe('cuttings', () => {
	for (const part of ['branch', 'subbranch'] as const) {
		it(`cuts a ${part} that stands upright on its cut`, () => {
			const cut = cutBranch(whole.skeleton, stub.record, { part });
			if (!cut) throw new Error('the stub grew no axis to cut');
			const piece = cut.skeleton;
			expect(Array.from(piece.position.subarray(0, 3))).toEqual([0, 0, 0]);
			expect(piece.parent[0]).toBe(-1);
			const [x, y, z] = meanNode(piece.position);
			expect(Math.hypot(x, z)).toBeLessThan(1e-4 * Math.max(1, y));
			expect(y).toBeGreaterThan(0);
			expect(piece.axes.parent[0]).toBe(-1);
			expect(piece.axes.order[0]).toBe(cut.order);
			expect(piece.axes.count).toBeLessThan(whole.skeleton.axes.count);
			expect(piece.nodeCount).toBe(
				1 + countSubtreeNodes(whole.skeleton.axes, whole.skeleton.axes.count, cut.axis),
			);
			for (let b = 0; b < piece.buds.count; b++) {
				const f = piece.buds.frame.subarray(b * 4, b * 4 + 4);
				expect(
					Math.hypot(f[0] as number, f[1] as number, f[2] as number, f[3] as number),
				).toBeCloseTo(1, 5);
			}
		});
	}

	it('cuts an axis that leaves at its parent node there, with every axis whose parents reach it', () => {
		// A stem of five nodes; a limb leaving its third node; a twig on the limb; a second limb above.
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const stemNodes: number[] = [];
		for (let k = 0; k < 5; k++)
			stemNodes.push(
				b.addNode({
					x: 0,
					y: k,
					z: 0,
					radius: 0.2,
					parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
					axis: stem,
				}),
			);
		const fork = stemNodes[2] as number;
		const limb = b.addAxis({
			parent: stem,
			parentNode: fork,
			parentT: 0,
			order: 1,
			kind: AXIS_LIMB,
		});
		const limbNodes: number[] = [];
		for (let k = 1; k <= 3; k++)
			limbNodes.push(
				b.addNode({
					x: 0.3 * k,
					y: 2 + 0.3 * k,
					z: 0,
					radius: 0.05,
					parent: k === 1 ? fork : (limbNodes[k - 2] as number),
					axis: limb,
				}),
			);
		const twig = b.addAxis({
			parent: limb,
			parentNode: limbNodes[1] as number,
			parentT: 0,
			order: 2,
			kind: AXIS_LIMB,
		});
		b.addNode({ x: 0.6, y: 2.9, z: 0.3, radius: 0.01, parent: limbNodes[1] as number, axis: twig });
		const other = b.addAxis({
			parent: stem,
			parentNode: stemNodes[3] as number,
			parentT: 0,
			order: 1,
			kind: AXIS_LIMB,
		});
		b.addNode({ x: -0.5, y: 3.4, z: 0, radius: 0.04, parent: stemNodes[3] as number, axis: other });
		const skeleton = b.finish();
		const cut = cutBranch(skeleton, stub.record, {
			part: 'branch',
			length: 1.3,
			orient: 'as-grown',
		});
		if (!cut) throw new Error('nothing was cut');
		expect(cut.axis).toBe(limb);
		expect(cut.skeleton.nodeCount).toBe(1 + 3 + 1);
		expect(cut.skeleton.axes.count).toBe(2);
		// The cut sits at the stem node the limb leaves from, so the limb's first node keeps its offset.
		expect(Array.from(cut.skeleton.position.subarray(3, 6))).toEqual([
			expect.closeTo(0.3, 5),
			expect.closeTo(0.3, 5),
			expect.closeTo(0, 5),
		]);
		expect(cut.extent).toBeCloseTo(Math.hypot(0.9, 0.9), 5);
	});

	it('ranks the branch nearest the asked length first, and takes others by pick', () => {
		const best = cutBranch(whole.skeleton, stub.record, { part: 'branch' });
		const second = cutBranch(whole.skeleton, stub.record, { part: 'branch', pick: 1 });
		const short = cutBranch(whole.skeleton, stub.record, { part: 'branch', length: 0.3 });
		if (!best || !second || !short) throw new Error('the stub grew no axis to cut');
		expect(second.axis).not.toBe(best.axis);
		const miss = (extent: number, length: number) => Math.abs(Math.log(extent / length));
		expect(miss(short.extent, 0.3)).toBeLessThanOrEqual(miss(best.extent, 0.3) + 0.15);
		expect(miss(best.extent, CUTTING_LENGTH.branch)).toBeLessThanOrEqual(
			miss(short.extent, CUTTING_LENGTH.branch) + 0.15,
		);
	});

	it('keeps the pose of a piece cut as grown', () => {
		const grown = cutBranch(whole.skeleton, stub.record, { part: 'branch', orient: 'as-grown' });
		const upright = cutBranch(whole.skeleton, stub.record, { part: 'branch' });
		if (!grown || !upright) throw new Error('the stub grew no axis to cut');
		expect(grown.axis).toBe(upright.axis);
		const [x, , z] = meanNode(grown.skeleton.position);
		expect(Math.hypot(x, z)).toBeGreaterThan(0.01);
	});

	it('dresses a cut branch into wood and merged shoots at the nearest level only', () => {
		const piece = growPlantNow(kit, { seed: 11, variant: 0, cutting: { part: 'branch' } });
		expect(piece.cutting?.part).toBe('branch');
		expect(piece.levels[0].parts.map((part) => part.name)).toEqual(['wood', 'foliage']);
		expect(piece.levels[1].parts).toHaveLength(0);
		expect(piece.levels[2].parts).toHaveLength(0);
		expect(piece.shoots.count).toBe(0);
		expect(piece.impostor.views).toBe(0);
		expect(piece.wind.count).toBe(piece.skeleton.axes.count);
		expect(piece.skeleton.bounds.min[1]).toBeGreaterThanOrEqual(-0.05);
		expect(piece.skeleton.height).toBeLessThan(whole.skeleton.height);
	});

	it('cuts a leaf with either face toward +Z, and a cluster in rank order', () => {
		const upper = cutFoliage(kit, { part: 'leaf' }, kit.detail);
		const lower = cutFoliage(kit, { part: 'leaf', face: 'lower' }, kit.detail);
		if (!upper || !lower) throw new Error('the stub has no leaf');
		expect(upper.normals[2]).toBeCloseTo(1, 5);
		expect(lower.normals[2]).toBeCloseTo(-1, 5);
		const ranked = clusterRank(kit);
		const cluster = cutFoliage(kit, { part: 'cluster', pick: 1 }, kit.detail);
		expect(cluster?.positions.length).toBe(ranked[1]?.tiers[2].positions.length);
		const leaf = growPlantNow(kit, { seed: 11, variant: 0, cutting: { part: 'leaf' } });
		expect(leaf.levels[0].parts.map((part) => part.name)).toEqual(['foliage']);
		expect(leaf.skeleton.height).toBeGreaterThan(0);
	});

	it('grows the same bytes twice, and in a worker that runs the job-worker task', async () => {
		const options = { seed: 11, variant: 0, cutting: { part: 'subbranch' as const } };
		const here = plantAssetDigest(growPlantNow(kit, options));
		expect(plantAssetDigest(growPlantNow(kit, options))).toBe(here);
		const dir = mkdtempSync(join(tmpdir(), 'plant-cutting-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { run } from ${JSON.stringify(join(import.meta.dirname, 'generate-task.ts'))};
self.onmessage = async (event) => {
	const answer = await run(event.data);
	postMessage(answer.output, answer.transfer);
};
`,
			);
			const worker = new Worker(script);
			const grown = await new Promise<PlantAsset>((resolve, reject) => {
				worker.onmessage = (event) => resolve(event.data as PlantAsset);
				worker.onerror = (event) => reject(new Error(String(event.message)));
				worker.postMessage({ stage: 'grow', kit, options } satisfies PlantTaskInput);
			});
			worker.terminate();
			expect(plantAssetDigest(grown)).toBe(here);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/** The nodes of an axis's subtree in a skeleton's axis table. */
function countSubtreeNodes(
	axes: PlantAsset['skeleton']['axes'],
	count: number,
	root: number,
): number {
	let nodes = 0;
	for (let a = 0; a < count; a++) {
		let at = a;
		while (at >= 0 && at !== root) at = axes.parent[at] as number;
		if (at === root) nodes += (axes.last[a] as number) - (axes.first[a] as number) + 1;
	}
	return nodes;
}
