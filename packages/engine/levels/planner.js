// The level planner that the asset tool and the engine share: levels of detail planned as Godot
// plans them at import. The simplifier sees each triangle list with its vertices welded, so that
// copies an exporter left at one place do not hold it back, and with the normals and colors in
// its error. Each level simplifies the level above to about half its triangles, down to a few
// dozen triangles, until a level saves too little. Each level keeps its error as a distance in the units the
// mesh draws in, which the engine compares with the screen.
//
// The module reads plain arrays and imports nothing, so the asset tool runs it in Node on a glTF
// file's accessors, and the engine runs it on a job worker on a mesh made in code. Both hand it
// meshoptimizer's simplifier of one pinned version, so the same arrays give the same levels.

/**
 * The calls of meshoptimizer's simplifier that the planner makes, with the arguments of the
 * `meshoptimizer` package's `MeshoptSimplifier.simplifyWithAttributes`, and the reorder of a
 * level's triangles for the GPU's vertex cache.
 *
 * @typedef {object} Meshopt
 * @property {(indices: Uint32Array, positions: Float32Array, positionsStride: number,
 *   attributes: Float32Array, attributesStride: number, weights: number[], lock: Uint8Array | null,
 *   target: number, error: number, flags: SimplifierFlag[]) => [Uint32Array, number]}
 *   simplifyWithAttributes
 * @property {(indices: Uint32Array) => Uint32Array} cacheOrder The triangles in the order that
 *   meshoptimizer's `optimizeVertexCache` gives them, naming the same vertices.
 */

/**
 * A flag of meshoptimizer's simplifier, by the name that its package takes.
 *
 * @typedef {'LockBorder' | 'Sparse' | 'ErrorAbsolute' | 'Prune' | 'Regularize' | 'Permissive'}
 *   SimplifierFlag
 */

/** Meshes with fewer triangles get no levels of detail: they cost little to draw anyway. */
export const LOD_MIN_TRIANGLES = 64;

/** The share of the level above's triangles that each level aims for. */
export const LOD_STEP = 0.5;

/**
 * A level that keeps more than this share of the level above's triangles ends the levels: it
 * fell short of its target by more than half the cut, so the simplifier has stalled.
 */
const LOD_MAX_KEPT = (1 + LOD_STEP) / 2;

/**
 * The triangles that the coarsest level aims for. A level of fewer than twice as many ends the
 * levels, since one more level would save too little. A far copy of a small mesh covers a few
 * pixels, where a few dozen triangles draw the same picture as hundreds.
 */
export const LOD_FLOOR_TRIANGLES = 32;

/**
 * Each level's error is at least this many times the level above's, so that the distances at
 * which levels switch stay apart.
 */
const LOD_ERROR_GROWTH = 1.5;

/**
 * The most lower levels that a mesh gets: the engine takes fifteen beside the mesh itself, which
 * halving needs to take a mesh of a million triangles to the floor.
 */
export const LOD_MAX_LEVELS = 15;

/** The cosine of the widest angle between two normals that welding still merges. */
const WELD_COS = Math.cos((20 * Math.PI) / 180);

/** The weight of each normal and color component in the simplifier's error. */
const ATTRIBUTE_WEIGHT = 1;

/** A vertex lock that lets a vertex move along a seam but not across it, in permissive mode. */
const SEAM = 2;

/**
 * The longest side of the box around a list of points, or around the points that a triangle list
 * names when `indices` is given.
 *
 * @param {Float32Array} positions
 * @param {Uint32Array} [indices]
 */
export function longestSide(positions, indices) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	const points = indices ? indices.length : positions.length / 3;
	for (let i = 0; i < points; i++) {
		const at = (indices ? /** @type {number} */ (indices[i]) : i) * 3;
		for (let k = 0; k < 3; k++) {
			const v = /** @type {number} */ (positions[at + k]);
			if (v < /** @type {number} */ (min[k])) min[k] = v;
			if (v > /** @type {number} */ (max[k])) max[k] = v;
		}
	}
	return Math.max(0, ...max.map((v, k) => v - /** @type {number} */ (min[k])));
}

