// The model files of S6, the city, built from the city layout of the sample content. The layout
// places copies of the Kenney city kits' models and boxes that stand for towers. The kit file holds
// each model part once, as a node of its own, and the tower file holds each box with its material.
// Both engines load these files through the asset tool, which compresses their meshes with meshopt
// and encodes their textures in KTX2, as a developer ships a city.
//
// - The kit file: one node per part of each model the layout uses, named `k<model>-<part>`, with the
//   part's place inside its model and the kit's own material and colour map. A page puts copies of
//   each part where the layout's rows say.
// - The tower file: one node per material of the layout's boxes, named `t<material>`, whose mesh holds
//   every box in that material. So each material draws in one draw, as an asset pipeline that
//   merges static meshes ships a city. The texture coordinates count metres over the material's
//   metres per repeat, so a stretched box keeps the texel size of a small one, and its walls line
//   up across tiers. Each mesh blocks the view with its own boxes, which are closed and solid, and
//   keeps its positions as floats, so the corners of boxes that meet stay exact.
// - The tower materials: the layout's 200, each a texture set of ambientCG in a tint. Occlusion,
//   roughness and metalness go into one image per set, in glTF's red, green and blue channels.
//
// The files go into the shared samples cache, beside the pinned commits' folders, keyed by the
// layout's SHA-256 and this module's source, so every copy of the repository builds them once.
// Images stay where the sample content keeps them, and the files name them by relative paths.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { encode as encodePng } from 'fast-png';
import type { Plugin } from 'vite';
import { decodeImage } from '../../packages/cli/src/assets/images.js';
import { sampleFileFor, samplesCacheRoot, samplesDir } from '../../tools/lib/samples.ts';
import type { S6Layout, S6Material } from '../scenes/s6.ts';

/** The layout's path in the sample content. */
export const CITY_LAYOUT = 'sources/city/layout/layout.json';

/** The address prefix under which pages import the city's files, such as `/s6-city/kit.gltf`. */
export const CITY_URL = '/s6-city/';

/** The city's two model files, by their names in the address. */
export const CITY_FILES = ['kit', 'towers'] as const;
export type CityFile = (typeof CITY_FILES)[number];

/** A glTF file in memory: its JSON and the one buffer it names. */
export interface GltfFile {
	json: GltfJson;
	bin: Uint8Array;
}

// The parts of glTF's JSON that this module reads and writes.
interface GltfNode {
	name?: string;
	mesh?: number;
	children?: number[];
	matrix?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
}
interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	count: number;
	type: string;
	normalized?: boolean;
	min?: number[];
	max?: number[];
}
interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	target?: number;
}
interface GltfPrimitive {
	attributes: Record<string, number>;
	indices?: number;
	material?: number;
	mode?: number;
}
interface TextureInfo {
	index: number;
	texCoord?: number;
	extensions?: Record<string, { texCoord?: number }>;
	scale?: number;
	strength?: number;
}
interface GltfMaterial {
	name?: string;
	pbrMetallicRoughness?: {
		baseColorFactor?: number[];
		baseColorTexture?: TextureInfo;
		metallicFactor?: number;
		roughnessFactor?: number;
		metallicRoughnessTexture?: TextureInfo;
	};
	normalTexture?: TextureInfo;
	occlusionTexture?: TextureInfo;
	emissiveTexture?: TextureInfo;
	emissiveFactor?: number[];
	doubleSided?: boolean;
	alphaMode?: string;
	alphaCutoff?: number;
}
export interface GltfJson {
	asset: { version: string; generator?: string };
	scene?: number;
	scenes?: { nodes: number[] }[];
	nodes?: GltfNode[];
	meshes?: { name?: string; primitives: GltfPrimitive[]; extras?: Record<string, unknown> }[];
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	buffers?: { byteLength: number; uri?: string }[];
	materials?: GltfMaterial[];
	textures?: { sampler?: number; source?: number; name?: string }[];
	images?: { uri?: string; name?: string; bufferView?: number; mimeType?: string }[];
	samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
	extensionsUsed?: string[];
}

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const LINEAR_MIPMAP_LINEAR = 9987;
const LINEAR = 9729;

