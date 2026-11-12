// The owner's caps: the most that any species of a growth model may spend, the near pool's caps per
// quality preset, and the variants each preset grows. A species carries its own budget under these
// caps (`lod.budget`), and one generic test checks every species against both. Only the owner
// changes a figure here.
import type { PlantAsset, SpeciesKitData } from '../asset';
import type { GrowthModel, Species } from './record';
import { DETAILS, type Detail } from './types';

/**
 * The most that one species of a class of growth models may spend. Bytes are counted in
 * megabytes of 1,000,000 bytes.
 *
 * @category api/vegetation
 */
export interface ModelCaps {
	/**
	 * Bytes of the kit at each detail tier, the tier it is built for: the shoot prototypes' meshes at
	 * that tier and those below it, the leaf meshes, and the card atlas until it uploads.
	 */
	readonly kitBytes: Readonly<Record<Detail, number>>;
	/**
	 * Bytes of one variant at each detail tier, read at the tier the plant is built for: its levels
	 * and wind records, the nearest wood left out, which has its own cap.
	 */
	readonly variantBytes: Readonly<Record<Detail, number>>;
	/**
	 * Bytes of one variant's nearest wood at each detail tier, which meshes in the background; 0 where
	 * the class has none.
	 */
	readonly lod0WoodBytes: Readonly<Record<Detail, number>>;
	/** Triangles of the nearest level of one copy, at the high tier. */
	readonly lod0Triangles: number;
	/** Triangles of the first card level. */
	readonly lod1Triangles: number;
	/** Triangles of the second card level. */
	readonly lod2Triangles: number;
	/** Bytes a page downloads for the species with the full texture set. */
	readonly downloadBytes: number;
	/** Bytes a page downloads for the species with the half texture set. */
	readonly downloadHalfBytes: number;
	/** Milliseconds to grow one variant in Bun on the reference Mac. */
	readonly growMilliseconds: number;
}

/**
 * The classes that the caps group growth models into.
 *
 * @category api/vegetation
 */
export type CapClass = 'tree' | 'palm' | 'ground';

const MB = 1_000_000;

/**
 * The owner's caps for each class of growth models.
 *
 * @category api/vegetation
 */
