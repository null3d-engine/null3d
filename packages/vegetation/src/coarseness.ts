// Coarseness: a genuinely simpler plant, not only a coarser mesh of the same plant. One number from
// 0, the plant as grown, to 1, the coarsest, acts in three stages: the grown skeleton loses a share
// of its finest twigs, the deepest inside the crown first (grow/coarsen.ts); the instancer keeps a
// share of the shoot rows, spread evenly through the crown, and grows each kept row (leaf/instancer.ts);
// and the wood mesher takes longer edges, so fewer rings and sides (wood/tube.ts). A page may give a
// triangle target instead: the coarseness that brings one copy's nearest level to it is found by
// counting the shoot rows and the wood quickly at a few coarseness values, before anything is meshed.
import type { PlantAsset, ShootRows, SpeciesKitData } from './asset';
import type { MacroSkeleton } from './core/graph';
import { log } from './core/math';
import { DETAILS, type Detail } from './core/types';
import { coarsenSkeleton } from './grow/coarsen';
import { dressShoots } from './leaf/instancer';
import type { CrownLight, DressInput, GrowInput } from './stages';
import { woodTriangles } from './wood/estimate';

/**
 * How much simpler than grown a plant is: a coarseness, or a triangle target that picks one.
 *
 * @category api/vegetation
 */
export interface CoarsenessOptions {
	/**
	 * From 0, the plant as grown, to 1, the coarsest: fewer of the finest twigs and their buds, fewer
	 * and larger shoots, and wood of fewer rings and sides. 0 by default.
	 */
	readonly coarseness?: number;
	/**
	 * The triangles that one copy's nearest level should hold: its wood, its shoot rows at the
	 * variant's tier and its extras. The variant grows at the coarseness that comes nearest. A target
	 * above the plant as grown gives the plant as grown, and one below the coarsest plant gives the
	 * coarsest. Give either this or `coarseness`, not both.
	 */
	readonly triangles?: number;
}

/** How close to the target the search stops, as a share of it. */
const CLOSE_ENOUGH = 0.02;

/** The most coarseness values the search tries between the two ends. */
const MOST_TRIES = 6;

/**
 * Checks a page's coarseness options, with an error that says how to fix them.
 *
 * @param options The options.
 * @returns The options.
 */
export function checkCoarseness<T extends CoarsenessOptions>(options: T): T {
	const { coarseness, triangles } = options;
	if (coarseness !== undefined && !(coarseness >= 0 && coarseness <= 1))
		throw new Error(
			`@null3d/vegetation: coarseness ${coarseness} is outside 0 to 1. Give 0 for the plant as grown, 1 for the coarsest.`,
		);
	if (triangles !== undefined && !(Number.isFinite(triangles) && triangles > 0))
		throw new Error(
			`@null3d/vegetation: a triangle target of ${triangles} is not a positive number of triangles.`,
		);
	if (coarseness !== undefined && triangles !== undefined)
		throw new Error(
			'@null3d/vegetation: give coarseness or a triangle target, not both. The target picks the coarseness.',
		);
	return options;
}

/**
 * The coarseness options a variant grows with: its own, or else the kit's, which the page gave
 * `prepareSpecies`.
 */
function chosen(kit: SpeciesKitData, options: CoarsenessOptions): CoarsenessOptions {
	if (options.coarseness !== undefined || options.triangles !== undefined)
		return checkCoarseness(options);
	return { coarseness: kit.coarseness, triangles: kit.triangles };
}

/**
 * The words that a variant's key holds for its coarseness options: none for the plant as grown, so
 * its key is the same as without them.
 *
 * @param kit The species' kit.
 * @param options The growth's options.
 * @returns The words, each led by a colon.
 */
export function coarsenessKey(kit: SpeciesKitData, options: CoarsenessOptions): string {
	const { coarseness, triangles } = chosen(kit, options);
	if (triangles !== undefined) return `:triangles=${triangles}`;
	return coarseness ? `:coarseness=${coarseness}` : '';
}