/** The JSON and binary chunks of a GLB file. */
export function readGlb(bytes: Uint8Array): GltfFile {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
	const binStart = 20 + jsonLength;
	const bin =
		binStart + 8 <= bytes.byteLength
			? bytes.subarray(binStart + 8, binStart + 8 + view.getUint32(binStart, true))
			: new Uint8Array(0);
	return { json, bin };
}

/** Appends byte ranges to one buffer, each at a multiple of 4 bytes, as glTF's accessors need. */
class BufferWriter {
	private chunks: Uint8Array[] = [];
	length = 0;
	add(bytes: Uint8Array): number {
		const offset = this.length;
		this.chunks.push(bytes);
		this.length += bytes.byteLength;
		const pad = (4 - (this.length % 4)) % 4;
		if (pad > 0) {
			this.chunks.push(new Uint8Array(pad));
			this.length += pad;
		}
		return offset;
	}
	bytes(): Uint8Array {
		const out = new Uint8Array(this.length);
		let at = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, at);
			at += chunk.byteLength;
		}
		return out;
	}
}

// Column-major 4 x 4 matrices, as glTF stores them.
type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
			out[c * 4 + r] = sum;
		}
	return out;
}

/** A node's local matrix from its matrix or its translation, rotation and scale. */
function localMatrix(node: GltfNode): Mat4 {
	if (node.matrix) return node.matrix;
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const q = [x as number, y as number, z as number, w as number] as const;
	const [qx, qy, qz, qw] = q;
	return [
		(1 - 2 * (qy * qy + qz * qz)) * (sx as number),
		2 * (qx * qy + qz * qw) * (sx as number),
		2 * (qx * qz - qy * qw) * (sx as number),
		0,
		2 * (qx * qy - qz * qw) * (sy as number),
		(1 - 2 * (qx * qx + qz * qz)) * (sy as number),
		2 * (qy * qz + qx * qw) * (sy as number),
		0,
		2 * (qx * qz + qy * qw) * (sz as number),
		2 * (qy * qz - qx * qw) * (sz as number),
		(1 - 2 * (qx * qx + qy * qy)) * (sz as number),
		0,
		tx as number,
		ty as number,
		tz as number,
		1,
	];
}

/** Rounds away the last bits of float noise, so decomposed values stay short and stable. */
const tidy = (v: number) => {
	const r = Math.round(v * 1e6) / 1e6;
	return r === 0 ? 0 : r;
};

/**
 * The translation, rotation and scale of a matrix without shear. A mirrored matrix gets a negative
 * scale on X, as glTF exporters write it.
 */
