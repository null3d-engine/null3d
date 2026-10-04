// The glTF loader's parser, which runs in the glTF worker (workers/gltf-worker.ts), off the sketch's
// frames. It reads a .glb or .gltf file's JSON and binary chunk, checks every index, offset and
// count before it reads or allocates, and turns the file into plain data that the loader on the
// sketch thread (gltf.ts) makes engine resources from: each mesh's vertex arrays, tightly packed in
// the types the file holds them in, the node tree with parents first, the materials as the
// engine's options, the textures each material uses with their color space and texture
// coordinates, the lights and the nodes with instancing. It decodes no image: the worker decodes
// the images that the file holds, and the loader those it names by address. It allocates only what
// it returns, so a file with huge counts fails with E1416 before it allocates anything.
//
// Buffer views compressed with meshopt decode on first use, through the decoder that the caller
// passes in. The worker loads the decoder only for a file that holds meshopt data.
//
// The module imports only its sibling modules of the glTF worker, so the worker's bundle holds no
// engine code.

import {
	type AnimationData,
	type MorphTargetsData,
	morphWeights,
	parseAnimation,
	parseMorphTargets,
} from './gltf-animation';
import {
	type AccessorArray,
	broken,
	count,
	type Entry,
	entry,
	finite,
	GltfError,
	index,
	list,
	numbers,
	type Reader,
	text,
	toFloats,
	unit,
} from './gltf-json';
import { decomposeColumns } from './gltf-math';

export { type AccessorArray, GltfError, type GltfErrorCode } from './gltf-json';

/** The extensions that the loader reads. A file that requires any other fails with E1417. */
export const READ_EXTENSIONS: readonly string[] = [
	'KHR_mesh_quantization',
	'KHR_texture_basisu',
	'KHR_texture_transform',
	'KHR_materials_unlit',
	'KHR_materials_emissive_strength',
	'KHR_lights_punctual',
	'EXT_mesh_gpu_instancing',
	'KHR_meshopt_compression',
	'EXT_meshopt_compression',
];

/**
 * The two names of meshopt compression. The Khronos extension reads the vendor one's data, and
 * adds a newer vertex codec and a color filter, which the decoder reads under either name.
 */
const MESHOPT_EXTENSIONS = ['KHR_meshopt_compression', 'EXT_meshopt_compression'] as const;

/**
 * Decodes one buffer view of meshopt data into `target`, which holds `count` elements of `stride`
 * bytes, as meshoptimizer's `decodeGltfBuffer` does. Throws when the data does not decode.
 */
export type MeshoptDecode = (
	target: Uint8Array,
	count: number,
	stride: number,
	source: Uint8Array,
	mode: string,
	filter: string,
) => void;

/** The strides that each meshopt mode and filter allow, as the extension's rules give them. */
const MESHOPT_MODES: Readonly<Record<string, (stride: number) => boolean>> = {
	ATTRIBUTES: (stride) => stride % 4 === 0 && stride >= 4 && stride <= 256,
	TRIANGLES: (stride) => stride === 2 || stride === 4,
	INDICES: (stride) => stride === 2 || stride === 4,
};
const MESHOPT_FILTERS: Readonly<Record<string, (stride: number) => boolean>> = {
	NONE: () => true,
	OCTAHEDRAL: (stride) => stride === 4 || stride === 8,
	QUATERNION: (stride) => stride === 8,
	EXPONENTIAL: (stride) => stride % 4 === 0,
	COLOR: (stride) => stride === 4 || stride === 8,
};

/** The meshopt extension of a buffer or a buffer view, under either name, or undefined. */
function meshoptOf(value: unknown): Entry | undefined {
	const extensions = (value as Entry | null | undefined)?.extensions as Entry | undefined;
	if (typeof extensions !== 'object' || extensions === null) return undefined;
	for (const name of MESHOPT_EXTENSIONS) {
		const extension = extensions[name];
		if (typeof extension === 'object' && extension !== null) return extension as Entry;
	}
	return undefined;
}

/** True when a file has a buffer view of meshopt data, which only the meshopt decoder reads. */
export function usesMeshopt(container: GltfContainer): boolean {
	const views = container.json.bufferViews;
	return Array.isArray(views) && views.some((view) => meshoptOf(view) !== undefined);
}

/**
 * The most bytes that one accessor may read: WebGPU's portable limit on a buffer's size. It also
 * bounds an accessor without a buffer view, which the parser fills with zeros.
 */
export const MAX_ACCESSOR_BYTES = 256 * 1024 * 1024;

// Numbers of the glTF 2.0 specification.
const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
const NEAREST = 9728;
const NEAREST_MIPMAP_NEAREST = 9984;
const CLAMP_TO_EDGE = 33071;
const MIRRORED_REPEAT = 33648;

/** Each component type's bytes and the typed array that holds it. */
const COMPONENTS: Readonly<Record<number, readonly [bytes: number, type: TypedArrayClass]>> = {
	[BYTE]: [1, Int8Array],
	[UNSIGNED_BYTE]: [1, Uint8Array],
	[SHORT]: [2, Int16Array],
	[UNSIGNED_SHORT]: [2, Uint16Array],
	[UNSIGNED_INT]: [4, Uint32Array],
	[FLOAT]: [4, Float32Array],
};

/** Each accessor type's components. */
const TYPES: Readonly<Record<string, number>> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
	MAT2: 4,
	MAT3: 9,
	MAT4: 16,
};

type TypedArrayClass =
	| Int8ArrayConstructor
	| Uint8ArrayConstructor
	| Int16ArrayConstructor
	| Uint16ArrayConstructor
	| Uint32ArrayConstructor
	| Float32ArrayConstructor;

