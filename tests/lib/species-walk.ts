// The checks every species takes, walked from the registry, so a new species adds a folder and no
// line here. The stand-in species joins them, so the walk proves itself before the first species
// lands. Each species' record must pass the record check and the owner's caps, name its own texture
// folder, grow the same bytes twice, and stay within its own budget.
//
// The walk is this module, and the slices beside it call it: the run starts a group only after the
// group before it has ended, so the walk's length is the run's floor unless it divides. A slice takes
// every nth species rather than a run of them, so the species that take longest land in different
// slices rather than in one.
import { describe, expect, it } from 'bun:test';
import type { PlantAsset, SpeciesKitData } from '../../packages/vegetation/src/asset';
import { plantAssetDigest } from '../../packages/vegetation/src/asset';
import {
	capsFor,
	kitBytesOf,
	NEAR_CAPS,
	variantBytesOf,
} from '../../packages/vegetation/src/core/caps';
import { speciesProblems } from '../../packages/vegetation/src/core/check';
import { radians, tan } from '../../packages/vegetation/src/core/math';
import type { SpeciesModule } from '../../packages/vegetation/src/core/record';
import { isSpeciesId, loadSpecies, speciesIds } from '../../packages/vegetation/src/core/registry';
import { standInSpecies } from '../../packages/vegetation/src/core/stand-in';
import { DETAILS, type Detail, spreadMax } from '../../packages/vegetation/src/core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../../packages/vegetation/src/generate';
import { kitBuffers } from '../../packages/vegetation/src/generate-task';
import { REFERENCE_VIEW } from '../../packages/vegetation/src/lod/levels';
import { scaledBudget } from './run-budget.ts';

/**
 * One species to walk: its folder's name, its module, and which of its stages grow as stand-ins:
 * every stage, or only those not built yet.
 */
export interface Walked {
	readonly folder: string;
	readonly load: () => Promise<SpeciesModule>;
	readonly placeholders: true | 'missing';
}

/** Every species the registry holds, then the stand-in that proves the walk. */
export function walkedSpecies(): readonly Walked[] {
	return [
		...speciesIds().map((id) => ({
			folder: id,
			load: () => loadSpecies(id),
			placeholders: 'missing' as const,
		})),
		{ folder: 'stub', load: async () => standInSpecies('stub'), placeholders: true as const },
	];
}

/**
 * The walk's `index`th slice, of `count` slices: every `count`th species, starting at `index`.
 *
 * @param all Every species the walk takes.
 * @param index Which slice this is, from zero.
 * @param count How many slices the walk divides into.
 * @returns This slice's species.
 */
export function sliceOf(all: readonly Walked[], index: number, count: number): readonly Walked[] {
	return all.filter((_, i) => i % count === index);
}

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

/**
 * Grows a kit's first variant twice and checks that both give the same bytes, and that the kit, the
 * variant, its near band and its card levels in every season stay within the record's own budget.
 */
function growsWithinBudget(kit: SpeciesKitData): void {
	const options = { seed: 11, variant: 0, near: true };
	const asset = growPlantNow(kit, options);
	expect(plantAssetDigest(growPlantNow(kit, options))).toBe(plantAssetDigest(asset));
	const record = kit.record;
	const budget = record.lod.budget;
	expect(kitBytesOf(kit)).toBeLessThanOrEqual(budget.kitBytes[kit.detail]);
	expect(variantBytesOf(asset)).toBeLessThanOrEqual(budget.variantBytes[kit.detail]);
	const near = nearBandTriangles(kit, asset);
	expect(near).toBeLessThanOrEqual(budget.lod0Triangles);
	expect(near).toBeLessThanOrEqual(NEAR_CAPS.high.triangles);
	expect(asset.levels[1].triangles).toBeLessThanOrEqual(budget.lod1Triangles);
	expect(asset.levels[2].triangles).toBeLessThanOrEqual(budget.lod2Triangles);
	// Every season's extras, such as autumn's fruit, stay within the variant's byte cap and the card
	// levels' caps too: a season can carry far more than the default one, and the bytes are what a
	// player downloads.
	for (const season of record.seasons.deciduous ? (['autumn', 'blossom'] as const) : []) {
		const seasonal = growPlantNow(kit, { ...options, season });
		expect(variantBytesOf(seasonal)).toBeLessThanOrEqual(budget.variantBytes[kit.detail]);
		expect(seasonal.levels[1].triangles).toBeLessThanOrEqual(budget.lod1Triangles);
		expect(seasonal.levels[2].triangles).toBeLessThanOrEqual(budget.lod2Triangles);
	}
}

