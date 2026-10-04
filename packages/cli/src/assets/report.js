// The budget report of an optimized model: what it draws, what it downloads and what its textures
// take in GPU memory on each family of devices.
import { counted } from '../text.js';

/** @import { Document, Mesh, Node } from '@gltf-transform/core' */
/** @import { TextureRecord } from './textures.js' */
/** @import { SpatialReport } from './spatial.js' */

/**
 * @typedef {object} TextureGroup Textures of one size, format and color space. The engine keeps
 * each such group in texture arrays of up to 256 layers.
 * @property {string} key Such as `1024x1024 etc1s srgb`.
 * @property {number} count
 */

/**
 * @typedef {object} ModelReport
 * @property {string} name The model's file name.
 * @property {number} inputBytes The source file with the files it names.
 * @property {number} outputBytes The model file with its texture files.
 * @property {number} modelBytes The model file alone.
 * @property {number} meshes The meshes that the scene draws at full detail.
 * @property {number} parts Their triangle lists and other primitives: one draw each per object.
 * @property {number} objects Nodes that draw a mesh, with each instance of an instancing node.
 * @property {number} triangles The triangles that the scene draws at full detail.
 * @property {number} vertices The vertices that the file stores.
 * @property {number} lodMeshes Meshes with levels of detail.
 * @property {SpatialReport} spatial Blockers and stored trees.
 * @property {{ min: number[], max: number[] }} bounds The scene's box in its own space.
 * @property {TextureRecord[]} textures
 * @property {TextureGroup[]} textureGroups
 * @property {{ etc2: number, bc7: number, rgba8: number }} textureMemory The textures' GPU
 *   memory in bytes with every mip level: where the GPU takes ETC2 and ASTC, as phones, tablets
 *   and Macs do; where it takes only BC7, as most Windows PCs do; and with no compressed format.
 * @property {number} textureMs The CPU time that the texture encodes took.
 * @property {number} ms The time the whole model took.
 */

/**
 * The bytes of a texture's mip levels, from its size down to 1 x 1, in blocks of 4 x 4 texels of
 * `blockBytes` each, or in 4 bytes per texel when `blockBytes` is 0.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} blockBytes
 */
export function mipBytes(width, height, blockBytes) {
	let total = 0;
	for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
		total += blockBytes === 0 ? w * h * 4 : Math.ceil(w / 4) * Math.ceil(h / 4) * blockBytes;
		if (w === 1 && h === 1) return total;
	}
}

/**
 * The GPU memory of textures on each family of devices. The engine transcodes ETC1S data to ETC2,
 * at 8 bytes a block without alpha, where the GPU has it, and UASTC data to ASTC or BC7, at 16.
 *
 * @param {readonly TextureRecord[]} textures
 */
export function textureMemory(textures) {
	const memory = { etc2: 0, bc7: 0, rgba8: 0 };
	for (const { width, height, codec, alpha } of textures) {
		memory.etc2 += mipBytes(width, height, codec === 'etc1s' && !alpha ? 8 : 16);
		memory.bc7 += mipBytes(width, height, 16);
		memory.rgba8 += mipBytes(width, height, 0);
	}
	return memory;
}

/**
 * The groups of textures that share a size, a format and a color space.
 *
 * @param {readonly TextureRecord[]} textures
 * @returns {TextureGroup[]}
 */
export function textureGroups(textures) {
	/** @type {Map<string, number>} */
	const groups = new Map();
	for (const t of textures) {
		const space = t.kind === 'color' ? 'srgb' : 'linear';
		const key = `${t.width}x${t.height} ${t.codec} ${t.kind === 'kept' ? 'kept' : space}`;
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}
	return [...groups]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

/**
 * A column-major 4 x 4 matrix from a translation, a rotation and a scale.
 *
 * @param {ArrayLike<number>} t
 * @param {ArrayLike<number>} r x, y, z, w.
 * @param {ArrayLike<number>} s
 * @returns {number[]}
 */
function trsMatrix(t, r, s) {
	const [x, y, z, w] = /** @type {[number, number, number, number]} */ (Array.from(r));
	const [sx, sy, sz] = /** @type {[number, number, number]} */ (Array.from(s));
	return [
		(1 - 2 * (y * y + z * z)) * sx,
		2 * (x * y + z * w) * sx,
		2 * (x * z - y * w) * sx,
		0,
		2 * (x * y - z * w) * sy,
		(1 - 2 * (x * x + z * z)) * sy,
		2 * (y * z + x * w) * sy,
		0,
		2 * (x * z + y * w) * sz,
		2 * (y * z - x * w) * sz,
		(1 - 2 * (x * x + y * y)) * sz,
		0,
		/** @type {number} */ (t[0]),
		/** @type {number} */ (t[1]),
		/** @type {number} */ (t[2]),
		1,
	];
}

/**
 * The product of two column-major 4 x 4 matrices.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
function multiply(a, b) {
	const out = new Array(16).fill(0);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++)
			for (let k = 0; k < 4; k++)
				out[c * 4 + r] +=
					/** @type {number} */ (a[k * 4 + r]) * /** @type {number} */ (b[c * 4 + k]);
	return out;
}

