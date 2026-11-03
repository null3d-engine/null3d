// Cuttings: a branch or sub-branch cut from the grown skeleton stands upright on its cut at the
// origin, holds only the chosen axis's subtree, dresses into wood and merged shoots, and grows the
// same bytes on this thread and in a worker that runs the job-worker task. A leaf and a leaf cluster
// come from the kit alone.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest } from './asset';
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
