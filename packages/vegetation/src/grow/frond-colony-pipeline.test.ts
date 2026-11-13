// Bracken through the plant core's stages: its own grower, frond leaves, wood and merged foliage,
// with stand-ins only for the stages not built yet (the material header, the wind records, the
// level distances and the far bake). The same seed gives the same bytes twice, on this thread and
// in a worker that runs the job-worker task, and the review's leaf and branch pieces cut.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PlantAsset, plantAssetDigest } from '../asset';
import { noTextureFiles } from '../core/textures';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import type { PlantTaskInput } from '../generate-task';
import { brackenRecord } from './bracken.fixture';

const source = { record: brackenRecord, textures: noTextureFiles(brackenRecord.id) };
await loadPlantCode(brackenRecord);
const kit = buildKitNow(source, { placeholders: 'missing' });
const options = { seed: 11, variant: 0, near: true };

describe('bracken through the plant core', () => {
	it('builds a kit of one whole frond for the leaf piece, and the leaves its sockets carry', () => {
		expect(kit.prototypes.length).toBeGreaterThan(0);
		for (const prototype of kit.prototypes) expect(prototype.piece?.name ?? '').toMatch(/^leaf-/);
		expect(kit.leaves).toHaveLength(1);
		expect((kit.leaves[0]?.indices.length ?? 0) / 3).toBeGreaterThan(100);
	});

	it('grows a colony whose levels hold its stipes as wood, its rhizome and its leaves as rows', () => {
		const asset = growPlantNow(kit, options);
		expect(asset.skeleton.buds.count).toBeGreaterThan(8);
		expect(asset.shoots.count).toBe(asset.skeleton.buds.count);
		asset.levels.forEach((level, at) => {
			const names = new Set(level.parts.map((part) => part.name));
			expect(names.has('wood')).toBe(true);
			expect(names.has('foliage')).toBe(true);
			// The card levels draw each leaf as its cards.
			expect(names.has('cards')).toBe(at > 0);
		});
		expect(asset.levels[2].triangles).toBeLessThanOrEqual(asset.levels[1].triangles);
	});

	it('grows the same bytes from the same seed and variant, and other bytes from another', () => {
		const first = plantAssetDigest(growPlantNow(kit, options));
		expect(plantAssetDigest(growPlantNow(kit, options))).toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, variant: 1 }))).not.toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, season: 'winter' }))).not.toBe(first);
	});

	it('cuts a whole frond as the leaf piece, and a frond from the colony as the branch', () => {
		const leaf = growPlantNow(kit, { ...options, cutting: { part: 'leaf' } });
		expect(leaf.levels[0].triangles).toBeGreaterThan(100);
		const branch = growPlantNow(kit, { ...options, cutting: { part: 'branch' } });
		expect(branch.levels[0].parts.some((part) => part.name === 'wood')).toBe(true);
	});

	it('grows the same bytes in a worker that runs the job-worker task', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bracken-task-'));
		try {
			const script = join(dir, 'worker.ts');
			writeFileSync(
				script,
				`import { run } from ${JSON.stringify(join(import.meta.dirname, '..', 'generate-task.ts'))};
self.onmessage = async (event) => {
	const answer = await run(event.data);
	postMessage(answer.output, answer.transfer);
};
`,
			);
			const worker = new Worker(script);
			const ask = <T>(input: PlantTaskInput) =>
				new Promise<T>((resolve, reject) => {
					worker.onmessage = (event) => resolve(event.data as T);
					worker.onerror = (event) => reject(new Error(String(event.message)));
					worker.postMessage(input);
				});
			const kitInWorker = await ask<typeof kit>({
				stage: 'kit',
				source: { record: brackenRecord, textures: { manifest: source.textures.manifest } },
				options: { placeholders: 'missing' },
			});
			expect(kitInWorker.key).toBe(kit.key);
			const grown = await ask<PlantAsset>({ stage: 'grow', kit: kitInWorker, options });
			worker.terminate();
			expect(plantAssetDigest(grown)).toBe(plantAssetDigest(growPlantNow(kit, options)));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
