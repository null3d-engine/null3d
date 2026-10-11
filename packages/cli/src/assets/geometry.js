// The tool's steps for meshes: reorder each triangle list for the GPU's vertex cache, and store
// vertices in the 8-bit and 16-bit integers that KHR_mesh_quantization allows. Each step works on
// a glTF-Transform document in place.
import { Accessor, Primitive } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';

/** @import { Document, Mesh, Node, PrimitiveTarget, Skin } from '@gltf-transform/core' */

/**
 * The bits of a quantized position: steps of 1/16,383 of the mesh's longest side, as gltfpack
 * keeps by default. meshopt compresses the values better than with 16 bits.
 */
export const POSITION_BITS = 14;

/** The largest value of a quantized position. */
const POSITION_MAX = 2 ** POSITION_BITS - 1;

/** A vertex index that a reorder's map gives to a vertex that no triangle uses. */
const UNUSED = 0xffffffff;

/** @param {Accessor} accessor */
const isFloat = (accessor) => accessor.getComponentType() === Accessor.ComponentType.FLOAT;

/**
 * The accessors that hold a primitive's vertices, with the slot of each: its attributes, then
 * those of each morph target.
 *
 * @param {Primitive} prim
 * @returns {{ owner: Primitive | PrimitiveTarget, semantic: string, accessor: Accessor }[]}
 */
function vertexStreams(prim) {
	return [prim, ...prim.listTargets()].flatMap((owner) =>
		owner.listSemantics().map((semantic) => ({
			owner,
			semantic,
			accessor: /** @type {Accessor} */ (owner.getAttribute(semantic)),
		})),
	);
}

/**
 * The places that use an accessor, apart from the document's list of accessors.
 *
 * @param {Document} doc
 * @param {Accessor} accessor
 */
const usesOf = (doc, accessor) =>
	doc
		.getGraph()
		.listParentEdges(accessor)
		.filter((edge) => edge.getName() !== 'accessors').length;

/**
 * A triangle list's indices, as 32-bit integers: the primitive's own, or one per vertex.
 *
 * @param {Primitive} prim
 * @param {number} vertices
 */
export function triangleIndices(prim, vertices) {
	const indices = prim.getIndices();
	return indices
		? Uint32Array.from(/** @type {ArrayLike<number>} */ (indices.getArray()))
		: Uint32Array.from({ length: vertices }, (_, i) => i);
}

/**
 * The triangle lists of a mesh that have positions, the only primitives that the steps change.
 *
 * @param {Mesh} mesh
 */
export const triangleLists = (mesh) =>
	mesh
		.listPrimitives()
		.filter(
			(prim) =>
				prim.getMode() === Primitive.Mode.TRIANGLES && prim.getAttribute('POSITION') !== null,
		);

/**
 * Copies the elements of a vertex stream to their places in a reordered stream, and leaves out
 * the vertices that no triangle uses.
 *
 * @template {import('@gltf-transform/core').TypedArray} T
 * @param {T} source
 * @param {number} size The values of one element.
 * @param {Uint32Array} remap Each old vertex's new index.
 * @param {number} count The vertices that triangles use.
 * @returns {T}
 */
function remapped(source, size, remap, count) {
	const Type = /** @type {new (length: number) => T} */ (source.constructor);
	const out = new Type(count * size);
	for (let i = 0; i < remap.length; i++) {
		const to = /** @type {number} */ (remap[i]);
		if (to === UNUSED) continue;
		for (let k = 0; k < size; k++)
			out[to * size + k] = /** @type {number} */ (source[i * size + k]);
	}
	return out;
}

/**
 * Reorders each triangle list for the GPU's vertex cache, then its vertices in the order that the
 * triangles first use them, and drops vertices that no triangle uses. Every vertex stream of a
 * primitive gets the same order, so a stream that another primitive also uses gets a copy.
 *
 * @param {Document} doc
 */
export async function reorderMeshes(doc) {
	await MeshoptEncoder.ready;
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of triangleLists(mesh)) {
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			const indices = triangleIndices(prim, count);
			if (indices.length === 0 || indices.length % 3 !== 0) continue;
			const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);
			const seen = new Set();
			for (const { owner, semantic, accessor } of vertexStreams(prim)) {
				let own = accessor;
				if (seen.has(accessor) || usesOf(doc, accessor) > 1) {
					own = accessor.clone();
					owner.setAttribute(semantic, own);
				}
				seen.add(own);
				own.setArray(
					remapped(
						/** @type {any} */ (accessor.getArray()),
						accessor.getElementSize(),
						remap,
						unique,
					),
				);
			}
			setIndices(doc, prim, indices, unique);
		}
}

