// Pieces of a large triangle list: the list's triangles sorted into a few runs, each facing about
// one way and lying close together, with a bounding sphere and a cone of facings for each run.
// A viewer that draws many copies of the list culls each piece of each copy on its own: a piece
// outside the view, or whose every triangle faces away from the eye, draws nothing, while the
// copy's other pieces draw.
//
// The planner reads plain typed arrays and imports nothing, so the asset tool runs it in Node on a
// glTF file's accessors, and the engine runs it on a job worker on a mesh made in code. It moves triangles only: every vertex stays where it is, so the list
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
//
// A smaller list pays only through its cones: the view seldom cuts a small copy, so a piece must
// face away to save anything. Such a list gets facing pieces (`facingPieces`) when its facings fall
// into a few tight groups, as a building's sides do, and a viewer uses them only where many copies
// draw it (`facingPiecesPay`), as a town draws a house's walls. Each facing group keeps the
// triangles that lie close to its mean facing, so its cone stays narrow, and the triangles that
// face between the groups, such as a pot's or a sloped cap's, draw in one more piece that never
// culls. The asset tool stores such pieces whatever copies the file places, since a page may place
// many copies of a file's mesh; the engine draws them only once the scene's copies pay for them.
//
// The pieces of a list of a few thousand triangles or more split into groups of up to 128
// triangles each (`planGroups`), which meshoptimizer's clusterizer makes and which the caller
// hands in, since the planner imports nothing. A group lies inside one piece and takes the same
// kind of bounds. A viewer that draws a few near copies of a list at a fine level culls those
// copies group by group, while every other copy culls piece by piece.

/**
 * The fewest triangles of one list for it to get pieces whatever draws it. The view cuts such a
 * list's copies, and its pieces cull by space as well as by facing. A smaller list gets pieces only
 * where its copies and facings make them pay ({@link facingPieces}).
 */
export const PIECE_LIST_MIN_TRIANGLES = 32768;

/**
 * The fewest triangles of a smaller list for it to get facing pieces. Each piece costs a draw in
 * every pass that draws the list, so a list of a few hundred triangles saves less than its draws.
 */
export const FACING_LIST_MIN_TRIANGLES = 1024;

/**
 * The fewest triangles that a smaller list's copies hold together for it to get facing pieces: the
 * list's triangles times its copies. Fewer copies save too few triangles for a draw per piece.
 */
export const FACING_DRAWN_MIN_TRIANGLES = 65536;

/**
 * The facing groups of a smaller list: a building's four sides, its tops and its undersides. The
 * groups start from the six ways along the list's own axes, which a kit's pieces mostly face.
 */
export const FACING_GROUPS = 6;

/** The six ways along a list's axes, three numbers each, where its facing groups start. */
const AXIS_WAYS = Float64Array.of(1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1);

/**
 * The least share of a smaller list's triangles that its cones drop, over eyes all around it, for
 * the list to keep its facing pieces. A flat piece drops its triangles from half the directions.
 */
export const FACING_MIN_SHARE = 0.25;

/**
 * A list whose triangles face one way by this much, as {@link meanFacing} measures it, lies like a
 * ground or a wall. A view sees such a list from its front, so facing pieces seldom drop, and its
 * large lists split by space alone.
 */
export const ONE_WAY_FACING = 0.7;

/** A facing group that keeps fewer triangles than this joins the piece that never culls. */
const FACING_PIECE_MIN_TRIANGLES = 64;

/** The triangles that one piece aims to hold. */
export const PIECE_TRIANGLES = 4096;

/** The fewest and the most pieces of one list. Past 16 a list draws more for little more culling. */
export const PIECE_MIN = 8;
export const PIECE_MAX = 16;

/** The most facing groups of one list: more pieces than this split the groups by space. */
export const PIECE_FACINGS = 14;

/** The numbers of each piece's bounds: its sphere's centre and radius, its cone's axis and cutoff. */
export const PIECE_BOUNDS = 8;

/**
 * The most triangles of one group. Each piece of a list of {@link GROUP_LIST_MIN_TRIANGLES}
 * triangles or more splits into groups of up to this many triangles that lie close together, each
 * with bounds of its own, so a viewer can cull a near copy's triangles at a finer grain than its
 * pieces.
 */