export function decompose(m: Mat4): Required<Pick<GltfNode, 'translation' | 'rotation' | 'scale'>> {
	const col = (c: number) => [m[c * 4] as number, m[c * 4 + 1] as number, m[c * 4 + 2] as number];
	const [cx, cy, cz] = [col(0), col(1), col(2)] as [number[], number[], number[]];
	let sx = Math.hypot(...cx);
	const sy = Math.hypot(...cy);
	const sz = Math.hypot(...cz);
	const det =
		(cx[0] as number) *
			((cy[1] as number) * (cz[2] as number) - (cy[2] as number) * (cz[1] as number)) -
		(cy[0] as number) *
			((cx[1] as number) * (cz[2] as number) - (cx[2] as number) * (cz[1] as number)) +
		(cz[0] as number) *
			((cx[1] as number) * (cy[2] as number) - (cx[2] as number) * (cy[1] as number));
	if (det < 0) sx = -sx;
	const r = [
		[(cx[0] as number) / sx, (cx[1] as number) / sx, (cx[2] as number) / sx],
		[(cy[0] as number) / sy, (cy[1] as number) / sy, (cy[2] as number) / sy],
		[(cz[0] as number) / sz, (cz[1] as number) / sz, (cz[2] as number) / sz],
	] as [number[], number[], number[]];
	// The rotation matrix's element at row i, column j.
	const e = (i: number, j: number) => r[j]?.[i] as number;
	const trace = e(0, 0) + e(1, 1) + e(2, 2);
	let q: [number, number, number, number];
	if (trace > 0) {
		const s = 0.5 / Math.sqrt(trace + 1);
		q = [(e(2, 1) - e(1, 2)) * s, (e(0, 2) - e(2, 0)) * s, (e(1, 0) - e(0, 1)) * s, 0.25 / s];
	} else if (e(0, 0) > e(1, 1) && e(0, 0) > e(2, 2)) {
		const s = 2 * Math.sqrt(1 + e(0, 0) - e(1, 1) - e(2, 2));
		q = [0.25 * s, (e(0, 1) + e(1, 0)) / s, (e(0, 2) + e(2, 0)) / s, (e(2, 1) - e(1, 2)) / s];
	} else if (e(1, 1) > e(2, 2)) {
		const s = 2 * Math.sqrt(1 + e(1, 1) - e(0, 0) - e(2, 2));
		q = [(e(0, 1) + e(1, 0)) / s, 0.25 * s, (e(1, 2) + e(2, 1)) / s, (e(0, 2) - e(2, 0)) / s];
	} else {
		const s = 2 * Math.sqrt(1 + e(2, 2) - e(0, 0) - e(1, 1));
		q = [(e(0, 2) + e(2, 0)) / s, (e(1, 2) + e(2, 1)) / s, 0.25 * s, (e(1, 0) - e(0, 1)) / s];
	}
	// One sign for each rotation, so equal turns write equal numbers.
	if (q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
	return {
		translation: [m[12] as number, m[13] as number, m[14] as number].map(tidy),
		rotation: q.map(tidy),
		scale: [sx, sy, sz].map(tidy),
	};
}

/** The kit a model path names, such as `roads` for `sources/city/kenney-roads/glb/x.glb`. */
const kitOf = (path: string) => /kenney-([a-z]+)\//.exec(path)?.[1] ?? path;

/** The node name of a part of a kit model, in the kit file. */
export const kitPartName = (model: number, part: number) => `k${model}-${part}`;

/** The node name of the boxes of one material of the layout, in the tower file. */
export const towerName = (material: number) => `t${material}`;

/** The parts of each kit model, as the kit file names them: the part count per model. */
export interface KitParts {
	/** How many parts each model has, by model number. */
	parts: number[];
}

/**
 * Builds the kit file from the layout's models: each mesh primitive of each model becomes a node of
 * its own with its place inside the model, so a page places it with no group around it. The kits'
 * colour maps stay external files, which `imageUri` names. Equal materials share one entry.
 */
export function buildKit(
	layout: Pick<S6Layout, 'models'>,
	readModel: (path: string) => Uint8Array,
	imageUri: (modelPath: string, uri: string) => string,
): GltfFile & KitParts {
	const out = new BufferWriter();
	const json: Required<
		Pick<
			GltfJson,
			| 'nodes'
			| 'meshes'
			| 'accessors'
			| 'bufferViews'
			| 'materials'
			| 'textures'
			| 'images'
			| 'samplers'
		>
	> &
		GltfJson = {
		asset: { version: '2.0', generator: 'null3D bench: S6 kit' },
		scene: 0,
		scenes: [{ nodes: [] }],
		nodes: [],
		meshes: [],
		accessors: [],
		bufferViews: [],
		materials: [],
		textures: [],
		images: [],
		samplers: [],
	};
	const images = new Map<string, number>();
	const samplers = new Map<string, number>();
	const textures = new Map<string, number>();
	const materials = new Map<string, number>();
	const parts: number[] = [];

	const indexOf = (map: Map<string, number>, list: unknown[], value: unknown) => {
		const key = JSON.stringify(value);
		let index = map.get(key);
		if (index === undefined) {
			index = list.push(value) - 1;
			map.set(key, index);
		}
		return index;
	};

	layout.models.forEach((path, model) => {
		const { json: src, bin } = readGlb(readModel(path));
		const views = new Map<number, number>();
		const view = (index: number) => {
			let at = views.get(index);
			if (at === undefined) {
				const v = src.bufferViews?.[index] as GltfBufferView;
				const offset = out.add(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
				at = json.bufferViews.push({ ...v, buffer: 0, byteOffset: offset }) - 1;
				views.set(index, at);
			}
			return at;
		};
		const accessors = new Map<number, number>();
		const accessor = (index: number) => {
			let at = accessors.get(index);
			if (at === undefined) {
				const a = src.accessors?.[index] as GltfAccessor;
				at =
					json.accessors.push({
						...a,
						...(a.bufferView !== undefined && { bufferView: view(a.bufferView) }),
					}) - 1;
				accessors.set(index, at);
			}
			return at;
		};
		const textureInfo = (info: TextureInfo | undefined): TextureInfo | undefined => {
			if (!info) return undefined;
			const texture = src.textures?.[info.index];
			const image = src.images?.[texture?.source ?? -1];
			if (!image?.uri) throw new Error(`${path}: a texture without an image file`);
			const uri = imageUri(path, image.uri);
			const source = indexOf(images, json.images, {
				uri,
				name: `${kitOf(path)}-${image.name ?? 'image'}`,
			});
			const sampler =
				texture?.sampler === undefined
					? undefined
					: indexOf(samplers, json.samplers, src.samplers?.[texture.sampler]);
			const index = indexOf(textures, json.textures, {
				source,
				...(sampler !== undefined && { sampler }),
			});
			// KHR_texture_transform with only a texture coordinate set is the plain texture info.
			const texCoord = info.extensions?.KHR_texture_transform?.texCoord ?? info.texCoord;
			const { extensions: _, ...rest } = info;
			return { ...rest, index, ...(texCoord ? { texCoord } : {}) };
		};
		const material = (index: number | undefined) => {
			if (index === undefined) return undefined;
			const m = src.materials?.[index] as GltfMaterial;
			const pbr = m.pbrMetallicRoughness;
			const copy: GltfMaterial = {
				...m,
				name: `${kitOf(path)}-${m.name ?? 'material'}`,
				...(pbr && {
					pbrMetallicRoughness: {
						...pbr,
						baseColorTexture: textureInfo(pbr.baseColorTexture),
						metallicRoughnessTexture: textureInfo(pbr.metallicRoughnessTexture),
					},
				}),
				normalTexture: textureInfo(m.normalTexture),
				occlusionTexture: textureInfo(m.occlusionTexture),
				emissiveTexture: textureInfo(m.emissiveTexture),
			};
			return indexOf(materials, json.materials, JSON.parse(JSON.stringify(copy)));
		};

		let part = 0;
		const visit = (index: number, parent: Mat4) => {
			const node = src.nodes?.[index] as GltfNode;
			const world = multiply(parent, localMatrix(node));
			if (node.mesh !== undefined) {
				for (const primitive of src.meshes?.[node.mesh]?.primitives ?? []) {
					const attributes: Record<string, number> = {};
					for (const [name, a] of Object.entries(primitive.attributes))
						attributes[name] = accessor(a);
					const mesh =
						json.meshes.push({
							name: kitPartName(model, part),
							primitives: [
								{
									attributes,
									...(primitive.indices !== undefined && { indices: accessor(primitive.indices) }),
									...(primitive.material !== undefined && {
										material: material(primitive.material),
									}),
									...(primitive.mode !== undefined && { mode: primitive.mode }),
								},
							],
						}) - 1;
					const at =
						json.nodes.push({ name: kitPartName(model, part), mesh, ...decompose(world) }) - 1;
					json.scenes?.[0]?.nodes.push(at);
					part++;
				}
			}
			for (const child of node.children ?? []) visit(child, world);
		};
		const scene = src.scenes?.[src.scene ?? 0];
		for (const root of scene?.nodes ?? []) visit(root, IDENTITY);
		if (part === 0) throw new Error(`${path}: a model with no mesh`);
		parts.push(part);
	});
	const bin = out.bytes();
	json.buffers = [{ byteLength: bin.byteLength }];
	return { json, bin, parts };
}

/**
 * The faces of a box: the axis of each face's normal and its sign, and for the walls the axis along
 * the ground with the sign that runs left to right seen from outside.
 */
const BOX_FACES = [
	{ axis: 0, sign: 1, along: 2, alongSign: -1 },
	{ axis: 0, sign: -1, along: 2, alongSign: 1 },
	{ axis: 1, sign: 1, along: 0, alongSign: 1 },
	{ axis: 1, sign: -1, along: 0, alongSign: 1 },
	{ axis: 2, sign: 1, along: 0, alongSign: 1 },
	{ axis: 2, sign: -1, along: 0, alongSign: -1 },
] as const;

/** A face's corners, as signs along its two other axes. */
const CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1],
] as const;