/**
 * A vertex stream as floats in the mesh's units: `size` values per vertex.
 *
 * @typedef {object} Stream
 * @property {Float32Array} values
 * @property {number} size
 */

/**
 * A triangle list's vertices and triangles as the planner reads them, in floats: normalized
 * integers already turned into the fractions they stand for.
 *
 * @typedef {object} ListStreams
 * @property {Float32Array} positions Where each vertex sits while the levels are planned.
 * @property {Stream | null} normal
 * @property {Stream | null} color
 * @property {Stream | null} tangent
 * @property {Stream[]} texcoords Each set of texture coordinates, in the list's order.
 * @property {Uint32Array} indices The list's triangles, which welding renames in place.
 */

/**
 * A triangle list as the simplifier plans it.
 *
 * @typedef {object} PlanningList
 * @property {Float32Array} positions Where each vertex sits while the levels are planned.
 * @property {Float32Array} attributes Each vertex's welded normal and color, as `stride` floats.
 * @property {number} stride
 * @property {number[]} weights
 * @property {Uint8Array} seams {@link SEAM} for each vertex where texture coordinates or colors
 *   change, else 0.
 * @property {Uint32Array} indices The triangles, each corner at its weld's first vertex.
 * @property {Card[] | null} cards The list's cards, where it holds separate cards alone, in an
 *   order that spreads them over the list; null for a list of any other shape.
 * @property {boolean} posed True for a list that a skin poses, whose positions are in the scene's
 *   units rather than its mesh's.
 */

/**
 * A card: a separate piece of a list, such as a leaf's quad, in one of {@link CARD_CORNERS}'
 * shapes.
 *
 * @typedef {object} Card
 * @property {number[]} vertices The card's welded vertices, by number.
 * @property {number[]} triangles Its triangles, in threes.
 * @property {number[]} centre The middle of its vertices.
 * @property {number} size The longest distance between two of its vertices.
 */

/**
 * The bits that each axis of a card's middle takes in its sorting key: three axes of 16 bits fit
 * a number exactly.
 */
const CARD_KEY_BITS = 16;

/**
 * The number that orders a card's middle along a space-filling curve, so that every other card in
 * that order spreads over the list.
 *
 * @param {number[]} centre
 * @param {{ min: number[], side: number }} box
 */
function cardKey(centre, box) {
	const scale = box.side > 0 ? (2 ** CARD_KEY_BITS - 1) / box.side : 0;
	const at = centre.map((v, k) =>
		Math.min(
			2 ** CARD_KEY_BITS - 1,
			Math.max(0, Math.round((v - /** @type {number} */ (box.min[k])) * scale)),
		),
	);
	let key = 0;
	for (let bit = CARD_KEY_BITS - 1; bit >= 0; bit--)
		for (const axis of at) key = key * 2 + ((axis >> bit) & 1);
	return key;
}

/**
 * The triangle lists of a card, by its vertices: a quad of four vertices and two triangles, or a
 * card folded along its middle, of six vertices and four triangles, as Creek makes its leaves.
 */
const CARD_CORNERS = new Map([
	[4, 6],
	[6, 12],
]);

/**
 * The cards of a triangle list, where every separate piece of the list is one of {@link
 * CARD_CORNERS}' shapes, as a leaf card is; otherwise null. The cards come in an order that
 * spreads them over the list, so that each level keeps an even share of them.
 *
 * @param {Uint32Array} indices
 * @param {Float32Array} positions
 * @returns {Card[] | null}
 */