export const MODEL_CAPS: Readonly<Record<CapClass, ModelCaps>> = {
	tree: {
		// The oak's kit, with room above it. Its leaves stand on two years of a shoot's run, and its
		// cuttings draw a forked shoot of their own that the crown never does: the two together
		// measure 2.49, 3.87, 6.95 and 12.86 MB. The owner raised the caps to hold that class at every
		// tier rather than make the crown give up a prototype for it. The beech's own cluster cutting
		// then added a second class, which takes the low tier to 3.29: the cap rises to 3.4 so the
		// species can keep the crown it won rather than give up a prototype for the cutting.
		// The English elm's branch piece reaches its photograph's width only with a second cutting
		// class, which measures 3.45, 6.25, 11.76 and 22.51 MB; its first class turns cleanly and is
		// kept either way. The owner raised the tiers so a species is not held to a narrower piece
		// than its picture shows.
		// The elm's cut branch widens and its turn steadies only with arms of three units rather
		// than two, which measures 3.39, 5.32, 9.13 and 16.57 MB — the piece's turning crown-box
		// spread falls from 52 to 12 per cent. The owner raised the tiers rather than keep a piece
		// that fits its picture and cannot turn.
		// The English elm's crown needs six prototypes and a cut shoot of nine leaves along a metre
		// with two side shoots, which measures 3.35, 4.99, 8.13 and 14.37 MB: a lighter cut shoot
		// fits the old caps and is sparser than its photograph. The owner raised the upper tiers
		// rather than let the budget choose the cutting.
		// The silver birch's crown needs six shoot prototypes and a cutting class of its own, and
		// its medium kit sits on the old four-megabyte ceiling: the owner raised it so the species
		// keeps the crown it won rather than give up a prototype for it.
		kitBytes: { low: 3.5 * MB, medium: 6.3 * MB, high: 11.8 * MB, ultra: 22.6 * MB },
		// The holm oak's densest variant, with a little room above it: 16.94, 17.05, 17.26 and
		// 17.61 MB. An evergreen carries many small leaves on dense shoots, and the clearance packs
		// the limbs into fuller crowns, so the evergreen rather than the oak now sets this cap. The
		// oak's own largest variant measures 11.02 MB at high.
		// The common alder's rim needs about a quarter more shoots than its variant could hold: bytes
		// run at 3.6 KB a shoot, so a rim of five pieces against a photograph's one is a budget
		// question rather than a growth one. The owner raised the cap rather than let the budget
		// choose the species' crown; the holm oak's figures this cap replaced were 16.94 to 17.61.
		variantBytes: { low: 20 * MB, medium: 20.1 * MB, high: 20.3 * MB, ultra: 20.7 * MB },
		// The pedunculate oak's largest of three variants, with about 15 per cent to spare: 7.72, 9.85,
		// 13.05 and 17.80 MB. Close-up review needs every finest macro axis as real wood, and a page
		// that needs fewer triangles grows a coarser plant. A thicker bole costs radial segments on
		// every axis, so the figures rise with the trunk's girth.
		lod0WoodBytes: { low: 8.9 * MB, medium: 11.3 * MB, high: 15 * MB, ultra: 20.5 * MB },
		// The beech's densest cutting, with about a twentieth to spare. A dense cutting is many rows of
		// leaves on one shoot, and the near band is the only place those rows are real geometry, so the
		// cap follows the densest species' measured figure rather than the oak's.
		lod0Triangles: 2_900_000,
		// The common alder's crown at density 3.5 measures 150,133 triangles at this level, and the
		// cap, not the growth, was choosing its density: the owner raised it so a species' crown can
		// be as solid as its photographs.
		lod1Triangles: 155_000,
		// The beech's second card level once each card draws its supporting twig: 27,666 triangles
		// without the twig line and about 42,700 with one, which is above the holm oak's 37,723. A
		// card that draws no twig floats free of the wood, so this cap follows the reading with it.
		// The saguaro's areole cards, one at every rib crest, measure 50,452 triangles at the ultra
		// tier, so the cap rises above them rather than leave the column thin of its spine clusters.
		lod2Triangles: 52_000,
		downloadBytes: 1 * MB,
		downloadHalfBytes: 0.35 * MB,
		growMilliseconds: 600,
	},
	palm: {
		kitBytes: { low: 4 * MB, medium: 4 * MB, high: 4 * MB, ultra: 4 * MB },
		// The date palm's crown is a hundred leaflets a side on twenty fronds, in a skirt of dead
		// ones: its nearest foliage measures 3.70 MB, against the 3 MB that stood here before a palm
		// grew. The owner raised the tier so the fronds keep the leaflets their photographs show
		// rather than thin to fit a figure. The nearest wood measures 0.64 MB and its triangles
		// 119,000, well under their own caps.
		variantBytes: { low: 4.2 * MB, medium: 4.2 * MB, high: 4.2 * MB, ultra: 4.2 * MB },
		lod0WoodBytes: { low: 2 * MB, medium: 2 * MB, high: 2 * MB, ultra: 2 * MB },
		lod0Triangles: 600_000,
		lod1Triangles: 80_000,
		lod2Triangles: 20_000,
		downloadBytes: 1 * MB,
		downloadHalfBytes: 0.35 * MB,
		growMilliseconds: 300,
	},
	ground: {
		kitBytes: { low: 2 * MB, medium: 2 * MB, high: 2 * MB, ultra: 2 * MB },
		// The largest of hosta, pendulous sedge and meadow grass once measured 1.35, 1.39, 1.44 and
		// 3.30 MB, with about 15 per cent to spare, so Hosta's ribs at the finest tier fit. The sedge's
		// tussock needs more blades than the old figures held, so the batch raised the medium and high
		// tiers in proportion: a species grows at every preset and may spend its blades at each. The
		// owner then raised the low tier by the packed blade keel's 73,928 bytes, so a grass blade can
		// turn its width to the view at the lowest memory tier too. On 12 November 2026 the owner ruled
		// that the sedge keeps its spikelets, ligule and shoots, and raised this high tier and the two
		// card levels from the newer grower's measured 3,042,793 bytes and 35,843 and 19,505 triangles.
		// On 12 November 2026 the owner then raised the high variant and the first two card levels so
		// the sedge could draw the photographs' twenty-two flowering stems: the measured twenty-two
		// read 3,375,625 bytes and 78,833, 40,987 and 23,409 triangles.
		// On 13 November 2026 the byte caps were re-recorded to govern every variant the species
		// shows, not one drawn variant: the sedge's record had flagged the lower tiers as measured
		// before the newer grower and awaiting a later read. At seed 11 the largest of its six
		// variants (variant 3) reads 3,327,959, 3,658,322, 4,099,334 and 5,611,850 bytes against the
		// old 1,673,928, 2,300,000, 3,600,000 and 3,800,000, so the caps take the class's 15 per cent
		// spare at 3,830,000, 4,210,000, 4,710,000 and 6,450,000. The sedge's largest variant therefore
		// sets this class's byte ceiling: the meadow grass and the hosta inherit headroom they did not
		// need, and their own figures did not grow.
		variantBytes: { low: 3_830_000, medium: 4_210_000, high: 4_710_000, ultra: 6_450_000 },
		// A frond colony's stipes and rachises are wood: the bracken test colony's largest of sixteen
		// variants and seasons, with about 15 per cent to spare: 52, 58, 61 and 64 KB.
		lod0WoodBytes: { low: 0.06 * MB, medium: 0.066 * MB, high: 0.07 * MB, ultra: 0.074 * MB },
		lod0Triangles: 200_000,
		lod1Triangles: 80_000,
		lod2Triangles: 25_000,
		downloadBytes: 0.35 * MB,
		downloadHalfBytes: 0.12 * MB,
		growMilliseconds: 150,
	},
};