export const GROUP_TRIANGLES = 128;

/** The most vertices that one group uses: the most that meshoptimizer's clusterizer takes. */
export const GROUP_VERTICES = 256;

/** The fewest triangles of a list with pieces for its pieces to split into groups. */
export const GROUP_LIST_MIN_TRIANGLES = 4096;

/** How much the clusterizer weighs a group's spread of facings against its size in space. */
export const GROUP_CONE_WEIGHT = 0.25;

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
 * The groups of a list's pieces: the list's triangles in group order, which keeps each piece's
 * triangles in the piece, and each group's triangles and bounds.
 *
 * @typedef {object} GroupPlan
 * @property {Uint32Array} indices The list's triangles, each piece's in the order of its groups.
 * @property {Uint8Array} counts The triangles of each group, one group after another, piece by
 *   piece: the groups of each piece hold its triangles and no other.
 * @property {Float32Array} bounds {@link PIECE_BOUNDS} numbers for each group, as a piece's.
 */

/**
 * Splits a list of triangles into groups of up to {@link GROUP_TRIANGLES} triangles that lie close
 * together, as meshoptimizer's clusterizer makes them: the same triangles in group order, and the
 * triangles of each group.
 *
 * @callback Clusterize
 * @param {Uint32Array} indices Three vertex numbers for each triangle.
 * @param {Float32Array} positions Three numbers for each vertex that the triangles use.
 * @returns {{ indices: Uint32Array, counts: Uint32Array }}
 */

/**
 * The groups of the pieces of a list of {@link GROUP_LIST_MIN_TRIANGLES} triangles or more, or
 * `undefined` for a smaller list. `indices` holds the list in piece order, and `pieces` the
 * triangles of each piece. Each piece splits into groups of its own, so a group never crosses
 * from one piece into the next, and each group's bounds are those that `planPieces` gives a piece.
 *
 * @param {ArrayLike<number>} positions Three numbers for each vertex, as the GPU reads them.
 * @param {Uint32Array} indices Three vertex numbers for each triangle, in piece order.
 * @param {ArrayLike<number>} pieces The triangles of each piece.
 * @param {Clusterize} clusterize
 * @returns {GroupPlan | undefined}
 */
export function planGroups(positions, indices, pieces, clusterize) {
	const triangles = Math.floor(indices.length / 3);
	if (triangles < GROUP_LIST_MIN_TRIANGLES) return undefined;
	const sorted = new Uint32Array(triangles * 3);
	/** @type {number[]} */
	const counts = [];
	// Each piece hands the clusterizer only the vertices that it uses, numbered from 0, so a call
	// copies a piece's share of a large mesh's positions rather than all of them.
	const local = new Int32Array(Math.floor(positions.length / 3)).fill(-1);
	const used = new Uint32Array(indices.length);
	let first = 0;
	for (let k = 0; k < pieces.length; k++) {
		const size = at(pieces, k);
		const piece = new Uint32Array(size * 3);
		let vertices = 0;
		for (let i = 0; i < size * 3; i++) {
			const v = at(indices, first * 3 + i);
			if (at(local, v) < 0) {
				local[v] = vertices;
				used[vertices++] = v;
			}
			piece[i] = at(local, v);
		}
		const corners = new Float32Array(vertices * 3);
		for (let v = 0; v < vertices; v++)
			for (let c = 0; c < 3; c++) corners[v * 3 + c] = at(positions, at(used, v) * 3 + c);
		for (let v = 0; v < vertices; v++) local[at(used, v)] = -1;
		const grouped = clusterize(piece, corners);
		let sum = 0;
		for (const count of grouped.counts) {
			if (count < 1 || count > GROUP_TRIANGLES) return undefined;
			sum += count;
			counts.push(count);
		}
		if (sum !== size || grouped.indices.length !== size * 3) return undefined;
		for (let i = 0; i < size * 3; i++) {
			const v = at(grouped.indices, i);
			if (v >= vertices) return undefined;
			sorted[first * 3 + i] = at(used, v);
		}
		first += size;
	}
	if (first !== triangles) return undefined;
	const { facing, area } = triangleFacings(positions, sorted);
	const bounds = new Float32Array(counts.length * PIECE_BOUNDS);
	let start = 0;
	counts.forEach((count, g) => {
		const group = new Uint32Array(count);
		for (let t = 0; t < count; t++) group[t] = start + t;
		bounds.set(pieceBounds(group, positions, sorted, facing, area), g * PIECE_BOUNDS);
		start += count;
	});
	return { indices: sorted, counts: Uint8Array.from(counts), bounds };
}