function cardsOf(indices, positions) {
	const count = indices.length / 3;
	if (count === 0) return null;
	const parent = new Map();
	/** @param {number} v */
	const find = (v) => {
		let root = v;
		while (parent.get(root) !== root) root = /** @type {number} */ (parent.get(root));
		let at = v;
		while (at !== root) {
			const next = /** @type {number} */ (parent.get(at));
			parent.set(at, root);
			at = next;
		}
		return root;
	};
	/** @param {number} a @param {number} b */
	const union = (a, b) => {
		const [ra, rb] = [find(a), find(b)];
		if (ra !== rb) parent.set(ra, rb);
	};
	for (let i = 0; i < indices.length; i++)
		parent.set(/** @type {number} */ (indices[i]), indices[i]);
	for (let t = 0; t < count; t++) {
		const [a, b, c] = [
			/** @type {number} */ (indices[t * 3]),
			/** @type {number} */ (indices[t * 3 + 1]),
			/** @type {number} */ (indices[t * 3 + 2]),
		];
		union(a, b);
		union(b, c);
	}
	/** @type {Map<number, { vertices: Set<number>, triangles: number[] }>} */
	const groups = new Map();
	for (let t = 0; t < count; t++) {
		const corners = [
			/** @type {number} */ (indices[t * 3]),
			/** @type {number} */ (indices[t * 3 + 1]),
			/** @type {number} */ (indices[t * 3 + 2]),
		];
		const root = find(/** @type {number} */ (corners[0]));
		let group = groups.get(root);
		if (!group) {
			group = { vertices: new Set(), triangles: [] };
			groups.set(root, group);
		}
		for (const corner of corners) group.vertices.add(corner);
		group.triangles.push(...corners);
	}
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	/** @type {Card[]} */
	const cards = [];
	for (const { vertices, triangles } of groups.values()) {
		// A piece of any other shape is no card. A flat-shaded surface splits every face into a
		// piece of three vertices, so it stays out.
		if (CARD_CORNERS.get(vertices.size) !== triangles.length) return null;
		const list = [...vertices];
		let size = 0;
		for (let a = 0; a < list.length; a++)
			for (let b = a + 1; b < list.length; b++) {
				const i = /** @type {number} */ (list[a]);
				const j = /** @type {number} */ (list[b]);
				size = Math.max(
					size,
					Math.hypot(
						/** @type {number} */ (positions[i * 3]) - /** @type {number} */ (positions[j * 3]),
						/** @type {number} */ (positions[i * 3 + 1]) -
							/** @type {number} */ (positions[j * 3 + 1]),
						/** @type {number} */ (positions[i * 3 + 2]) -
							/** @type {number} */ (positions[j * 3 + 2]),
					),
				);
			}
		const centre = [0, 0, 0];
		for (const v of list)
			for (let k = 0; k < 3; k++) {
				const value = /** @type {number} */ (positions[v * 3 + k]);
				centre[k] = /** @type {number} */ (centre[k]) + value / list.length;
				if (value < /** @type {number} */ (min[k])) min[k] = value;
				if (value > /** @type {number} */ (max[k])) max[k] = value;
			}
		cards.push({ vertices: list, triangles, centre, size });
	}
	const side = Math.max(0, ...max.map((v, k) => v - /** @type {number} */ (min[k])));
	const box = { min, side };
	return cards
		.map((card) => ({ card, key: cardKey(card.centre, box) }))
		.sort((a, b) => a.key - b.key)
		.map(({ card }) => card);
}

/** The bits of a float, for a hash of the values that welding keeps equal. */
const HASH_FLOAT = new Float32Array(1);
const HASH_BITS = new Uint32Array(HASH_FLOAT.buffer);

/**
 * True when two values are the same number: -0 matches 0, and NaN matches NaN, as their text
 * does.
 *
 * @param {number} a
 * @param {number} b
 */
