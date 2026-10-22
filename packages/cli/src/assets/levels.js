// The tool's levels of detail, planned as Godot plans them at import. The simplifier sees each
// triangle list with its vertices welded, so that copies an exporter left at one place do not
// hold it back, and with the normals and colors in its error. Each level simplifies the level
// above to about half its triangles, until a level saves too little. Each level keeps its error
// as a distance in the units the mesh draws in, which the engine compares with the screen.
import { MathUtils } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { cacheOrder, setIndices, triangleIndices, triangleLists } from './geometry.js';
import { lodOf, MSFT_LOD, MSFTLod } from './lod-extension.js';

/** @import { Accessor, Buffer, Document, Mesh, Node, Primitive, Skin } from '@gltf-transform/core' */
/** @import { SimplifierFlags } from 'meshoptimizer' */

/** Meshes with fewer triangles get no levels of detail: they cost little to draw anyway. */
export const LOD_MIN_TRIANGLES = 64;

/** The share of the level above's triangles that each level aims for. */
const LOD_STEP = 0.5;

/**
 * A level that keeps more than this share of the level above's triangles ends the levels: it
 * fell short of its target by more than half the cut.
 */
const LOD_MAX_KEPT = (1 + LOD_STEP) / 2;

/**
 * Each level's error is at least this many times the level above's, so that the distances at
 * which levels switch stay apart.
 */
const LOD_ERROR_GROWTH = 1.5;

/** The most lower levels that a mesh gets. */
export const LOD_MAX_LEVELS = 6;

/**
 * The screen height in pixels that the stored screen coverage assumes, for readers of MSFT_lod
 * that pick levels by coverage. The engine reads each level's error instead.
 */
export const LOD_SCREEN_PIXELS = 1080;

/** The cosine of the widest angle between two normals that welding still merges. */
const WELD_COS = Math.cos((20 * Math.PI) / 180);

/** The weight of each normal and color component in the simplifier's error. */
const ATTRIBUTE_WEIGHT = 1;

/**
 * The largest error of a simplified base mesh by default, as a share of the mesh's longest side:
 * gltfpack's default.
 */
export const SIMPLIFY_MAX_ERROR = 0.01;

/** A vertex lock that lets a vertex move along a seam but not across it, in permissive mode. */
const SEAM = 2;

/**
 * An accessor's values in the mesh's units: normalized integers become the fractions they
 * stand for.
 *
 * @param {Accessor} accessor
 */
function floats(accessor) {
	const out = Float32Array.from(/** @type {ArrayLike<number>} */ (accessor.getArray()));
	if (accessor.getNormalized()) {
		const type = accessor.getComponentType();
		for (let i = 0; i < out.length; i++)
			out[i] = MathUtils.decodeNormalizedInt(/** @type {number} */ (out[i]), type);
	}
	return out;
}

/**
 * The product of two column-major 4 x 4 matrices.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
function multiply(a, b) {
	const out = new Float64Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++)
				sum += /** @type {number} */ (a[k * 4 + r]) * /** @type {number} */ (b[c * 4 + k]);
			out[c * 4 + r] = sum;
		}
	return out;
}

/**
 * The positions of a skinned triangle list in its skeleton's rest pose: each vertex moved by its
 * joints as the file places them, through their inverse bind matrices. A vertex with no weight
 * keeps its place.
 *
 * @param {Primitive} prim
 * @param {Float32Array} positions
 * @param {Skin} skin
 */
