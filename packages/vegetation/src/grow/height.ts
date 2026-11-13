// A record's height target means the drawn plant's top, not its wood: the grown skeleton and the
// shoot placement are scaled together so the highest card of the drawn level stands at the sampled
// target. A uniform scale leaves the crown's base share and the plant's aspect as they were, which
// the target already governs as shares.
//
// The drawn level is the first card level, which the review measures a plant from: its cards grow
// about their centres by the record's growth, so they stand above the nearest foliage. A measure of
// the nearest shoots would leave the reviewed plant a little short of the target.
//
// The scale is applied before the crown's light grid, so a cell of the shadow pyramid keeps one
// meaning whatever the target is. The crown's reach is estimated from the kit before the light; the
// stage measures the drawn top after the placement and records the residual, and a residual over
// half a per cent is taken out by one corrective scale of the already-placed geometry.
import type { ShootRows, SpeciesKitData } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { unitAt } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import type { Species } from '../core/record';
import { curveAt, spreadAt, spreadMax } from '../core/types';
import { CARD_CORNERS } from '../lod/cards';

/** The card of one prototype: its centre and half-extents, as the card level builds it. */
type Card = SpeciesKitData['prototypes'][number]['card'];

/** The hash purpose each grower draws its height with. */
const HEIGHT_PURPOSE = 1;

/** The residual the stage accepts without a corrective scale. */
export const HEIGHT_RESIDUAL = 0.005;

/**
 * The height the record asks for this seed and variant, in metres: the drawn plant's top.
 *
 * @param record The record the plant grows from.
 * @param seed The seed.
 * @param variant The variant.
 * @returns The target height.
 * @category api/vegetation
 */
export function targetHeight(record: Species, seed: number, variant: number): number {
	return spreadAt(record.size.height, unitAt(seed, record.seedSalt >>> 0, variant, HEIGHT_PURPOSE));
}

/** A prototype card's highest corner above its shoot, in prototype metres. */
function cardReach(card: Card): number {
	let top = 0;
	for (const plane of card.planes) {
		const y = plane.centre[1] + Math.abs(plane.right[1]) + Math.abs(plane.up[1]);
		if (y > top) top = y;
	}
	return top;
}

/**
 * The crown's added height above the wood, estimated from the kit: the tallest card's corner, the
 * largest placement scale and the height curve's top. The topmost row's own rotation may tilt it, so
 * this is an upper bound and the residual measure corrects the difference.
 *
 * @param kit The species' kit.
 * @param record The record the plant grows from.
 * @returns The crown's reach in metres.
 * @category api/vegetation
 */
export function crownReach(kit: SpeciesKitData, record: Species): number {
	const placement = record.shoots?.placement;
	if (!placement) return 0;
	let local = 0;
	for (const prototype of kit.prototypes) {
		if (prototype.cutting) continue;
		const reach = cardReach(prototype.card);
		if (reach > local) local = reach;
	}
	const curve = placement.scaleByHeight === undefined ? 1 : curveAt(placement.scaleByHeight, 1);
	return local * spreadMax(placement.scale) * curve;
}

/** The highest point of one shoot row's cards, in metres. */
function rowTop(kit: SpeciesKitData, rows: ShootRows, r: number): number {
	const prototype = kit.prototypes[rows.prototype[r] as number];
	if (!prototype) return Number.NEGATIVE_INFINITY;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	const scale = rows.scale[r] as number;
	const y = rows.position[r * 3 + 1] as number;
	let top = Number.NEGATIVE_INFINITY;
	for (const plane of prototype.card.planes) {
		for (const [sx, sy] of CARD_CORNERS) {
			for (let c = 0; c < 3; c++)
				local[c] =
					(plane.centre[c] as number) +
					sx * (plane.right[c] as number) +
					sy * (plane.up[c] as number);
			local[0] *= scale;
			local[1] *= scale;
			local[2] *= scale;
			quatRotate(rows.rotation, r * 4, local, world);
			if (y + (world[1] as number) > top) top = y + (world[1] as number);
		}
	}
	return top;
}

/**
 * The highest point of the drawn card level, in metres: every shoot's card planes at the shoot's
 * own size, turned and placed as the shoot places them.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @returns The card level's top.
 * @category api/vegetation
 */
export function cardTop(kit: SpeciesKitData, rows: ShootRows): number {
	let top = 0;
	for (let r = 0; r < rows.count; r++) top = Math.max(top, rowTop(kit, rows, r));
	return top;
}

/**
 * The shoot row whose cards reach highest, which holds the drawn top of the card level.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @returns The row, or -1 when no row draws a card.
 */
export function topRow(kit: SpeciesKitData, rows: ShootRows): number {
	let best = -1;
	let top = Number.NEGATIVE_INFINITY;
	for (let r = 0; r < rows.count; r++) {
		const reach = rowTop(kit, rows, r);
		if (reach > top) {
			top = reach;
			best = r;
		}
	}
	return best;
}

/** The record with its shoot placement scaled by `factor`, so the crown scales with the wood. */
export function scaledPlacement(record: Species, factor: number): Species {
	const shoots = record.shoots;
	if (!shoots) return record;
	const scale = shoots.placement.scale;
	const mean = typeof scale === 'number' ? scale : scale.mean;
	const spread = typeof scale === 'number' ? 0 : scale.spread;
	return {
		...record,
		shoots: {
			...shoots,
			placement: { ...shoots.placement, scale: { mean: mean * factor, spread: spread * factor } },
		},
	};
}

/** The skeleton with every position, radius and length scaled by `factor`. */
export function scaledSkeleton(skeleton: MacroSkeleton, factor: number): MacroSkeleton {
	return {
		...skeleton,
		position: skeleton.position.map((value) => value * factor),
		radius: skeleton.radius.map((value) => value * factor),
		bounds: {
			min: skeleton.bounds.min.map((value) => value * factor) as [number, number, number],
			max: skeleton.bounds.max.map((value) => value * factor) as [number, number, number],
		},
		height: skeleton.height * factor,
		crownBase: skeleton.crownBase * factor,
		axes: { ...skeleton.axes, barkV: skeleton.axes.barkV.map((value) => value * factor) },
		buds: {
			...skeleton.buds,
			position: skeleton.buds.position.map((value) => value * factor),
			woodRadius: skeleton.buds.woodRadius.map((value) => value * factor),
		},
	};
}

/**
 * The skeleton scaled by `factor` with the pieces at its sockets scaled with it, for a plant that is
 * its pieces, such as a tuft or a frond colony, whose size is the plant's own.
 */
export function scaledWithPieces(skeleton: MacroSkeleton, factor: number): MacroSkeleton {
	const scaled = scaledSkeleton(skeleton, factor);
	const sockets = scaled.buds.sockets;
	return sockets
		? {
				...scaled,
				buds: {
					...scaled.buds,
					sockets: { ...sockets, scale: sockets.scale.map((value) => value * factor) },
				},
			}
		: scaled;
}

/** The shoot rows with every position, scale and stalk vector scaled by `factor`. */
export function scaledRows(rows: ShootRows, factor: number): ShootRows {
	return {
		...rows,
		position: rows.position.map((value) => value * factor),
		scale: rows.scale.map((value) => value * factor),
		...(rows.back ? { back: rows.back.map((value) => value * factor) } : {}),
	};
}