/**
 * The groups that meshoptimizer's clusterizer made, from its buffers, as {@link Clusterize} gives
 * them: the triangles in group order, and the triangles of each group.
 *
 * @param {ArrayLike<number>} meshlets Four numbers for each group: where its vertices start in
 *   `vertices`, where its triangles start in `triangles`, its vertices and its triangles.
 * @param {ArrayLike<number>} vertices The vertices that the groups use, group by group.
 * @param {ArrayLike<number>} triangles Three places in its group's vertices for each triangle.
 * @param {number} count The groups.
 * @returns {{ indices: Uint32Array, counts: Uint32Array }}
 */
export function meshletGroups(meshlets, vertices, triangles, count) {
	let total = 0;
	for (let k = 0; k < count; k++) total += at(meshlets, k * 4 + 3);
	const indices = new Uint32Array(total * 3);
	const counts = new Uint32Array(count);
	let out = 0;
	for (let k = 0; k < count; k++) {
		const first = at(meshlets, k * 4);
		const from = at(meshlets, k * 4 + 1);
		const size = at(meshlets, k * 4 + 3);
		counts[k] = size;
		for (let i = 0; i < size * 3; i++)
			indices[out++] = at(vertices, first + at(triangles, from + i));
	}
	return { indices, counts };
}

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
 * @param {number} [facings] The most facing groups: one gives pieces by space only.
 * @returns {PiecePlan | undefined}
 */
export function planPieces(positions, indices, count, facings = Math.min(count, PIECE_FACINGS)) {
	const triangles = Math.floor(indices.length / 3);
	if (count < 1 || triangles < 2) return undefined;
	const { facing, area, middle, total } = triangleFacings(positions, indices);
	if (total === 0) return undefined;
	const groups = facingGroups(facing, area, total, facings);
	const shares = shareOut(
		groups.map((group) => group.length),
		count,
	);
	/** @type {Uint32Array[]} */
	const pieces = [];
	groups.forEach((group, g) => {
		splitBySpace(group, middle, at(shares, g), pieces);
	});
	return piecePlan(pieces, positions, indices, facing, area);
}

/**
 * True when `copies` copies of a list of `triangles` triangles pay for its facing pieces: a list
 * from {@link FACING_LIST_MIN_TRIANGLES} up to {@link PIECE_LIST_MIN_TRIANGLES} whose copies hold
 * {@link FACING_DRAWN_MIN_TRIANGLES} triangles or more together.
 *
 * @param {number} triangles
 * @param {number} copies
 */
export function facingPiecesPay(triangles, copies) {
	return (
		triangles >= FACING_LIST_MIN_TRIANGLES &&
		triangles < PIECE_LIST_MIN_TRIANGLES &&
		triangles * copies >= FACING_DRAWN_MIN_TRIANGLES
	);
}

/**
 * The facing pieces of a list from {@link FACING_LIST_MIN_TRIANGLES} up to
 * {@link PIECE_LIST_MIN_TRIANGLES} triangles, or `undefined` for a list outside that range or whose
 * cones would drop less than {@link FACING_MIN_SHARE} of its triangles. The list's triangles fall
 * into up to {@link FACING_GROUPS} facing groups. Each group keeps the triangles that lie close
 * enough to its mean facing for its cone to drop the most of them, and the rest draw in one piece
 * more, which faces every way. The pieces pay only where many copies draw the list
 * ({@link facingPiecesPay}).
 *
 * @param {ArrayLike<number>} positions Three numbers for each vertex, as the GPU reads them.
 * @param {ArrayLike<number>} indices Three vertex numbers for each triangle.
 * @returns {PiecePlan | undefined}
 */
