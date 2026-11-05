// Distances between a point and a triangle surface, which the cluster tree measures each patch's
// error with. A box tree over the triangles finds the nearest one without testing them all, so a
// patch of the mesh's top level, measured against the whole mesh, still takes little time.

/** The most triangles that one leaf of a tree holds. */
const LEAF_TRIANGLES = 8;

/**
 * The squared distance from the point (`px`, `py`, `pz`) to the triangle of the corners `a`, `b`
 * and `c` in `positions`, from the closest point on the triangle (Ericson, "Real-Time Collision
 * Detection", 5.1.5).
 *
 * @param {Float32Array} positions
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 */
function triangleDistance2(positions, a, b, c, px, py, pz) {
	const p = positions;
	const ax = /** @type {number} */ (p[a * 3]);
	const ay = /** @type {number} */ (p[a * 3 + 1]);
	const az = /** @type {number} */ (p[a * 3 + 2]);
	const abx = /** @type {number} */ (p[b * 3]) - ax;
	const aby = /** @type {number} */ (p[b * 3 + 1]) - ay;
	const abz = /** @type {number} */ (p[b * 3 + 2]) - az;
	const acx = /** @type {number} */ (p[c * 3]) - ax;
	const acy = /** @type {number} */ (p[c * 3 + 1]) - ay;
	const acz = /** @type {number} */ (p[c * 3 + 2]) - az;
	const apx = px - ax;
	const apy = py - ay;
	const apz = pz - az;
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	// The closest point as a + v * ab + w * ac.
	let v = 0;
	let w = 0;
	if (d1 > 0 || d2 > 0) {
		const bpx = apx - abx;
		const bpy = apy - aby;
		const bpz = apz - abz;
		const d3 = abx * bpx + aby * bpy + abz * bpz;
		const d4 = acx * bpx + acy * bpy + acz * bpz;
		const cpx = apx - acx;
		const cpy = apy - acy;
		const cpz = apz - acz;
		const d5 = abx * cpx + aby * cpy + abz * cpz;
		const d6 = acx * cpx + acy * cpy + acz * cpz;
		const vc = d1 * d4 - d3 * d2;
		const vb = d5 * d2 - d1 * d6;
		const va = d3 * d6 - d5 * d4;
		if (d3 >= 0 && d4 <= d3) v = 1;
		else if (d6 >= 0 && d5 <= d6) w = 1;
		else if (vc <= 0 && d1 >= 0 && d3 <= 0) v = d1 / (d1 - d3);
		else if (vb <= 0 && d2 >= 0 && d6 <= 0) w = d2 / (d2 - d6);
		else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			w = (d4 - d3) / (d4 - d3 + (d5 - d6));
			v = 1 - w;
		} else {
			const scale = 1 / (va + vb + vc);
			v = vb * scale;
			w = vc * scale;
		}
	}
	const dx = apx - v * abx - w * acx;
	const dy = apy - v * aby - w * acy;
	const dz = apz - v * abz - w * acz;
	return dx * dx + dy * dy + dz * dz;
}

/** A box tree over a list of triangles, for the distance from a point to their surface. */
export class TriangleTree {
	/**
	 * @param {Float32Array} positions The vertices' positions, three floats each.
	 * @param {Uint32Array} indices The triangles, three indices each.
	 */
	constructor(positions, indices) {
		this.positions = positions;
		this.indices = indices;
		const triangles = indices.length / 3;
		/** The triangles in the order that the leaves name them. */
		this.order = Uint32Array.from({ length: triangles }, (_, t) => t);
		const centres = new Float32Array(triangles * 3);
		for (let t = 0; t < triangles; t++)
			for (let k = 0; k < 3; k++)
				centres[t * 3 + k] =
					/** @type {number} */ (positions[/** @type {number} */ (indices[t * 3]) * 3 + k]) +
					/** @type {number} */ (positions[/** @type {number} */ (indices[t * 3 + 1]) * 3 + k]) +
					/** @type {number} */ (positions[/** @type {number} */ (indices[t * 3 + 2]) * 3 + k]);
		// A split leaves at least half a leaf's triangles on each side, so the leaves number at most
		// one for each half leaf, and the nodes twice that.
		const nodes = 2 * Math.ceil(triangles / (LEAF_TRIANGLES / 2)) + 1;
		/** Each node's box: its lowest corner, then its highest. */
		this.boxes = new Float32Array(nodes * 6);
		/** Each node's first child, or for a leaf its first triangle in `order`. */
		this.first = new Int32Array(nodes);
		/** Each node's second child; unused for a leaf. */
		this.right = new Int32Array(nodes);
		/** Each leaf's triangle count, or 0 for a node with two children. */
		this.count = new Int32Array(nodes);
		this.nodes = 0;
		this.stack = new Int32Array(64);
		if (triangles > 0) this.build(centres, 0, triangles);
	}

