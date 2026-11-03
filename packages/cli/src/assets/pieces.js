// Pieces of a large triangle list: the list's triangles sorted into a few runs, each facing about
// one way and lying close together, with a bounding sphere and a cone of facings for each run.
// A viewer that draws many copies of the list culls each piece of each copy on its own: a piece
// outside the view, or whose every triangle faces away from the eye, draws nothing, while the
// copy's other pieces draw.
//
// The planner reads plain typed arrays and imports nothing, so the asset tool and the engine's job
// workers can both run it. It moves triangles only: every vertex stays where it is, so the list
// keeps sharing its vertex streams with the levels and the base mesh beside it.
//
// The pieces come in two steps. Spherical k-means on the triangles' facings, weighted by their
// areas and started from directions spread evenly over the sphere, makes groups that face about one
// way each: one group for each piece, up to a cap. Rough surfaces, such as rocks, hold triangles
// that face many ways in any small patch, so narrow facing groups cull more back faces than small
// patches do. Past the cap, each group splits along the longest side of its triangles' middles, at
// the median, until it holds its share of the pieces, so a copy that the view cuts through draws
// fewer of them. A piece's cone has the axis of its triangles' mean facing,
// and its cutoff is the sine of the widest angle between that axis and a triangle's facing, as
// meshoptimizer's `computeClusterBounds` gives it. A viewer culls a piece whose sphere's centre `c`,
// relative to the eye, and radius `r` meet `dot(c, axis) >= cutoff * |c| + r`: every triangle then
// faces away from every point of the sphere. A cutoff of 1 or more never culls.

/**
 * The fewest triangles of one list for it to get pieces. A copy draws a smaller list far away,
 * where the view seldom cuts it and its few pieces face too many ways to cull, while each piece
 * still costs a test per copy and a draw.
 */
export const PIECE_LIST_MIN_TRIANGLES = 32768;

/** The triangles that one piece aims to hold. */
export const PIECE_TRIANGLES = 4096;

/** The fewest and the most pieces of one list. Past 16 a list draws more for little more culling. */
export const PIECE_MIN = 8;
export const PIECE_MAX = 16;

/** The most facing groups of one list: more pieces than this split the groups by space. */
export const PIECE_FACINGS = 14;

/**
 * How many more vertex cache misses pieces by facing may cost than pieces by space, as a share,
 * for a list to take them (see {@link cacheMisses}).
 */
export const FACING_MISS_ALLOWANCE = 0.1;

/** The entries of the vertex cache that {@link cacheMisses} models. */
const CACHE_ENTRIES = 32;

/** The numbers of each piece's bounds: its sphere's centre and radius, its cone's axis and cutoff. */
export const PIECE_BOUNDS = 8;

/** The rounds of spherical k-means on the facings. */
const FACING_ROUNDS = 8;

/** A facing group with less than this share of the list's area joins the group nearest it. */
const LEAST_GROUP_SHARE = 0.02;

/** A cone whose widest facing lies this near to square with its axis, or past it, never culls. */
const LEAST_CONE_DOT = 0.1;

/**
 * The pieces of a triangle list.
 *
 * @typedef {object} PiecePlan
 * @property {Uint32Array} order The list's triangles in piece order: triangle `k` of the new list
 *   is triangle `order[k]` of the old one.
 * @property {Uint32Array} counts The triangles of each piece, one piece after another.
 * @property {Float32Array} bounds {@link PIECE_BOUNDS} numbers for each piece.
 */

/**
 * The pieces that a triangle list of `triangles` triangles should have: none below
 * {@link PIECE_LIST_MIN_TRIANGLES}, else about one for each {@link PIECE_TRIANGLES}, within
 * {@link PIECE_MIN} and {@link PIECE_MAX}.
 *
 * @param {number} triangles
 */
export function pieceCount(triangles) {
	if (triangles < PIECE_LIST_MIN_TRIANGLES) return 0;
	return Math.min(PIECE_MAX, Math.max(PIECE_MIN, Math.round(triangles / PIECE_TRIANGLES)));
}