/** An attribute's values in the type the file holds them in, as `geometry.fromArrays` takes them. */
export interface VertexData {
	array: Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array;
	normalized: boolean;
}

/** One primitive of a mesh: its vertex arrays, its triangles and its material. */
export interface PrimitiveData {
	positions: VertexData;
	normals?: VertexData;
	uvs?: VertexData;
	uvs1?: VertexData;
	colors?: VertexData;
	tangents?: VertexData;
	joints?: VertexData;
	weights?: VertexData;
	/** Three indices per triangle, or none when each three vertices in a row make one. */
	indices?: Uint16Array | Uint32Array;
	/** The material's index in the file, or -1 for glTF's default material. */
	material: number;
	/** The lowest and highest position on each axis, from the position accessor. */
	min: [number, number, number];
	max: [number, number, number];
	/** The deltas of the primitive's morph targets, when it has any. */
	morph?: MorphTargetsData;
}

export interface MeshData {
	name: string;
	primitives: PrimitiveData[];
	/** The weight of each morph target when no clip sets it, when the primitives have targets. */
	weights?: number[];
	/** The targets' names, from the file's `extras.targetNames`, or none. */
	targetNames?: string[];
}

/** A texture as one material slot uses it: its image, color space, coordinates and sampler. */
export interface TextureUse {
	/** The image's index in the file. */
	image: number;
	colorSpace: 'srgb' | 'linear';
	uvSet: 0 | 1;
	wrap: readonly ['clamp' | 'repeat' | 'mirror', 'clamp' | 'repeat' | 'mirror'];
	filter: 'linear' | 'nearest';
	mipmaps: boolean;
}

/** Where a material's maps sit on the texture coordinates, as KHR_texture_transform gives it. */
export interface UvTransformData {
	offset: [number, number];
	repeat: [number, number];
	rotation: number;
}

/** A material as the engine's options, with its maps as indices into the texture uses. */
export interface MaterialData {
	name: string;
	unlit: boolean;
	/** Linear RGB. */
	color: [number, number, number];
	opacity: number;
	alphaMode: 'opaque' | 'mask' | 'blend';
	alphaCutoff: number;
	doubleSided: boolean;
	metalness: number;
	roughness: number;
	/** Linear RGB. */
	emissive: [number, number, number];
	emissiveIntensity: number;
	normalScale: number;
	aoMapIntensity: number;
	maps: {
		map?: number;
		metalnessRoughnessMap?: number;
		normalMap?: number;
		aoMap?: number;
		emissiveMap?: number;
	};
	uvTransform?: UvTransformData;
}

/** A light of KHR_lights_punctual, in the units that glTF and three.js share. */
export interface LightData {
	type: 'directional' | 'point' | 'spot';
	/** Linear RGB. */
	color: [number, number, number];
	intensity: number;
	/** The distance where the light ends, or 0 when the file gives none. */
	range: number;
	/** The cone's half angle, and the share of it over which the light fades, for spot lights. */
	angle: number;
	penumbra: number;
}

/** A node's instancing: the transform of each instance, relative to the node. */
export interface InstancingData {
	count: number;
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
}

/** A node of the scene, with its parent among the nodes before it. */
export interface NodeData {
	name: string;
	/** The parent's index in the node list, or -1 for a root of the scene. */
	parent: number;
	/** Position (3 numbers), rotation (4) and scale (3) relative to the parent. */
	transform: Float32Array;
	/** The mesh's index in the mesh list, or -1. */
	mesh: number;
	/** The light's index in the light list, or -1. */
	light: number;
	instancing?: InstancingData;
	/** The skin's index in the file, or -1. */
	skin: number;
	/**
	 * The node's joint in the model's skeleton, or -1 for a node that is no joint. A joint is no
	 * object: its mesh and light go under the copy's group.
	 */
	joint?: number;
	/** True when the node moves with clips, as a joint or below one. */
	moving?: boolean;
	/**
	 * True when joints move the node's mesh: a skinned mesh, or a mesh on a node that moves. Its
	 * vertices name the skeleton's joints, and it goes under the copy's group with no transform of
	 * its own.
	 */
	skinned?: boolean;
	/**
	 * The first joint of the model's skeleton that animates the morph weights of the node's mesh,
	 * three weights to a joint, or -1 when no clip animates them.
	 */
	morphJoint?: number;
	/** The morph weights of the node's mesh, when the node gives its own in place of the mesh's. */
	weights?: number[];
}

/** An image: its bytes when the file holds it, or its address when the file names it. */
export interface ImageData {
	/** The absolute address of an image that the file names, or undefined. */
	url?: string;
	bytes?: Uint8Array;
	/** The image's media type, when the file gives it. */
	mimeType?: string;
}

/** A parsed file: everything the loader makes engine resources from. */
export interface GltfData {
	nodes: NodeData[];
	meshes: MeshData[];
	materials: MaterialData[];
	textures: TextureUse[];
	images: ImageData[];
	lights: LightData[];
	/** The model's skeleton and clips, when the file has skins or animations. */
	animation?: AnimationData;
	/** What the parser left out, such as points and lines, for a warning in development builds. */
	notes: string[];
}

/** The parts of a glTF file's JSON that the parser reads. */
interface Json {
	asset?: { version?: unknown };
	extensionsRequired?: unknown;
	extensions?: { KHR_lights_punctual?: { lights?: unknown } };
	scene?: unknown;
	scenes?: unknown;
	nodes?: unknown;
	meshes?: unknown;
	accessors?: unknown;
	bufferViews?: unknown;
	buffers?: unknown;
	materials?: unknown;
	textures?: unknown;
	images?: unknown;
	samplers?: unknown;
	skins?: unknown;
	animations?: unknown;
}

