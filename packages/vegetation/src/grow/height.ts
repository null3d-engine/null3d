// A record's height target means the drawn plant's top, not its wood: the grown skeleton and the
// shoot placement are scaled together so the foliage's highest point stands at the sampled target.
// A uniform scale leaves the crown's base share and the plant's aspect as they were, which the
// target already governs as shares.
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
import { curveAt, DETAILS, spreadAt, spreadMax } from '../core/types';

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

/**
 * The crown's added height above the wood, estimated from the kit: the tallest shoot prototype's
 * local top, the largest placement scale and the height curve's top. The topmost row's own rotation
 * may tilt it, so this is an upper bound and the residual measure corrects the difference.
 *
 * @param kit The species' kit.
 * @param record The record the plant grows from.
 * @returns The crown's reach in metres.
 * @category api/vegetation
 */
export function crownReach(kit: SpeciesKitData, record: Species): number {
	const placement = record.shoots?.placement;
	if (!placement) return 0;
	const tier = Math.max(0, DETAILS.indexOf(kit.detail));
	let local = 0;
	for (const prototype of kit.prototypes) {
		if (prototype.cutting) continue;
		const positions = prototype.tiers[tier]?.positions;
		if (!positions) continue;
		for (let i = 1; i < positions.length; i += 3)
			if ((positions[i] as number) > local) local = positions[i] as number;
	}
	const curve = placement.scaleByHeight === undefined ? 1 : curveAt(placement.scaleByHeight, 1);
	return local * spreadMax(placement.scale) * curve;
}

/** The highest point of the instanced foliage at the kit's tier, in metres. */
export function foliageTop(kit: SpeciesKitData, rows: ShootRows): number {
	const tier = Math.max(0, DETAILS.indexOf(kit.detail));
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	let top = 0;
	for (let r = 0; r < rows.count; r++) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		const positions = prototype.tiers[tier]?.positions;
		if (!positions) continue;
		const scale = rows.scale[r] as number;
		const y = rows.position[r * 3 + 1] as number;
		for (let i = 0; i < positions.length; i += 3) {
			local[0] = (positions[i] as number) * scale;
			local[1] = (positions[i + 1] as number) * scale;
			local[2] = (positions[i + 2] as number) * scale;
			quatRotate(rows.rotation, r * 4, local, world);
			if (y + world[1] > top) top = y + world[1];
		}
	}
	return top;
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

/** The shoot rows with every position, scale and stalk vector scaled by `factor`. */
export function scaledRows(rows: ShootRows, factor: number): ShootRows {
	return {
		...rows,
		position: rows.position.map((value) => value * factor),
		scale: rows.scale.map((value) => value * factor),
		...(rows.back ? { back: rows.back.map((value) => value * factor) } : {}),
	};
}