function restPose(prim, positions, skin) {
	const bind = skin.getInverseBindMatrices();
	const matrices = skin
		.listJoints()
		.map((joint, j) =>
			multiply(
				joint.getWorldMatrix(),
				bind ? bind.getElement(j, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			),
		);
	const sets = [];
	for (let k = 0; prim.getAttribute(`JOINTS_${k}`) && prim.getAttribute(`WEIGHTS_${k}`); k++)
		sets.push({
			joints: /** @type {ArrayLike<number>} */ (
				/** @type {Accessor} */ (prim.getAttribute(`JOINTS_${k}`)).getArray()
			),
			weights: floats(/** @type {Accessor} */ (prim.getAttribute(`WEIGHTS_${k}`))),
		});
	const out = new Float32Array(positions.length);
	for (let v = 0; v < positions.length / 3; v++) {
		const x = /** @type {number} */ (positions[v * 3]);
		const y = /** @type {number} */ (positions[v * 3 + 1]);
		const z = /** @type {number} */ (positions[v * 3 + 2]);
		let px = 0;
		let py = 0;
		let pz = 0;
		let total = 0;
		for (const { joints, weights } of sets)
			for (let i = v * 4; i < v * 4 + 4; i++) {
				const w = /** @type {number} */ (weights[i]);
				const m = matrices[/** @type {number} */ (joints[i])];
				if (w === 0 || !m) continue;
				const at = (/** @type {number} */ k) => /** @type {number} */ (m[k]);
				px += w * (at(0) * x + at(4) * y + at(8) * z + at(12));
				py += w * (at(1) * x + at(5) * y + at(9) * z + at(13));
				pz += w * (at(2) * x + at(6) * y + at(10) * z + at(14));
				total += w;
			}
		out.set(total > 0 ? [px / total, py / total, pz / total] : [x, y, z], v * 3);
	}
	return out;
}

/**
 * The longest side of the box around a list of points.
 *
 * @param {Float32Array} positions
 */
function longestSide(positions) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i++) {
		const v = /** @type {number} */ (positions[i]);
		const k = i % 3;
		if (v < /** @type {number} */ (min[k])) min[k] = v;
		if (v > /** @type {number} */ (max[k])) max[k] = v;
	}
	return Math.max(0, ...max.map((v, k) => v - /** @type {number} */ (min[k])));
}

/**
 * A triangle list as the simplifier plans it.
 *
 * @typedef {object} PlanningList
 * @property {Primitive} prim
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

/**
 * The text that a vertex's place and the values welding must keep equal give it.
 *
 * @param {Float32Array[]} streams Streams of `sizes` values each.
 * @param {number[]} sizes
 * @param {number} v
 */
function vertexKey(streams, sizes, v) {
	let key = '';
	streams.forEach((stream, s) => {
		const size = /** @type {number} */ (sizes[s]);
		for (let k = 0; k < size; k++) key += `${stream[v * size + k]},`;
		key += '|';
	});
	return key;
}

/**
 * Welds a triangle list's vertices for planning. Vertices merge when they share their place,
 * texture coordinates, color and tangent handedness, and their normals lie within 20 degrees,
 * as Godot welds at import. Each weld takes its first vertex's number, and the average of its
 * normals. A merged vertex then draws with its first vertex's values, which differ from its own
 * only by that angle.
 *
 * @param {Primitive} prim
 * @param {Float32Array} positions
 * @param {boolean} posed
 * @param {number} side The mesh's longest side, which a texture coordinate's unit weighs.
 * @returns {PlanningList}
 */
