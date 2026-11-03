// The checks every species takes, walked from the registry, so a new species adds a folder and no
// line here. The stand-in species joins them, so the walk proves itself before the first species
// lands. Each species' record must pass the record check and the owner's caps, name its own texture
// folder, grow the same bytes twice, and stay within its own budget.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { plantAssetDigest } from '../asset';
import { kitBytesOf, NEAR_CAPS, variantBytesOf } from '../core/caps';
import { speciesProblems } from '../core/check';
import { radians, tan } from '../core/math';
import type { SpeciesModule } from '../core/record';
import { isSpeciesId, loadSpecies, speciesIds } from '../core/registry';
import { standInSpecies } from '../core/stand-in';
import { DETAILS, type Detail, spreadMax } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { REFERENCE_VIEW } from '../lod/levels';

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

/** The near band's leaf tiers out from the camera, as shares of the split distance. */
const NEAR_BANDS: readonly (readonly [share: number, detail: Detail])[] = [
	[0.25, 'high'],
	[0.5, 'medium'],
	[1.04, 'low'],
];

/**
 * The triangles one copy draws inside its near band at the High preset, for the worse of two eyes
 * at a standing person's height: beside the trunk, and at the crown's edge. The split is where the
 * longest shoot at its largest scale spans the record's first switch pixels at the reference view;
 * each shoot row inside it draws at its band's tier, and the nearest level's meshes draw whole. An
 * eye inside the crown is the near pool's to bound, which cuts the split nearer at run time.
 */
function nearBandTriangles(kit: SpeciesKitData, asset: PlantAsset): number {
	const record = kit.record;
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	longest *= record.shoots ? spreadMax(record.shoots.placement.scale) : 1;
	const split =
		(longest * REFERENCE_VIEW.height) /
		(2 * tan(radians(REFERENCE_VIEW.fov / 2)) * record.lod.switchPixels[0]);
	const { centre, radius } = asset.crown;
	const eyes = [
		[0.5, 1.7, 0.5],
		[(centre[0] as number) + radius, 1.7, centre[2] as number],
	] as const;
	const rows = asset.shoots;
	let worst = 0;
	for (const eye of eyes) {
		let triangles = asset.levels[0].triangles;
		for (let r = 0; r < rows.count; r++) {
			const prototype = kit.prototypes[rows.prototype[r] as number];
			if (!prototype) continue;
			const reach = prototype.radius * (rows.scale[r] as number);
			const distance =
				Math.hypot(
					(rows.position[r * 3] as number) - eye[0],
					(rows.position[r * 3 + 1] as number) - eye[1],
					(rows.position[r * 3 + 2] as number) - eye[2],
				) - reach;
			const band = NEAR_BANDS.find(([share]) => distance < share * split);
			if (band) triangles += (prototype.tiers[DETAILS.indexOf(band[1])]?.indices.length ?? 0) / 3;
		}
		worst = Math.max(worst, triangles);
	}
	return worst;
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

		for (const detail of DETAILS)
			it(
				`keeps its kit within its own budget at the ${detail} tier`,
				() => {
					const kit = buildKitNow(module, { placeholders: walked.placeholders, detail });
					expect(kitBytesOf(kit)).toBeLessThanOrEqual(record.lod.budget.kitBytes[detail]);
				},
				scaledBudget(60_000),
			);

		it('grows the same bytes twice, and stays within its own budget', () => {
			const kit = buildKitNow(module, { placeholders: walked.placeholders });
			const options = { seed: 11, variant: 0, near: true };
			const asset = growPlantNow(kit, options);
			expect(plantAssetDigest(growPlantNow(kit, options))).toBe(plantAssetDigest(asset));
			const budget = record.lod.budget;
			expect(kitBytesOf(kit)).toBeLessThanOrEqual(budget.kitBytes[kit.detail]);
			expect(variantBytesOf(asset)).toBeLessThanOrEqual(budget.variantBytes[kit.detail]);
			const near = nearBandTriangles(kit, asset);
			expect(near).toBeLessThanOrEqual(budget.lod0Triangles);
			expect(near).toBeLessThanOrEqual(NEAR_CAPS.high.triangles);
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