/**
 * Gives a primitive new indices, in 16 bits when its vertices allow, in the primitive's own
 * accessor unless another place uses it too.
 *
 * @param {Document} doc
 * @param {Primitive} prim
 * @param {Uint32Array} indices
 * @param {number} vertices
 */
export function setIndices(doc, prim, indices, vertices) {
	const array = vertices <= 0xffff ? Uint16Array.from(indices) : Uint32Array.from(indices);
	const old = prim.getIndices();
	if (old && usesOf(doc, old) === 1) {
		old.setArray(array);
		return;
	}
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	prim.setIndices(
		doc
			.createAccessor(old?.getName() ?? '')
			.setType('SCALAR')
			.setArray(array)
			.setBuffer(buffer),
	);
}

/**
 * A triangle list's order for the vertex cache, in the vertex numbers it had.
 *
 * @param {Uint32Array} indices
 */
export function cacheOrder(indices) {
	const work = indices.slice();
	const [remap] = MeshoptEncoder.reorderMesh(work, true, false);
	const back = new Uint32Array(remap.length);
	for (let i = 0; i < remap.length; i++) {
		const to = /** @type {number} */ (remap[i]);
		if (to !== UNUSED) back[to] = i;
	}
	for (let i = 0; i < work.length; i++)
		work[i] = /** @type {number} */ (back[/** @type {number} */ (work[i])]);
	return work;
}

/**
 * Rotates a vector by a unit quaternion.
 *
 * @param {ArrayLike<number>} q x, y, z, w.
 * @param {ArrayLike<number>} v
 * @returns {[number, number, number]}
 */
function rotate(q, v) {
	const [x, y, z, w] = /** @type {[number, number, number, number]} */ (Array.from(q));
	const [vx, vy, vz] = /** @type {[number, number, number]} */ (Array.from(v));
	const tx = 2 * (y * vz - z * vy);
	const ty = 2 * (z * vx - x * vz);
	const tz = 2 * (x * vy - y * vx);
	return [
		vx + w * tx + (y * tz - z * ty),
		vy + w * ty + (z * tx - x * tz),
		vz + w * tz + (x * ty - y * tx),
	];
}

/**
 * A transform followed by the dequantizing one, `p = offset + scale * q`, as a translation, a
 * rotation and a scale: the scale is the same on each axis, so the result stays in that form.
 *
 * @param {{ t: number[], r: number[], s: number[] }} trs
 * @param {{ offset: number[], scale: number }} volume
 */
function withVolume({ t, r, s }, { offset, scale }) {
	const moved = rotate(
		r,
		offset.map((o, k) => o * /** @type {number} */ (s[k])),
	);
	return {
		t: t.map((v, k) => v + /** @type {number} */ (moved[k])),
		r,
		s: s.map((v) => v * scale),
	};
}

/**
 * The volume that a group of meshes quantizes into: the corner and the step of its integers.
 *
 * @typedef {{ offset: number[], scale: number }} Volume
 */

/**
 * Finds the meshes that must share one volume: those that share position streams, as levels of
 * detail do, and those that one skin binds, whose inverse bind matrices hold the volume.
 *
 * @param {Document} doc
 * @returns {Mesh[][]}
 */
function volumeGroups(doc) {
	const meshes = doc.getRoot().listMeshes();
	/** @type {Map<Mesh, Mesh>} */
	const parent = new Map(meshes.map((m) => [m, m]));
	/** @param {Mesh} m @returns {Mesh} */
	const find = (m) => {
		let root = m;
		while (parent.get(root) !== root) root = /** @type {Mesh} */ (parent.get(root));
		parent.set(m, root);
		return root;
	};
	/** @param {Mesh} a @param {Mesh} b */
	const join = (a, b) => parent.set(find(a), find(b));
	/** @type {Map<Accessor | Skin, Mesh>} */
	const first = new Map();
	/** @param {Accessor | Skin} key @param {Mesh} mesh */
	const link = (key, mesh) => {
		const other = first.get(key);
		if (other) join(other, mesh);
		else first.set(key, mesh);
	};
	for (const mesh of meshes)
		for (const prim of triangleLists(mesh))
			link(/** @type {Accessor} */ (prim.getAttribute('POSITION')), mesh);
	for (const node of doc.getRoot().listNodes()) {
		const mesh = node.getMesh();
		const skin = node.getSkin();
		if (mesh && skin) link(skin, mesh);
	}
	/** @type {Map<Mesh, Mesh[]>} */
	const groups = new Map();
	for (const mesh of meshes) {
		const root = find(mesh);
		groups.set(root, [...(groups.get(root) ?? []), mesh]);
	}
	return [...groups.values()];
}