/**
 * A point moved by a column-major 4 x 4 matrix.
 *
 * @param {ArrayLike<number>} m
 * @param {ArrayLike<number>} p
 * @returns {[number, number, number]}
 */
function place(m, p) {
	const at = (/** @type {ArrayLike<number>} */ a, /** @type {number} */ i) =>
		/** @type {number} */ (a[i]);
	const [x, y, z] = [at(p, 0), at(p, 1), at(p, 2)];
	return /** @type {[number, number, number]} */ (
		[0, 1, 2].map((r) => at(m, r) * x + at(m, 4 + r) * y + at(m, 8 + r) * z + at(m, 12 + r))
	);
}

/**
 * The matrices of an instancing node's instances.
 *
 * @param {any} instancing
 * @returns {number[][]}
 */
function instanceMatrices(instancing) {
	const count = instancing.listAttributes()[0]?.getCount() ?? 0;
	/** @param {string} semantic @param {number[]} fallback */
	const read = (semantic, fallback) => {
		const accessor = instancing.getAttribute(semantic);
		return (/** @type {number} */ i) => (accessor ? accessor.getElement(i, []) : fallback);
	};
	const t = read('TRANSLATION', [0, 0, 0]);
	const r = read('ROTATION', [0, 0, 0, 1]);
	const s = read('SCALE', [1, 1, 1]);
	return Array.from({ length: count }, (_, i) => trsMatrix(t(i), r(i), s(i)));
}

/**
 * What the scene draws: each node with a mesh, and each instance of an instancing node, draws its
 * mesh's primitives once. The box holds each drawn mesh's box in the scene's space, and each
 * skinned mesh in its bind pose.
 *
 * @param {Document} doc
 */
function drawn(doc) {
	let objects = 0;
	let triangles = 0;
	/** @type {Set<Mesh>} */
	const meshes = new Set();
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	/** @param {readonly number[]} point */
	const include = (point) => {
		point.forEach((v, r) => {
			min[r] = Math.min(/** @type {number} */ (min[r]), v);
			max[r] = Math.max(/** @type {number} */ (max[r]), v);
		});
	};
	/** @param {number[]} matrix @param {Mesh} mesh */
	const grow = (matrix, mesh) => {
		for (const prim of mesh.listPrimitives()) {
			const position = prim.getAttribute('POSITION');
			if (!position) continue;
			const lo = position.getMinNormalized([]);
			const hi = position.getMaxNormalized([]);
			for (let corner = 0; corner < 8; corner++) {
				include(
					place(
						matrix,
						[0, 1, 2].map((k) => ((corner >> k) & 1 ? hi[k] : lo[k]) ?? 0),
					),
				);
			}
		}
	};
	/**
	 * Grows the box by each vertex of a skinned mesh in its bind pose: the joints' matrices times
	 * their inverse bind matrices, mixed by the vertex's weights.
	 *
	 * @param {import('@gltf-transform/core').Skin} skin
	 * @param {Mesh} mesh
	 */
	const growSkinned = (skin, mesh) => {
		const binds = skin.getInverseBindMatrices();
		const joints = skin
			.listJoints()
			.map((joint, j) =>
				multiply(
					joint.getWorldMatrix(),
					binds ? binds.getElement(j, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
				),
			);
		for (const prim of mesh.listPrimitives()) {
			const position = prim.getAttribute('POSITION');
			const index = prim.getAttribute('JOINTS_0');
			const weight = prim.getAttribute('WEIGHTS_0');
			if (!position || !index || !weight) continue;
			for (let v = 0; v < position.getCount(); v++) {
				/** @type {number[]} */
				const p = position.getElement(v, []);
				/** @type {number[]} */
				const js = index.getElement(v, []);
				/** @type {number[]} */
				const ws = weight.getElement(v, []);
				/** @type {[number, number, number]} */
				const out = [0, 0, 0];
				js.forEach((j, k) => {
					const m = joints[j];
					const w = ws[k] ?? 0;
					if (!m || w === 0) return;
					const [x, y, z] = place(m, p);
					out[0] += w * x;
					out[1] += w * y;
					out[2] += w * z;
				});
				include(out);
			}
		}
	};
	/** @param {Mesh} mesh */
	const meshTriangles = (mesh) =>
		mesh.listPrimitives().reduce((sum, prim) => {
			if (prim.getMode() !== 4) return sum;
			const indices = prim.getIndices();
			const count = indices ? indices.getCount() : (prim.getAttribute('POSITION')?.getCount() ?? 0);
			return sum + Math.floor(count / 3);
		}, 0);
	/** @param {Node} node */
	const visit = (node) => {
		const mesh = node.getMesh();
		if (mesh) {
			meshes.add(mesh);
			const world = node.getWorldMatrix();
			const instancing = node.getExtension('EXT_mesh_gpu_instancing');
			const placed = instancing
				? instanceMatrices(instancing).map((m) => multiply(world, m))
				: [Array.from(world)];
			objects += placed.length;
			triangles += placed.length * meshTriangles(mesh);
			const skin = node.getSkin();
			if (skin) growSkinned(skin, mesh);
			else for (const matrix of placed) grow(matrix, mesh);
		}
		for (const child of node.listChildren()) visit(child);
	};
	for (const scene of doc.getRoot().listScenes())
		for (const node of scene.listChildren()) visit(node);
	const empty = objects === 0;
	return {
		objects,
		triangles,
		meshes: meshes.size,
		parts: [...meshes].reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0),
		bounds: empty ? { min: [0, 0, 0], max: [0, 0, 0] } : { min, max },
	};
}

