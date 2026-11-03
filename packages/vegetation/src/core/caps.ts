// The owner's caps: the most that any species of a growth model may spend, the near pool's caps per
// quality preset, and the variants each preset grows. A species carries its own budget under these
// caps (`lod.budget`), and one generic test checks every species against both. Only the owner
// changes a figure here.
import type { PlantAsset } from '../asset';
import type { GrowthModel, Species } from './record';
import { DETAILS, type Detail } from './types';

/**
 * The most that one species of a class of growth models may spend. Bytes are counted in
 * megabytes of 1,000,000 bytes.
 *
 * @category api/vegetation
 */
export interface ModelCaps {
	/** Bytes of the kit: prototypes in every tier, and the card atlas until it uploads. */
	readonly kitBytes: number;
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
		kitBytes: 6 * MB,
		// The grown oak's largest variant, with about 15 per cent to spare: 6.07, 6.09, 6.11 and 6.14 MB.
		variantBytes: { low: 7 * MB, medium: 7 * MB, high: 7.1 * MB, ultra: 7.1 * MB },
		// The grown oak's largest of six variants, with about 15 per cent to spare: 5.2, 5.7, 6.4 and
		// 7.9 MB. Close-up review needs every finest macro axis as real wood.
		lod0WoodBytes: { low: 6 * MB, medium: 6.5 * MB, high: 7.5 * MB, ultra: 9 * MB },
		lod0Triangles: 2_500_000,
		lod1Triangles: 150_000,
		lod2Triangles: 30_000,
		downloadBytes: 1 * MB,
		downloadHalfBytes: 0.35 * MB,
		growMilliseconds: 600,
	},
	palm: {
		kitBytes: 4 * MB,
		variantBytes: { low: 3 * MB, medium: 3 * MB, high: 3 * MB, ultra: 3 * MB },
		lod0WoodBytes: { low: 2 * MB, medium: 2 * MB, high: 2 * MB, ultra: 2 * MB },
		lod0Triangles: 600_000,
		lod1Triangles: 80_000,
		lod2Triangles: 20_000,
		downloadBytes: 1 * MB,
		downloadHalfBytes: 0.35 * MB,
		growMilliseconds: 300,
	},
	ground: {
		kitBytes: 2 * MB,
		// The largest of hosta, pendulous sedge and meadow grass, with about 15 per cent to spare: 1.35,
		// 1.39, 1.44 and 3.30 MB. Hosta's ribs at the finest tier take four columns a vein.
		variantBytes: { low: 1.6 * MB, medium: 1.6 * MB, high: 1.7 * MB, ultra: 3.8 * MB },
		lod0WoodBytes: { low: 0, medium: 0, high: 0, ultra: 0 },
		lod0Triangles: 200_000,
		lod1Triangles: 30_000,
		lod2Triangles: 8_000,
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
	column: 'ground',
};

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
 * @category api/vegetation
 */
export const TWO_ZONE_DOWNLOADS: Readonly<
	Record<string, { readonly downloadBytes: number; readonly downloadHalfBytes: number }>
> = {
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
		['kitBytes', budget.kitBytes, caps.kitBytes],
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
	for (const detail of DETAILS) {
		const value = budget.variantBytes[detail];
		const cap = caps.variantBytes[detail];
		if (value > cap)
			problems.push(
				`lod.budget.variantBytes.${detail} is ${value}, over the cap of ${cap} for a ${record.growth.model} plant`,
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
