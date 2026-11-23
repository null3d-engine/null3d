// Bakes the island's far cards from the raw Blender models, before the optimizer packs them: one
// octahedral atlas pair for each plant, with the engine's own baker, so every GPU path draws the
// same pictures and a card lights from the normals that the bake stores. The atlases are written
// beside the models, in the sample-assets repository, and the scene loads them with
// `createImpostors`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeImage } from '../../../packages/cli/src/assets/images.js';
import { writePng } from '../../../packages/cli/src/png.js';
import { bakeImpostorAtlas, type ImpostorBakeMap } from '../../../packages/impostors/src/bake';
import { octahedralAtlas } from '../../../packages/impostors/src/octahedral';

/** The views that one plant's atlas holds: a five by five octahedral grid, its widest gap 42.5 degrees. */
export const VIEWS = 25;
/**
 * The texels on each side of one view's cell. A plant's card reaches about 140 to 215 pixels at its
 * hand-over, and this gives about 0.6 to 1.5 texels for each of those pixels.
 */
export const TEXELS = 128;

/** The file name of a plant's colour atlas, and of its surface atlas. */
export const colorName = (kind: string): string => `${kind}-card-color.png`;
export const surfaceName = (kind: string): string => `${kind}-card-surface.png`;

interface Gltf {
	accessors?: {
		bufferView?: number;
		byteOffset?: number;
		componentType: number;
		count: number;
		type: string;
		normalized?: boolean;
	}[];
	bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
	buffers?: { byteLength: number; uri?: string }[];
	nodes?: {
		name?: string;
		mesh?: number;
		matrix?: number[];
		translation?: number[];
		rotation?: number[];
		scale?: number[];
	}[];
	meshes?: { name?: string; primitives: Primitive[] }[];
	materials?: {
		name?: string;
		alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
		alphaCutoff?: number;
		doubleSided?: boolean;
		pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
	}[];
	textures?: { source?: number }[];
	images?: { uri?: string; bufferView?: number; mimeType?: string }[];
}

interface Primitive {
	attributes: Record<string, number>;
	indices?: number;
	material?: number;
}

/** The components of an accessor as floats, element by element, without the start or the stride. */
function readFloats(json: Gltf, bin: Uint8Array, index: number): Float32Array {
	const accessor = json.accessors?.[index];
	if (!accessor) throw new Error(`the model has no accessor ${index}`);
	const view = json.bufferViews?.[accessor.bufferView ?? -1];
	if (!view) throw new Error(`accessor ${index} reads no buffer view`);
	const components = accessor.type === 'SCALAR' ? 1 : Number(accessor.type.slice(3));
	const size = componentTypeSize(accessor.componentType);
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride = view.byteStride ?? components * size;
	const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
	const scale = accessor.normalized ? 1 / maxOf(accessor.componentType) : 1;
	const out = new Float32Array(accessor.count * components);
	for (let i = 0; i < accessor.count; i++)
		for (let c = 0; c < components; c++)
			out[i * components + c] = readComponent(
				data,
				start + i * stride + c * size,
				accessor.componentType,
				scale,
			);
	return out;
}

/** One component of an accessor as a number, scaled where the accessor is normalized. */
function readComponent(data: DataView, at: number, componentType: number, scale: number): number {
	switch (componentType) {
		case 5126:
			return data.getFloat32(at, true);
		case 5125:
			return data.getUint32(at, true) * scale;
		case 5123:
			return data.getUint16(at, true) * scale;
		case 5121:
			return data.getUint8(at) * scale;
		case 5122:
			return data.getInt16(at, true) * scale;
		case 5120:
			return data.getInt8(at) * scale;
		default:
			throw new Error(`the model holds accessor component type ${componentType}`);
	}
}

function componentTypeSize(componentType: number): number {
	switch (componentType) {
		case 5126:
		case 5125:
		case 5122:
			return 4;
		case 5123:
			return 2;
		case 5121:
		case 5120:
			return 1;
		default:
			throw new Error(`the model holds accessor component type ${componentType}`);
	}
}

function maxOf(componentType: number): number {
	switch (componentType) {
		case 5121:
			return 255;
		case 5123:
			return 65_535;
		case 5120:
			return 127;
		case 5122:
			return 32_767;
		default:
			return 1;
	}
}

/** The JSON and the binary chunk of a binary glTF file. */
function readGlb(bytes: Uint8Array): { json: Gltf; bin: Uint8Array } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
	const at = 20 + jsonLength;
	const bin =
		at + 8 <= bytes.length && view.getUint32(at + 4, true) === 0x004e4942
			? bytes.subarray(at + 8, at + 8 + view.getUint32(at, true))
			: new Uint8Array(0);
	return { json, bin };
}

type Mat16 = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