/**
 * Sorts a triangle list into `count` pieces, or fewer where its facings make fewer groups. Returns
 * `undefined` for a list that gets none: one of fewer than two triangles that have area.
 *
 * @param {ArrayLike<number>} positions Three numbers for each vertex, as the GPU reads them.
 * @param {ArrayLike<number>} indices Three vertex numbers for each triangle.
 * @param {number} count
 * @returns {PiecePlan | undefined}
 */
export function planPieces(positions, indices, count, facings = Math.min(count, PIECE_FACINGS)) {
	const triangles = Math.floor(indices.length / 3);
	if (count < 1 || triangles < 2) return undefined;
	// Each triangle's unit facing, its area and its middle.
	const facing = new Float64Array(triangles * 3);
	const area = new Float64Array(triangles);
	const middle = new Float64Array(triangles * 3);
	const e1 = [0, 0, 0];
	const e2 = [0, 0, 0];
	let total = 0;
	for (let t = 0; t < triangles; t++) {
		const a = at(indices, t * 3) * 3;
		const b = at(indices, t * 3 + 1) * 3;
		const c = at(indices, t * 3 + 2) * 3;
		for (let k = 0; k < 3; k++) {
			e1[k] = at(positions, b + k) - at(positions, a + k);
			e2[k] = at(positions, c + k) - at(positions, a + k);
			middle[t * 3 + k] = (at(positions, a + k) + at(positions, b + k) + at(positions, c + k)) / 3;
		}
		const nx = at(e1, 1) * at(e2, 2) - at(e1, 2) * at(e2, 1);
		const ny = at(e1, 2) * at(e2, 0) - at(e1, 0) * at(e2, 2);
		const nz = at(e1, 0) * at(e2, 1) - at(e1, 1) * at(e2, 0);
		const length = Math.hypot(nx, ny, nz);
		area[t] = length / 2;
		total += length / 2;
		if (length > 0) {
			facing[t * 3] = nx / length;
			facing[t * 3 + 1] = ny / length;
			facing[t * 3 + 2] = nz / length;
		}
	}
	if (total === 0) return undefined;
	const groups = facingGroups(facing, area, total, facings);
	// Each group's share of the pieces, by its triangles, at least one: the largest remainders
	// take the pieces left over.
	const exact = groups.map((group) => (group.length / triangles) * count);
	const shares = exact.map((share) => Math.max(1, Math.floor(share)));
	let left = count - shares.reduce((sum, share) => sum + share, 0);
	const byRemainder = exact
		.map((share, g) => ({ g, rest: share - Math.floor(share) }))
		.sort((x, y) => y.rest - x.rest || x.g - y.g);
	for (const { g } of byRemainder) {
		if (left <= 0) break;
		shares[g] = at(shares, g) + 1;
		left -= 1;
	}
	/** @type {Uint32Array[]} */
	const pieces = [];
	groups.forEach((group, g) => {
		splitBySpace(group, middle, at(shares, g), pieces);
	});
	const order = new Uint32Array(triangles);
	const counts = new Uint32Array(pieces.length);
	const bounds = new Float32Array(pieces.length * PIECE_BOUNDS);
	let first = 0;
	pieces.forEach((piece, k) => {
		order.set(piece, first);
		first += piece.length;
		counts[k] = piece.length;
		bounds.set(pieceBounds(piece, positions, indices, facing, area), k * PIECE_BOUNDS);
	});
	return { order, counts, bounds };
}

/**
 * The number at place `i` of `values`, which the caller keeps within the array.
 *
 * @param {ArrayLike<number>} values
 * @param {number} i
 */
const at = (values, i) => /** @type {number} */ (values[i]);

/**
 * The dot product of the three numbers of `a` from `i` on and those of `b` from `j` on.
 *
 * @param {ArrayLike<number>} a
 * @param {number} i
 * @param {ArrayLike<number>} b
 * @param {number} j
 */
const dot3 = (a, i, b, j) =>
	at(a, i) * at(b, j) + at(a, i + 1) * at(b, j + 1) + at(a, i + 2) * at(b, j + 2);