function weld(prim, positions, posed, side) {
	const count = positions.length / 3;
	const stream = (/** @type {string} */ semantic) => {
		const accessor = prim.getAttribute(semantic);
		return accessor ? { values: floats(accessor), size: accessor.getElementSize() } : null;
	};
	const normal = stream('NORMAL');
	const color = stream('COLOR_0');
	const tangent = stream('TANGENT');
	const texcoords = prim
		.listSemantics()
		.filter((s) => s.startsWith('TEXCOORD_'))
		.map((s) => /** @type {{ values: Float32Array, size: number }} */ (stream(s)));
	const surface = [...texcoords, ...(color ? [color] : [])];
	const handedness =
		tangent?.size === 4
			? Float32Array.from({ length: count }, (_, v) =>
					Math.sign(/** @type {number} */ (tangent.values[v * 4 + 3])),
				)
			: new Float32Array(count);
	const placeKeys = Array.from({ length: count }, (_, v) => vertexKey([positions], [3], v));
	/** @type {Map<string, Set<string>>} */
	const looks = new Map();
	/** @type {Map<string, number[]>} */
	const firsts = new Map();
	const remap = new Uint32Array(count);
	const sums = new Float64Array(count * 3);
	for (let v = 0; v < count; v++) {
		const place = /** @type {string} */ (placeKeys[v]);
		const look = vertexKey(
			[...surface.map((s) => s.values), handedness],
			[...surface.map((s) => s.size), 1],
			v,
		);
		looks.set(place, (looks.get(place) ?? new Set()).add(look));
		const key = place + look;
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
	 * The values that the simplifier keeps near the base mesh's, and their weights in the units of
	 * its positions. A texture coordinate covers the texture across a UV unit, so it weighs a
	 * sixty-fourth of the mesh's longest side: a slide of a large share of a texture counts like a
	 * small distance, while a slide of a few texels stays under the geometry's own error.
	 */
	/** @type {{ values: Float32Array, size: number, take: number, weight: number }[]} */
	const parts = [
		...(normal ? [{ values: welded, size: 3, take: 3, weight: ATTRIBUTE_WEIGHT }] : []),
		...texcoords.map((uv) => ({ .../** @type {typeof uv} */ (uv), take: 2, weight: side / 64 })),
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
		/** @type {Set<string>} */ (looks.get(/** @type {string} */ (placeKeys[v]))).size > 1
			? SEAM
			: 0,
	);
	const indices = triangleIndices(prim, count);
	for (let i = 0; i < indices.length; i++)
		indices[i] = /** @type {number} */ (remap[/** @type {number} */ (indices[i])]);
	return {
		prim,
		positions,
		attributes,
		stride: channels,
		weights: parts.flatMap(({ take, weight }) => Array(take).fill(weight)),
		seams,
		indices,
		cards: posed ? null : cardsOf(indices, positions),
		posed,
	};
}

/**
 * The skin of the first node that draws a mesh with one, or null.
 *
 * @param {Mesh} mesh
 */
const skinOf = (mesh) =>
	/** @type {Node[]} */ (mesh.listParents().filter((p) => p.propertyType === 'Node'))
		.map((node) => node.getSkin())
		.find((skin) => skin !== null) ?? null;

/**
 * A mesh's triangle lists as the simplifier plans them, with the mesh's longest side. A skinned
 * mesh plans in its skeleton's rest pose, as it draws, so its distances are in the units of the
 * scene that holds the skeleton.
 *
 * @param {Mesh} mesh
 * @param {Primitive[]} prims
 */
function planningLists(mesh, prims) {
	const skin = skinOf(mesh);
	let side = 0;
	const placed = prims.map((prim) => {
		const own = floats(/** @type {Accessor} */ (prim.getAttribute('POSITION')));
		const posed =
			skin && prim.getAttribute('JOINTS_0') && prim.getAttribute('WEIGHTS_0')
				? restPose(prim, own, skin)
				: own;
		side = Math.max(side, longestSide(posed));
		return { own, posed };
	});
	const lists = prims.map((prim, p) => {
		const { own, posed } = /** @type {{ own: Float32Array, posed: Float32Array }} */ (placed[p]);
		return weld(prim, posed, posed !== own, side);
	});
	return { lists, side };
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
 * units, in each of four ways, and keeps the result of least error among those that reach the
 * share or come within half the cut of it. Pruning lets small separate parts vanish. Permissive
 * simplification lets normal seams move but keeps texture and color seams: in a mesh of flat
 * faces every edge is a normal seam, so little simplifies without it. A list that no way brings
 * near its share keeps the result with the fewest triangles. A list of separate cards thins its
 * cards instead, at the level's own step, once `level` names one.
 *
 * @param {PlanningList} list
 * @param {Uint32Array} indices The triangles to simplify, a subset of the list's welded ones.
 * @param {number} share
 * @param {number} limit
 * @param {SimplifierFlags[]} flags
 * @param {number} [level] The level of detail, counted from the base mesh's 0: a mesh's level
 *   keeps one card of every `2^level`.
 * @returns {[Uint32Array, number, Float32Array?]} The triangles, their error, and the positions
 *   when the step moved vertices.
 */
function simplifyList(list, indices, share, limit, flags, level) {
	if (level !== undefined && list.cards)
		return thinCards(list, Math.min(2 ** level, Math.max(1, list.cards.length)));
	const target = Math.floor((indices.length / 3) * share) * 3;
	const enough = (indices.length * (1 + share)) / 2;
	/** @type {[Uint32Array, number] | undefined} */
	let best;
	for (const extra of TRIES) {
		const permissive = extra[0] === 'Permissive';
		const result = MeshoptSimplifier.simplifyWithAttributes(
			indices,
			list.positions,
			3,
			list.attributes,
			list.stride,
			list.weights,
			permissive ? list.seams : null,
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
	return best ?? [indices, 0];
}

/**
 * The flags of every simplification: borders stay, so the lists of a mesh still meet; errors are
 * distances; and meshes that bend, with joints or morph targets, keep evener triangles.
 *
 * @param {Primitive[]} prims
 * @returns {SimplifierFlags[]}
 */
function simplifierFlags(prims) {
	const bends = prims.some(
		(prim) => prim.getAttribute('JOINTS_0') !== null || prim.listTargets().length > 0,
	);
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
 * @param {PlanningList[]} lists
 * @param {Uint32Array[]} from Each list's triangles.
 * @param {number} share
 * @param {number} limit
 * @param {SimplifierFlags[]} flags
 * @param {number} [level] The level of detail that the step makes, for a list of cards.
 */
function simplifyStep(lists, from, share, limit, flags, level) {
	const result = lists.map((list, p) =>
		simplifyList(list, /** @type {Uint32Array} */ (from[p]), share, limit, flags, level),
	);
	return {
		indices: result.map(([indices]) => indices),
		positions: result.map(([, , positions]) => positions),
		error: Math.max(0, ...result.map(([, error]) => error)),
		triangles: result.reduce((sum, [indices]) => sum + indices.length / 3, 0),
	};
}

/**
 * The levels of detail of one mesh: each level's indices for each triangle list, its error, and
 * the positions of the lists whose vertices a step moved.
 *
 * @typedef {object} MeshLevels
 * @property {Primitive[]} prims The mesh's triangle lists, in the order of each level's indices.
 * @property {number} side The mesh's longest side, in the units of its errors.
 * @property {{ indices: Uint32Array[], positions: (Float32Array | undefined)[], error: number,
 *   triangles: number }[]} levels The lower levels, from the most detailed down. A list of cards
 *   keeps its own positions, with each kept card grown; the other lists share the mesh's. The
 *   error is the largest distance between the level's surface and the full mesh's, in the units of
 *   the mesh's stored positions, or of the scene that holds its skeleton for a skinned mesh, in
 *   its rest pose.
 */

/**
 * True for a mesh that a file's own levels already use, as the full mesh or as a level.
 *
 * @param {Mesh} mesh
 */
const hasLevels = (mesh) =>
	mesh
		.listParents()
		.some(
			(p) =>
				p.propertyType === 'Node' &&
				(lodOf(/** @type {Node} */ (p)) !== null ||
					p.listParents().some((q) => q.propertyType === 'Lod')),
		);

/**
 * Plans levels of detail for each mesh of enough triangles. Each level simplifies the level above
 * toward half its triangles, with no error limit short of the mesh's size: the engine draws a
 * level only where its error spans under a pixel, so a coarse level only draws far away. Each
 * level's error is at least 1.5 times the level above's. The levels stop when one keeps more than
 * three quarters of the triangles above it. They share the mesh's vertices: only their indices
 * are new. Meshes whose levels the file already has keep them.
 *
 * Run after quantizing: the planning reads the positions as stored, so the errors are in the
 * units that the file's mesh has.
 *
 * @param {Document} doc
 * @returns {Promise<Map<Mesh, MeshLevels>>}
 */
export async function planLevels(doc) {
	await MeshoptSimplifier.ready;
	/** @type {Map<Mesh, MeshLevels>} */
	const plans = new Map();
	for (const mesh of doc.getRoot().listMeshes()) {
		const prims = triangleLists(mesh);
		const total = prims.reduce((sum, prim) => {
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			return sum + (prim.getIndices()?.getCount() ?? count) / 3;
		}, 0);
		if (total < LOD_MIN_TRIANGLES || hasLevels(mesh)) continue;
		const { lists, side } = planningLists(mesh, prims);
		if (side === 0) continue;
		const flags = simplifierFlags(prims);
		/** @type {MeshLevels['levels']} */
		const levels = [];
		let from = lists.map((list) => list.indices);
		let previous = total;
		let error = 0;
		while (levels.length < LOD_MAX_LEVELS) {
			const step = simplifyStep(lists, from, LOD_STEP, side, flags, levels.length + 1);
			if (step.triangles === 0 || step.triangles > previous * LOD_MAX_KEPT) break;
			error = Math.max(error * LOD_ERROR_GROWTH, step.error);
			if (error >= side) break;
			levels.push({
				indices: step.indices.map(cacheOrder),
				positions: step.positions,
				error,
				triangles: step.triangles,
			});
			from = step.indices;
			previous = step.triangles;
		}
		if (levels.length > 0) plans.set(mesh, { prims, side, levels });
	}
	return plans;
}

/**
 * Simplifies each triangle list to a share of its triangles, as far as an error limit allows, as
 * gltfpack's `-si` and `-se` do. The base mesh then draws fewer triangles at
 * every distance. A list that cannot lose a triangle keeps its own indices. Vertices that no
 * triangle uses stay until the reorder step drops them.
 *
 * @param {Document} doc
 * @param {number} share From 0 to 1.
 * @param {number} [maxError] The largest error, as a share of each mesh's longest side.
 */
export async function simplifyMeshes(doc, share, maxError = SIMPLIFY_MAX_ERROR) {
	await MeshoptSimplifier.ready;
	for (const mesh of doc.getRoot().listMeshes()) {
		const prims = triangleLists(mesh);
		if (prims.length === 0 || hasLevels(mesh)) continue;
		const { lists, side } = planningLists(mesh, prims);
		if (side === 0) continue;
		const step = simplifyStep(
			lists,
			lists.map((list) => list.indices),
			share,
			maxError * side,
			simplifierFlags(prims),
		);
		prims.forEach((prim, p) => {
			const indices = /** @type {Uint32Array} */ (step.indices[p]);
			const list = /** @type {PlanningList} */ (lists[p]);
			if (indices.length === list.indices.length) return;
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			setIndices(doc, prim, indices, count);
		});
	}
}

/**
 * The screen coverage of each level, for readers that pick levels by it: the share of the
 * screen's height below which the level after it errs by less than a pixel of a screen
 * {@link LOD_SCREEN_PIXELS} high. The lowest level's is 0, so it draws at any distance.
 *
 * @param {readonly { error: number }[]} levels The lower levels.
 * @param {number} side The mesh's longest side, in the units of the errors.
 */
export function levelCoverage(levels, side) {
	const coverage = levels.map(({ error }) =>
		error > 0 ? Math.min(1, side / (LOD_SCREEN_PIXELS * error)) : 1,
	);
	return [...coverage, 0];
}

/**
 * A copy of a position accessor with new values, in the accessor's own component type, so that a
 * mesh keeps one vertex format. Values outside the type's range take its ends.
 *
 * @param {Document} doc
 * @param {Accessor} base
 * @param {Float32Array} values
 * @param {Buffer} buffer
 */
function positionAccessor(doc, base, values, buffer) {
	const source = /** @type {Float32Array} */ (base.getArray());
	const Type =
		/** @type {Float32ArrayConstructor | Uint16ArrayConstructor | Int16ArrayConstructor | Uint8ArrayConstructor | Int8ArrayConstructor} */ (
			source.constructor
		);
	const out = new Type(values.length);
	if (Type === Float32Array) out.set(values);
	else {
		const normalized = base.getNormalized();
		const unsigned = Type === Uint8Array || Type === Uint16Array;
		const bits = 8 * Type.BYTES_PER_ELEMENT;
		const max = normalized || unsigned ? 2 ** bits - 1 : 2 ** (bits - 1) - 1;
		const min = normalized || unsigned ? 0 : -(2 ** (bits - 1));
		for (let i = 0; i < values.length; i++)
			out[i] = Math.min(max, Math.max(min, Math.round(/** @type {number} */ (values[i]))));
	}
	return doc
		.createAccessor(base.getName())
		.setType('VEC3')
		.setNormalized(base.getNormalized())
		.setArray(out)
		.setBuffer(buffer);
}

/**
 * Stores the planned levels in the document, as MSFT_lod gives them: a mesh for each level, whose
 * triangle lists share the mesh's vertex streams and materials, and a node for each level beside
 * each node that draws the mesh, with that node's transform, skin and instances. A list of cards
 * takes its own positions, with each kept card grown, which the level's primitive reads in place
 * of the base mesh's. The node names its levels and gives each level's error and screen coverage.
 *
 * @param {Document} doc
 * @param {Map<Mesh, MeshLevels>} plans
 */
export function storeLevels(doc, plans) {
	if (plans.size === 0) return;
	const extension = doc.createExtension(MSFTLod);
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	for (const [mesh, { prims, side, levels }] of plans) {
		const meshes = levels.map((level, k) => {
			const lower = doc.createMesh(`${mesh.getName()}_lod${k + 1}`);
			prims.forEach((prim, p) => {
				const indices = /** @type {Uint32Array} */ (level.indices[p]);
				if (indices.length === 0) return;
				const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
				const copy = doc
					.createPrimitive()
					.setMode(prim.getMode())
					.setMaterial(prim.getMaterial())
					.setIndices(
						doc
							.createAccessor()
							.setType('SCALAR')
							.setArray(count <= 0xffff ? Uint16Array.from(indices) : Uint32Array.from(indices))
							.setBuffer(buffer),
					);
				const positions = level.positions[p];
				for (const semantic of prim.listSemantics()) {
					const base = /** @type {Accessor} */ (prim.getAttribute(semantic));
					copy.setAttribute(
						semantic,
						semantic === 'POSITION' && positions
							? positionAccessor(doc, base, positions, buffer)
							: base,
					);
				}
				for (const target of prim.listTargets()) copy.addTarget(target);
				lower.addPrimitive(copy);
			});
			return lower;
		});
		const coverage = levelCoverage(levels, side);
		const errors = levels.map((level) => level.error);
		for (const node of mesh.listParents().filter((p) => p.propertyType === 'Node')) {
			const base = /** @type {Node} */ (node);
			const instancing = base.getExtension('EXT_mesh_gpu_instancing');
			const lod = extension.createLod().setCoverage(coverage).setErrors(errors);
			meshes.forEach((lower, k) => {
				const level = doc
					.createNode(`${base.getName()}_lod${k + 1}`)
					.setMesh(lower)
					.setSkin(base.getSkin())
					.setTranslation(base.getTranslation())
					.setRotation(base.getRotation())
					.setScale(base.getScale());
				if (instancing)
					level.setExtension('EXT_mesh_gpu_instancing', /** @type {any} */ (instancing).clone());
				lod.addLevel(level);
			});
			base.setExtension(MSFT_LOD, /** @type {any} */ (lod));
		}
	}
}