/** A file's container, read: its JSON, its binary chunk, and the buffers it names by address. */
export interface GltfContainer {
	json: Json;
	/** The GLB binary chunk, or undefined for a .gltf file. */
	bin?: Uint8Array;
	/** The absolute address of each buffer that the file names, by the buffer's index. */
	external: Map<number, string>;
}

/** Reads a .glb or .gltf file's container and JSON, and lists the buffers it names by address. */
export function readContainer(file: Uint8Array, url: string): GltfContainer {
	let text: Uint8Array;
	let bin: Uint8Array | undefined;
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	if (file.length >= 4 && view.getUint32(0, true) === GLB_MAGIC) {
		if (file.length < GLB_HEADER_BYTES + 8) broken('its GLB header is cut short');
		const version = view.getUint32(4, true);
		if (version !== 2) broken(`it is a GLB file of version ${version}, not 2`);
		const length = Math.min(view.getUint32(8, true), file.length);
		let at = GLB_HEADER_BYTES;
		let chunk: Uint8Array | undefined;
		while (at + 8 <= length) {
			const size = view.getUint32(at, true);
			const kind = view.getUint32(at + 4, true);
			const end = at + 8 + size;
			if (end > length)
				broken(`a chunk of its GLB container runs ${end - length} bytes past its end`);
			const data = file.subarray(at + 8, end);
			if (kind === GLB_JSON && !chunk) chunk = data;
			else if (kind === GLB_BIN && !bin) bin = data;
			at = end + ((4 - (size % 4)) % 4);
		}
		if (!chunk) broken('its GLB container has no JSON chunk');
		text = chunk;
	} else text = file;
	let json: Json;
	try {
		json = JSON.parse(new TextDecoder().decode(text)) as Json;
	} catch (error) {
		broken(`its JSON does not parse: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json))
		broken('its JSON is not an object');
	const version = String(json.asset?.version ?? '');
	if (!/^2(\.\d+)?$/.test(version))
		broken(
			version ? `it is glTF ${version}, and the engine reads glTF 2.0` : 'it names no glTF version',
		);
	const required = list(json.extensionsRequired, 'extensionsRequired');
	for (const name of required)
		if (typeof name !== 'string' || !READ_EXTENSIONS.includes(name))
			throw new GltfError('E1417', `it requires ${String(name)}, which the engine does not read`);
	const external = new Map<number, string>();
	list(json.buffers, 'buffers').forEach((buffer, k) => {
		const uri = entry(buffer, `buffer ${k}`).uri;
		// A fallback buffer holds what meshopt data decodes to, for loaders without the decoder.
		// The engine decodes, so it never downloads one.
		const fallback = meshoptOf(buffer)?.fallback === true;
		if (uri === undefined) {
			if (!fallback && (k !== 0 || !bin))
				broken(`buffer ${k} has no uri, and only a GLB file's first buffer may lack one`);
			return;
		}
		if (typeof uri !== 'string') broken(`buffer ${k} has a uri that is not text`);
		if (!uri.startsWith('data:') && !fallback) external.set(k, resolve(uri, url));
	});
	return { json, bin, external };
}

/**
 * Parses a file whose container `readContainer` read, with the bytes of each buffer that it names
 * by address. `decode` reads buffer views of meshopt data. Without it, such a view reads its
 * fallback buffer, when the caller gives that buffer's bytes. Throws a `GltfError`.
 */
