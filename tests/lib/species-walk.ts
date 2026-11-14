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
import type { SpeciesKitData } from '../../packages/vegetation/src/asset';
import { plantAssetDigest } from '../../packages/vegetation/src/asset';
import {
	capsFor,
	kitBytesOf,
	NEAR_CAPS,
	variantBytesOf,
} from '../../packages/vegetation/src/core/caps';
import { speciesProblems } from '../../packages/vegetation/src/core/check';
import type { SpeciesModule } from '../../packages/vegetation/src/core/record';
import { isSpeciesId, loadSpecies, speciesIds } from '../../packages/vegetation/src/core/registry';
import { standInSpecies } from '../../packages/vegetation/src/core/stand-in';
import { DETAILS } from '../../packages/vegetation/src/core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../../packages/vegetation/src/generate';
import { kitBuffers } from '../../packages/vegetation/src/generate-task';
import { drawnAtTallest } from '../../packages/vegetation/src/lod/drawn';
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

/**
 * The species known to draw more at once than their near budget allows at the tallest views, with
 * the count each draws there from its worst stated eye, at seed 11 and variant 0. A known species'
 * test expects the failure and fails once the species holds its budget, so its line must go as it
 * is mended.
 */
const NEAR_OVER: Readonly<Record<string, number>> = {
	'common-alder': 24_439_959,
	'european-beech': 15_687_335,
	'giant-sequoia': 53_398_951,
	'hawthorn-shrub': 22_401_474,
	olive: 30_065_894,
	'pedunculate-oak': 43_550_406,
	'silver-birch': 81_019_038,
	'weeping-willow': 12_556_895,
};

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
					const hinted = ['branch', 'subbranch', 'cluster'].some(
						(part) =>
							(
								record.cuttings?.[part as 'branch' | 'subbranch' | 'cluster'] as
									| { readonly density?: number }
									| undefined
							)?.density !== undefined,
					);
					if (!cutOnly && record.cuttings?.density === undefined && !hinted) return;
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

		// The triangles one copy draws at once, as the engine draws them, from its worst stated eye at
		// the tallest views the presets give, against its near budget and the High preset's cap.
		const over = NEAR_OVER[walked.folder];
		(over === undefined ? it : it.failing)(
			`draws at once within its near budget at the tallest view${over === undefined ? '' : `, known to draw ${over}`}`,
			() => {
				const kit = buildKitNow(module, { placeholders: walked.placeholders });
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
				const drawn = drawnAtTallest(kit, asset).triangles;
				expect(drawn).toBeLessThanOrEqual(record.lod.budget.lod0Triangles);
				expect(drawn).toBeLessThanOrEqual(NEAR_CAPS.high.triangles);
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