/**
 * The nodes whose own transform may take a dequantizing transform: those with nothing else that
 * the transform would move. A node with children, a camera, a light, an animated transform or a
 * place in a skeleton keeps its transform, and its mesh moves to a new child instead.
 *
 * @param {Document} doc
 * @returns {(node: Node) => boolean}
 */
function plainNodes(doc) {
	const fixed = new Set();
	for (const animation of doc.getRoot().listAnimations())
		for (const channel of animation.listChannels())
			if (channel.getTargetPath() !== 'weights') fixed.add(channel.getTargetNode());
	for (const skin of doc.getRoot().listSkins())
		for (const joint of skin.listJoints()) fixed.add(joint);
	return (node) =>
		!fixed.has(node) &&
		node.listChildren().length === 0 &&
		node.getCamera() === null &&
		node.getExtension('KHR_lights_punctual') === null;
}

/**
 * True when the mesh's extras ask to keep its positions as floats, as `"quantizePositions": false`
 * does. A mesh that spreads small parts over a large space, such as a city's merged buildings,
 * would otherwise take steps too coarse for its parts' corners.
 *
 * @param {Mesh} mesh
 */
const keepsFloatPositions = (mesh) =>
	/** @type {Record<string, unknown>} */ (mesh.getExtras()).quantizePositions === false;

/**
 * Quantizes each position stream into a volume, as unsigned integers of {@link POSITION_BITS}
 * bits, and each morph target's position offsets as signed 16-bit integers at the same step.
 *
 * @param {Accessor[]} positions
 * @param {Accessor[]} offsets
 * @param {Volume} volume
 */
function quantizePositions(positions, offsets, { offset, scale }) {
	for (const accessor of positions) {
		const source = /** @type {Float32Array} */ (accessor.getArray());
		const out = new Uint16Array(source.length);
		for (let i = 0; i < source.length; i++) {
			const value = /** @type {number} */ (source[i]);
			const corner = /** @type {number} */ (offset[i % 3]);
			const q = Math.round((value - corner) / scale);
			out[i] = q < 0 ? 0 : q > POSITION_MAX ? POSITION_MAX : q;
		}
		accessor.setArray(out).setNormalized(false);
	}
	for (const accessor of offsets) {
		const source = /** @type {Float32Array} */ (accessor.getArray());
		const out = new Int16Array(source.length);
		let fits = true;
		for (let i = 0; i < source.length && fits; i++) {
			const q = Math.round(/** @type {number} */ (source[i]) / scale);
			fits = q >= -32767 && q <= 32767;
			out[i] = q;
		}
		if (fits) accessor.setArray(out).setNormalized(false);
	}
}

/**
 * The mesh's corner and step for a group of position streams.
 *
 * @param {Accessor[]} positions
 * @returns {Volume}
 */
function volumeOf(positions) {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const accessor of positions) {
		const array = /** @type {Float32Array} */ (accessor.getArray());
		for (let i = 0; i < array.length; i++) {
			const v = /** @type {number} */ (array[i]);
			const k = i % 3;
			if (v < /** @type {number} */ (min[k])) min[k] = v;
			if (v > /** @type {number} */ (max[k])) max[k] = v;
		}
	}
	const side = Math.max(...max.map((v, k) => v - /** @type {number} */ (min[k])));
	return { offset: min, scale: side > 0 ? side / POSITION_MAX : 1 };
}

/**
 * Multiplies each inverse bind matrix of a skin by the dequantizing transform, so that skinning
 * reads the quantized positions as the original ones.
 *
 * @param {Document} doc
 * @param {Skin} skin
 * @param {Volume} volume
 */
function foldIntoSkin(doc, skin, { offset, scale }) {
	const joints = skin.listJoints().length;
	let matrices = skin.getInverseBindMatrices();
	if (!matrices || usesOf(doc, matrices) > 1) {
		const source = matrices?.getArray();
		const identity = Float32Array.from({ length: joints * 16 }, (_, i) =>
			(i % 16) % 5 === 0 ? 1 : 0,
		);
		matrices = doc
			.createAccessor(matrices?.getName() ?? '')
			.setType('MAT4')
			.setArray(source ? Float32Array.from(/** @type {Float32Array} */ (source)) : identity)
			.setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
		skin.setInverseBindMatrices(matrices);
	}
	const m = /** @type {Float32Array} */ (matrices.getArray()).slice();
	for (let j = 0; j < joints; j++) {
		const at = j * 16;
		const [ox, oy, oz] = /** @type {[number, number, number]} */ (offset);
		for (let r = 0; r < 4; r++) {
			const c0 = /** @type {number} */ (m[at + r]);
			const c1 = /** @type {number} */ (m[at + 4 + r]);
			const c2 = /** @type {number} */ (m[at + 8 + r]);
			m[at + 12 + r] = c0 * ox + c1 * oy + c2 * oz + /** @type {number} */ (m[at + 12 + r]);
			m[at + r] = c0 * scale;
			m[at + 4 + r] = c1 * scale;
			m[at + 8 + r] = c2 * scale;
		}
	}
	matrices.setArray(m);
}