/**
 * Triangles of a level's shoot rows at a tier: each row's prototype's mesh at that tier.
 *
 * @param kit The species' kit.
 * @param rows The rows.
 * @param detail The tier.
 * @returns The count.
 */
export function shootTriangles(kit: SpeciesKitData, rows: ShootRows, detail: Detail): number {
	const tier = DETAILS.indexOf(detail);
	const perPrototype = kit.prototypes.map(
		(prototype) => (prototype.tiers[tier]?.indices.length ?? 0) / 3,
	);
	let triangles = 0;
	for (let r = 0; r < rows.count; r++) triangles += perPrototype[rows.prototype[r] as number] ?? 0;
	return triangles;
}

/**
 * Triangles of one copy's nearest level: its meshes, wood included once it is meshed, and its shoot
 * rows at a tier.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param detail The tier the variant grew at; the kit's by default.
 * @returns The count.
 * @category api/vegetation
 */
export function nearTriangles(
	kit: SpeciesKitData,
	asset: PlantAsset,
	detail: Detail = kit.detail,
): number {
	return asset.levels[0].triangles + shootTriangles(kit, asset.shoots, detail);
}

/**
 * The coarseness a variant grows at: the one its options give, or the one that brings its nearest
 * level nearest the triangle target. The search counts the shoot rows that the instancer places
 * and the wood quickly, at each coarseness it tries, from the skeleton as grown.
 *
 * @param kit The species' kit.
 * @param grown The skeleton as grown, and the growth's record, seed, variant and season.
 * @param detail The tier.
 * @param options The coarseness options.
 * @returns The coarseness, from 0 to 1.
 */
export function coarsenessFor(
	kit: SpeciesKitData,
	grown: GrowInput & { readonly skeleton: MacroSkeleton; readonly pruneLight?: CrownLight },
	detail: Detail,
	options: CoarsenessOptions & { readonly sections?: number },
): number {
	const { coarseness, triangles: target } = chosen(kit, options);
	if (target === undefined) return coarseness ?? 0;
	const count = (c: number) => {
		const dress: DressInput = {
			...grown,
			kit,
			skeleton: coarsenSkeleton(grown.skeleton, c),
			coarseness: c,
			sections: options.sections,
		};
		// The rows and the wood the dressing keeps, its bare twigs trimmed as the record asks.
		if (kit.record.lod.nearFoliage !== 'instanced' || kit.prototypes.length === 0)
			return woodTriangles({ ...dress, detail }, 0);
		const dressed = dressShoots(dress);
		return (
			shootTriangles(kit, dressed.rows, detail) +
			woodTriangles({ ...dress, skeleton: dressed.skeleton, detail }, 0)
		);
	};
	// The count falls as the coarseness rises; search between the ends on its logarithm, by false
	// position with the Illinois step, so a few tries come within the target's few per cent.
	let lo = 0;
	let hi = 1;
	let fLo = log(count(lo) / target);
	if (fLo <= 0) return 0;
	let fHi = log(count(hi) / target);
	if (fHi >= 0) return 1;
	let side = 0;
	let best = fLo < -fHi ? lo : hi;
	let bestError = Math.min(Math.abs(fLo), Math.abs(fHi));
	for (let k = 0; k < MOST_TRIES && bestError > log(1 + CLOSE_ENOUGH); k++) {
		const c = (lo * fHi - hi * fLo) / (fHi - fLo);
		const f = log(count(c) / target);
		if (Math.abs(f) < bestError) {
			best = c;
			bestError = Math.abs(f);
		}
		if (f > 0) {
			lo = c;
			fLo = f;
			if (side === 1) fHi /= 2;
			side = 1;
		} else {
			hi = c;
			fHi = f;
			if (side === -1) fLo /= 2;
			side = -1;
		}
	}
	return best;
}