/** A node's transform, column-major, from its matrix or its translation, rotation and scale. */
function worldOf(node: NonNullable<Gltf['nodes']>[number]): Float32Array {
	if (node.matrix) return Float32Array.from(node.matrix);
	const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
	const [x = 0, y = 0, z = 0, w = 1] = node.rotation ?? [];
	const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
	const turn: [number, number, number, number, number, number, number, number, number] = [
		1 - 2 * (y * y + z * z),
		2 * (x * y + z * w),
		2 * (x * z - y * w),
		2 * (x * y - z * w),
		1 - 2 * (x * x + z * z),
		2 * (y * z + x * w),
		2 * (x * z + y * w),
		2 * (y * z - x * w),
		1 - 2 * (x * x + y * y),
	];
	return Float32Array.from([
		turn[0] * sx,
		turn[1] * sx,
		turn[2] * sx,
		0,
		turn[3] * sy,
		turn[4] * sy,
		turn[5] * sy,
		0,
		turn[6] * sz,
		turn[7] * sz,
		turn[8] * sz,
		0,
		tx,
		ty,
		tz,
		1,
	]);
}

/** Moves positions by a transform, and turns normals by its rotation. */
function moved(matrix: Float32Array, positions: Float32Array): Float32Array {
	const m = matrix as unknown as Mat16;
	const out = new Float32Array(positions.length);
	for (let i = 0; i < positions.length; i += 3) {
		const [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]] as [
			number,
			number,
			number,
		];
		out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
		out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
		out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
	}
	return out;
}

/** Turns normals by a transform's rotation. */
function turned(matrix: Float32Array, normals: Float32Array): Float32Array {
	const m = matrix as unknown as Mat16;
	const out = new Float32Array(normals.length);
	for (let i = 0; i < normals.length; i += 3) {
		const [x, y, z] = [normals[i], normals[i + 1], normals[i + 2]] as [number, number, number];
		out[i] = m[0] * x + m[4] * y + m[8] * z;
		out[i + 1] = m[1] * x + m[5] * y + m[9] * z;
		out[i + 2] = m[2] * x + m[6] * y + m[10] * z;
	}
	return out;
}

/** The texels of a texture's image, decoded from the PNG it holds. */
function pictureOf(
	json: Gltf,
	bin: Uint8Array,
	texture: number,
): { width: number; height: number; data: Uint8Array } | undefined {
	const source = json.textures?.[texture]?.source;
	const image = source === undefined ? undefined : json.images?.[source];
	if (!image) return undefined;
	if (image.uri)
		throw new Error(`image ${source} is stored outside the model, which a build does not write`);
	const view = json.bufferViews?.[image.bufferView ?? -1];
	if (!view) throw new Error(`image ${source} reads no buffer view`);
	const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
	return decodeImage(bytes, image.mimeType ?? 'image/png');
}

/** A coverage map whose blue holds the picture's alpha, which the bake reads for a cut-out part. */
function coverageOf(picture: { width: number; height: number; data: Uint8Array }): ImpostorBakeMap {
	const data = new Uint8Array(picture.width * picture.height * 4);
	for (let i = 0; i < picture.width * picture.height; i++) {
		const alpha = picture.data[i * 4 + 3] as number;
		data[i * 4] = alpha;
		data[i * 4 + 1] = alpha;
		data[i * 4 + 2] = alpha;
		data[i * 4 + 3] = 255;
	}
	return { width: picture.width, height: picture.height, data };
}

/**
 * The plants of a model: the leaves part and the wood part that draw just before the far card takes
 * over, by the plant's name. That is the coarsest level that the scene draws: a card replaces the
 * last level before its hand-over, so the card's silhouette matches the mesh that it takes from.
 */
function plantsOf(json: Gltf): Map<string, { leaves: number; wood: number }> {
	const plants = new Map<string, { leaves: number; wood: number }>();
	const byName = new Map<string, number>();
	json.nodes?.forEach((node, index) => {
		if (node.name) byName.set(node.name, index);
	});
	for (const kind of new Set(
		[...byName.keys()]
			.map((name) => name.slice(0, name.lastIndexOf('-')))
			.filter((name) => byName.has(`${name}-leaves`) && byName.has(`${name}-wood`)),
	)) {
		// The coarsest level that the scene draws, the second level of the file.
		const leaves = byName.get(`${kind}-leaves-1`) ?? byName.get(`${kind}-leaves`);
		const wood = byName.get(`${kind}-wood-1`) ?? byName.get(`${kind}-wood`);
		if (leaves !== undefined && wood !== undefined) plants.set(kind, { leaves, wood });
	}
	return plants;
}