export function facingPieces(positions, indices) {
	const triangles = Math.floor(indices.length / 3);
	if (triangles >= PIECE_LIST_MIN_TRIANGLES || triangles < FACING_LIST_MIN_TRIANGLES)
		return undefined;
	const { facing, area, total } = triangleFacings(positions, indices);
	if (total === 0 || summedFacing(facing, area) / total >= ONE_WAY_FACING) return undefined;
	/** @type {Uint32Array[]} */
	const pieces = [];
	/** @type {number[]} */
	const rest = [];
	for (const group of facingGroups(facing, area, total, FACING_GROUPS, AXIS_WAYS)) {
		const { kept, left } = tightCone(group, facing, area);
		if (kept.length >= FACING_PIECE_MIN_TRIANGLES) pieces.push(kept);
		else left.push(...kept);
		rest.push(...left);
	}
	if (pieces.length < 2) return undefined;
	if (rest.length > 0) pieces.push(Uint32Array.from(rest).sort());
	const plan = piecePlan(pieces, positions, indices, facing, area);
	return coneShare(plan) >= FACING_MIN_SHARE ? plan : undefined;
}

/**
 * The pieces that a file stores for a triangle list: {@link pieceCount} pieces for a large list,
 * else {@link facingPieces} where its facings let them pay, else none. `facing` is false for a list
 * whose material draws both faces or blends: its copies never drop a piece by the way it faces, so
 * a smaller list gets none.
 *
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {boolean} [facing]
 * @returns {PiecePlan | undefined}
 */
export function listPieces(positions, indices, facing = true) {
	const count = pieceCount(Math.floor(indices.length / 3));
	if (count > 0) return planPieces(positions, indices, count);
	return facing ? facingPieces(positions, indices) : undefined;
}

/**
 * The share of a plan's triangles that its cones drop, over eyes spread evenly around each piece
 * and far from it. A cone of cutoff `s` drops its piece for `(1 - s) / 2` of the directions.
 *
 * @param {PiecePlan} plan
 */
export function coneShare(plan) {
	let dropped = 0;
	let triangles = 0;
	plan.counts.forEach((count, k) => {
		const cutoff = at(plan.bounds, k * PIECE_BOUNDS + 7);
		if (cutoff < 1) dropped += (count * (1 - cutoff)) / 2;
		triangles += count;
	});
	return triangles > 0 ? dropped / triangles : 0;
}

/**
 * Splits a facing group in two: the triangles whose facing lies within the angle of its mean
 * facing that lets the group's cone drop the most triangles, and the rest. A triangle without area
 * faces no way, so it stays with the group.
 *
 * @param {Uint32Array} group
 * @param {Float64Array} facing
 * @param {Float64Array} area
 * @returns {{ kept: Uint32Array, left: number[] }}
 */
function tightCone(group, facing, area) {
	const axis = [0, 0, 0];
	for (const t of group)
		for (let k = 0; k < 3; k++) axis[k] = at(axis, k) + at(area, t) * at(facing, t * 3 + k);
	const length = Math.hypot(at(axis, 0), at(axis, 1), at(axis, 2));
	if (length === 0) return { kept: new Uint32Array(0), left: Array.from(group) };
	const dots = Array.from(group, (t) => ({
		t,
		dot: at(area, t) > 0 ? dot3(facing, t * 3, axis, 0) / length : 1,
	})).sort((a, b) => b.dot - a.dot || a.t - b.t);
	// The cone drops its piece from `(1 - cutoff) / 2` of the directions, with the cutoff the sine
	// of the widest angle that it keeps, so the cut weighs the triangles kept by that share.
	let best = 0;
	let keep = 0;
	dots.forEach(({ dot }, k) => {
		if (dot <= LEAST_CONE_DOT) return;
		const dropped = (k + 1) * (1 - Math.sqrt(Math.max(0, 1 - dot * dot)));
		if (dropped > best) {
			best = dropped;
			keep = k + 1;
		}
	});
	return {
		kept: Uint32Array.from(dots.slice(0, keep), ({ t }) => t).sort(),
		left: dots.slice(keep).map(({ t }) => t),
	};
}