/**
 * The class of caps that each growth model takes.
 *
 * @category api/vegetation
 */
export const MODEL_CLASS: Readonly<Record<GrowthModel, CapClass>> = {
	'self-organizing': 'tree',
	architectural: 'tree',
	'crown-rosette': 'palm',
	culm: 'palm',
	rosette: 'ground',
	'frond-colony': 'ground',
	tuft: 'ground',
	column: 'tree',
};

/**
 * The bytes a kit holds, as its cap counts them: every mesh of its leaves and its shoot prototypes'
 * tiers, its card atlas's pixels and its records header.
 *
 * @param kit The kit.
 * @returns The bytes.
 */
export function kitBytesOf(kit: SpeciesKitData): number {
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

/**
 * The bytes a grown variant holds against its budget: its levels and wind records, without the
 * nearest wood, which has a cap of its own.
 *
 * @param asset The grown variant.
 * @returns The bytes.
 */
export function variantBytesOf(asset: PlantAsset): number {
	let wood = 0;
	for (const part of asset.levels[0].parts) {
		if (part.name !== 'wood') continue;
		const a = part.arrays;
		wood +=
			a.positions.byteLength +
			a.normals.byteLength +
			a.uvs.byteLength +
			a.uvs1.byteLength +
			a.colors.byteLength +
			a.indices.byteLength;
	}
	return asset.stats.bytes - wood;
}

/**
 * The species whose second bark zone the owner allows a larger download, with those caps.
 *
 * The bracken's entry is measured, not a second zone: a stipe's own bark texture beside its leaf
 * set reads 731 KB with the full set and 220 KB with the half, against the ground class's 350 and
 * 120. Its leaf set is 310.0 KB and 97.7 KB, and one stipe zone 421 KB and 123 KB.
 *
 * @category api/vegetation
 */
export const TWO_ZONE_DOWNLOADS: Readonly<
	Record<string, { readonly downloadBytes: number; readonly downloadHalfBytes: number }>
> = {
	// The bracken's stipe zone, measured from its own texture set.
	bracken: { downloadBytes: 0.75 * MB, downloadHalfBytes: 0.23 * MB },
	'silver-birch': { downloadBytes: 1.3 * MB, downloadHalfBytes: 0.4 * MB },
	'scots-pine': { downloadBytes: 1.3 * MB, downloadHalfBytes: 0.4 * MB },
	'quaking-aspen': { downloadBytes: 1.3 * MB, downloadHalfBytes: 0.4 * MB },
};

/**
 * The caps that a species' budget must stay under: its model's class, with the larger download of a
 * species the owner names.
 *
 * @param record The species record.
 * @returns The caps.
 * @category api/vegetation
 */
export function capsFor(record: Species): ModelCaps {
	const caps = MODEL_CAPS[MODEL_CLASS[record.growth.model]];
	const download = TWO_ZONE_DOWNLOADS[record.id];
	return download ? { ...caps, ...download } : caps;
}

/**
 * Every figure of a species' budget that passes its caps, one line each.
 *
 * @param record The species record.
 * @returns The problems, empty when the budget is within its caps.
 * @category api/vegetation
 */
export function capProblems(record: Species): string[] {
	const caps = capsFor(record);
	const budget = record.lod.budget;
	const problems: string[] = [];
	const figures = [
		['lod0Triangles', budget.lod0Triangles, caps.lod0Triangles],
		['lod1Triangles', budget.lod1Triangles, caps.lod1Triangles],
		['lod2Triangles', budget.lod2Triangles, caps.lod2Triangles],
		['downloadBytes', budget.downloadBytes, caps.downloadBytes],
		['downloadHalfBytes', budget.downloadHalfBytes, caps.downloadHalfBytes],
		['growMilliseconds', budget.growMilliseconds, caps.growMilliseconds],
	] as const;
	for (const [name, value, cap] of figures)
		if (value > cap)
			problems.push(
				`lod.budget.${name} is ${value}, over the cap of ${cap} for a ${record.growth.model} plant`,
			);
	for (const detail of DETAILS)
		for (const name of ['kitBytes', 'variantBytes'] as const) {
			const value = budget[name][detail];
			const cap = caps[name][detail];
			if (value > cap)
				problems.push(
					`lod.budget.${name}.${detail} is ${value}, over the cap of ${cap} for a ${record.growth.model} plant`,
				);
		}
	return problems;
}

/**
 * The near pool's caps at one quality preset: copies that draw real shoots, their triangles, and
 * the prototype tier they draw.
 *
 * @category api/vegetation
 */
export interface NearCaps {
	/** Copies nearest the camera that draw real shoots. */
	readonly copies: number;
	/** Triangles those copies' shoots may draw together. */
	readonly triangles: number;
	/** The prototype tier the shoots draw. */
	readonly detail: Detail;
}

/**
 * The near pool's caps at each quality preset.
 *
 * @category api/vegetation
 */
export const NEAR_CAPS: Readonly<Record<Detail, NearCaps>> = {
	low: { copies: 1, triangles: 500_000, detail: 'low' },
	medium: { copies: 3, triangles: 1_500_000, detail: 'medium' },
	high: { copies: 6, triangles: 5_000_000, detail: 'high' },
	ultra: { copies: 10, triangles: 10_000_000, detail: 'ultra' },
};

/**
 * The variants each quality preset grows of a species, at most the species' own count.
 *
 * @category api/vegetation
 */
export const VARIANTS_BY_PRESET: Readonly<Record<Detail, number>> = {
	low: 3,
	medium: 4,
	high: 6,
	ultra: 6,
};
