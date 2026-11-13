// Test helpers for the rule that every level is the same plant in size. The box of a level's
// foliage as a camera sees it: at the nearest level, every vertex of every shoot row's prototype,
// placed, or of a merged plant's foliage mesh; at a card level, the part of each card that its
// picture covers, the texels of at least half cover, and never the card's clear margin. And a
// matte of one level drawn on the CPU from two sides, with the share of sky inside the plant's
// outline. Each is read from the level's own meshes and the kit's atlas, not from the code that
// places the cards. Only the tests import this file.
import type { PlantAsset, PlantPart, SpeciesKitData } from '../asset';
import { quatRotate, type Vector3 } from '../core/math';
import { DETAILS } from '../core/types';
import { dequantisePosition } from './quantise';
import { rasterise, rasterTarget } from './raster';

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
 * Calls back with each shoot row's prototype at the kit's tier, placed in plant space: the row's
 * leaf form itself.
 */
function eachPlacedShoot(
	kit: SpeciesKitData,
	asset: PlantAsset,
	each: (positions: Float32Array, indices: Uint16Array) => void,
): void {
	const rows = asset.shoots;
	const tier = DETAILS.indexOf(kit.detail);
	const from: Vector3 = [0, 0, 0];
	const to: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const arrays = kit.prototypes[rows.prototype[r] as number]?.tiers[tier];
		if (!arrays) continue;
		const scale = rows.scale[r] as number;
		const placed = new Float32Array(arrays.positions.length);
		for (let i = 0; i < placed.length; i += 3) {
			from[0] = (arrays.positions[i] as number) * scale;
			from[1] = (arrays.positions[i + 1] as number) * scale;
			from[2] = (arrays.positions[i + 2] as number) * scale;
			quatRotate(rows.rotation, r * 4, from, to);
			placed[i] = to[0] + (rows.position[r * 3] as number);
			placed[i + 1] = to[1] + (rows.position[r * 3 + 1] as number);
			placed[i + 2] = to[2] + (rows.position[r * 3 + 2] as number);
		}
		each(placed, arrays.indices);
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
		eachPlacedShoot(kit, asset, (positions) => {
			for (let i = 0; i < positions.length; i += 3)
				hold(box, positions[i] as number, positions[i + 1] as number, positions[i + 2] as number);
		});
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

/** A matte of a plant from two sides: the front view's pixels, then the side view's. */
export interface OutlineMatte {
	/** Pixels along each side of each view. */
	readonly size: number;
	/** One byte per pixel, 1 where the plant covers it. */
	readonly covered: Uint8Array;
}

/** The margin round the skeleton's bounds, as a share of their longest side. */
const FRAME_MARGIN = 0.2;

/**
 * The matte of one level of a grown variant, from the front and from the side, in a frame that
 * holds the plant's skeleton and a margin for its foliage. A wood, foliage or extras triangle
 * covers its pixels; a leaf card covers the pixels of at least half cover in its atlas cell. The
 * nearest level's shoot rows are drawn as the triangles of each row's prototype at the kit's tier,
 * the plant's leaf form itself.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param level The level.
 * @param size Pixels along each side of each view.
 * @returns The matte.
 */
export function outlineMatte(
	kit: SpeciesKitData,
	asset: PlantAsset,
	level: 0 | 1 | 2,
	size = 128,
): OutlineMatte {
	const covered = new Uint8Array(size * size * 2);
	const bounds = asset.skeleton.bounds;
	const reach = Math.max(
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	);
	const span = reach * (1 + 2 * FRAME_MARGIN);
	const min = [0, 1, 2].map(
		(k) => ((bounds.min[k] as number) + (bounds.max[k] as number)) / 2 - span / 2,
	);
	min[1] = bounds.min[1] - reach * FRAME_MARGIN;
	const scale = size / span;
	const atlas = kit.cards.size;
	const alpha = kit.cards.color;
	const targets = [rasterTarget(size, size), rasterTarget(size, size)];
	/** Draws triangles into both views; `uvs` names the atlas texel of each corner of a card. */
	const draw = (
		positions: ArrayLike<number>,
		indices: ArrayLike<number>,
		uvs?: ArrayLike<number>,
	): void => {
		const count = positions.length / 3;
		for (let view = 0; view < 2; view++) {
			const across = view === 0 ? 0 : 2;
			const points = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				points[i * 3] = ((positions[i * 3 + across] as number) - (min[across] as number)) * scale;
				points[i * 3 + 1] = ((positions[i * 3 + 1] as number) - (min[1] as number)) * scale;
			}
			const offset = view * size * size;
			rasterise(targets[view] as ReturnType<typeof rasterTarget>, points, indices, (fragment) => {
				if (uvs && atlas > 0) {
					const a = (indices[fragment.triangle * 3] as number) * 2;
					const b = (indices[fragment.triangle * 3 + 1] as number) * 2;
					const c = (indices[fragment.triangle * 3 + 2] as number) * 2;
					const u =
						fragment.w0 * (uvs[a] as number) +
						fragment.w1 * (uvs[b] as number) +
						fragment.w2 * (uvs[c] as number);
					const v =
						fragment.w0 * (uvs[a + 1] as number) +
						fragment.w1 * (uvs[b + 1] as number) +
						fragment.w2 * (uvs[c + 1] as number);
					const x = Math.min(atlas - 1, Math.max(0, Math.floor(u * atlas)));
					const y = Math.min(atlas - 1, Math.max(0, Math.floor(v * atlas)));
					if ((alpha[(y * atlas + x) * 4 + 3] as number) < HALF_COVER) return false;
				}
				covered[offset + fragment.y * size + fragment.x] = 1;
				// No fragment writes depth, so every triangle covers what it stands over.
				return false;
			});
		}
	};
	const out: [number, number, number] = [0, 0, 0];
	const drawPart = (part: PlantPart): void => {
		const arrays = part.arrays;
		const count = arrays.positions.length / 3;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			dequantisePosition(arrays.positions, i, kit.box, out);
			positions.set(out, i * 3);
		}
		if (part.name !== 'cards') {
			draw(positions, arrays.indices);
			return;
		}
		const uvs = new Float32Array(count * 2);
		for (let i = 0; i < count * 2; i++) uvs[i] = (arrays.uvs[i] as number) / 65535;
		draw(positions, arrays.indices, uvs);
	};
	for (const part of asset.levels[level].parts) drawPart(part);
	if (level === 0) eachPlacedShoot(kit, asset, draw);
	return { size, covered };
}

/**
 * The share of sky inside a plant's outline in the front view of a matte: over the rows of pixels a
 * crown stands in, the pixels between each row's first and last covered pixel that nothing covers.
 * Two mattes of one plant are read against one outline, the first's, so a level that draws less is
 * read as more open and not as a smaller plant.
 *
 * @param outline The matte whose rows give the outline: the plant's leaf form.
 * @param matte The matte whose cover is read inside it.
 * @returns The sky share, from 0 to 1.
 */
export function skyShare(outline: OutlineMatte, matte: OutlineMatte): number {
	const { size } = outline;
	let inside = 0;
	let open = 0;
	for (let y = 0; y < size; y++) {
		let first = -1;
		let last = -1;
		for (let x = 0; x < size; x++)
			if (outline.covered[y * size + x]) {
				if (first < 0) first = x;
				last = x;
			}
		if (first < 0) continue;
		for (let x = first; x <= last; x++) {
			inside++;
			if (!matte.covered[y * size + x]) open++;
		}
	}
	return inside === 0 ? 0 : open / inside;
}