/** A box's vertices: positions, normals and texture coordinates, and its 36 indices. */
export interface BoxVertices {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint16Array;
}

/**
 * The vertices of a box of `size` whose base centre stands at `base`, relative to that centre.
 * Texture coordinates are world metres over `metresPerRepeat`: the walls run along the ground and
 * up from the ground, and the top and bottom run along X and Z. So a texture keeps one size on
 * every box, and boxes stacked into a tower line their walls up.
 */
export function boxVertices(
	base: readonly [number, number, number],
	size: readonly [number, number, number],
	metresPerRepeat: number,
): BoxVertices {
	const positions = new Float32Array(24 * 3);
	const normals = new Float32Array(24 * 3);
	const uvs = new Float32Array(24 * 2);
	const indices = new Uint16Array(36);
	const half = [size[0] / 2, size[1] / 2, size[2] / 2] as const;
	// The box's centre, relative to its base's centre.
	const centre = [0, half[1], 0] as const;
	BOX_FACES.forEach((face, f) => {
		const [a1, a2] = [0, 1, 2].filter((a) => a !== face.axis) as [0 | 1 | 2, 0 | 1 | 2];
		CORNERS.forEach(([s1, s2], k) => {
			const p: [number, number, number] = [0, 0, 0];
			p[face.axis] = centre[face.axis] + face.sign * half[face.axis];
			p[a1] = centre[a1] + s1 * half[a1];
			p[a2] = centre[a2] + s2 * half[a2];
			const i = f * 4 + k;
			positions.set(p, i * 3);
			normals[i * 3 + face.axis] = face.sign;
			const world = [p[0] + base[0], p[1] + base[1], p[2] + base[2]] as const;
			if (face.axis === 1) {
				uvs[i * 2] = world[0] / metresPerRepeat;
				uvs[i * 2 + 1] = world[2] / metresPerRepeat;
			} else {
				// Up the wall runs toward the image's top, which glTF puts at v = 0.
				uvs[i * 2] = (face.alongSign * world[face.along]) / metresPerRepeat;
				uvs[i * 2 + 1] = -world[1] / metresPerRepeat;
			}
		});
		indices.set([f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3], f * 6);
	});
	fixWinding(positions, normals, indices);
	return { positions, normals, uvs, indices };
}

