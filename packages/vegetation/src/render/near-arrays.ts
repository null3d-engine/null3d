// The near task's arrays of one placed species, made at setup from its kit, its variants and its
// copies: each copy's place and turn, each variant's rows and crown, each prototype's bound and
// triangles per tier, and the distance bands of the leaf mesh tiers inside the split. The file holds
// no engine import, so the page, the job worker's tests and Bun all make the same arrays.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { DETAILS, type Detail } from '../core/types';
import { switchSizes } from '../lod/levels';
import {
	COPY_FLOATS,
	GROUP,
	GROUP_FLOATS,
	type GroupArrays,
	MAX_TIERS,
	type NearScene,
	PROTOTYPE_FLOATS,
	ROW_FLOATS,
	ROW_WORDS,
	VARIANT_FLOATS,
} from './near-task';

/** Where copies stand, as `placePlants` takes them. */
export interface CopyRows {
	readonly count: number;
	readonly position: Float32Array;
	readonly turn: Float32Array;
	readonly scale: Float32Array;
	readonly variant: Uint8Array;
}

/** One distance band of a leaf mesh tier: the tier, and the distances it draws between. */
export interface TierBand {
	readonly tier: number;
	readonly start: number;
	readonly end: number;
}

/** The share of a draw range's edge over which the engine dithers it. */
export const EDGE = 1.08;
/** The share past the split where the last band of shoot rows ends, as the near task reads it. */
export const SPLIT_REACH = 1.04;

/**
 * The distance bands of the leaf mesh tiers inside a split: the pool's tier nearest the camera, then
 * each tier below it, at most three. A band starts where the one before it is about to thin, less
 * its own fade, so the two overlap and no row drops out of both. The nearest band ends at a quarter
 * of the split and the next at half, so most of the band's ground draws the coarsest tier.
 *
 * @param detail The tier of the nearest band.
 * @param split The split distance in metres.
 * @returns The bands, nearest first.
 */
export function tierBands(detail: Detail, split: number): readonly TierBand[] {
	const top = DETAILS.indexOf(detail);
	const count = Math.min(MAX_TIERS, top + 1);
	const ends =
		count === 1
			? [split * SPLIT_REACH]
			: count === 2
				? [split / 2, split * SPLIT_REACH]
				: [split / 4, split / 2, split * SPLIT_REACH];
	return ends.map((end, k) => ({
		tier: top - k,
		start: k === 0 ? 0 : (ends[k - 1] as number) / (EDGE * EDGE),
		end,
	}));
}

/** One placed species as the near task's scene lays it out. */
export interface NearGroup {
	/** Its near table, by index among the scene's tables, and the table's first slot it may take. */
	readonly table: number;
	readonly firstSlot: number;
	/** Its split distance and tier bands. */
	readonly split: number;
	readonly bands: readonly TierBand[];
	/** Its arrays, and the copies, variants and prototypes in them. */
	readonly arrays: GroupArrays;
	readonly copies: number;
	readonly variants: number;
	readonly prototypes: number;
	/** Each batch's capacity, prototype `p`'s band `k` at `p * bands + k`; 0 where it has none. */
	readonly capacities: readonly number[];
	/** Card rows across its variants. */
	readonly cardRows: number;
}

/**
 * The near task's scene: every species' block, with its batches in one table, each batch's rows
 * after the one before it in the output, and each species' card rows after the one before it.
 *
 * @param groups The placed species.
 * @param tables The near tables they name.
 * @returns The scene.
 */
export function nearScene(groups: readonly NearGroup[], tables: number): NearScene {
	const blocks = new Float64Array(groups.length * GROUP_FLOATS);
	const capacities: number[] = [];
	let cards = 0;
	groups.forEach((s, g) => {
		const at = g * GROUP_FLOATS;
		blocks[at + GROUP.split] = s.split;
		blocks[at + GROUP.tierCount] = s.bands.length;
		s.bands.forEach((band, k) => {
			blocks[at + GROUP.tier + k] = band.tier;
			blocks[at + GROUP.bandStart + k] = band.start;
			blocks[at + GROUP.bandEnd + k] = band.end;
		});
		blocks[at + GROUP.copyCount] = s.copies;
		blocks[at + GROUP.cardBase] = cards;
		blocks[at + GROUP.variantCount] = s.variants;
		blocks[at + GROUP.prototypeCount] = s.prototypes;
		blocks[at + GROUP.batchBase] = capacities.length;
		blocks[at + GROUP.table] = s.table;
		blocks[at + GROUP.firstSlot] = s.firstSlot;
		capacities.push(...s.capacities);
		cards += s.cardRows;
	});
	const batches = new Uint32Array(capacities.length * 2);
	let rows = 0;
	capacities.forEach((capacity, b) => {
		batches[b * 2] = rows;
		batches[b * 2 + 1] = capacity;
		rows += capacity;
	});
	return { groups: blocks, arrays: groups.map((s) => s.arrays), batches, rows, tables, cards };
}

/**
 * The most rows of each prototype that any one variant holds, which sizes the shoot batches.
 *
 * @param prototypes The kit's prototypes.
 * @param assets The grown variants.
 * @returns One count per prototype.
 */
