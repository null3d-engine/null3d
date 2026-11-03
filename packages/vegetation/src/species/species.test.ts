// The checks every species takes, walked from the registry, so a new species adds a folder and no
// line here. The stand-in species joins them, so the walk proves itself before the first species
// lands. Each species' record must pass the record check and the owner's caps, name its own texture
// folder, grow the same bytes twice, and stay within its own budget.
import { describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import { plantAssetDigest } from '../asset';
import { nearTriangles } from '../coarseness';
import { variantBytesOf } from '../core/caps';
import { speciesProblems } from '../core/check';
import type { SpeciesModule } from '../core/record';
import { isSpeciesId, loadSpecies, speciesIds } from '../core/registry';
import { standInSpecies } from '../core/stand-in';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';

/**
 * One species to walk: its folder's name, its module, and which of its stages grow as stand-ins:
 * every stage, or only those not built yet.
 */
interface Walked {
	readonly folder: string;
	readonly load: () => Promise<SpeciesModule>;
	readonly placeholders: true | 'missing';
}

const WALKED: readonly Walked[] = [
	...speciesIds().map((id) => ({
		folder: id,
		load: () => loadSpecies(id),
		placeholders: 'missing' as const,
	})),
	{ folder: 'stub', load: async () => standInSpecies('stub'), placeholders: true as const },
];

/** The bytes of every array a kit holds. */
function kitBytes(kit: SpeciesKitData): number {
	let bytes = kit.cards.color.byteLength + kit.cards.surface.byteLength + kit.header.byteLength;
	for (const mesh of [...kit.leaves, ...kit.prototypes.flatMap((p) => p.tiers)])
		bytes +=
			mesh.positions.byteLength +
			mesh.normals.byteLength +
			mesh.uvs.byteLength +
			mesh.uvs1.byteLength +
			mesh.colors.byteLength +
			mesh.indices.byteLength;
	return bytes;
}

for (const walked of WALKED) {
	describe(`the species ${walked.folder}`, async () => {
		const module = await walked.load();
		const { record } = module;
		await loadPlantCode(record);

		it('passes the record check and the owner caps', () => {
			expect(speciesProblems(record)).toEqual([]);
		});

		it('is named by its folder and names its own texture folder', () => {
			expect(record.id).toBe(walked.folder);
			if (record.textures === 'own') expect(module.textures.manifest.species).toBe(record.id);
			else expect(isSpeciesId(record.textures.from)).toBe(true);
		});

		it('grows the same bytes twice, and stays within its own budget', () => {
			const kit = buildKitNow(module, { placeholders: walked.placeholders });
			const options = { seed: 11, variant: 0, near: true };
			const asset = growPlantNow(kit, options);
			expect(plantAssetDigest(growPlantNow(kit, options))).toBe(plantAssetDigest(asset));
			const budget = record.lod.budget;
			expect(kitBytes(kit)).toBeLessThanOrEqual(budget.kitBytes);
			expect(variantBytesOf(asset)).toBeLessThanOrEqual(budget.variantBytes[kit.detail]);
			expect(nearTriangles(kit, asset, 'high')).toBeLessThanOrEqual(budget.lod0Triangles);
			expect(asset.levels[1].triangles).toBeLessThanOrEqual(budget.lod1Triangles);
			expect(asset.levels[2].triangles).toBeLessThanOrEqual(budget.lod2Triangles);
			const outputs = module.textures.manifest.outputs;
			const half = outputs.filter((o) => o.file.includes('-half')).reduce((s, o) => s + o.bytes, 0);
			const full = outputs
				.filter((o) => !o.file.includes('-half'))
				.reduce((s, o) => s + o.bytes, 0);
			expect(full).toBeLessThanOrEqual(budget.downloadBytes);
			expect(half).toBeLessThanOrEqual(budget.downloadHalfBytes);
		});
	});
}