export function parseGltf(
	container: GltfContainer,
	externalBuffers: ReadonlyMap<number, Uint8Array>,
	url: string,
	decode?: MeshoptDecode,
): GltfData {
	const { json } = container;
	const notes: string[] = [];
	const buffers = list(json.buffers, 'buffers').map((value, k) => {
		const buffer = entry(value, `buffer ${k}`);
		const byteLength = count(buffer.byteLength, `buffer ${k}'s byteLength`);
		const { uri } = buffer;
		const fallback = meshoptOf(buffer)?.fallback === true;
		const bytes = fallback
			? externalBuffers.get(k)
			: uri === undefined
				? container.bin
				: typeof uri === 'string' && uri.startsWith('data:')
					? fromDataUri(uri, `buffer ${k}`)
					: externalBuffers.get(k);
		if (!bytes) {
			if (fallback) return undefined;
			broken(`buffer ${k} did not arrive`);
		}
		if (bytes.length < byteLength)
			broken(`buffer ${k} holds ${bytes.length} bytes, and its byteLength says ${byteLength}`);
		return bytes.subarray(0, byteLength);
	});
	const views = list(json.bufferViews, 'bufferViews').map((value, k): View => {
		const view = entry(value, `bufferView ${k}`);
		const what = `bufferView ${k}`;
		const buffer = index(view.buffer, buffers.length, `${what}'s buffer`);
		const offset = count(view.byteOffset ?? 0, `${what}'s byteOffset`);
		const length = count(view.byteLength, `${what}'s byteLength`);
		const stride =
			view.byteStride === undefined ? 0 : count(view.byteStride, `${what}'s byteStride`);
		const bytes = buffers[buffer];
		const meshopt = meshoptOf(view);
		if (meshopt && (decode || !bytes))
			return { stride, meshopt: compressedView(meshopt, length, buffers, what) };
		if (!bytes) broken(`${what} reads buffer ${buffer}, a fallback buffer that holds no data`);
		if (offset + length > bytes.length)
			broken(
				`${what} reads bytes ${offset} to ${offset + length} of buffer ${buffer}, which holds ${bytes.length}`,
			);
		return { bytes: bytes.subarray(offset, offset + length), stride };
	});

	/** The bytes of buffer view `v`. A view of meshopt data decodes the first time it is read. */
	const viewOf = (v: number): { bytes: Uint8Array; stride: number } => {
		const view = views[v] as View;
		if (view.bytes) return { bytes: view.bytes, stride: view.stride };
		const { buffer, offset, length, stride, count, mode, filter } = view.meshopt as CompressedView;
		if (!decode) broken(`bufferView ${v} holds meshopt data, and the parser has no decoder`);
		const source = (buffers[buffer] as Uint8Array).subarray(offset, offset + length);
		const target = new Uint8Array(count * stride);
		try {
			decode(target, count, stride, source, mode, filter);
		} catch (error) {
			broken(
				`bufferView ${v}'s meshopt data does not decode: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		view.bytes = target;
		return { bytes: target, stride: view.stride };
	};
	const accessors = list(json.accessors, 'accessors').map((value, k) =>
		entry(value, `accessor ${k}`),
	);

	/** Reads accessor `k` into a tight typed array of its component type, with its sparse values. */
	const read = (k: number, what: string, shared = false) => {
		const accessor = accessors[index(k, accessors.length, what)] as Entry;
		const name = `accessor ${k}`;
		const components = TYPES[String(accessor.type)];
		if (!components) broken(`${name} has the type ${String(accessor.type)}`);
		const componentType = Number(accessor.componentType);
		const component = COMPONENTS[componentType];
		if (!component) broken(`${name} has the component type ${String(accessor.componentType)}`);
		const [bytes, Type] = component;
		const n = count(accessor.count, `${name}'s count`);
		const element = components * bytes;
		if (n * element > MAX_ACCESSOR_BYTES)
			broken(
				`${name} holds ${n} elements, more than the ${MAX_ACCESSOR_BYTES} bytes an accessor may read`,
			);
		let out: Uint8Array<ArrayBuffer> | undefined;
		if (accessor.bufferView !== undefined) {
			const v = index(accessor.bufferView, views.length, `${name}'s bufferView`);
			const { bytes: source, stride } = viewOf(v);
			const offset = count(accessor.byteOffset ?? 0, `${name}'s byteOffset`);
			const step = stride || element;
			const end = n === 0 ? 0 : offset + (n - 1) * step + element;
			if (end > source.length)
				broken(`${name} reads ${end} bytes from bufferView ${v}, which holds ${source.length}`);
			const at = source.byteOffset + offset;
			if (shared && step === element && accessor.sparse === undefined && at % bytes === 0)
				return {
					array: new Type(source.buffer as ArrayBuffer, at, n * components) as AccessorArray,
					components,
					componentType,
					normalized: accessor.normalized === true,
					count: n,
					accessor,
				};
			out = new Uint8Array(n * element);
			if (step === element) out.set(source.subarray(offset, offset + n * element));
			else
				for (let i = 0; i < n; i++)
					out.set(source.subarray(offset + i * step, offset + i * step + element), i * element);
		}
		const array = new Type((out ?? new Uint8Array(n * element)).buffer) as AccessorArray;
		if (accessor.sparse !== undefined) applySparse(array, accessor.sparse, components, n, name);
		return {
			array,
			components,
			componentType,
			normalized: accessor.normalized === true,
			count: n,
			accessor,
		};
	};

	const applySparse = (
		array: AccessorArray,
		value: unknown,
		components: number,
		n: number,
		name: string,
	) => {
		const sparse = entry(value, `${name}'s sparse`);
		const m = count(sparse.count, `${name}'s sparse count`);
		if (m > n) broken(`${name} has ${m} sparse values for ${n} elements`);
		const at = entry(sparse.indices, `${name}'s sparse indices`);
		const values = entry(sparse.values, `${name}'s sparse values`);
		const indexType = COMPONENTS[Number(at.componentType)];
		if (
			!indexType ||
			indexType[1] === Int8Array ||
			indexType[1] === Int16Array ||
			indexType[1] === Float32Array
		)
			broken(`${name}'s sparse indices have the component type ${String(at.componentType)}`);
		/** Copies the `m` elements of `bytes` bytes each that `part` reads, after its checks. */
		const slice = (part: Entry, bytes: number, what: string) => {
			const v = index(part.bufferView, views.length, `${what}'s bufferView`);
			const source = viewOf(v).bytes;
			const offset = count(part.byteOffset ?? 0, `${what}'s byteOffset`);
			const end = offset + m * bytes;
			if (end > source.length)
				broken(`${what} read ${end} bytes from bufferView ${v}, which holds ${source.length}`);
			return source.slice(offset, end);
		};
		const indices = new indexType[1](slice(at, indexType[0], `${name}'s sparse indices`).buffer);
		const bytes = array.BYTES_PER_ELEMENT * components;
		const Type = array.constructor as TypedArrayClass;
		const replacement = new Type(slice(values, bytes, `${name}'s sparse values`).buffer);
		for (let i = 0; i < m; i++) {
			const target = indices[i] as number;
			if (target >= n) broken(`${name}'s sparse index ${target} is past its ${n} elements`);
			array.set(replacement.subarray(i * components, (i + 1) * components), target * components);
		}
	};

	const meshes = list(json.meshes, 'meshes').map((value, k): MeshData => {
		const mesh = entry(value, `mesh ${k}`);
		const primitives: PrimitiveData[] = [];
		list(mesh.primitives, `mesh ${k}'s primitives`).forEach((p, j) => {
			const what = `mesh ${k}'s primitive ${j}`;
			const primitive = parsePrimitive(entry(p, what), what, read, notes);
			if (primitive) primitives.push(primitive);
		});
		const data: MeshData = { name: text(mesh.name), primitives };
		if (primitives.some((p) => p.morph))
			Object.assign(data, morphWeights(mesh, primitives, `mesh ${k}`));
		return data;
	});

	const textureUses: TextureUse[] = [];
	const useKeys = new Map<string, number>();
	const textureDefs = list(json.textures, 'textures').map((value, k) =>
		entry(value, `texture ${k}`),
	);
	const samplers = list(json.samplers, 'samplers').map((value, k) => entry(value, `sampler ${k}`));
	const imageCount = list(json.images, 'images').length;
	const useTexture = (info: unknown, colorSpace: 'srgb' | 'linear', what: string) => {
		if (info === undefined) return undefined;
		const slot = entry(info, what);
		const t = index(slot.index, textureDefs.length, `${what}'s texture`);
		const texture = textureDefs[t] as Entry;
		const basisu = (texture.extensions as Entry | undefined)?.KHR_texture_basisu as
			| Entry
			| undefined;
		const source = basisu?.source ?? texture.source;
		if (source === undefined) broken(`texture ${t} has no image`);
		const image = index(source, imageCount, `texture ${t}'s image`);
		const transform = (slot.extensions as Entry | undefined)?.KHR_texture_transform as
			| Entry
			| undefined;
		const coordinates = Number(transform?.texCoord ?? slot.texCoord ?? 0);
		if (coordinates !== 0 && coordinates !== 1)
			broken(`${what} reads texture coordinates ${coordinates}, and the engine reads sets 0 and 1`);
		const sampler =
			texture.sampler === undefined
				? {}
				: (samplers[index(texture.sampler, samplers.length, `texture ${t}'s sampler`)] as Entry);
		const use: TextureUse = {
			image,
			colorSpace,
			uvSet: coordinates,
			wrap: [wrapOf(sampler.wrapS), wrapOf(sampler.wrapT)],
			filter: sampler.magFilter === NEAREST ? 'nearest' : 'linear',
			mipmaps:
				sampler.minFilter === undefined || Number(sampler.minFilter) >= NEAREST_MIPMAP_NEAREST,
		};
		const key = JSON.stringify(use);
		let found = useKeys.get(key);
		if (found === undefined) {
			found = textureUses.push(use) - 1;
			useKeys.set(key, found);
		}
		return { use: found, transform };
	};

	const materials = list(json.materials, 'materials').map((value, k): MaterialData => {
		const what = `material ${k}`;
		const material = entry(value, what);
		const pbr = (material.pbrMetallicRoughness ?? {}) as Entry;
		const extensions = (material.extensions ?? {}) as Entry;
		const base = numbers(pbr.baseColorFactor, 4, [1, 1, 1, 1], `${what}'s baseColorFactor`);
		const emissive = numbers(material.emissiveFactor, 3, [0, 0, 0], `${what}'s emissiveFactor`);
		const strength = (extensions.KHR_materials_emissive_strength as Entry | undefined)
			?.emissiveStrength;
		const slots = {
			map: useTexture(pbr.baseColorTexture, 'srgb', `${what}'s baseColorTexture`),
			metalnessRoughnessMap: useTexture(
				pbr.metallicRoughnessTexture,
				'linear',
				`${what}'s metallicRoughnessTexture`,
			),
			normalMap: useTexture(material.normalTexture, 'linear', `${what}'s normalTexture`),
			aoMap: useTexture(material.occlusionTexture, 'linear', `${what}'s occlusionTexture`),
			emissiveMap: useTexture(material.emissiveTexture, 'srgb', `${what}'s emissiveTexture`),
		};
		const maps: MaterialData['maps'] = {};
		let transform: Entry | undefined;
		for (const key of Object.keys(slots) as (keyof typeof slots)[]) {
			const slot = slots[key];
			if (!slot) continue;
			maps[key] = slot.use;
			transform ??= slot.transform;
		}
		const unlit = extensions.KHR_materials_unlit !== undefined;
		const alphaMode = String(material.alphaMode ?? 'OPAQUE');
		if (alphaMode !== 'OPAQUE' && alphaMode !== 'MASK' && alphaMode !== 'BLEND')
			broken(`${what} has the alpha mode ${alphaMode}`);
		const data: MaterialData = {
			name: text(material.name),
			unlit,
			color: [base[0] as number, base[1] as number, base[2] as number],
			opacity: base[3] as number,
			alphaMode: alphaMode.toLowerCase() as MaterialData['alphaMode'],
			alphaCutoff: unit(material.alphaCutoff ?? 0.5, `${what}'s alphaCutoff`, Infinity),
			doubleSided: material.doubleSided === true,
			metalness: unit(pbr.metallicFactor ?? 1, `${what}'s metallicFactor`),
			roughness: unit(pbr.roughnessFactor ?? 1, `${what}'s roughnessFactor`),
			emissive: [emissive[0] as number, emissive[1] as number, emissive[2] as number],
			emissiveIntensity: unit(strength ?? 1, `${what}'s emissiveStrength`, Infinity),
			normalScale: finite(
				(material.normalTexture as Entry | undefined)?.scale ?? 1,
				`${what}'s normal scale`,
			),
			aoMapIntensity: unit(
				(material.occlusionTexture as Entry | undefined)?.strength ?? 1,
				`${what}'s occlusion strength`,
			),
			maps,
		};
		if (transform) {
			const offset = numbers(transform.offset, 2, [0, 0], `${what}'s texture transform offset`);
			const scale = numbers(transform.scale, 2, [1, 1], `${what}'s texture transform scale`);
			data.uvTransform = {
				offset: [offset[0] as number, offset[1] as number],
				repeat: [scale[0] as number, scale[1] as number],
				rotation: finite(transform.rotation ?? 0, `${what}'s texture transform rotation`),
			};
		}
		return data;
	});
	for (const mesh of meshes)
		for (const primitive of mesh.primitives)
			if (primitive.material >= materials.length)
				broken(
					`a primitive of mesh "${mesh.name}" names material ${primitive.material}, and the file has ${materials.length}`,
				);

	const images = list(json.images, 'images').map((value, k): ImageData => {
		const image = entry(value, `image ${k}`);
		const mimeType = image.mimeType === undefined ? undefined : text(image.mimeType);
		if (typeof image.uri === 'string') {
			if (image.uri.startsWith('data:'))
				return {
					bytes: fromDataUri(image.uri, `image ${k}`),
					mimeType: mimeType ?? image.uri.slice(5).split(/[;,]/)[0],
				};
			return { url: resolve(image.uri, url), mimeType };
		}
		const v = index(image.bufferView, views.length, `image ${k}'s bufferView`);
		return { bytes: viewOf(v).bytes.slice(), mimeType };
	});

	const lightDefs = list(json.extensions?.KHR_lights_punctual?.lights, 'lights');
	const lights = lightDefs.map((value, k): LightData => {
		const what = `light ${k}`;
		const light = entry(value, what);
		const type = String(light.type);
		if (type !== 'directional' && type !== 'point' && type !== 'spot')
			broken(`${what} has the type ${type}`);
		const color = numbers(light.color, 3, [1, 1, 1], `${what}'s color`);
		const spot = (light.spot ?? {}) as Entry;
		const outer = unit(
			spot.outerConeAngle ?? Math.PI / 4,
			`${what}'s outer cone angle`,
			Math.PI / 2,
		);
		const inner = unit(spot.innerConeAngle ?? 0, `${what}'s inner cone angle`, outer);
		return {
			type,
			color: [color[0] as number, color[1] as number, color[2] as number],
			intensity: unit(light.intensity ?? 1, `${what}'s intensity`, Infinity),
			range: light.range === undefined ? 0 : unit(light.range, `${what}'s range`, Infinity),
			angle: outer,
			penumbra: outer > 0 ? 1 - inner / outer : 0,
		};
	});

	const { nodes, place } = parseNodes(json, meshes, lights.length, read);
	const animation = parseAnimation(json, nodes, meshes, place, read, notes);
	const data: GltfData = { nodes, meshes, materials, textures: textureUses, images, lights, notes };
	if (animation) data.animation = animation;
	return data;
}

/** A buffer view: its bytes, or the meshopt data that its bytes decode from on first use. */
interface View {
	bytes?: Uint8Array;
	stride: number;
	meshopt?: CompressedView;
}

/** A buffer view's meshopt data, checked against the extension's rules. */
interface CompressedView {
	buffer: number;
	offset: number;
	length: number;
	stride: number;
	count: number;
	mode: string;
	filter: string;
}

/**
 * Checks a buffer view's meshopt extension: its data lies inside a buffer that holds data, its
 * mode and filter allow its stride, and its decoded bytes fill the view and stay within an
 * accessor's limit. So a decode never allocates a huge count.
 */
function compressedView(
	meshopt: Entry,
	viewLength: number,
	buffers: readonly (Uint8Array | undefined)[],
	what: string,
): CompressedView {
	const name = `${what}'s meshopt data`;
	const buffer = index(meshopt.buffer, buffers.length, `${name}'s buffer`);
	const offset = count(meshopt.byteOffset ?? 0, `${name}'s byteOffset`);
	const length = count(meshopt.byteLength, `${name}'s byteLength`);
	const stride = count(meshopt.byteStride, `${name}'s byteStride`);
	const n = count(meshopt.count, `${name}'s count`);
	const mode = String(meshopt.mode);
	const filter = String(meshopt.filter ?? 'NONE');
	const bytes = buffers[buffer];
	if (!bytes) broken(`${name} reads buffer ${buffer}, a fallback buffer that holds no data`);
	if (offset + length > bytes.length)
		broken(
			`${name} reads bytes ${offset} to ${offset + length} of buffer ${buffer}, which holds ${bytes.length}`,
		);
	const modeAllows = MESHOPT_MODES[mode];
	if (!modeAllows) broken(`${name} has the mode ${mode}`);
	const filterAllows = MESHOPT_FILTERS[filter];
	if (!filterAllows) broken(`${name} has the filter ${filter}`);
	if (filter !== 'NONE' && mode !== 'ATTRIBUTES')
		broken(`${name} has the filter ${filter}, which only the ATTRIBUTES mode takes`);
	if (!modeAllows(stride) || !filterAllows(stride))
		broken(`${name} has the byteStride ${stride}, which its mode and filter do not allow`);
	if (mode === 'TRIANGLES' && n % 3 !== 0)
		broken(`${name} has ${n} indices, which make no whole triangles`);
	if (n * stride > MAX_ACCESSOR_BYTES)
		broken(
			`${name} decodes to ${n * stride} bytes, more than the ${MAX_ACCESSOR_BYTES} bytes an accessor may read`,
		);
	if (n * stride !== viewLength)
		broken(`${name} decodes to ${n * stride} bytes, and the view's byteLength says ${viewLength}`);
	return { buffer, offset, length, stride, count: n, mode, filter };
}

/**
 * Each attribute that the engine reads: its glTF name, its field, its components, and the
 * component types it takes, each with whether it must be normalized (true), must not be (false),
 * or may be either (undefined).
 */
const ATTRIBUTES: readonly [
	name: string,
	field: Exclude<keyof PrimitiveData, 'indices' | 'material' | 'min' | 'max'>,
	components: readonly number[],
	types: Readonly<Record<number, boolean | undefined>>,
][] = [
	[
		'POSITION',
		'positions',
		[3],
		{
			[FLOAT]: false,
			[BYTE]: undefined,
			[UNSIGNED_BYTE]: undefined,
			[SHORT]: undefined,
			[UNSIGNED_SHORT]: undefined,
		},
	],
	['NORMAL', 'normals', [3], { [FLOAT]: false, [BYTE]: true, [SHORT]: true }],
	['TANGENT', 'tangents', [4], { [FLOAT]: false, [BYTE]: true, [SHORT]: true }],
	[
		'TEXCOORD_0',
		'uvs',
		[2],
		{
			[FLOAT]: false,
			[BYTE]: undefined,
			[UNSIGNED_BYTE]: undefined,
			[SHORT]: undefined,
			[UNSIGNED_SHORT]: undefined,
		},
	],
	[
		'TEXCOORD_1',
		'uvs1',
		[2],
		{
			[FLOAT]: false,
			[BYTE]: undefined,
			[UNSIGNED_BYTE]: undefined,
			[SHORT]: undefined,
			[UNSIGNED_SHORT]: undefined,
		},
	],
	['COLOR_0', 'colors', [3, 4], { [FLOAT]: false, [UNSIGNED_BYTE]: true, [UNSIGNED_SHORT]: true }],
	['JOINTS_0', 'joints', [4], { [UNSIGNED_BYTE]: false, [UNSIGNED_SHORT]: false }],
	['WEIGHTS_0', 'weights', [4], { [FLOAT]: false, [UNSIGNED_BYTE]: true, [UNSIGNED_SHORT]: true }],
];

/** One primitive's vertex arrays and triangles, or undefined for points and lines, which it notes. */
function parsePrimitive(
	primitive: Entry,
	what: string,
	read: Reader,
	notes: string[],
): PrimitiveData | undefined {
	const mode = Number(primitive.mode ?? TRIANGLES);
	if (mode !== TRIANGLES && mode !== TRIANGLE_STRIP && mode !== TRIANGLE_FAN) {
		notes.push(`${what} draws points or lines, which the engine does not draw from glTF files yet`);
		return undefined;
	}
	const attributes = entry(primitive.attributes, `${what}'s attributes`);
	if (attributes.POSITION === undefined) broken(`${what} has no POSITION attribute`);
	const out: Partial<PrimitiveData> = {};
	let vertices = -1;
	for (const [name, field, components, types] of ATTRIBUTES) {
		if (attributes[name] === undefined) continue;
		const data = read(Number(attributes[name]), `${what}'s ${name}`);
		const normalized = types[data.componentType];
		if (
			!(data.componentType in types) ||
			!components.includes(data.components) ||
			(normalized !== undefined && normalized !== data.normalized)
		)
			broken(
				`${what}'s ${name} is ${data.components} values of component type ${data.componentType}${data.normalized ? ', normalized' : ''}, which glTF does not allow for it`,
			);
		if (vertices < 0) vertices = data.count;
		else if (data.count !== vertices)
			broken(`${what}'s ${name} has ${data.count} values, and its POSITION has ${vertices}`);
		out[field] = { array: data.array as VertexData['array'], normalized: data.normalized };
		if (field === 'positions') {
			const min = numbers(data.accessor.min, 3, undefined, `${what}'s POSITION min`);
			const max = numbers(data.accessor.max, 3, undefined, `${what}'s POSITION max`);
			out.min = [min[0] as number, min[1] as number, min[2] as number];
			out.max = [max[0] as number, max[1] as number, max[2] as number];
		}
	}
	let indices: Uint16Array | Uint32Array | undefined;
	if (primitive.indices !== undefined) {
		const data = read(Number(primitive.indices), `${what}'s indices`);
		if (
			data.components !== 1 ||
			!(
				data.array instanceof Uint8Array ||
				data.array instanceof Uint16Array ||
				data.array instanceof Uint32Array
			)
		)
			broken(`${what}'s indices are not unsigned integers`);
		indices = data.array instanceof Uint32Array ? data.array : Uint16Array.from(data.array);
		for (const i of indices)
			if (i >= vertices) broken(`${what} has the index ${i}, past its ${vertices} vertices`);
	}
	if (mode !== TRIANGLES) indices = toTriangles(indices, vertices, mode);
	const corners = indices ? indices.length : vertices;
	if (corners % 3 !== 0) broken(`${what} has ${corners} corners, which make no whole triangles`);
	if (vertices === 0) return undefined;
	const morph = parseMorphTargets(primitive, vertices, what, read, notes);
	if (morph) out.morph = morph;
	const material =
		primitive.material === undefined ? -1 : count(primitive.material, `${what}'s material`);
	return { ...(out as PrimitiveData), indices, material };
}

/** Triangle lists from a strip or a fan, as three.js's `toTrianglesDrawMode` makes them. */
function toTriangles(
	indices: Uint16Array | Uint32Array | undefined,
	vertices: number,
	mode: number,
): Uint32Array {
	const n = indices?.length ?? vertices;
	const at = (i: number) => (indices ? (indices[i] as number) : i);
	const triangles = Math.max(0, n - 2);
	const out = new Uint32Array(triangles * 3);
	for (let i = 0; i < triangles; i++) {
		if (mode === TRIANGLE_FAN) out.set([at(0), at(i + 1), at(i + 2)], i * 3);
		else if (i % 2 === 0) out.set([at(i), at(i + 1), at(i + 2)], i * 3);
		else out.set([at(i + 2), at(i + 1), at(i)], i * 3);
	}
	return out;
}

/**
 * The scene's nodes in an order where parents come first, each with its parent's index, and each
 * file node's index in that order, or -1 for a node outside the scene.
 */
function parseNodes(
	json: Json,
	meshes: readonly MeshData[],
	lights: number,
	read: Reader,
): { nodes: NodeData[]; place: Int32Array } {
	const skins = list(json.skins, 'skins').length;
	const defs = list(json.nodes, 'nodes').map((value, k) => entry(value, `node ${k}`));
	const parents = new Int32Array(defs.length).fill(-1);
	defs.forEach((node, k) => {
		for (const child of list(node.children, `node ${k}'s children`)) {
			const c = index(child, defs.length, `node ${k}'s child`);
			if (parents[c] !== -1 || c === k) broken(`node ${c} has more than one parent, or is its own`);
			parents[c] = k;
		}
	});
	// A node that can reach itself through its parents is in a loop, which a parent-first order
	// can never place.
	for (let k = 0; k < defs.length; k++) {
		let up = parents[k] as number;
		for (let steps = 0; up >= 0; steps++) {
			if (up === k || steps > defs.length) broken(`node ${k} is in a loop of parents`);
			up = parents[up] as number;
		}
	}
	const scenes = list(json.scenes, 'scenes');
	let roots: number[];
	if (scenes.length > 0) {
		const scene = index(json.scene ?? 0, scenes.length, 'scene');
		roots = list(entry(scenes[scene], `scene ${scene}`).nodes, `scene ${scene}'s nodes`).map((n) =>
			index(n, defs.length, `scene ${scene}'s node`),
		);
		for (const root of roots)
			if (parents[root] !== -1) broken(`scene ${scene} names node ${root}, which has a parent`);
	} else roots = defs.flatMap((_, k) => (parents[k] === -1 ? [k] : []));
	const order: number[] = [...new Set(roots)];
	const place = new Int32Array(defs.length).fill(-1);
	order.forEach((k, i) => {
		place[k] = i;
	});
	for (let i = 0; i < order.length; i++) {
		const k = order[i] as number;
		for (const child of list((defs[k] as Entry).children, '')) {
			place[child as number] = order.length;
			order.push(child as number);
		}
	}
	const nodes = order.map((k): NodeData => {
		const node = defs[k] as Entry;
		const what = `node ${k}`;
		const extensions = (node.extensions ?? {}) as Entry;
		const lightRef = (extensions.KHR_lights_punctual as Entry | undefined)?.light;
		const data: NodeData = {
			name: text(node.name),
			parent: parents[k] === -1 ? -1 : (place[parents[k] as number] as number),
			transform: transformOf(node, what),
			mesh: node.mesh === undefined ? -1 : index(node.mesh, meshes.length, `${what}'s mesh`),
			light: lightRef === undefined ? -1 : index(lightRef, lights, `${what}'s light`),
			skin: node.skin === undefined ? -1 : index(node.skin, skins, `${what}'s skin`),
		};
		const instancing = extensions.EXT_mesh_gpu_instancing as Entry | undefined;
		if (instancing && data.mesh >= 0) data.instancing = parseInstancing(instancing, what, read);
		if (node.weights !== undefined && data.mesh >= 0) {
			const targets = (meshes[data.mesh] as MeshData).weights?.length ?? 0;
			data.weights = numbers(node.weights, targets, undefined, `${what}'s weights`);
		}
		return data;
	});
	return { nodes, place };
}

/** A node's position, rotation and scale, from its matrix or its own values. */
function transformOf(node: Entry, what: string): Float32Array {
	const out = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
	if (node.matrix !== undefined) {
		decomposeColumns(numbers(node.matrix, 16, undefined, `${what}'s matrix`), out);
		return out;
	}
	out.set(numbers(node.translation, 3, [0, 0, 0], `${what}'s translation`), 0);
	out.set(numbers(node.rotation, 4, [0, 0, 0, 1], `${what}'s rotation`), 3);
	out.set(numbers(node.scale, 3, [1, 1, 1], `${what}'s scale`), 7);
	return out;
}

/** A node's EXT_mesh_gpu_instancing transforms, as floats. */
function parseInstancing(instancing: Entry, what: string, read: Reader): InstancingData {
	const attributes = entry(instancing.attributes, `${what}'s instancing attributes`);
	let n = -1;
	const take = (name: string, components: number) => {
		if (attributes[name] === undefined) return undefined;
		const data = read(Number(attributes[name]), `${what}'s instancing ${name}`);
		if (data.components !== components)
			broken(`${what}'s instancing ${name} has ${data.components} components`);
		if (n >= 0 && data.count !== n) broken(`${what}'s instancing attributes differ in count`);
		n = data.count;
		return toFloats(data.array, data.normalized);
	};
	const positions = take('TRANSLATION', 3);
	const rotations = take('ROTATION', 4);
	const scales = take('SCALE', 3);
	if (n < 0) broken(`${what}'s instancing has no attributes`);
	const filled = (array: Float32Array | undefined, value: readonly number[]) => {
		if (array) return array;
		const out = new Float32Array(n * value.length);
		for (let i = 0; i < n; i++) out.set(value, i * value.length);
		return out;
	};
	return {
		count: n,
		positions: filled(positions, [0, 0, 0]),
		rotations: filled(rotations, [0, 0, 0, 1]),
		scales: filled(scales, [1, 1, 1]),
	};
}

function wrapOf(value: unknown): 'clamp' | 'repeat' | 'mirror' {
	return value === CLAMP_TO_EDGE ? 'clamp' : value === MIRRORED_REPEAT ? 'mirror' : 'repeat';
}

/** An address relative to the file's own. */
function resolve(uri: string, base: string): string {
	try {
		return new URL(uri, base).href;
	} catch {
		broken(`it names the address ${uri}, which does not resolve`);
	}
}

/** The bytes of a base64 data: address. */
function fromDataUri(uri: string, what: string): Uint8Array {
	const comma = uri.indexOf(',');
	if (comma < 0 || !uri.slice(0, comma).endsWith(';base64'))
		broken(`${what} has a data: address that is not base64`);
	let binary: string;
	try {
		binary = atob(uri.slice(comma + 1));
	} catch {
		broken(`${what} has a data: address whose base64 does not decode`);
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