/** Swaps the order of each triangle whose winding points away from its face's normal. */
function fixWinding(positions: Float32Array, normals: Float32Array, indices: Uint16Array): void {
	for (let t = 0; t < indices.length; t += 3) {
		const [a, b, c] = [indices[t] as number, indices[t + 1] as number, indices[t + 2] as number];
		const p = (i: number, k: number) => positions[i * 3 + k] as number;
		const e1 = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)] as const;
		const e2 = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)] as const;
		const n = [
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0],
		];
		const dot =
			(n[0] as number) * (normals[a * 3] as number) +
			(n[1] as number) * (normals[a * 3 + 1] as number) +
			(n[2] as number) * (normals[a * 3 + 2] as number);
		if (dot < 0) {
			indices[t + 1] = c;
			indices[t + 2] = b;
		}
	}
}

/** The image file names of a texture set's maps, as the tower file names them. */
export interface SetImages {
	/** The colour map, an sRGB image. */
	color: string;
	normal?: string;
	/** Occlusion, roughness and metalness, in red, green and blue. */
	orm: string;
	/** Whether the set has an occlusion map in the red channel of `orm`. */
	occlusion: boolean;
	/** Whether the set has a metalness map in the blue channel of `orm`. */
	metalness: boolean;
	emission?: string;
}

/**
 * Builds the tower file: for each material of the layout's boxes, a node and a mesh that holds all
 * of that material's boxes, and the layout's materials. The node stands at the centre of its boxes'
 * base. `imagesOf` gives the image files of a material's texture set.
 */