const sameValue = (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * Each vertex's first vertex with the same values in every stream, by number: the vertex itself
 * where no earlier one has them. A hash of the values finds the earlier vertices that may match,
 * and an exact comparison decides.
 *
 * @param {Float32Array[]} streams Streams of `sizes` values each.
 * @param {number[]} sizes
 * @param {number} count
 * @returns {Uint32Array}
 */
function sameValues(streams, sizes, count) {
	const firsts = new Uint32Array(count);
	/** @type {Map<number, number[]>} */
	const buckets = new Map();
	for (let v = 0; v < count; v++) {
		let hash = 0x811c9dc5;
		for (let s = 0; s < streams.length; s++) {
			const stream = /** @type {Float32Array} */ (streams[s]);
			const size = /** @type {number} */ (sizes[s]);
			for (let k = 0; k < size; k++) {
				const value = /** @type {number} */ (stream[v * size + k]);
				// -0 hashes as 0, and every NaN alike, so that values the comparison takes as the same
				// share a bucket.
				HASH_FLOAT[0] = value === 0 ? 0 : Number.isNaN(value) ? Number.NaN : value;
				hash = Math.imul(hash ^ /** @type {number} */ (HASH_BITS[0]), 0x01000193);
			}
		}
		const bucket = buckets.get(hash);
		let first = v;
		if (bucket) {
			const match = bucket.find((other) =>
				streams.every((stream, s) => {
					const size = /** @type {number} */ (sizes[s]);
					for (let k = 0; k < size; k++)
						if (
							!sameValue(
								/** @type {number} */ (stream[other * size + k]),
								/** @type {number} */ (stream[v * size + k]),
							)
						)
							return false;
					return true;
				}),
			);
			if (match === undefined) bucket.push(v);
			else first = match;
		} else buckets.set(hash, [v]);
		firsts[v] = first;
	}
	return firsts;
}

/**
 * Welds a triangle list's vertices for planning. Vertices merge when they share their place,
 * texture coordinates, color and tangent handedness, and their normals lie within 20 degrees,
 * as Godot welds at import. Each weld takes its first vertex's number, and the average of its
 * normals. A merged vertex then draws with its first vertex's values, which differ from its own
 * only by that angle.
 *
 * @param {ListStreams} streams
 * @param {boolean} posed
 * @param {number} [side] The mesh's longest side, which a texture coordinate's unit weighs; 0
 *   leaves the texture coordinates out of the error, for a caller that reads only the triangles.
 * @param {boolean} [cards] Whether a list of separate quads counts as leaf cards, whose levels
 *   thin the cards. A posed list never does. A list that takes no cards simplifies as any other,
 *   so separate quads that build a wall lose only the pieces that pruning drops.
 * @returns {PlanningList}
 */
export function weldList(streams, posed = false, side = 0, cards = !posed) {
	const { positions, normal, color, tangent, texcoords, indices } = streams;
	const count = positions.length / 3;
	const surface = [...texcoords, ...(color ? [color] : [])];
	const handedness =
		tangent?.size === 4
			? Float32Array.from({ length: count }, (_, v) =>
					Math.sign(/** @type {number} */ (tangent.values[v * 4 + 3])),
				)
			: new Float32Array(count);
	// Each vertex's place and look, as the first vertex that shares them: a look is its texture
	// coordinates, color and tangent handedness.
	const places = sameValues([positions], [3], count);
	const looks = sameValues(
		[...surface.map((s) => s.values), handedness],
		[...surface.map((s) => s.size), 1],
		count,
	);
	// The look that each place takes first, and whether another look meets it there: a seam.
	const placeLook = new Int32Array(count).fill(-1);
	const seamAt = new Uint8Array(count);
	/** @type {Map<number, number[]>} */
	const firsts = new Map();
	const remap = new Uint32Array(count);
	const sums = new Float64Array(count * 3);
	for (let v = 0; v < count; v++) {
		const place = /** @type {number} */ (places[v]);
		const look = /** @type {number} */ (looks[v]);
		const seen = /** @type {number} */ (placeLook[place]);
		if (seen < 0) placeLook[place] = look;
		else if (seen !== look) seamAt[place] = 1;
		const key = place * count + look;
		const candidates = firsts.get(key) ?? [];
		firsts.set(key, candidates);
		const n = normal?.values;
		const match = candidates.find(
			(first) =>
				!n ||
				/** @type {number} */ (n[first * 3]) * /** @type {number} */ (n[v * 3]) +
					/** @type {number} */ (n[first * 3 + 1]) * /** @type {number} */ (n[v * 3 + 1]) +
					/** @type {number} */ (n[first * 3 + 2]) * /** @type {number} */ (n[v * 3 + 2]) >=
					WELD_COS,
		);
		const first = match ?? v;
		if (match === undefined) candidates.push(v);
		remap[v] = first;
		if (n)
			for (let k = 0; k < 3; k++)
				sums[first * 3 + k] =
					/** @type {number} */ (sums[first * 3 + k]) + /** @type {number} */ (n[v * 3 + k]);
	}
	const welded = new Float32Array(count * 3);
	for (let v = 0; v < count; v++) {
		const x = /** @type {number} */ (sums[v * 3]);
		const y = /** @type {number} */ (sums[v * 3 + 1]);
		const z = /** @type {number} */ (sums[v * 3 + 2]);
		const length = Math.hypot(x, y, z) || 1;
		welded.set([x / length, y / length, z / length], v * 3);
	}
	/**
	 * The values that the simplifier keeps near the base mesh's, and their weights. The simplifier
	 * scales the list's points into a box of side 1 before it weighs them, so each weight is a
	 * share of the list's own longest side, whatever the units of the positions. A normal or color
	 * component's change of 1 counts like a distance of the list's whole side. A texture
	 * coordinate covers the texture across a UV unit, so a UV unit counts like a sixty-fourth of
	 * the mesh's longest side: a slide of a large share of a texture counts like a small distance,
	 * while a slide of a few texels stays under the geometry's own error. Measured against the
	 * list's side, that is the mesh's side over 64 times the list's.
	 */
	const extent = longestSide(positions, indices);
	const uvWeight = extent > 0 ? side / (64 * extent) : 0;
	/** @type {{ values: Float32Array, size: number, take: number, weight: number }[]} */
	const parts = [
		...(normal ? [{ values: welded, size: 3, take: 3, weight: ATTRIBUTE_WEIGHT }] : []),
		...texcoords.map((uv) => ({ ...uv, take: 2, weight: uvWeight })),
		...(color ? [{ ...color, take: 3, weight: ATTRIBUTE_WEIGHT }] : []),
	];
	const channels = parts.reduce((sum, part) => sum + part.take, 0);
	const attributes = new Float32Array(count * channels);
	for (let v = 0; v < count; v++) {
		let at = v * channels;
		for (const { values, size, take } of parts)
			for (let k = 0; k < take; k++)
				attributes[at++] = /** @type {number} */ (values[v * size + k]);
	}
	const seams = Uint8Array.from({ length: count }, (_, v) =>
		seamAt[/** @type {number} */ (places[v])] ? SEAM : 0,
	);
	for (let i = 0; i < indices.length; i++)
		indices[i] = /** @type {number} */ (remap[/** @type {number} */ (indices[i])]);
	return {
		positions,
		attributes,
		stride: channels,
		weights: parts.flatMap(({ take, weight }) => Array(take).fill(weight)),
		seams,
		indices,
		cards: posed || !cards ? null : cardsOf(indices, positions),
		posed,
	};
}

/** The ways each simplification tries, on top of the flags that every one takes. */
const TRIES = /** @type {const} */ ([[], ['Prune'], ['Permissive'], ['Permissive', 'Prune']]);

/**
 * A card list's level: the triangles of every `every`-th card, in the list's order, and the list's
 * positions with each kept card grown about its middle, so that the cards cover the surface that
 * the dropped ones covered. The error is the size of the largest card that the step drops.
 *
 * @param {PlanningList} list
 * @param {number} every
 * @returns {[Uint32Array, number, Float32Array]} The triangles, their error and the positions.
 */
function thinCards(list, every) {
	const cards = list.cards ?? [];
	const grow = Math.sqrt(every);
	const indices = new Uint32Array(list.indices.length);
	const positions = new Float32Array(list.positions);
	let at = 0;
	let error = 0;
	for (let k = 0; k < cards.length; k++) {
		const card = /** @type {Card} */ (cards[k]);
		if (k % every !== 0) {
			error = Math.max(error, card.size);
			continue;
		}
		indices.set(card.triangles, at);
		at += card.triangles.length;
		for (const v of card.vertices)
			for (let c = 0; c < 3; c++) {
				const centre = /** @type {number} */ (card.centre[c]);
				const value = /** @type {number} */ (list.positions[v * 3 + c]);
				positions[v * 3 + c] = centre + (value - centre) * grow;
			}
	}
	return [indices.subarray(0, at), error, positions];
}

/**
 * Simplifies a triangle list toward a share of its triangles, under an error limit in planning
 * units, as {@link simplifyTries} chooses. Pruning lets small separate parts vanish. Permissive
 * simplification lets normal seams move but keeps texture and color seams: in a mesh of flat
 * faces every edge is a normal seam, so little simplifies without it. A list that every way
 * empties keeps its triangles. A list of separate cards thins its cards instead, once `every`
 * names a step.
 *
 * @param {Meshopt} meshopt
 * @param {PlanningList} list
 * @param {Uint32Array} indices The triangles to simplify, a subset of the list's welded ones.
 * @param {number} share
 * @param {number} limit
 * @param {SimplifierFlag[]} flags
 * @param {number} [every] For a level of detail, the base mesh's cards for each card that the
 *   level keeps.
 * @returns {[Uint32Array, number, Float32Array?]} The triangles, their error, and the positions
 *   when the step moved vertices.
 */
function simplifyList(meshopt, list, indices, share, limit, flags, every) {
	if (every !== undefined && list.cards)
		return thinCards(list, Math.min(every, Math.max(1, list.cards.length)));
	return simplifyTries(meshopt, list, indices, share, limit, flags) ?? [indices, 0];
}

/**
 * Simplifies a triangle list toward a share of its triangles in each of the four ways, and keeps
 * the result of least error among those that reach the share or come within half the cut of it.
 * When no way comes that near, it keeps the result with the fewest triangles. The whole levels and
 * the patches of a cluster tree both choose this way.
 *
 * `locks` holds the vertex marks of the ways that keep normal seams, and of the permissive ways,
 * which let them move: 1 locks a vertex, and 2 keeps it on its texture or color seam. With no
 * marks, only the permissive ways mark the seams.
 *
 * @param {Meshopt} meshopt
 * @param {PlanningList} list
 * @param {Uint32Array} indices The triangles to simplify, a subset of the list's welded ones.
 * @param {number} share
 * @param {number} limit The largest error, in planning units.
 * @param {SimplifierFlag[]} flags
 * @param {[Uint8Array | null, Uint8Array | null]} [locks]
 * @returns {[Uint32Array, number] | undefined} The triangles and their error, or none when every
 *   way leaves nothing.
 */
export function simplifyTries(
	meshopt,
	list,
	indices,
	share,
	limit,
	flags,
	locks = [null, list.seams],
) {
	const target = Math.floor((indices.length / 3) * share) * 3;
	const enough = (indices.length * (1 + share)) / 2;
	/** @type {[Uint32Array, number] | undefined} */
	let best;
	for (const extra of TRIES) {
		const permissive = extra[0] === 'Permissive';
		const result = meshopt.simplifyWithAttributes(
			indices,
			list.positions,
			3,
			list.attributes,
			list.stride,
			list.weights,
			permissive ? locks[1] : locks[0],
			target,
			limit,
			[...flags, ...extra],
		);
		if (result[0].length === 0 && indices.length > 0) continue;
		const better =
			!best ||
			(result[0].length <= enough
				? best[0].length > enough || result[1] < best[1]
				: best[0].length > enough && result[0].length < best[0].length);
		if (better) best = result;
	}
	return best;
}

/**
 * The flags of every simplification: borders stay, so the lists of a mesh still meet; errors are
 * distances; and meshes that bend, with joints or morph targets, keep evener triangles.
 *
 * @param {boolean} bends
 * @returns {SimplifierFlag[]}
 */
export function simplifierFlags(bends) {
	return [
		'LockBorder',
		'Sparse',
		'ErrorAbsolute',
		...(bends ? /** @type {const} */ (['Regularize']) : []),
	];
}

/**
 * Simplifies one step: each list toward a share of its triangles.
 *
 * @param {Meshopt} meshopt
 * @param {PlanningList[]} lists
 * @param {Uint32Array[]} from Each list's triangles.
 * @param {number} share
 * @param {number} limit
 * @param {SimplifierFlag[]} flags
 * @param {number} [every] For a level of detail, the base mesh's cards for each card that the
 *   level keeps.
 */
export function simplifyStep(meshopt, lists, from, share, limit, flags, every) {
	const result = lists.map((list, p) =>
		simplifyList(meshopt, list, /** @type {Uint32Array} */ (from[p]), share, limit, flags, every),
	);
	return {
		indices: result.map(([indices]) => indices),
		positions: result.map(([, , positions]) => positions),
		error: Math.max(0, ...result.map(([, error]) => error)),
		triangles: result.reduce((sum, [indices]) => sum + indices.length / 3, 0),
	};
}

/**
 * One lower level of a mesh: its indices for each triangle list, the positions of the lists whose
 * vertices the step moved, its error and its triangles. A list of cards keeps its own positions,
 * with each kept card grown; the other lists share the mesh's. The error estimates the level's
 * distance from the full mesh, in the units of the positions that the planner read: each step
 * reports its distance from the level above, and the plan keeps at least half again the value
 * before. It is not measured against the base mesh, so a chain of steps can lie farther from the
 * base than the stored value.
 *
 * @typedef {object} PlannedLevel
 * @property {Uint32Array[]} indices
 * @property {(Float32Array | undefined)[]} positions
 * @property {number} error
 * @property {number} triangles
 */

/**
 * Plans the levels of detail of one mesh from its welded triangle lists. Each level simplifies the
 * level above toward half its triangles, with no error limit short of the mesh's size: the engine
 * draws a level only where its error spans under a pixel, so a coarse level only draws far away.
 * Each level's error is at least 1.5 times the level above's, grown from the errors that the
 * simplifier reports for its step; it is an estimate rather than a measurement of the level
 * against the base mesh. The levels stop at the floor, after
 * `maxLevels` levels, when one keeps more than three quarters of the triangles above it, or when
 * its error reaches the mesh's size. They share the mesh's vertices: only their indices are new,
 * each list's in the order of the GPU's vertex cache.
 *
 * @param {Meshopt} meshopt
 * @param {PlanningList[]} lists
 * @param {number} total The mesh's triangles.
 * @param {number} side The mesh's longest side, in the units of its positions.
 * @param {SimplifierFlag[]} flags
 * @param {number} [maxLevels] The most lower levels to make.
 * @returns {PlannedLevel[]}
 */
export function planMeshLevels(meshopt, lists, total, side, flags, maxLevels = LOD_MAX_LEVELS) {
	/** @type {PlannedLevel[]} */
	const levels = [];
	let from = lists.map((list) => list.indices);
	let previous = total;
	let error = 0;
	while (levels.length < maxLevels && previous >= 2 * LOD_FLOOR_TRIANGLES) {
		// A list of cards keeps one card of every 2^level, the level counted from the base's 0.
		const every = 2 ** (levels.length + 1);
		const step = simplifyStep(meshopt, lists, from, LOD_STEP, side, flags, every);
		if (step.triangles === 0 || step.triangles > previous * LOD_MAX_KEPT) break;
		error = Math.max(error * LOD_ERROR_GROWTH, step.error);
		if (error >= side) break;
		levels.push({
			indices: step.indices.map(meshopt.cacheOrder),
			positions: step.positions,
			error,
			triangles: step.triangles,
		});
		from = step.indices;
		previous = step.triangles;
	}
	return levels;
}