/**
 * The report's figures for a model, from its document after every step.
 *
 * @param {Document} doc
 * @param {{ name: string, inputBytes: number, modelBytes: number, textures: TextureRecord[], files: Map<string, Uint8Array>, lodMeshes: number, spatial: SpatialReport, ms: number }} facts
 * @returns {ModelReport}
 */
export function modelReport(
	doc,
	{ name, inputBytes, modelBytes, textures, files, lodMeshes, spatial, ms },
) {
	const root = doc.getRoot();
	const positions = new Set(
		root
			.listMeshes()
			.flatMap((mesh) => mesh.listPrimitives().map((prim) => prim.getAttribute('POSITION')))
			.filter((a) => a !== null),
	);
	let fileBytes = 0;
	for (const bytes of files.values()) fileBytes += bytes.byteLength;
	return {
		name,
		inputBytes,
		outputBytes: modelBytes + fileBytes,
		modelBytes,
		...drawn(doc),
		vertices: [...positions].reduce((sum, a) => sum + /** @type {any} */ (a).getCount(), 0),
		lodMeshes,
		spatial,
		textures,
		textureGroups: textureGroups(textures),
		textureMemory: textureMemory(textures),
		textureMs: textures.reduce((sum, t) => sum + t.ms, 0),
		ms,
	};
}

/**
 * A size in bytes as people read it: bytes, KB or MB, with a decimal place for KB and MB.
 *
 * @param {number} bytes
 */
export function shownBytes(bytes) {
	if (bytes < 1024) return `${bytes} bytes`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * A model's report as lines for the terminal.
 *
 * @param {ModelReport} report
 * @returns {string[]}
 */
export function reportLines(report) {
	const size = report.bounds.max.map((v, k) => v - /** @type {number} */ (report.bounds.min[k]));
	const lines = [
		`${report.name}: ${shownBytes(report.inputBytes)} to ${shownBytes(report.outputBytes)} (the model ${shownBytes(report.modelBytes)}), in ${(report.ms / 1000).toFixed(1)} s`,
		`  draws ${counted(report.objects, 'object')} of ${counted(report.parts, 'part')} in ${report.meshes} ${report.meshes === 1 ? 'mesh' : 'meshes'}: ${report.triangles.toLocaleString('en-US')} triangles, ${report.vertices.toLocaleString('en-US')} stored vertices`,
		`  size ${size.map((v) => Number(v.toPrecision(3))).join(' x ')}`,
	];
	if (report.lodMeshes > 0)
		lines.push(
			`  levels of detail for ${report.lodMeshes} ${report.lodMeshes === 1 ? 'mesh' : 'meshes'}`,
		);
	if (report.textures.length > 0) {
		const m = report.textureMemory;
		lines.push(
			`  ${counted(report.textures.length, 'texture')}: ${report.textureGroups.map((g) => `${g.count} of ${g.key}`).join(', ')}`,
			`  texture memory: ${shownBytes(m.etc2)} with ETC2 and ASTC, ${shownBytes(m.bc7)} with BC7 only, ${shownBytes(m.rgba8)} uncompressed`,
		);
	}
	return lines;
}