/**
 * `count` directions spread evenly over the sphere, on a Fibonacci spiral, three numbers each.
 *
 * @param {number} count
 */
function spread(count) {
	const golden = Math.PI * (3 - Math.sqrt(5));
	const axes = new Float64Array(count * 3);
	for (let k = 0; k < count; k++) {
		const y = 1 - (2 * (k + 0.5)) / count;
		const r = Math.sqrt(1 - y * y);
		axes.set([Math.cos(golden * k) * r, y, Math.sin(golden * k) * r], k * 3);
	}
	return axes;
}

/**
 * The triangles of each of `facings` facing groups, in their order in the list. A triangle
 * without area joins the first group, since it faces no way and draws nothing.
 *
 * @param {Float64Array} facing
 * @param {Float64Array} area
 * @param {number} total
 * @param {number} facings
 * @returns {Uint32Array[]}
 */
function facingGroups(facing, area, total, facings) {
	const triangles = area.length;
	const axes = spread(facings);
	const group = new Uint16Array(triangles);
	// Each group's summed facing, weighted by area, and its area.
	const sums = new Float64Array(facings * 4);
	const assign = () => {
		sums.fill(0);
		for (let t = 0; t < triangles; t++) {
			let best = 0;
			let bestDot = -Infinity;
			for (let g = 0; g < facings; g++) {
				const dot = dot3(facing, t * 3, axes, g * 3);
				if (dot > bestDot) {
					bestDot = dot;
					best = g;
				}
			}
			group[t] = best;
			const a = at(area, t);
			for (let k = 0; k < 3; k++)
				sums[best * 4 + k] = at(sums, best * 4 + k) + a * at(facing, t * 3 + k);
			sums[best * 4 + 3] = at(sums, best * 4 + 3) + a;
		}
	};
	for (let round = 0; round < FACING_ROUNDS; round++) {
		assign();
		for (let g = 0; g < facings; g++) {
			const length = Math.hypot(at(sums, g * 4), at(sums, g * 4 + 1), at(sums, g * 4 + 2));
			if (length > 0) for (let k = 0; k < 3; k++) axes[g * 3 + k] = at(sums, g * 4 + k) / length;
		}
	}
	assign();
	// A group of little area costs a draw for little gain, so it joins the kept group whose axis
	// lies nearest its own.
	const kept = Array.from(
		{ length: facings },
		(_, g) => at(sums, g * 4 + 3) >= LEAST_GROUP_SHARE * total,
	);
	if (!kept.some(Boolean)) kept.fill(true);
	const target = kept.map((keep, g) => {
		if (keep) return g;
		let best = 0;
		let bestDot = -Infinity;
		for (let h = 0; h < facings; h++) {
			const dot = dot3(axes, g * 3, axes, h * 3);
			if (kept[h] && dot > bestDot) {
				bestDot = dot;
				best = h;
			}
		}
		return best;
	});
	/** @type {number[][]} */
	const lists = kept.map(() => []);
	for (let t = 0; t < triangles; t++) lists[at(target, at(group, t))]?.push(t);
	return lists.filter((list) => list.length > 0).map((list) => Uint32Array.from(list));
}

/**
 * Splits a group of triangles into `count` pieces of about equal size, each across the longest
 * side of its triangles' middles at the median, and appends them to `out` in order.
 *
 * @param {Uint32Array} group
 * @param {Float64Array} middle
 * @param {number} count
 * @param {Uint32Array[]} out
 */