/** One part of a bake: its arrays in the plant's frame, and what colours it and cuts it out. */
function partOf(
	json: Gltf,
	bin: Uint8Array,
	nodeIndex: number,
): {
	positions: Float32Array;
	normals: Float32Array | undefined;
	uvs: Float32Array | undefined;
	colors: Float32Array | undefined;
	indices: ArrayLike<number>;
	color: ImpostorBakeMap | undefined;
	coverage: ImpostorBakeMap | undefined;
	alphaCutoff: number | undefined;
	doubleSided: boolean;
} {
	const node = json.nodes?.[nodeIndex];
	const primitive = json.meshes?.[node?.mesh ?? -1]?.primitives[0];
	if (!node || !primitive) throw new Error(`node ${nodeIndex} draws no mesh`);
	const matrix = worldOf(node);
	const material =
		primitive.material === undefined ? undefined : json.materials?.[primitive.material];
	const pictureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
	const picture = pictureIndex === undefined ? undefined : pictureOf(json, bin, pictureIndex);
	const cutOut = material?.alphaMode === 'MASK';
	const normalAt = primitive.attributes.NORMAL;
	const positions = moved(matrix, readFloats(json, bin, primitive.attributes.POSITION ?? -1));
	return {
		positions,
		normals: normalAt === undefined ? undefined : turned(matrix, readFloats(json, bin, normalAt)),
		uvs:
			primitive.attributes.TEXCOORD_0 === undefined
				? undefined
				: readFloats(json, bin, primitive.attributes.TEXCOORD_0),
		colors:
			primitive.attributes.COLOR_0 === undefined
				? undefined
				: readFloats(json, bin, primitive.attributes.COLOR_0),
		indices:
			primitive.indices === undefined
				? sequence(positions.length / 3)
				: readFloats(json, bin, primitive.indices),
		color: picture,
		// A cut-out's alpha is its coverage; an opaque part covers every texel it draws.
		coverage: cutOut && picture ? coverageOf(picture) : undefined,
		alphaCutoff: cutOut ? (material?.alphaCutoff ?? 0.5) : undefined,
		doubleSided: material?.doubleSided === true,
	};
}

/** The indices from zero, which a part without an index accessor draws its vertices in. */
function sequence(vertices: number): Uint32Array {
	const out = new Uint32Array(vertices);
	for (let i = 0; i < vertices; i++) out[i] = i;
	return out;
}

/** The smallest and largest corner of some positions. */
function boundsOf(...lists: readonly Float32Array[]): {
	min: [number, number, number];
	max: [number, number, number];
} {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	for (const positions of lists)
		for (let i = 0; i < positions.length; i += 3)
			for (let axis = 0; axis < 3; axis++) {
				const value = positions[i + axis] as number;
				if (value < (min[axis] as number)) min[axis] = value;
				if (value > (max[axis] as number)) max[axis] = value;
			}
	return { min, max };
}

/** What a plant's bake gave: the card's size, its room and the two pictures' files. */
export interface BakedCard {
	readonly kind: string;
	readonly seconds: number;
	readonly size: readonly [number, number];
	readonly room: number;
	readonly depth: number;
	readonly color: string;
	readonly surface: string;
	readonly textureBytes: number;
}

/** Where a model's cards' sizes and rooms are written, for the scene to stand its cards with. */
export const cardsName = (model: string): string => `${model}-cards.json`;

/**
 * Bakes each plant of a raw Blender model from its own leaves and wood, and writes the two atlases
 * and the cards' figures into `out`. A plant is drawn from its full leaves level, which the card can
 * stand for at Medium, so the card matches the most detailed mesh that a hand-over can leave behind.
 */
export async function bakeCards(rawGlb: string, out: string, model: string): Promise<BakedCard[]> {
	const { json, bin } = readGlb(new Uint8Array(readFileSync(rawGlb)));
	const plants = plantsOf(json);
	const made: BakedCard[] = [];
	const atlas = octahedralAtlas(VIEWS);
	const figures: {
		atlas: { columns: number; rows: number };
		species: Record<string, { size: [number, number]; room: number; depth: number }>;
	} = { atlas, species: {} };
	for (const [kind, nodes] of plants) {
		if (nodes.leaves < 0 || nodes.wood < 0) continue;
		const leaves = partOf(json, bin, nodes.leaves);
		const wood = partOf(json, bin, nodes.wood);
		const bounds = boundsOf(leaves.positions, wood.positions);
		const started = performance.now();
		const bake = bakeImpostorAtlas({
			atlas,
			texels: TEXELS,
			parts: [leaves, wood],
			min: bounds.min,
			max: bounds.max,
		});
		const seconds = (performance.now() - started) / 1000;
		const color = join(out, colorName(kind));
		const surface = join(out, surfaceName(kind));
		writePng(color, bake.color);
		writePng(surface, bake.surface);
		const textureBytes = bake.color.width * bake.color.height * 8;
		figures.species[kind] = { size: [...bake.size], room: bake.room, depth: bake.depth };
		made.push({
			kind,
			seconds,
			size: bake.size,
			room: bake.room,
			depth: bake.depth,
			color,
			surface,
			textureBytes,
		});
		console.log(
			`${kind} card: ${bake.color.width}x${bake.color.height} texels, ` +
				`${(textureBytes / 1024 / 1024).toFixed(2)} MB of texture, card ` +
				`${bake.size[0].toFixed(1)} x ${bake.size[1].toFixed(1)} m, room ${bake.room.toFixed(2)}, ` +
				`baked in ${seconds.toFixed(2)} s`,
		);
	}
	writeFileSync(join(out, cardsName(model)), `${JSON.stringify(figures, null, '\t')}\n`);
	return made;
}