/**
 * The plan of `pieces`, each a list of triangles in the order that it draws them.
 *
 * @param {Uint32Array[]} pieces
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {Float64Array} facing
 * @param {Float64Array} area
 * @returns {PiecePlan}
 */
function piecePlan(pieces, positions, indices, facing, area) {
	const triangles = pieces.reduce((sum, piece) => sum + piece.length, 0);
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
 * Each group's share of `count` pieces, by its triangles in `sizes`, at least one: the largest
 * remainders take the pieces left over. Groups past `count` take one each all the same.
 *
 * @param {number[]} sizes
 * @param {number} count
 * @returns {number[]}
 */
export function shareOut(sizes, count) {
	const triangles = sizes.reduce((sum, size) => sum + size, 0);
	const exact = sizes.map((size) => (size / triangles) * count);
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
	return shares;
}

/**
 * The triangles of `indices` in the order of the pieces of `plan`, each piece's triangles in the
 * order that `cacheOrder` gives them for the GPU's vertex cache, which keeps the vertex numbers.
 *
 * @param {ArrayLike<number>} indices
 * @param {PiecePlan} plan
 * @param {(indices: Uint32Array) => Uint32Array} cacheOrder
 * @returns {Uint32Array<ArrayBuffer>}
 */
export function piecesInOrder(indices, plan, cacheOrder) {
	const sorted = new Uint32Array(plan.order.length * 3);
	let first = 0;
	for (const triangles of plan.counts) {
		const piece = new Uint32Array(triangles * 3);
		for (let k = 0; k < triangles; k++) {
			const from = at(plan.order, first + k) * 3;
			piece[k * 3] = at(indices, from);
			piece[k * 3 + 1] = at(indices, from + 1);
			piece[k * 3 + 2] = at(indices, from + 2);
		}
		sorted.set(cacheOrder(piece), first * 3);
		first += triangles;
	}
	return sorted;
}

/**
 * The bounds of one piece that holds the whole triangle list, as `planPieces` bounds each piece.
 *
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @returns {Float32Array}
 */
export function listBounds(positions, indices) {
	const { facing, area } = triangleFacings(positions, indices);
	const piece = Uint32Array.from({ length: area.length }, (_, t) => t);
	return Float32Array.from(pieceBounds(piece, positions, indices, facing, area));
}

/**
 * How far a triangle list faces one way: the length of its triangles' facings summed by area, as
 * a share of their area. 1 for a flat list, near 0 for a closed shape.
 *
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 */
export function meanFacing(positions, indices) {
	const { facing, area, total } = triangleFacings(positions, indices);
	return total === 0 ? 0 : summedFacing(facing, area) / total;
}

/**
 * The length of the triangles' facings summed by area.
 *
 * @param {Float64Array} facing
 * @param {Float64Array} area
 */
function summedFacing(facing, area) {
	const sum = [0, 0, 0];
	for (let t = 0; t < area.length; t++)
		for (let k = 0; k < 3; k++) sum[k] = at(sum, k) + at(area, t) * at(facing, t * 3 + k);
	return Math.hypot(at(sum, 0), at(sum, 1), at(sum, 2));
}

/**
 * Each triangle's unit facing, its area and its middle, and the list's whole area.
 *
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 */
function triangleFacings(positions, indices) {
	const triangles = Math.floor(indices.length / 3);
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
	return { facing, area, middle, total };
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
 * The triangles of each of `facings` facing groups, in their order in the list. The groups start
 * from the directions `start`, or from directions spread evenly over the sphere. A triangle
 * without area joins the first group, since it faces no way and draws nothing.
 *
 * @param {Float64Array} facing
 * @param {Float64Array} area
 * @param {number} total
 * @param {number} facings
 * @param {Float64Array} [start] Three numbers for each group.
 * @returns {Uint32Array[]}
 */
function facingGroups(facing, area, total, facings, start) {
	const triangles = area.length;
	const axes = start ? Float64Array.from(start) : spread(facings);
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
