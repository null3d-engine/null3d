// The crown's leaf area density: each shoot row's leaf area splatted into a grid over the plant, so
// the crown's light can count how much leaf lies between any point and the sky.
import { crownPrototypes, type ShootRows } from '../asset';
import { BUD_TERMINAL } from '../core/graph';
import { quatRotate, type Vector3 } from '../core/math';
import type { Foliage } from '../core/record';
import { spreadMean, type Vec3 } from '../core/types';
import type { DressInput } from '../stages';

/** Cells across the grid's longest side. */
export const DENSITY_CELLS = 40;
/**
 * Cells across the grid's longest side for a plant whose nearest foliage is merged: a ground plant
 * a metre or two across, whose light needs no finer cells, and whose growth stays within its cap.
 */
export const MERGED_DENSITY_CELLS = 20;

/**
 * Leaf area per cubic metre over a plant.
 */
export interface LeafDensity {
	/** Cells along x, y and z. */
	readonly cells: readonly [number, number, number];
	/** The grid's lowest corner in plant space. */
	readonly min: Vec3;
	/** A cell's edge in metres. */
	readonly cell: number;
	/** Square metres of leaf per cubic metre, per cell: x fastest, then y, then z. */
	readonly density: Float32Array;
}

/**
 * The one-sided area of one leaf, needle, blade or leaf group in square metres, from the record's
 * foliage: a blade fills about half the square of its length; a compound leaf counts its leaflets.
 *
 * @param foliage The record's foliage.
 * @returns The area.
 */
export function leafArea(foliage: Foliage): number {
	switch (foliage.kind) {
		case 'blade': {
			const length = spreadMean(foliage.leaf.length);
			const one = 0.5 * length * length;
			return foliage.compound ? one * Math.max(1, spreadMean(foliage.compound.leaflets)) : one;
		}
		case 'needle':
			return spreadMean(foliage.needle.length) * foliage.needle.width;
		case 'fascicle':
			return spreadMean(foliage.needle.length) * foliage.needle.width * 2;
		case 'scale-spray':
			return foliage.spray.segment * foliage.spray.radius * 4;
		case 'grass-blade':
			return spreadMean(foliage.blade.length) * foliage.blade.width;
		case 'thick': {
			// A broad heart-shaped blade fills a little over half the square of its length.
			const length = spreadMean(foliage.leaf.length);
			return 0.6 * length * length;
		}
		default:
			return 0;
	}
}

/**
 * The centre of a shoot row's leaves: half its prototype's length out along its direction.
 *
 * @param rows The shoot rows.
 * @param row The row.
 * @param length The prototype's length at scale 1, in metres.
 * @param out The point to write.
 * @returns `out`.
 */
export function rowCentre(rows: ShootRows, row: number, length: number, out: Vector3): Vector3 {
	const reach = 0.5 * length * (rows.scale[row] as number);
	quatRotate(rows.rotation, row * 4, [0, reach, 0], out);
	out[0] += rows.position[row * 3] as number;
	out[1] += rows.position[row * 3 + 1] as number;
	out[2] += rows.position[row * 3 + 2] as number;
	return out;
}

/** The length of one leaf, blade or leaf group of a record's foliage, in metres. */
function leafLength(foliage: Foliage): number {
	switch (foliage.kind) {
		case 'blade':
		case 'thick':
			return spreadMean(foliage.leaf.length);
		case 'grass-blade':
			return spreadMean(foliage.blade.length);
		case 'needle':
		case 'fascicle':
			return spreadMean(foliage.needle.length);
		default:
			return 0;
	}
}