	/**
	 * Builds the node over the triangles from `start` to `end` of `order`, split at the middle of
	 * the longest axis of their centres, and returns its place.
	 *
	 * @param {Float32Array} centres
	 * @param {number} start
	 * @param {number} end
	 * @returns {number}
	 */
	build(centres, start, end) {
		const node = this.nodes++;
		const box = this.boxes.subarray(node * 6, node * 6 + 6);
		box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
		for (let i = start; i < end; i++) {
			const t = /** @type {number} */ (this.order[i]);
			for (let k = 0; k < 3; k++) {
				const v = /** @type {number} */ (this.indices[t * 3 + k]);
				for (let c = 0; c < 3; c++) {
					const value = /** @type {number} */ (this.positions[v * 3 + c]);
					if (value < /** @type {number} */ (box[c])) box[c] = value;
					if (value > /** @type {number} */ (box[c + 3])) box[c + 3] = value;
				}
			}
		}
		if (end - start <= LEAF_TRIANGLES) {
			this.first[node] = start;
			this.count[node] = end - start;
			return node;
		}
		let axis = 0;
		for (let c = 1; c < 3; c++)
			if (
				/** @type {number} */ (box[c + 3]) - /** @type {number} */ (box[c]) >
				/** @type {number} */ (box[axis + 3]) - /** @type {number} */ (box[axis])
			)
				axis = c;
		this.order
			.subarray(start, end)
			.sort(
				(a, b) =>
					/** @type {number} */ (centres[a * 3 + axis]) -
						/** @type {number} */ (centres[b * 3 + axis]) || a - b,
			);
		const middle = (start + end) >> 1;
		this.first[node] = this.build(centres, start, middle);
		this.right[node] = this.build(centres, middle, end);
		this.count[node] = 0;
		return node;
	}

	/**
	 * The squared distance from the point to the box of node `node`.
	 *
	 * @param {number} node
	 * @param {number} px
	 * @param {number} py
	 * @param {number} pz
	 */
	boxDistance2(node, px, py, pz) {
		const b = this.boxes;
		const at = node * 6;
		const dx = Math.max(
			/** @type {number} */ (b[at]) - px,
			0,
			px - /** @type {number} */ (b[at + 3]),
		);
		const dy = Math.max(
			/** @type {number} */ (b[at + 1]) - py,
			0,
			py - /** @type {number} */ (b[at + 4]),
		);
		const dz = Math.max(
			/** @type {number} */ (b[at + 2]) - pz,
			0,
			pz - /** @type {number} */ (b[at + 5]),
		);
		return dx * dx + dy * dy + dz * dz;
	}

	/**
	 * The distance from the point (`px`, `py`, `pz`) to the nearest triangle, or Infinity for a tree
	 * with no triangle. A caller that only needs distances above `floor` gets a value of at most
	 * `floor` as soon as one triangle lies that near, which ends most searches early.
	 *
	 * @param {number} px
	 * @param {number} py
	 * @param {number} pz
	 * @param {number} [floor]
	 */
	distance(px, py, pz, floor = 0) {
		if (this.nodes === 0) return Infinity;
		const enough = floor * floor;
		let best = Infinity;
		let stack = this.stack;
		let top = 0;
		stack[top++] = 0;
		while (top > 0 && best > enough) {
			const node = /** @type {number} */ (stack[--top]);
			if (this.boxDistance2(node, px, py, pz) >= best) continue;
			const count = /** @type {number} */ (this.count[node]);
			const first = /** @type {number} */ (this.first[node]);
			if (count > 0) {
				for (let i = first; i < first + count; i++) {
					const t = /** @type {number} */ (this.order[i]);
					const d = triangleDistance2(
						this.positions,
						/** @type {number} */ (this.indices[t * 3]),
						/** @type {number} */ (this.indices[t * 3 + 1]),
						/** @type {number} */ (this.indices[t * 3 + 2]),
						px,
						py,
						pz,
					);
					if (d < best) best = d;
				}
				continue;
			}
			if (top + 2 > stack.length) {
				const grown = new Int32Array(stack.length * 2);
				grown.set(stack);
				stack = grown;
				this.stack = grown;
			}
			// The nearer child goes on top, so its triangles tighten the bound first.
			const left = first;
			const right = /** @type {number} */ (this.right[node]);
			const nearLeft = this.boxDistance2(left, px, py, pz) <= this.boxDistance2(right, px, py, pz);
			stack[top++] = nearLeft ? right : left;
			stack[top++] = nearLeft ? left : right;
		}
		return Math.sqrt(best);
	}
}
