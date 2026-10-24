// The crown: the outline that scales a branch by its height, the bounds that a level shares, and the
// occlusion that darkens the leaves inside it. The outline lives here alone, so growth and meshing
// read the same curve.
import type { CrownShape } from './species';

/**
 * The crown's bounds and the data that its shading reads.
 * @category api/vegetation
 */
export interface CrownData {
	/** The crown's outline. */
	readonly shape: CrownShape;
	/** The bounds' smallest corner. */
	readonly min: readonly [number, number, number];
	/** The bounds' largest corner. */
	readonly max: readonly [number, number, number];
	/** The bounds' center. */
	readonly center: readonly [number, number, number];
	/** The radius of the sphere around the center that holds the plant. */
	readonly radius: number;
	/** The height where the crown starts, in meters. */
	readonly start: number;
}

/**
 * The crown outline's value at a height share through the crown, from 0 at its bottom to 1 at its
 * top. Each shape gives a different silhouette, and every branch's length follows it.
 *
 * @param shape The crown outline.
 * @param t The height share through the crown.
 * @returns A value from 0 to 1.
 * @category api/vegetation
 */
export function crownEnvelope(shape: CrownShape, t: number): number {
	const h = Math.min(1, Math.max(0, t));
	switch (shape) {
		case 'conical':
			return 1 - h;
		case 'spherical':
			return Math.sqrt(Math.max(0, 1 - (2 * h - 1) ** 2));
		case 'hemispherical':
			return Math.sqrt(Math.max(0, 1 - h * h));
		case 'cylindrical':
			return h > 0.9 ? (1 - h) / 0.1 : 1;
		case 'tapered':
			return Math.sqrt(1 - h);
		case 'vase':
			return 0.25 + 0.75 * h;
		case 'inverse-conical':
			return h;
		case 'flame':
			return Math.sin(Math.PI * h) ** 0.7;
		case 'weeping':
			return 1;
	}
}

/** The share of a child's length that the crown keeps at its narrowest. */
const CROWN_FLOOR = 0.2;

/**
 * The length scale that the crown gives a branch at a height share through it.
 *
 * @param shape The crown outline.
 * @param spread How strongly the outline holds, from 0.
 * @param t The height share through the crown.
 * @returns A length multiplier.
 * @category api/vegetation
 */
export function crownScale(shape: CrownShape, spread: number, t: number): number {
	const shapeValue = crownEnvelope(shape, t);
	return CROWN_FLOOR + (1 - CROWN_FLOOR) * shapeValue ** (1 + spread);
}

/**
 * How enclosed a point is in the crown, from 0 at its surface to 1 at its axis. The leaf material
 * darkens a leaf by this value, so the crown's inside reads as shade.
 *
 * @param x The point's x.
 * @param y The point's y.
 * @param z The point's z.
 * @param radius The crown's widest horizontal radius.
 * @param start The height where the crown starts.
 * @param height The plant's height.
 * @param shape The crown's outline.
 * @returns A value from 0 to 1.
 * @category api/vegetation
 */
export function crownOcclusion(
	x: number,
	y: number,
	z: number,
	radius: number,
	start: number,
	height: number,
	shape: CrownShape,
): number {
	const t = (y - start) / Math.max(1e-6, height - start);
	const at = radius * (0.35 + 0.65 * crownEnvelope(shape, t));
	const across = Math.hypot(x, z) / Math.max(1e-6, at);
	return Math.min(1, Math.max(0, 1 - across));
}

/**
 * The crown's volume, which growth and meshing share: its widest radius, its start and the plant's
 * height.
 *
 * @category api/vegetation
 */
export interface CrownField {
	/** The crown's widest horizontal radius, in meters. */
	readonly radius: number;
	/** The height where the crown starts, in meters. */
	readonly start: number;
	/** The plant's height, in meters. */
	readonly height: number;
	/** The crown's outline. */
	readonly shape: CrownShape;
}

/**
 * How enclosed a point is in the crown, as the byte that a vertex color holds.
 *
 * @param x The point's x.
 * @param y The point's y.
 * @param z The point's z.
 * @param field The crown's volume.
 * @returns A byte from 0 to 255.
 * @category api/vegetation
 */
export function occlusionByte(x: number, y: number, z: number, field: CrownField): number {
	return Math.round(
		crownOcclusion(x, y, z, field.radius, field.start, field.height, field.shape) * 255,
	);
}

/**
 * The bounds of a set of positions: the smallest and largest corner, their center, and the radius
 * around the center that holds every point.
 *
 * @param positions The points, three numbers each.
 * @returns The bounds.
 * @category api/vegetation
 */
export function boundsOf(positions: ArrayLike<number>): {
	min: [number, number, number];
	max: [number, number, number];
	center: [number, number, number];
	radius: number;
} {
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (let i = 0; i + 2 < positions.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			const value = positions[i + k] as number;
			if (value < (min[k] as number)) min[k] = value;
			if (value > (max[k] as number)) max[k] = value;
		}
	}
	if (!Number.isFinite(min[0]))
		return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 0 };
	const center: [number, number, number] = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	];
	let radius = 0;
	for (let i = 0; i + 2 < positions.length; i += 3) {
		radius = Math.max(
			radius,
			Math.hypot(
				(positions[i] as number) - center[0],
				(positions[i + 1] as number) - center[1],
				(positions[i + 2] as number) - center[2],
			),
		);
	}
	return { min, max, center, radius };
}