/** Adds an area at a point into the eight cells round it. */
function splat(
	density: Float32Array,
	cells: readonly [number, number, number],
	low: Readonly<Vector3>,
	cell: number,
	at: Readonly<Vector3>,
	area: number,
): void {
	const [nx, ny, nz] = cells;
	const volume = cell * cell * cell;
	const fx = (at[0] - low[0]) / cell - 0.5;
	const fy = (at[1] - low[1]) / cell - 0.5;
	const fz = (at[2] - low[2]) / cell - 0.5;
	const i0 = Math.floor(fx);
	const j0 = Math.floor(fy);
	const l0 = Math.floor(fz);
	const wx = fx - i0;
	const wy = fy - j0;
	const wz = fz - l0;
	for (let c = 0; c < 8; c++) {
		const i = i0 + (c & 1);
		const j = j0 + ((c >> 1) & 1);
		const l = l0 + ((c >> 2) & 1);
		if (i < 0 || j < 0 || l < 0 || i >= nx || j >= ny || l >= nz) continue;
		const w = (c & 1 ? wx : 1 - wx) * (c & 2 ? wy : 1 - wy) * (c & 4 ? wz : 1 - wz);
		const k = (l * ny + j) * nx + i;
		density[k] = (density[k] as number) + (w * area) / volume;
	}
}

/**
 * The leaf area density of a dressed plant: a grid over its skeleton and its shoots, into which
 * each row's leaf area goes, shared among the eight cells round its centre. A plant whose nearest
 * foliage is merged has no rows: each terminal bud site of it stands for one leaf or blade from that
 * site, whose area goes in half a leaf out along the bud's direction.
 *
 * @param input The grown skeleton, the kit and the record.
 * @param rows The shoot rows.
 * @returns The grid.
 */
export function leafDensity(input: DressInput, rows: ShootRows): LeafDensity {
	const { skeleton, kit, record } = input;
	let reach = 0;
	for (const prototype of crownPrototypes(kit.prototypes))
		reach = Math.max(reach, prototype.length);
	let largest = 0;
	for (let r = 0; r < rows.count; r++) largest = Math.max(largest, rows.scale[r] as number);
	if (record.lod.nearFoliage === 'merged') reach = Math.max(reach, leafLength(record.foliage));
	const margin = reach * Math.max(1, largest) + 0.01;
	const { min, max } = skeleton.bounds;
	const low: Vector3 = [min[0] - margin, Math.max(0, min[1] - margin), min[2] - margin];
	const size = [max[0] + margin - low[0], max[1] + margin - low[1], max[2] + margin - low[2]];
	const across = record.lod.nearFoliage === 'merged' ? MERGED_DENSITY_CELLS : DENSITY_CELLS;
	const cell = Math.max(size[0] as number, size[1] as number, size[2] as number, 0.01) / across;
	const nx = Math.max(1, Math.ceil((size[0] as number) / cell));
	const ny = Math.max(1, Math.ceil((size[1] as number) / cell));
	const nz = Math.max(1, Math.ceil((size[2] as number) / cell));
	const density = new Float32Array(nx * ny * nz);
	const cells = [nx, ny, nz] as const;
	const leaf = leafArea(record.foliage);
	const centre: Vector3 = [0, 0, 0];
	if (record.lod.nearFoliage === 'merged' && leaf > 0) {
		const buds = skeleton.buds;
		const half = 0.5 * leafLength(record.foliage);
		for (let b = 0; b < buds.count; b++) {
			if ((buds.kind[b] as number) !== BUD_TERMINAL) continue;
			quatRotate(buds.frame, b * 4, [0, half, 0], centre);
			centre[0] += buds.position[b * 3] as number;
			centre[1] += buds.position[b * 3 + 1] as number;
			centre[2] += buds.position[b * 3 + 2] as number;
			splat(density, cells, low, cell, centre, leaf);
		}
	}
	for (let r = 0; r < rows.count; r++) {
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		const scale = rows.scale[r] as number;
		const area = prototype.leaves * leaf * scale * scale;
		if (area <= 0) continue;
		rowCentre(rows, r, prototype.length, centre);
		splat(density, cells, low, cell, centre, area);
	}
	return { cells: [nx, ny, nz], min: [low[0], low[1], low[2]], cell, density };
}