/**
 * Adds the dequantizing transform to each instance of an instancing node, after the instance's
 * own transform.
 *
 * @param {Document} doc
 * @param {any} instancing The node's EXT_mesh_gpu_instancing property.
 * @param {Volume} volume
 */
function foldIntoInstances(doc, instancing, volume) {
	const count = /** @type {Accessor} */ (instancing.listAttributes()[0]).getCount();
	/** @param {string} semantic @param {number} size @param {number[]} fallback */
	const own = (semantic, size, fallback) => {
		/** @type {Accessor | null} */
		const accessor = instancing.getAttribute(semantic);
		const array = accessor
			? Float32Array.from(/** @type {Float32Array} */ (accessor.getArray()))
			: Float32Array.from(
					{ length: count * size },
					(_, i) => /** @type {number} */ (fallback[i % size]),
				);
		const out =
			accessor && usesOf(doc, accessor) === 1
				? accessor
				: doc
						.createAccessor(accessor?.getName() ?? '')
						.setType(size === 4 ? 'VEC4' : 'VEC3')
						.setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
		instancing.setAttribute(semantic, out);
		return { out, array };
	};
	const t = own('TRANSLATION', 3, [0, 0, 0]);
	const r = own('ROTATION', 4, [0, 0, 0, 1]);
	const s = own('SCALE', 3, [1, 1, 1]);
	for (let i = 0; i < count; i++) {
		const placed = withVolume(
			{
				t: Array.from(t.array.subarray(i * 3, i * 3 + 3)),
				r: Array.from(r.array.subarray(i * 4, i * 4 + 4)),
				s: Array.from(s.array.subarray(i * 3, i * 3 + 3)),
			},
			volume,
		);
		t.array.set(placed.t, i * 3);
		s.array.set(placed.s, i * 3);
	}
	t.out.setArray(t.array);
	r.out.setArray(r.array);
	s.out.setArray(s.array);
}

/**
 * True when an instancing node's transforms are floats, which the volume can join.
 *
 * @param {any} instancing
 */
const floatInstances = (instancing) =>
	['TRANSLATION', 'ROTATION', 'SCALE'].every((semantic) => {
		const accessor = instancing.getAttribute(semantic);
		return !accessor || isFloat(accessor);
	});

/**
 * Quantizes the positions of each group of meshes that shares a volume, and puts the transform
 * that turns them back into each place that draws them: the node's own transform when nothing
 * else moves with it, the instances of an instancing node, the inverse bind matrices of a skin, or
 * else a new child node that takes the mesh.
 *
 * @param {Document} doc
 * @returns {boolean} True when some positions are now integers.
 */
function quantizeGroupPositions(doc) {
	const plain = plainNodes(doc);
	let quantized = false;
	for (const group of volumeGroups(doc)) {
		const prims = group.flatMap(triangleLists);
		const positions = [
			...new Set(prims.map((prim) => /** @type {Accessor} */ (prim.getAttribute('POSITION')))),
		];
		if (positions.length === 0 || !positions.every(isFloat) || group.some(keepsFloatPositions))
			continue;
		const users = group.flatMap(
			(mesh) => /** @type {Node[]} */ (mesh.listParents().filter((p) => p.propertyType === 'Node')),
		);
		const instancingOf = (/** @type {Node} */ node) => node.getExtension('EXT_mesh_gpu_instancing');
		if (users.some((node) => instancingOf(node) && !floatInstances(instancingOf(node)))) continue;
		const offsets = [
			...new Set(
				prims.flatMap((prim) =>
					prim
						.listTargets()
						.map((target) => target.getAttribute('POSITION'))
						.filter((a) => a !== null && isFloat(a)),
				),
			),
		];
		const volume = volumeOf(positions);
		quantizePositions(positions, /** @type {Accessor[]} */ (offsets), volume);
		quantized = true;
		const skins = new Set();
		for (const node of users) {
			const skin = node.getSkin();
			const instancing = instancingOf(node);
			if (skin) {
				if (!skins.has(skin)) foldIntoSkin(doc, skin, volume);
				skins.add(skin);
			} else if (instancing) foldIntoInstances(doc, instancing, volume);
			else if (plain(node)) {
				const { t, s } = withVolume(
					{ t: node.getTranslation(), r: node.getRotation(), s: node.getScale() },
					volume,
				);
				node.setTranslation(/** @type {any} */ (t)).setScale(/** @type {any} */ (s));
			} else {
				const child = doc
					.createNode(node.getName())
					.setMesh(node.getMesh())
					.setTranslation(/** @type {any} */ (volume.offset))
					.setScale([volume.scale, volume.scale, volume.scale]);
				node.setMesh(null).addChild(child);
			}
		}
	}
	return quantized;
}

