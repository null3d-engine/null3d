// Test helpers for a plant built of pieces placed at sockets: the order its rows thin by, the rows
// a sparseness setting keeps, a level's own mesh in metres, and the box its placed pieces fill.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { DETAILS } from '../core/types';
import { dequantisePosition } from '../lod/quantise';
import type { TestMesh } from './body.fixture';

/** A grown plant of pieces with the kit it grew from. */
export interface Placed {
	readonly kit: SpeciesKitData;
	readonly asset: PlantAsset;
}

/** How long each row stays as the plant thins, from its socket: 1 for a row of the least plant. */
export function staying(asset: PlantAsset): number[] {
	const { buds } = asset.skeleton;
	const out: number[] = [];
	for (let b = 0; b < buds.count; b++) if (buds.sockets) out.push(buds.light[b] as number);
	return out;
}

/** The rows a sparseness setting keeps: the least plant's, and an even share of the rest. */
export function keptAt(asset: PlantAsset, sparseness: number): number {
	const stay = staying(asset);
	const least = stay.filter((value) => value === 1).length;
	return least + Math.round((1 - sparseness) * (stay.length - least));
}

/** Where a row stands. */
export function placeOf(asset: PlantAsset, row: number): number[] {
	return [0, 1, 2].map((k) => asset.shoots.position[row * 3 + k] as number);
}

/** The class of piece a row draws. */
export function classOf(grown: Placed, row: number): string {
	return grown.kit.prototypes[grown.asset.shoots.prototype[row] as number]?.piece?.name ?? '';
}

/** The parts of one name that a level draws as its own mesh, in metres. */
export function ownMesh(grown: Placed, level: 0 | 1 | 2, name = 'foliage'): TestMesh {
	const positions: number[] = [];
	const indices: number[] = [];
	const out: [number, number, number] = [0, 0, 0];
	for (const part of grown.asset.levels[level].parts) {
		if (part.name !== name) continue;
		const base = positions.length / 3;
		for (let i = 0; i < part.arrays.positions.length / 3; i++) {
			dequantisePosition(part.arrays.positions, i, grown.kit.box, out);
			positions.push(out[0], out[1], out[2]);
		}
		for (const index of part.arrays.indices) indices.push(base + index);
	}
	return { positions, indices };
}

/** A unit quaternion's turn of a vector. */
export function turned(q: ArrayLike<number>, at: number, v: readonly number[]): number[] {
	const [x, y, z, w] = [
		q[at] as number,
		q[at + 1] as number,
		q[at + 2] as number,
		q[at + 3] as number,
	];
	const [vx, vy, vz] = v as [number, number, number];
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

/** The box the placed pieces fill, in metres: its least and greatest corner. */
export function standing(grown: Placed): {
	low: number;
	top: number;
	min: number[];
	max: number[];
} {
	const { shoots } = grown.asset;
	const tier = DETAILS.indexOf('high');
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (let r = 0; r < shoots.count; r++) {
		const positions = grown.kit.prototypes[shoots.prototype[r] as number]?.tiers[tier]?.positions;
		if (!positions) throw new Error('a row names no prototype');
		const scale = shoots.scale[r] as number;
		for (let i = 0; i < positions.length; i += 3) {
			const p = turned(shoots.rotation, r * 4, [
				positions[i] as number,
				positions[i + 1] as number,
				positions[i + 2] as number,
			]);
			for (let k = 0; k < 3; k++) {
				const at = (shoots.position[r * 3 + k] as number) + (p[k] as number) * scale;
				min[k] = Math.min(min[k] as number, at);
				max[k] = Math.max(max[k] as number, at);
			}
		}
	}
	return { low: min[1] as number, top: max[1] as number, min, max };
}
