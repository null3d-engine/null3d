// The checks every species takes, walked from the registry, so a new species adds a folder and no
// line here. The stand-in species joins them, so the walk proves itself before the first species
// lands. Each species' record must pass the record check and the owner's caps, name its own texture
// folder, grow the same bytes twice, and stay within its own budget.
import { describe, expect, it } from 'bun:test';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { plantAssetDigest } from '../asset';
import { speciesProblems } from '../core/check';
import type { SpeciesModule } from '../core/record';
import { isSpeciesId, loadSpecies, speciesIds } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { species as stub } from './_stub/index';

/** One species to walk: its folder's name, its module, and whether its stages may be stand-ins. */
interface Walked {
	readonly folder: string;
	readonly load: () => Promise<SpeciesModule>;
	readonly placeholders: boolean;
}

const WALKED: readonly Walked[] = [
	...speciesIds().map((id) => ({ folder: id, load: () => loadSpecies(id), placeholders: false })),
	{ folder: 'stub', load: async () => stub, placeholders: true },
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

/** Triangles of the nearest level of one copy at the high tier: its meshes and its shoot rows. */
function nearTriangles(kit: SpeciesKitData, asset: PlantAsset): number {
	const high = DETAILS.indexOf('high');
	let triangles = asset.levels[0].triangles;
	for (let row = 0; row < asset.shoots.count; row++) {
		const prototype = kit.prototypes[asset.shoots.prototype[row] as number];
		triangles += (prototype?.tiers[high]?.indices.length ?? 0) / 3;
	}
	return triangles;
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
			expect(asset.stats.bytes).toBeLessThanOrEqual(budget.variantBytes);
			expect(nearTriangles(kit, asset)).toBeLessThanOrEqual(budget.lod0Triangles);
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