/**
 * Registers the checks one species must pass.
 *
 * @param walked The species to walk.
 */
export function walkSpecies(walked: Walked): void {
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
				`keeps its cutting kit within its cap at the ${detail} tier`,
				() => {
					const cutOnly = (record.shoots?.cuttingClasses ?? []).some(
						(shoot) => shoot.cutOnly === true,
					);
					if (!cutOnly && record.cuttings?.density === undefined) return;
					const kit = buildKitNow(module, {
						placeholders: walked.placeholders,
						detail,
						cutting: true,
					});
					expect(kit.prototypes.length).toBeGreaterThan(0);
					expect(kit.cards.size).toBe(0);
					expect(kitBytesOf(kit)).toBeLessThanOrEqual(record.lod.budget.kitBytes[detail]);
				},
				scaledBudget(120_000),
			);

		for (const detail of DETAILS)
			it(
				`keeps its kit and its nearest wood within their caps at the ${detail} tier`,
				() => {
					const kit = buildKitNow(module, { placeholders: walked.placeholders, detail });
					expect(kitBytesOf(kit)).toBeLessThanOrEqual(record.lod.budget.kitBytes[detail]);
					// A kit goes to the job worker by transfer, so two kits share no buffer: a shared one
					// is detached at its second transfer.
					const own = new Set(kitBuffers(kit));
					const again = buildKitNow(module, { placeholders: walked.placeholders, detail });
					expect(kitBuffers(again).filter((buffer) => own.has(buffer))).toEqual([]);
					// The nearest wood of the first variants stays under the owner's cap at this tier.
					const cap = capsFor(record).lod0WoodBytes[detail];
					for (let variant = 0; variant < Math.min(3, record.variants); variant++) {
						const asset = growPlantNow(kit, { seed: 11, variant, near: true });
						let wood = 0;
						for (const part of asset.levels[0].parts)
							if (part.name === 'wood')
								wood += Object.values(part.arrays).reduce(
									(sum, array) => sum + array.byteLength,
									0,
								);
						expect(wood).toBeLessThanOrEqual(cap);
					}
				},
				scaledBudget(120_000),
			);

		it(
			'grows the same bytes twice, and stays within its own budget',
			() => {
				const kit = buildKitNow(module, { placeholders: walked.placeholders });
				growsWithinBudget(kit);
				const budget = record.lod.budget;
				const outputs = module.textures.manifest.outputs;
				const half = outputs
					.filter((o) => o.file.includes('-half'))
					.reduce((s, o) => s + o.bytes, 0);
				const full = outputs
					.filter((o) => !o.file.includes('-half'))
					.reduce((s, o) => s + o.bytes, 0);
				expect(full).toBeLessThanOrEqual(budget.downloadBytes);
				expect(half).toBeLessThanOrEqual(budget.downloadHalfBytes);
			},
			scaledBudget(60_000),
		);

		// Each of the species' other forms grows from its own kit within the species' own budget.
		for (const form of Object.keys(record.forms ?? {}))
			it(
				`grows its ${form} form the same twice, within the species' own budget`,
				() => {
					growsWithinBudget(buildKitNow(module, { placeholders: walked.placeholders, form }));
				},
				scaledBudget(60_000),
			);
	});
}
