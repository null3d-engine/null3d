// Test helpers for the rule that every level is the same plant in size: the box of a level's
// foliage as a camera sees it. At the nearest level that is every vertex of every shoot row's
// prototype, placed, or of a merged plant's foliage mesh. At a card level it is the part of each
// card that its picture covers, the texels of at least half cover, and never the card's clear
// margin. The box is read from the level's own meshes and the kit's atlas, not from the code that
// places the cards. Only the tests import this file.
import type { PlantAsset, SpeciesKitData } from '../asset';
import { quatRotate, type Vector3 } from '../core/math';
import { DETAILS } from '../core/types';
import { dequantisePosition } from './quantise';

/** A box in plant space. */
export interface Box {
	readonly min: [number, number, number];
	readonly max: [number, number, number];
}

/** Texels of the card atlas with at least this coverage are the picture. */
const HALF_COVER = 128;

/** A box that holds nothing yet. */
function emptyBox(): Box {
	return {
		min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
		max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
	};
}

/** Widens a box to hold a point. */
function hold(box: Box, x: number, y: number, z: number): void {
	const p = [x, y, z];
	for (let k = 0; k < 3; k++) {
		if ((p[k] as number) < (box.min[k] as number)) box.min[k as 0] = p[k] as number;
		if ((p[k] as number) > (box.max[k] as number)) box.max[k as 0] = p[k] as number;
	}
}

/**
 * The box of one level's foliage: its shoot rows' own meshes at the nearest level of a plant with
 * rows, its foliage mesh on a merged plant, and the pictured part of its cards at a card level.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param level The level.
 * @returns The box.
 */
export function foliageBox(kit: SpeciesKitData, asset: PlantAsset, level: 0 | 1 | 2): Box {
	const box = emptyBox();
	const point: [number, number, number] = [0, 0, 0];
	if (level === 0 && asset.shoots.count > 0) {
		const rows = asset.shoots;
		const tier = DETAILS.indexOf(kit.detail);
		const from: Vector3 = [0, 0, 0];
		const to: Vector3 = [0, 0, 0];
		for (let r = 0; r < rows.count; r++) {
			const positions = kit.prototypes[rows.prototype[r] as number]?.tiers[tier]?.positions;
			if (!positions) continue;
			const scale = rows.scale[r] as number;
			for (let i = 0; i < positions.length; i += 3) {
				from[0] = (positions[i] as number) * scale;
				from[1] = (positions[i + 1] as number) * scale;
				from[2] = (positions[i + 2] as number) * scale;
				quatRotate(rows.rotation, r * 4, from, to);
				hold(
					box,
					to[0] + (rows.position[r * 3] as number),
					to[1] + (rows.position[r * 3 + 1] as number),
					to[2] + (rows.position[r * 3 + 2] as number),
				);
			}
		}
		return box;
	}
	const atlas = kit.cards.size;
	const alpha = kit.cards.color;
	// The edge of the picture in each atlas cell a card names, as shares of the cell: for each row
	// of texels, the left side of its first texel of half cover and the right side of its last.
	// The box of these points is the box of the picture. Found once a cell.
	const pictured = new Map<string, readonly (readonly [number, number])[]>();
	for (const part of asset.levels[level].parts) {
		const arrays = part.arrays;
		if (part.name === 'foliage') {
			for (let i = 0; i < arrays.positions.length / 3; i++) {
				dequantisePosition(arrays.positions, i, kit.box, point);
				hold(box, point[0], point[1], point[2]);
			}
			continue;
		}
		if (part.name !== 'cards') continue;
		const corners: [number, number, number][] = [];
		// A card is four vertices in turn: its corners at (0, 0), (1, 0), (1, 1) and (0, 1) of its
		// cell. A stalk is a line with no picture, and it names itself in its second coordinate.
		for (let v = 0; v + 3 < arrays.positions.length / 3; v += 4) {
			if (Math.abs((arrays.uvs1[v * 2 + 1] as number) / 65535 - 0.75) < 0.01) continue;
			corners.length = 0;
			for (let k = 0; k < 4; k++) {
				dequantisePosition(arrays.positions, v + k, kit.box, point);
				corners.push([point[0], point[1], point[2]]);
			}
			const u0 = (arrays.uvs[v * 2] as number) / 65535;
			const v0 = (arrays.uvs[v * 2 + 1] as number) / 65535;
			const u1 = (arrays.uvs[(v + 2) * 2] as number) / 65535;
			const v1 = (arrays.uvs[(v + 2) * 2 + 1] as number) / 65535;
			const key = `${u0},${v0},${u1},${v1}`;
			let edge = pictured.get(key);
			if (edge === undefined) {
				const points: [number, number][] = [];
				if (atlas > 0) {
					const x0 = Math.round(u0 * atlas);
					const y0 = Math.round(v0 * atlas);
					const w = Math.round((u1 - u0) * atlas);
					const h = Math.round((v1 - v0) * atlas);
					for (let j = 0; j < h; j++) {
						let left = -1;
						let right = -1;
						for (let i = 0; i < w; i++) {
							if ((alpha[((y0 + j) * atlas + x0 + i) * 4 + 3] as number) < HALF_COVER) continue;
							if (left < 0) left = i;
							right = i;
						}
						if (left < 0) continue;
						for (const t of [j / h, (j + 1) / h]) points.push([left / w, t], [(right + 1) / w, t]);
					}
				} else points.push([0, 0], [1, 0], [1, 1], [0, 1]);
				edge = points;
				pictured.set(key, edge);
			}
			const [a, b, c, d] = corners as unknown as [number[], number[], number[], number[]];
			for (const [s, t] of edge) {
				const at = [0, 1, 2].map(
					(k) =>
						(1 - s) * (1 - t) * (a[k] as number) +
						s * (1 - t) * (b[k] as number) +
						s * t * (c[k] as number) +
						(1 - s) * t * (d[k] as number),
				);
				hold(box, at[0] as number, at[1] as number, at[2] as number);
			}
		}
	}
	return box;
}
