// The plant core's pipeline, grown through every stage with stand-ins for the stages that are not
// built yet: the kit, the skeleton, the shoot rows, the crown light, the wind records, the three
// levels, the nearest wood, the far bake and a cutting. Two growths of one seed and variant give the
// same bytes on this thread and in a worker that runs the job-worker task.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { type PlantAsset, plantAssetDigest } from './asset';
import { hashBytes } from './core/hash';
import { NotBuiltError } from './core/not-built';
import { standInSpecies } from './core/stand-in';
import {
	bakeFarNow,
	buildKitNow,
	growNearWoodNow,
	growPlantNow,
	kitKey,
	loadPlantCode,
	variantKey,
	withLeaves,
	withLimbs,
} from './generate';
import type { PlantTaskInput } from './generate-task';

/** The growth tests grow a real species, which a busy machine draws in tens of seconds. */
const LONG = scaledBudget(180_000);

const stub = standInSpecies('stub');

await loadPlantCode(stub.record);
const kit = buildKitNow(stub, { placeholders: true });

describe('the plant core with stand-ins', () => {
	it('builds a kit of prototypes, a leaf, a card atlas and a header', () => {
		expect(kit.prototypes.length).toBe(stub.record.shoots?.prototypes ?? -1);
		for (const prototype of kit.prototypes) {
			expect(prototype.tiers).toHaveLength(4);
			expect(prototype.card.planes).toHaveLength(3);
			expect(prototype.length).toBeGreaterThan(0);
		}
		expect(kit.leaves).toHaveLength(1);
		expect(kit.cards.color.length).toBe(kit.cards.size * kit.cards.size * 4 * 2);
		expect(kit.header.length).toBeGreaterThan(0);
		expect(kit.key).toBe(kitKey(stub.record, stub.textures.manifest, 'high'));
	});

	it('builds the kit of a form under a key of its own, and the record as it stands without one', () => {
		const formed = {
			...stub,
			record: {
				...stub.record,
				forms: { young: { form: 'a young stand-in', size: { height: { mean: 2, spread: 0.2 } } } },
			},
		};
		// The forms leave the record as it stands, and its kit, unchanged.
		const own = buildKitNow(formed, { placeholders: true });
		expect(own.key).toBe(kit.key);
		expect('forms' in own.record).toBe(false);
		const youngKit = buildKitNow(formed, { placeholders: true, form: 'young' });
		expect(youngKit.record.size.height).toEqual({ mean: 2, spread: 0.2 });
		expect(youngKit.key).not.toBe(kit.key);
		const asset = growPlantNow(youngKit, { seed: 11, variant: 0 });
		expect(asset.skeleton.height).toBeLessThan(2.5);
		expect(variantKey(youngKit, { seed: 11, variant: 0 })).not.toBe(
			variantKey(kit, { seed: 11, variant: 0 }),
		);
		expect(() => buildKitNow(formed, { placeholders: true, form: 'old' })).toThrow(/no form 'old'/);
	});

	it('grows a variant through every stage', () => {
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		expect(asset.skeleton.axes.count).toBeGreaterThan(1);
		expect(asset.skeleton.buds.count).toBeGreaterThan(0);
		expect(asset.shoots.count).toBe(asset.skeleton.buds.count);
		expect(asset.wind.count).toBe(asset.skeleton.axes.count);
		expect(asset.levels[0].parts.map((part) => part.name)).toEqual(['wood']);
		expect(asset.levels[1].parts.map((part) => part.name)).toEqual(['wood', 'cards']);
		expect(asset.levels[2].triangles).toBeLessThan(asset.levels[1].triangles);
		expect(asset.levels[1].from).toBeGreaterThan(0);
		expect(asset.levels[2].from).toBeGreaterThan(asset.levels[1].from);
		const box = kit.box;
		expect(asset.skeleton.bounds.max[1]).toBeLessThan(box.max[1]);
		expect(asset.skeleton.bounds.min[0]).toBeGreaterThan(box.min[0]);
		expect(asset.stats.triangles[0]).toBe(asset.levels[0].triangles);
	});

	it('grows the same bytes from the same seed and variant, and other bytes from another', () => {
		const options = { seed: 11, variant: 1, near: true };
		const first = plantAssetDigest(growPlantNow(kit, options));
		expect(plantAssetDigest(growPlantNow(kit, options))).toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, variant: 2 }))).not.toBe(first);
		expect(plantAssetDigest(growPlantNow(kit, { ...options, seed: 12 }))).not.toBe(first);
		expect(variantKey(kit, options)).not.toBe(variantKey(kit, { ...options, variant: 2 }));
	});

	it('meshes the nearest wood later as it would have at once', () => {
		const later = growPlantNow(kit, { seed: 11, variant: 0 });
		expect(later.levels[0].parts).toHaveLength(0);
		const wood = growNearWoodNow(kit, { seed: 11, variant: 0 });
		const atOnce = growPlantNow(kit, { seed: 11, variant: 0, near: true }).levels[0].parts[0];
		expect(wood).toHaveLength(1);
		expect(wood[0]?.arrays.positions).toEqual(atOnce?.arrays.positions as Uint16Array);
	});

	it('bakes the far cards and cuts the review pieces', async () => {
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
		const far = await bakeFarNow(kit, asset);
		expect(far.views).toBe(stub.record.lod.impostor.views);
		expect(far.color.length).toBe((far.views * far.texels) ** 2 * 4);
		for (const part of ['leaf', 'cluster', 'subbranch', 'branch'] as const) {
			const piece = growPlantNow(kit, { seed: 11, variant: 0, near: true, cutting: { part } });
			expect(piece.cutting?.part).toBe(part);
			expect(piece.levels[0].triangles).toBeGreaterThan(0);
			expect(piece.levels[1].parts).toHaveLength(0);
		}
	});

	it('grows the same stand-ins as real stages land, so scenes that place them draw the same', () => {
		const frozen = [
			['stub', {}, 3667806437, '6b3580f98a8ac9bd'],
			[
				'pedunculate-oak',
				{ height: { mean: 20, spread: 3 }, aspect: 1.2 },
				843710834,
				'0ab62314c7bf2788',
			],
		] as const;
		for (const [id, options, kitHash, assetDigest] of frozen) {
			const standIn = buildKitNow(standInSpecies(id, options), { placeholders: true });
			let hash = 0;
			for (const prototype of standIn.prototypes)
				for (const tier of prototype.tiers)
					hash =
						hashBytes(new Uint8Array(tier.positions.buffer), hash) ^
						hashBytes(tier.colors, hash + 1);
			hash = hashBytes(standIn.cards.color, hash);
			hash = hashBytes(
				new Uint8Array(standIn.leaves[0]?.positions.buffer ?? new ArrayBuffer(0)),
				hash,
			);
			expect(hash >>> 0).toBe(kitHash);
			const grown = growPlantNow(standIn, { seed: 11, variant: 0, near: true });
			expect(plantAssetDigest(grown)).toBe(assetDigest);
		}
	});

	it('grows the built stages and stand-ins for the rest when the kit asks for the missing ones', () => {
		const mixed = buildKitNow(stub, { placeholders: 'missing' });
		expect(mixed.placeholders).toBe('missing');
		const options = { seed: 11, variant: 0, near: true };
		const asset = growPlantNow(mixed, options);
		expect(plantAssetDigest(growPlantNow(mixed, options))).toBe(plantAssetDigest(asset));
		expect(plantAssetDigest(asset)).not.toBe(plantAssetDigest(growPlantNow(kit, options)));
		expect(asset.wind.count).toBe(asset.skeleton.axes.count);
		expect(asset.levels[1].from).toBeGreaterThan(0);
	});

	it('throws where a stage is not built and the kit asks for no stand-ins', () => {
		// Every kit stage is built; a variant's growth still meets a stage that is not.
		const kit = buildKitNow(stub);
		expect(() => growPlantNow(kit, { seed: 11, variant: 0, near: true })).toThrow(NotBuiltError);
	});

	it('grows the same bytes in a worker that runs the job-worker task', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'plant-task-'));
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
			const ask = <T>(input: PlantTaskInput) =>
				new Promise<T>((resolve, reject) => {
					worker.onmessage = (event) => resolve(event.data as T);
					worker.onerror = (event) => reject(new Error(String(event.message)));
					worker.postMessage(input);
				});
			const options = { seed: 11, variant: 0, near: true };
			const kitInWorker = await ask<typeof kit>({
				stage: 'kit',
				source: { record: stub.record, textures: { manifest: stub.textures.manifest } },
				options: { placeholders: true },
			});
			expect(kitInWorker.key).toBe(kit.key);
			const grown = await ask<PlantAsset>({ stage: 'grow', kit: kitInWorker, options });
			worker.terminate();
			expect(plantAssetDigest(grown)).toBe(plantAssetDigest(growPlantNow(kit, options)));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it(
		"sizes every species' leaves from one share, leaving the wood where the record grows it",
		async () => {
			const oak = (await import('./species/pedunculate-oak/index')).species;
			await loadPlantCode(oak.record);
			const grown = buildKitNow(oak, { placeholders: 'missing', detail: 'high' });
			const shoots = oak.record.shoots as NonNullable<typeof oak.record.shoots>;
			// The leaf area is the share, so a shoot's own scale moves by its square root.
			const own = withLeaves(oak.record, 1);
			expect(own).toBe(oak.record);
			const smaller = withLeaves(oak.record, 0.64) as typeof oak.record;
			const scaleOf = (record: typeof oak.record): number => {
				const scale = record.shoots?.placement.scale ?? 1;
				return typeof scale === 'number' ? scale : scale.mean;
			};
			expect(scaleOf(smaller)).toBeCloseTo(scaleOf(oak.record) * 0.8, 6);
			// The wood does not move: the same growth, and a shoot count that keeps its own by
			// taking back the room a smaller shoot frees along the axis.
			expect(smaller.growth).toBe(oak.record.growth);
			const perMetre = (curve: typeof shoots.placement.perMetre) =>
				typeof curve === 'number' ? curve : (curve[0]?.[1] ?? 0);
			expect(perMetre(smaller.shoots?.placement.perMetre ?? 0)).toBeCloseTo(
				perMetre(shoots.placement.perMetre) * 0.8,
				6,
			);
			expect(() => withLeaves(oak.record, 3)).toThrow();
			expect(variantKey(grown, { seed: 11, variant: 0, leaves: 0.5 })).not.toBe(
				variantKey(grown, { seed: 11, variant: 0 }),
			);
			expect(variantKey(grown, { seed: 11, variant: 0, leaves: 1 })).toBe(
				variantKey(grown, { seed: 11, variant: 0 }),
			);
		},
		LONG,
	);

	it(
		'thins or fills the wood from one limb share, every species the same way',
		async () => {
			const oak = (await import('./species/pedunculate-oak/index')).species;
			await loadPlantCode(oak.record);
			const grown = buildKitNow(oak, { placeholders: 'missing', detail: 'high' });
			const rows = (limbs?: number) =>
				growPlantNow(grown, { seed: 11, variant: 0, near: true, limbs }).shoots.count;
			// A share below one drops the shoots a crown's shaded wood carries; above it, keeps them.
			expect(rows(0.5)).toBeLessThan(rows(1));
			expect(rows(1.6)).toBeGreaterThan(rows(1));
			// Absent or one grows the record's own crown, to the shoot.
			expect(rows()).toBe(rows(1));
			const shoots = oak.record.shoots as NonNullable<typeof oak.record.shoots>;
			// The share moves the record's own sky prune, so a sparse crown keeps its lit rim.
			const thinner = withLimbs(oak.record, 1.5) as typeof oak.record;
			expect(thinner.shoots?.placement.skyPrune).toBeLessThan(shoots.placement.skyPrune ?? 0.5);
			const sparse = withLimbs(oak.record, 0.5) as typeof oak.record;
			// The growth's own count of limbs moves with the share, whatever model the record names.
			if (oak.record.growth.model === 'self-organizing') {
				const own = oak.record.growth.branching ?? 1;
				expect(sparse.growth.model).toBe('self-organizing');
				if (sparse.growth.model === 'self-organizing')
					expect(sparse.growth.branching).toBeCloseTo(own * 0.5, 6);
			}
			if (shoots.placement.density !== undefined)
				expect(sparse.shoots?.placement.density).toBeCloseTo(shoots.placement.density * 0.5, 6);
			// The shoots along the finest axes thin too, which is the dial every growth model answers.
			const perMetre = (curve: typeof shoots.placement.perMetre) =>
				typeof curve === 'number' ? curve : (curve[0]?.[1] ?? 0);
			expect(perMetre(sparse.shoots?.placement.perMetre ?? 0)).toBeCloseTo(
				perMetre(shoots.placement.perMetre) * 0.5,
				6,
			);
			expect(() => withLimbs(oak.record, 3)).toThrow();
			// A different share is a different asset, so the cache never hands back the record's own.
			expect(variantKey(grown, { seed: 11, variant: 0, limbs: 0.5 })).not.toBe(
				variantKey(grown, { seed: 11, variant: 0 }),
			);
			expect(variantKey(grown, { seed: 11, variant: 0, limbs: 1 })).toBe(
				variantKey(grown, { seed: 11, variant: 0 }),
			);
		},
		LONG,
	);
});