function splitBySpace(group, middle, count, out) {
	if (count <= 1 || group.length < 2) {
		out.push(group);
		return;
	}
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	for (const t of group)
		for (let k = 0; k < 3; k++) {
			low[k] = Math.min(at(low, k), at(middle, t * 3 + k));
			high[k] = Math.max(at(high, k), at(middle, t * 3 + k));
		}
	const spans = [0, 1, 2].map((k) => at(high, k) - at(low, k));
	const axis = spans.indexOf(Math.max(...spans));
	// The triangles in order along the axis, with ties kept in list order, so the split is the same
	// on every machine.
	const sorted = Array.from(group).sort(
		(a, b) => at(middle, a * 3 + axis) - at(middle, b * 3 + axis) || a - b,
	);
	const first = Math.floor(count / 2);
	const cut = Math.round((sorted.length * first) / count);
	splitBySpace(Uint32Array.from(sorted.slice(0, cut)).sort(), middle, first, out);
	splitBySpace(Uint32Array.from(sorted.slice(cut)).sort(), middle, count - first, out);
}

/**
 * The next 32-bit float above `value`, or `value` when it is one.
 *
 * @param {number} value
 */
function roundUp(value) {
	const bits = new Float32Array([value]);
	if (at(bits, 0) >= value) return at(bits, 0);
	const words = new Int32Array(bits.buffer);
	words[0] = at(words, 0) + (at(bits, 0) >= 0 ? 1 : -1);
	return at(bits, 0);
}

/**
 * A piece's sphere and cone, as 32-bit floats that cull no more than the exact ones: the sphere's
 * radius reaches every vertex from the rounded centre, and the cone's cutoff holds every facing
 * about the rounded axis.
 *
 * @param {Uint32Array} piece
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {Float64Array} facing
 * @param {Float64Array} area
 * @returns {number[]}
 */
function pieceBounds(piece, positions, indices, facing, area) {
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	const sum = [0, 0, 0];
	for (const t of piece) {
		for (let c = 0; c < 3; c++) {
			const v = at(indices, t * 3 + c) * 3;
			for (let k = 0; k < 3; k++) {
				low[k] = Math.min(at(low, k), at(positions, v + k));
				high[k] = Math.max(at(high, k), at(positions, v + k));
			}
		}
		for (let k = 0; k < 3; k++) sum[k] = at(sum, k) + at(area, t) * at(facing, t * 3 + k);
	}
	const centre = [0, 1, 2].map((k) => Math.fround((at(low, k) + at(high, k)) / 2));
	let reach = 0;
	for (const t of piece)
		for (let c = 0; c < 3; c++) {
			const v = at(indices, t * 3 + c) * 3;
			const d = [0, 1, 2].map((k) => at(positions, v + k) - at(centre, k));
			reach = Math.max(reach, Math.hypot(at(d, 0), at(d, 1), at(d, 2)));
		}
	const length = Math.hypot(at(sum, 0), at(sum, 1), at(sum, 2));
	const axis = sum.map((v) => Math.fround(length > 0 ? v / length : 0));
	// The widest facing about the axis as it is stored, so rounding the axis widens the cone.
	const stored = Math.hypot(at(axis, 0), at(axis, 1), at(axis, 2));
	let least = stored > 0 ? 1 : -1;
	if (stored > 0)
		for (const t of piece)
			if (at(area, t) > 0) least = Math.min(least, dot3(facing, t * 3, axis, 0) / stored);
	const cutoff = least <= LEAST_CONE_DOT ? 1 : roundUp(Math.sqrt(1 - least * least));
	return [...centre, roundUp(reach), ...axis, cutoff];
}

/**
 * The vertex cache misses per triangle of a list, with a cache of the last 32 vertices that came
 * in, first in first out: a stand-in for the vertex shading that a GPU does again for a vertex that
 * it shaded too long before.
 *
 * @param {ArrayLike<number>} indices
 */
export function cacheMisses(indices) {
	const slots = new Int32Array(CACHE_ENTRIES).fill(-1);
	/** @type {Map<number, number>} */
	const held = new Map();
	let next = 0;
	let misses = 0;
	for (let i = 0; i < indices.length; i++) {
		const vertex = at(indices, i);
		if (held.has(vertex)) continue;
		misses += 1;
		const old = at(slots, next);
		if (old >= 0) held.delete(old);
		slots[next] = vertex;
		held.set(vertex, next);
		next = (next + 1) % CACHE_ENTRIES;
	}
	return misses / Math.max(1, Math.floor(indices.length / 3));
}
