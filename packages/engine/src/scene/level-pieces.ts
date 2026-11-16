// Pieces of a mesh made in code and of its planned levels, which the levels task plans on a job
// worker (see `levels/pieces.js`, which the asset tool runs on a file's lists). A list of
// `PIECE_LIST_MIN_TRIANGLES` triangles or more sorts its triangles into pieces that each copy culls
// on its own, and a smaller list that many copies draw gets facing pieces where they pay. The mesh
// keeps its own list: its pieces draw a sorted list of their own that shares its vertices, and each
// level's list is sorted before the level is made.
//
// A mesh that the engine split into parts draws each list part by part: a triangle draws from the
// part where one of its corners first appears, trying its corners in turn, once that part holds all
// three, and the triangles that no part holds whole draw last from a copy of their vertices. A
// list's pieces then plan within each of those groups, so that the sorted list still comes part by
// part and the core keeps its order. A piece may still cross from one part into the next.
//
// The pieces of a list of a few thousand triangles or more split into groups too, with
// meshoptimizer's clusterizer (`planGroups`), so a near copy can cull its triangles at a finer
// grain than its pieces.

import {
	type Clusterize,
	facingPieces,
	facingPiecesPay,
	listBounds,
	meanFacing,
	ONE_WAY_FACING,
	PIECE_MAX,
	pieceCount,
	piecesInOrder,
	planGroups,
	planPieces,
	shareOut,
} from '../../levels/pieces.js';
import type { PiecesData } from './gltf-parse';

/** A list's pieces: its triangles in piece order, the triangles of each piece and their bounds. */
export interface ListPieces extends PiecesData {
	indices: Uint32Array;
}

/**
 * The group of each triangle of `indices` in a split mesh whose vertices name the parts that hold
 * them in `masks`, one bit a part: the part that draws it, or `parts` for one that no part holds.
 */
export function triangleGroups(
	indices: Uint32Array,
	masks: Uint32Array,
	parts: number,
): Uint8Array {
	const groups = new Uint8Array(indices.length / 3);
	for (let t = 0; t < groups.length; t++) {
		const a = masks[indices[t * 3] as number] as number;
		const b = masks[indices[t * 3 + 1] as number] as number;
		const c = masks[indices[t * 3 + 2] as number] as number;
		const all = a & b & c;
		let group = parts;
		for (const corner of [a, b, c]) {
			// The part where the corner first appears is its lowest bit.
			const first = 31 - Math.clz32(corner & -corner);
			if ((all >>> first) & 1) {
				group = first;
				break;
			}
		}
		groups[t] = group;
	}
	return groups;
}

/**
 * `pieces` with the groups that `clusterize` splits them into, in their list's order, where the
 * list is large enough for groups.
 */
function withGroups(
	positions: Float32Array,
	pieces: ListPieces,
	clusterize: Clusterize | undefined,
): ListPieces {
	const groups = clusterize && planGroups(positions, pieces.indices, pieces.triangles, clusterize);
	if (!groups) return pieces;
	return { ...pieces, indices: groups.indices, groups: groups.counts, groupBounds: groups.bounds };
}

/**
 * The pieces of the triangle list `indices` over `positions`. A list under
 * `PIECE_LIST_MIN_TRIANGLES` triangles gets facing pieces where its `copies` and its facings make
 * them pay, unless it splits by `space` or into parts, and none otherwise. `split` names the parts
 * of a split mesh that hold each vertex, and the part count; the pieces then keep the order in
 * which the parts draw the list. Each group takes one piece at least, so a list of more groups than
 * `PIECE_MAX` takes one piece a group: the parts draw a range each without pieces too, so such
 * pieces add no draw. `clusterize` splits the pieces of a large enough list into groups.
 */
export function planListPieces(
	positions: Float32Array,
	indices: Uint32Array,
	split: { masks: Uint32Array; parts: number } | undefined,
	cacheOrder: (indices: Uint32Array) => Uint32Array,
	space = false,
	copies = 1,
	clusterize?: Clusterize,
): ListPieces | undefined {
	const pieces = listPiecesOf(positions, indices, split, cacheOrder, space, copies);
	return pieces && withGroups(positions, pieces, clusterize);
}

/** The pieces of `planListPieces`, without their groups. */
function listPiecesOf(
	positions: Float32Array,
	indices: Uint32Array,
	split: { masks: Uint32Array; parts: number } | undefined,
	cacheOrder: (indices: Uint32Array) => Uint32Array,
	space: boolean,
	copies: number,
): ListPieces | undefined {
	const triangles = indices.length / 3;
	const wanted = pieceCount(triangles);
	if (wanted === 0) {
		const plan =
			space || split || !facingPiecesPay(triangles, copies)
				? undefined
				: facingPieces(positions, indices);
		return (
			plan && {
				indices: piecesInOrder(indices, plan, cacheOrder),
				triangles: plan.counts,
				bounds: plan.bounds,
			}
		);
	}
	const groups = split && triangleGroups(indices, split.masks, split.parts);
	const sizes = new Array<number>(split ? split.parts + 1 : 1).fill(0);
	for (let t = 0; t < triangles; t++) {
		const g = groups ? (groups[t] as number) : 0;
		sizes[g] = (sizes[g] as number) + 1;
	}
	const used = sizes.flatMap((size, g) => (size > 0 ? [g] : []));
	const most = Math.max(PIECE_MAX, used.length);
	const shares = shareOut(
		used.map((g) => sizes[g] as number),
		Math.max(wanted, used.length),
	);
	// Each group takes a piece however small, so the largest shares give pieces back until the
	// list holds no more than the most pieces.
	for (let over = shares.reduce((sum, share) => sum + share, 0) - most; over > 0; over--) {
		const largest = shares.indexOf(Math.max(...shares));
		shares[largest] = (shares[largest] as number) - 1;
	}
	// A list that lies like a ground or a wall splits by space alone, so the view cuts the pieces
	// that it leaves out: groups by facing would each spread over the whole list.
	const facings = space || meanFacing(positions, indices) >= ONE_WAY_FACING ? 1 : undefined;
	const sorted = new Uint32Array(indices.length);
	const counts: number[] = [];
	const bounds: number[] = [];
	let at = 0;
	used.forEach((g, k) => {
		const list = groups ? gather(indices, groups, g, sizes[g] as number) : indices;
		const plan = planPieces(positions, list, shares[k] as number, facings);
		if (plan) {
			sorted.set(piecesInOrder(list, plan, cacheOrder), at);
			counts.push(...plan.counts);
			bounds.push(...plan.bounds);
		} else {
			// A group too small or too flat to plan draws as one piece, which faces every way.
			sorted.set(list, at);
			counts.push(list.length / 3);
			bounds.push(...listBounds(positions, list));
		}
		at += list.length;
	});
	if (counts.length < 2) return undefined;
	return {
		indices: sorted,
		triangles: Uint32Array.from(counts),
		bounds: Float32Array.from(bounds),
	};
}

/** The `size` triangles of `indices` whose group is `group`, in their order. */
function gather(
	indices: Uint32Array,
	groups: Uint8Array,
	group: number,
	size: number,
): Uint32Array {
	const list = new Uint32Array(size * 3);
	let at = 0;
	for (let t = 0; t < groups.length; t++) {
		if (groups[t] !== group) continue;
		list[at] = indices[t * 3] as number;
		list[at + 1] = indices[t * 3 + 1] as number;
		list[at + 2] = indices[t * 3 + 2] as number;
		at += 3;
	}
	return list;
}