export function mostRows(prototypes: number, assets: readonly PlantAsset[]): Uint32Array {
	const most = new Uint32Array(prototypes);
	const each = new Uint32Array(prototypes);
	for (const asset of assets) {
		each.fill(0);
		const shoots = asset.shoots;
		for (let r = 0; r < shoots.count; r++) {
			const p = shoots.prototype[r] as number;
			if (p < prototypes) each[p] = (each[p] as number) + 1;
		}
		for (let p = 0; p < prototypes; p++) most[p] = Math.max(most[p] as number, each[p] as number);
	}
	return most;
}

/**
 * The triangles that one copy's shoot rows draw inside the near band for an eye at a point of the
 * copy's own plant space: every row whose bound's nearest point lies inside a tier band, at that
 * band's tier, counted once for each band it stands in. The engine draws the same rows, since the
 * bands are the shoot batches' draw ranges.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param eye The eye in the copy's plant space, at scale 1.
 * @param bands The tier bands.
 * @returns The triangles and the rows drawn.
 */
export function bandTriangles(
	kit: SpeciesKitData,
	asset: PlantAsset,
	eye: readonly [number, number, number],
	bands: readonly TierBand[],
): { readonly triangles: number; readonly rows: number } {
	const s = asset.shoots;
	let triangles = 0;
	let rows = 0;
	for (let r = 0; r < s.count; r++) {
		const prototype = kit.prototypes[s.prototype[r] as number];
		if (!prototype) continue;
		const dx = (s.position[r * 3] as number) - eye[0];
		const dy = (s.position[r * 3 + 1] as number) - eye[1];
		const dz = (s.position[r * 3 + 2] as number) - eye[2];
		const distance = Math.max(
			0,
			Math.sqrt(dx * dx + dy * dy + dz * dz) - prototype.radius * (s.scale[r] as number),
		);
		let drawn = false;
		for (const band of bands)
			if (distance >= band.start && distance <= band.end) {
				triangles += (prototype.tiers[band.tier]?.indices.length ?? 0) / 3;
				drawn = true;
			}
		if (drawn) rows++;
	}
	return { triangles, rows };
}

/**
 * The near task's arrays of one placed species.
 *
 * @param kit The species' kit.
 * @param assets The grown variants.
 * @param copies Where the copies stand.
 * @param cardRows Each copy's row in its variant's card batch, counted across the variants.
 * @returns The arrays, in the task's order.
 */
export function nearArrays(
	kit: SpeciesKitData,
	assets: readonly PlantAsset[],
	copies: CopyRows,
	cardRows: Uint32Array,
): GroupArrays {
	const prototypeFloats = new Float32Array(kit.prototypes.length * PROTOTYPE_FLOATS);
	kit.prototypes.forEach((prototype, p) => {
		prototypeFloats[p * PROTOTYPE_FLOATS] = prototype.radius;
		prototype.tiers.forEach((tier, t) => {
			prototypeFloats[p * PROTOTYPE_FLOATS + 1 + t] = tier.indices.length / 3;
		});
	});
	const copyFloats = new Float32Array(copies.count * COPY_FLOATS);
	for (let c = 0; c < copies.count; c++) {
		const turn = copies.turn[c] as number;
		const at = c * COPY_FLOATS;
		copyFloats[at] = copies.position[c * 3] as number;
		copyFloats[at + 1] = copies.position[c * 3 + 1] as number;
		copyFloats[at + 2] = copies.position[c * 3 + 2] as number;
		copyFloats[at + 3] = turn;
		copyFloats[at + 4] = Math.cos(turn);
		copyFloats[at + 5] = Math.sin(turn);
		copyFloats[at + 6] = Math.sin(turn / 2);
		copyFloats[at + 7] = Math.cos(turn / 2);
		copyFloats[at + 8] = copies.scale[c] as number;
		copyFloats[at + 9] = copies.variant[c] as number;
	}
	// A copy is chosen by the sphere round its crown that holds every shoot.
	const reach = switchSizes(kit).shoot;
	let total = 0;
	for (const asset of assets) total += asset.shoots.count;
	const variants = new Float32Array(assets.length * VARIANT_FLOATS);
	const rowFloats = new Float32Array(total * ROW_FLOATS);
	const rowWords = new Uint32Array(total * ROW_WORDS);
	let first = 0;
	assets.forEach((asset, v) => {
		const s = asset.shoots;
		const c = asset.crown.centre;
		const at = v * VARIANT_FLOATS;
		variants[at] = first;
		variants[at + 1] = s.count;
		variants[at + 2] = asset.wind.base;
		variants[at + 3] = c[0];
		variants[at + 4] = c[1];
		variants[at + 5] = c[2];
		variants[at + 6] = asset.crown.radius + reach;
		for (let r = 0; r < s.count; r++) {
			const f = (first + r) * ROW_FLOATS;
			for (let k = 0; k < 3; k++) rowFloats[f + k] = s.position[r * 3 + k] as number;
			for (let k = 0; k < 4; k++) rowFloats[f + 3 + k] = s.rotation[r * 4 + k] as number;
			rowFloats[f + 7] = s.scale[r] as number;
			const w = (first + r) * ROW_WORDS;
			rowWords[w] = ((s.prototype[r] as number) & 255) | (((s.record[r] as number) & 0xffff) << 8);
			rowWords[w + 1] =
				(s.phase[r] as number) | ((s.sky[r] as number) << 8) | ((s.bent[r] as number) << 16);
		}
		first += s.count;
	});
	return [copyFloats, cardRows, variants, rowFloats, rowWords, prototypeFloats];
}