/**
 * Quantizes a stream of unit vectors, such as normals, to signed normalized bytes.
 *
 * @param {Accessor} accessor
 */
function quantizeUnit(accessor) {
	const source = /** @type {Float32Array} */ (accessor.getArray());
	const out = new Int8Array(source.length);
	for (let i = 0; i < source.length; i++) {
		const v = /** @type {number} */ (source[i]);
		out[i] = Math.round((v < -1 ? -1 : v > 1 ? 1 : v) * 127);
	}
	accessor.setArray(out).setNormalized(true);
}

/**
 * Quantizes a stream of values from 0 to 1 to unsigned normalized integers of 8 or 16 bits, or
 * leaves it as floats when a value lies outside.
 *
 * @param {Accessor} accessor
 * @param {8 | 16} bits
 * @returns {boolean} True when the stream is now integers.
 */
function quantizeFraction(accessor, bits) {
	const source = /** @type {Float32Array} */ (accessor.getArray());
	for (const v of source) if (!(v >= 0 && v <= 1)) return false;
	const max = 2 ** bits - 1;
	const out = bits === 8 ? new Uint8Array(source.length) : new Uint16Array(source.length);
	for (let i = 0; i < source.length; i++)
		out[i] = Math.round(/** @type {number} */ (source[i]) * max);
	accessor.setArray(out).setNormalized(true);
	return true;
}

/**
 * Quantizes joint weights to unsigned normalized bytes, with each vertex's weights still adding
 * up to one: the largest takes what rounding left over.
 *
 * @param {Accessor} accessor
 */
function quantizeWeights(accessor) {
	const source = /** @type {Float32Array} */ (accessor.getArray());
	const out = new Uint8Array(source.length);
	for (let v = 0; v < source.length; v += 4) {
		let sum = 0;
		let largest = v;
		for (let k = v; k < v + 4; k++) {
			out[k] = Math.round(/** @type {number} */ (source[k]) * 255);
			sum += /** @type {number} */ (out[k]);
			if (/** @type {number} */ (source[k]) > /** @type {number} */ (source[largest])) largest = k;
		}
		if (sum > 0) out[largest] = /** @type {number} */ (out[largest]) + 255 - sum;
	}
	accessor.setArray(out).setNormalized(true);
}

/**
 * Stores vertices in the integer types of KHR_mesh_quantization: positions in 14-bit steps of
 * their mesh's volume, normals and tangents in signed bytes, texture coordinates from 0 to 1 in
 * 16 bits, colors from 0 to 1 in 8 bits, and joint weights in bytes. Streams of other values keep
 * their floats, and so do the positions of a mesh whose extras ask for floats.
 *
 * @param {Document} doc
 */
export function quantizeMeshes(doc) {
	let quantized = quantizeGroupPositions(doc);
	const done = new Set();
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of triangleLists(mesh))
			for (const { owner, semantic, accessor } of vertexStreams(prim)) {
				if (done.has(accessor) || !isFloat(accessor) || owner !== prim) continue;
				done.add(accessor);
				if (semantic === 'NORMAL' || semantic === 'TANGENT') {
					quantizeUnit(accessor);
					quantized = true;
				} else if (semantic.startsWith('TEXCOORD_'))
					quantized = quantizeFraction(accessor, 16) || quantized;
				else if (semantic.startsWith('COLOR_'))
					quantized = quantizeFraction(accessor, 8) || quantized;
				else if (semantic === 'WEIGHTS_0' && accessor.getType() === 'VEC4') {
					quantizeWeights(accessor);
					quantized = true;
				}
			}
	if (quantized) doc.createExtension(KHRMeshQuantization).setRequired(true);
}