export function buildTowers(
	layout: Pick<S6Layout, 'materials' | 'objects'>,
	imagesOf: (material: S6Material) => SetImages,
): GltfFile & { boxes: number } {
	const out = new BufferWriter();
	const json: GltfJson &
		Required<
			Pick<
				GltfJson,
				'nodes' | 'meshes' | 'accessors' | 'bufferViews' | 'materials' | 'textures' | 'images'
			>
		> = {
		asset: { version: '2.0', generator: 'null3D bench: S6 towers' },
		scene: 0,
		scenes: [{ nodes: [] }],
		nodes: [],
		meshes: [],
		accessors: [],
		bufferViews: [],
		materials: [],
		textures: [],
		images: [],
		samplers: [{ magFilter: LINEAR, minFilter: LINEAR_MIPMAP_LINEAR }],
	};
	const images = new Map<string, number>();
	const textureOf = (uri: string) => {
		let index = images.get(uri);
		if (index === undefined) {
			json.images.push({ uri });
			index = json.textures.push({ sampler: 0, source: json.images.length - 1 }) - 1;
			images.set(uri, index);
		}
		return index;
	};
	for (const m of layout.materials) {
		const files = imagesOf(m);
		const orm = textureOf(files.orm);
		json.materials.push({
			name: `${m.set}-${m.tint.join('-')}`,
			pbrMetallicRoughness: {
				baseColorFactor: [...m.tint, 1],
				baseColorTexture: { index: textureOf(files.color) },
				metallicFactor: files.metalness ? 1 : 0,
				roughnessFactor: 1,
				metallicRoughnessTexture: { index: orm },
			},
			...(files.normal && { normalTexture: { index: textureOf(files.normal) } }),
			...(files.occlusion && { occlusionTexture: { index: orm } }),
			...(files.emission && {
				emissiveTexture: { index: textureOf(files.emission) },
				emissiveFactor: [1, 1, 1],
			}),
		});
	}
	const { fields, rows } = layout.objects;
	const field = (name: string) => {
		const at = fields.indexOf(name);
		if (at < 0) throw new Error(`the layout's rows have no field ${name}`);
		return at;
	};
	const f = {
		model: field('model'),
		material: field('material'),
		x: field('x'),
		y: field('y'),
		z: field('z'),
		sx: field('sx'),
		sy: field('sy'),
		sz: field('sz'),
	};
	const view = (bytes: Uint8Array, target: number) =>
		json.bufferViews.push({
			buffer: 0,
			byteOffset: out.add(bytes),
			byteLength: bytes.byteLength,
			target,
		}) - 1;
	const accessor = (
		array: Float32Array | Uint16Array,
		type: string,
		size: number,
		bounds = false,
	) => {
		const a: GltfAccessor = {
			bufferView: view(
				new Uint8Array(array.buffer, array.byteOffset, array.byteLength),
				array instanceof Uint16Array ? ELEMENT_ARRAY_BUFFER : ARRAY_BUFFER,
			),
			componentType: array instanceof Uint16Array ? UNSIGNED_SHORT : FLOAT,
			count: array.length / size,
			type,
		};
		if (bounds) {
			a.min = [Infinity, Infinity, Infinity];
			a.max = [-Infinity, -Infinity, -Infinity];
			for (let i = 0; i < array.length; i++) {
				const k = i % 3;
				a.min[k] = Math.min(a.min[k] as number, array[i] as number);
				a.max[k] = Math.max(a.max[k] as number, array[i] as number);
			}
		}
		return json.accessors.push(a) - 1;
	};

	// Each material's boxes, in the layout's order.
	const boxesOf = new Map<number, number[]>();
	rows.forEach((row, r) => {
		if (row[f.model] !== -1) return;
		const material = row[f.material] as number;
		if (!layout.materials[material]) throw new Error(`the box of row ${r} has no material`);
		const list = boxesOf.get(material);
		if (list) list.push(r);
		else boxesOf.set(material, [r]);
	});
	let boxes = 0;
	for (const [material, list] of [...boxesOf].sort(([a], [b]) => a - b)) {
		const { metresPerRepeat } = layout.materials[material] as S6Material;
		const sizeOf = (r: number) =>
			[f.sx, f.sy, f.sz].map((k) => (rows[r] as number[])[k] as number) as [number, number, number];
		const baseOf = (r: number) =>
			[f.x, f.y, f.z].map((k) => (rows[r] as number[])[k] as number) as [number, number, number];
		// The node stands at the centre of the boxes' base, so the positions stay near zero.
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (const r of list) {
			const [x, y, z] = baseOf(r);
			const [sx, , sz] = sizeOf(r);
			lo[0] = Math.min(lo[0] as number, x - sx / 2);
			hi[0] = Math.max(hi[0] as number, x + sx / 2);
			lo[1] = Math.min(lo[1] as number, y);
			lo[2] = Math.min(lo[2] as number, z - sz / 2);
			hi[2] = Math.max(hi[2] as number, z + sz / 2);
		}
		const origin = [
			((lo[0] as number) + (hi[0] as number)) / 2,
			lo[1] as number,
			((lo[2] as number) + (hi[2] as number)) / 2,
		] as const;
		const positions = new Float32Array(list.length * 24 * 3);
		const normals = new Float32Array(list.length * 24 * 3);
		const uvs = new Float32Array(list.length * 24 * 2);
		const indices = new Uint16Array(list.length * 36);
		list.forEach((r, b) => {
			const base = baseOf(r);
			const box = boxVertices(base, sizeOf(r), metresPerRepeat);
			for (let i = 0; i < 24 * 3; i++)
				positions[b * 72 + i] =
					(box.positions[i] as number) + (base[i % 3] as number) - (origin[i % 3] as number);
			normals.set(box.normals, b * 72);
			uvs.set(box.uvs, b * 48);
			for (let i = 0; i < 36; i++) indices[b * 36 + i] = (box.indices[i] as number) + b * 24;
		});
		const mesh =
			json.meshes.push({
				name: towerName(material),
				primitives: [
					{
						attributes: {
							POSITION: accessor(positions, 'VEC3', 3, true),
							NORMAL: accessor(normals, 'VEC3', 3),
							TEXCOORD_0: accessor(uvs, 'VEC2', 2),
						},
						indices: accessor(indices, 'SCALAR', 1),
						material,
					},
				],
				// The asset tool's blocker of one or two boxes inside the mesh's bounds fits no mesh
				// of boxes spread over the city, so each mesh blocks with its own boxes. Its steps
				// for positions across hundreds of metres would move the boxes' corners by
				// centimetres, so the positions stay floats, and boxes that meet keep meeting exactly.
				extras: { occluder: true, quantizePositions: false },
			}) - 1;
		const node = json.nodes.push({ name: towerName(material), mesh, translation: [...origin] }) - 1;
		json.scenes?.[0]?.nodes.push(node);
		boxes += list.length;
	}
	const bin = out.bytes();
	json.buffers = [{ byteLength: bin.byteLength }];
	return { json, bin, boxes };
}

/**
 * An image of occlusion, roughness and metalness in red, green and blue, from a texture set's
 * grey maps: full occlusion (1) where the set has no occlusion map, and no metal where it has no
 * metalness map. Every map of a set has one size.
 */
export function packOrm(
	roughness: Uint8Array,
	occlusion: Uint8Array | undefined,
	metalness: Uint8Array | undefined,
	width: number,
	height: number,
): Uint8Array {
	const read = (bytes: Uint8Array) => {
		const image = decodeImage(bytes, 'image/jpeg');
		if (image.width !== width || image.height !== height)
			throw new Error(`a map of ${image.width} x ${image.height} in a set of ${width} x ${height}`);
		return image.data;
	};
	const g = read(roughness);
	const r = occlusion && read(occlusion);
	const b = metalness && read(metalness);
	const rgb = new Uint8Array(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		rgb[i * 3] = r ? (r[i * 4] as number) : 255;
		rgb[i * 3 + 1] = g[i * 4] as number;
		rgb[i * 3 + 2] = b ? (b[i * 4] as number) : 0;
	}
	return encodePng({ width, height, data: rgb, channels: 3, depth: 8 });
}

/** Writes a glTF file as JSON beside its buffer, which it names by a relative path. */
function writeGltf(folder: string, name: string, file: GltfFile): void {
	const json = { ...file.json, buffers: [{ byteLength: file.bin.byteLength, uri: `${name}.bin` }] };
	writeFileSync(join(folder, `${name}.bin`), file.bin);
	writeFileSync(join(folder, `${name}.gltf`), `${JSON.stringify(json)}\n`);
}

/** The width and height of a JPEG file, from its start-of-frame marker. */
export function jpegSize(bytes: Uint8Array): [number, number] {
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) throw new Error('not a JPEG file');
		const marker = bytes[at + 1] as number;
		const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
			return [
				((bytes[at + 7] as number) << 8) | (bytes[at + 8] as number),
				((bytes[at + 5] as number) << 8) | (bytes[at + 6] as number),
			];
		at += 2 + length;
	}
	throw new Error('a JPEG file with no frame');
}

/** The cache folder of the city's built files, beside the pinned commits' folders. */
function cacheDir(): string {
	return join(samplesCacheRoot(), 'city');
}

/**
 * The city's built files for the pinned layout, built on the first call into the shared cache:
 * the full paths of the kit file and the tower file. A build writes a folder of its own and moves
 * it into place, so two builds at once end with one whole folder.
 */
export function cityFiles(root: string): Record<CityFile, string> {
	const layoutFile = sampleFileFor(root, `/samples/${CITY_LAYOUT}`);
	if (!layoutFile) throw new Error(`${CITY_LAYOUT} is not in the pinned sample manifest`);
	const samples = samplesDir(root);
	const layoutPath = join(samples, CITY_LAYOUT);
	if (!existsSync(layoutPath))
		throw new Error(`${CITY_LAYOUT} is missing: run bun run samples:fetch`);
	const key = createHash('sha256')
		.update(`${layoutFile.sha256}\n`)
		.update(readFileSync(new URL(import.meta.url)))
		.digest('hex')
		.slice(0, 24);
	const folder = join(cacheDir(), key);
	const paths = {
		kit: join(folder, 'kit.gltf'),
		towers: join(folder, 'towers.gltf'),
	};
	if (existsSync(paths.kit) && existsSync(paths.towers)) return paths;

	const partial = `${folder}.${process.pid}`;
	rmSync(partial, { recursive: true, force: true });
	mkdirSync(join(partial, 'orm'), { recursive: true });
	const layout = JSON.parse(readFileSync(layoutPath, 'utf8')) as S6Layout;
	const source = (path: string) => join(samples, path);
	// Paths from the finished folder, which the partial one becomes.
	const fromFolder = (path: string) => relative(folder, path).split('\\').join('/');

	const kit = buildKit(
		layout,
		(path) => readFileSync(source(path)),
		(model, uri) => fromFolder(join(dirname(source(model)), uri)),
	);
	writeGltf(partial, 'kit', kit);

	const sets = new Map<string, SetImages>();
	const towers = buildTowers(layout, (m) => {
		let images = sets.get(m.set);
		if (!images) {
			const { color, normal, roughness, occlusion, metalness, emission } = m.maps;
			if (!color || !roughness)
				throw new Error(`the texture set ${m.set} lacks colour or roughness`);
			const bytes = (path: string | undefined) => (path ? readFileSync(source(path)) : undefined);
			const rough = bytes(roughness) as Uint8Array;
			const [width, height] = jpegSize(rough);
			writeFileSync(
				join(partial, 'orm', `${m.set}.png`),
				packOrm(rough, bytes(occlusion), bytes(metalness), width, height),
			);
			images = {
				color: fromFolder(source(color)),
				...(normal && { normal: fromFolder(source(normal)) }),
				orm: `orm/${m.set}.png`,
				occlusion: occlusion !== undefined,
				metalness: metalness !== undefined,
				...(emission && { emission: fromFolder(source(emission)) }),
			};
			sets.set(m.set, images);
		}
		return images;
	});
	writeGltf(partial, 'towers', towers);
	mkdirSync(cacheDir(), { recursive: true });
	try {
		renameSync(partial, folder);
	} catch (error) {
		// Another build finished first: keep its folder.
		rmSync(partial, { recursive: true, force: true });
		if (!existsSync(paths.kit)) throw error;
	}
	return paths;
}

/**
 * Resolves a page's import of a city file, `/s6-city/<name>.gltf?optimized`, to the built file,
 * which the null3D plugin then optimizes. The first import builds the files, in about a minute.
 */
export function cityServer(root: string): Plugin {
	const pattern = new RegExp(`^${CITY_URL}(${CITY_FILES.join('|')})\\.gltf\\?optimized$`);
	return {
		name: 'null3d-s6-city',
		enforce: 'pre',
		resolveId(id) {
			const name = pattern.exec(id)?.[1] as CityFile | undefined;
			if (!name) return null;
			try {
				return `${cityFiles(root)[name]}?optimized`;
			} catch (error) {
				return this.error(`S6's city files: ${(error as Error).message}`);
			}
		},
	};
}

// `bun bench/lib/city-files.ts` builds the city's files and optimizes them into the null3D plugin's
// cache of this copy of the repository, as the first page that imports them would. CI runs it
// before the tests that load S6, so no page waits for the build.
if (import.meta.main) {
	const { optimizedModel } = await import('../../packages/vite-plugin/src/assets.ts');
	const root = join(import.meta.dirname, '../..');
	const started = performance.now();
	const files = cityFiles(root);
	for (const name of CITY_FILES) await optimizedModel(root, files[name]);
	console.log(
		`S6's city files are built and optimized, in ${((performance.now() - started) / 1000).toFixed(1)} s`,
	);
}
