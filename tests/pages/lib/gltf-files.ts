// Small glTF files made in code, for the loader's unit tests and its test pages: one per extension
// that the loader reads, and the files that break the rules. The builder packs typed arrays into
// one buffer, four bytes apart as glTF asks, and writes a .glb file, or a .gltf file whose buffer
// is a data: address. Meshopt data goes into the same buffer, and its views read a fallback buffer
// with no data, as gltfpack writes them. It imports nothing, so pages and Bun load it alike.

/** A field of the glTF JSON. */
// biome-ignore lint/suspicious/noExplicitAny: the JSON of a test file takes any shape, broken ones too
export type GltfJson = Record<string, any>;

type Typed = Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array;

const COMPONENT: Record<string, number> = {
	Int8Array: 5120,
	Uint8Array: 5121,
	Int16Array: 5122,
	Uint16Array: 5123,
	Uint32Array: 5125,
	Float32Array: 5126,
};

const TYPE: Record<number, string> = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' };

/** Builds a glTF file from typed arrays and JSON. */
export class GltfBuilder {
	readonly json: GltfJson = {
		asset: { version: '2.0', generator: 'null3D tests' },
		buffers: [],
		bufferViews: [],
		accessors: [],
		meshes: [],
		materials: [],
		nodes: [],
		scenes: [{ nodes: [] }],
		scene: 0,
	};
	private readonly chunks: Uint8Array[] = [];
	private length = 0;
	/** The fallback buffer's length, and the meshopt extension that names it, once a view uses it. */
	private fallback?: { length: number; extension: string };

	/** Adds bytes to the buffer, four bytes apart from the next, and returns their offset. */
	private append(bytes: Uint8Array): number {
		const at = this.length;
		this.chunks.push(bytes);
		this.length += bytes.length;
		const pad = (4 - (this.length % 4)) % 4;
		if (pad) {
			this.chunks.push(new Uint8Array(pad));
			this.length += pad;
		}
		return at;
	}

	/** Adds bytes to the buffer as a buffer view, and returns the view's index. */
	view(bytes: Uint8Array, stride?: number): number {
		const view: GltfJson = { buffer: 0, byteOffset: this.append(bytes), byteLength: bytes.length };
		if (stride) view.byteStride = stride;
		return this.json.bufferViews.push(view) - 1;
	}

	/**
	 * Adds meshopt data to the buffer as a buffer view of `fields.count` elements of
	 * `fields.byteStride` bytes, and returns the view's index. The view itself reads the fallback
	 * buffer, and `stride` is its byteStride.
	 */
	meshoptView(
		data: Uint8Array,
		fields: { count: number; byteStride: number; mode: string; filter?: string },
		extension = 'EXT_meshopt_compression',
		stride?: number,
	): number {
		this.fallback ??= { length: 0, extension };
		const fallback = this.fallback;
		const byteLength = fields.count * fields.byteStride;
		const view: GltfJson = {
			buffer: 1,
			byteOffset: fallback.length,
			byteLength,
			extensions: {
				[extension]: {
					buffer: 0,
					byteOffset: this.append(data),
					byteLength: data.length,
					...fields,
				},
			},
		};
		if (stride) view.byteStride = stride;
		fallback.length += Math.ceil(byteLength / 4) * 4;
		return this.json.bufferViews.push(view) - 1;
	}

	/** Adds an accessor that reads buffer view `view`, and returns its index. */
	accessorOf(
		view: number,
		componentType: number,
		count: number,
		components: number,
		fields: GltfJson = {},
	): number {
		const accessor: GltfJson = {
			bufferView: view,
			componentType,
			count,
			type: TYPE[components],
			...fields,
		};
		return this.json.accessors.push(accessor) - 1;
	}

	/** Adds an accessor of `components` values per element, and returns its index. */
	accessor(array: Typed, components: number, fields: GltfJson = {}): number {
		const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
		const accessor: GltfJson = {
			bufferView: this.view(bytes.slice()),
			componentType: COMPONENT[array.constructor.name],
			count: array.length / components,
			type: TYPE[components],
			...fields,
		};
		return this.json.accessors.push(accessor) - 1;
	}

	/** Adds a POSITION accessor with the min and max that glTF asks of it. */
	positions(array: Typed, fields: GltfJson = {}): number {
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < array.length; i++) {
			const axis = i % 3;
			min[axis] = Math.min(min[axis] as number, array[i] as number);
			max[axis] = Math.max(max[axis] as number, array[i] as number);
		}
		return this.accessor(array, 3, { min, max, ...fields });
	}

	/**
	 * Adds a float accessor that reads as `values`, with `components` values per element, and returns
	 * its index. Without `base` it holds zeros, and with `base` it reads that array from a buffer
	 * view. A sparse list holds each element where `values` differs, as Blender's exporter writes
	 * morph targets. Its indices take the smallest unsigned type that holds the largest one, unless
	 * `indexType` names a component type. When no element differs, the accessor has no sparse list.
	 */
	sparse(
		values: Float32Array,
		components: number,
		options: { base?: Float32Array; indexType?: number } = {},
	): number {
		const { base } = options;
		const n = values.length / components;
		const changed: number[] = [];
		for (let i = 0; i < n; i++)
			for (let c = 0; c < components; c++)
				if (values[i * components + c] !== (base?.[i * components + c] ?? 0)) {
					changed.push(i);
					break;
				}
		const min = Array<number>(components).fill(Infinity);
		const max = Array<number>(components).fill(-Infinity);
		values.forEach((v, k) => {
			min[k % components] = Math.min(min[k % components] as number, v);
			max[k % components] = Math.max(max[k % components] as number, v);
		});
		const accessor: GltfJson = {
			componentType: 5126,
			count: n,
			type: TYPE[components],
			min,
			max,
		};
		if (base) accessor.bufferView = this.view(new Uint8Array(base.slice().buffer));
		if (changed.length > 0) {
			const last = changed.at(-1) as number;
			const indexType = options.indexType ?? (last < 256 ? 5121 : last < 65536 ? 5123 : 5125);
			const Indices = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[indexType];
			if (!Indices) throw new Error(`${indexType} is not a sparse index type`);
			const replaced = new Float32Array(changed.length * components);
			changed.forEach((i, k) => {
				replaced.set(values.subarray(i * components, (i + 1) * components), k * components);
			});
			accessor.sparse = {
				count: changed.length,
				indices: {
					bufferView: this.view(new Uint8Array(Indices.from(changed).buffer)),
					componentType: indexType,
				},
				values: { bufferView: this.view(new Uint8Array(replaced.buffer)) },
			};
		}
		return this.json.accessors.push(accessor) - 1;
	}

	/** Adds a mesh of the primitives given, and returns its index. */
	mesh(primitives: GltfJson[], name = ''): number {
		return this.json.meshes.push({ name, primitives }) - 1;
	}

	/** Adds a material, and returns its index. */
	material(material: GltfJson): number {
		return this.json.materials.push(material) - 1;
	}

	/** Adds a node, as a root of the scene unless `child` is true, and returns its index. */
	node(node: GltfJson, child = false): number {
		const k = this.json.nodes.push(node) - 1;
		if (!child) this.json.scenes[0].nodes.push(k);
		return k;
	}

	/** Marks an extension as used, and as required when `required` is true. */
	uses(name: string, required = false): this {
		this.json.extensionsUsed = [...new Set([...(this.json.extensionsUsed ?? []), name])];
		if (required)
			this.json.extensionsRequired = [...new Set([...(this.json.extensionsRequired ?? []), name])];
		return this;
	}

	/** The file's buffers: the one that holds the data, then the fallback buffer of meshopt views. */
	private buffers(first: GltfJson): GltfJson[] {
		if (!this.fallback) return [first];
		const { length, extension } = this.fallback;
		return [first, { byteLength: length, extensions: { [extension]: { fallback: true } } }];
	}

	/** The buffer's bytes. */
	bytes(): Uint8Array {
		const out = new Uint8Array(this.length);
		let at = 0;
		for (const chunk of this.chunks) {
			out.set(chunk, at);
			at += chunk.length;
		}
		return out;
	}

	/** The file as a .glb file. */
	glb(): Uint8Array {
		const bin = this.bytes();
		this.json.buffers = this.buffers({ byteLength: bin.length });
		const text = new TextEncoder().encode(JSON.stringify(this.json));
		const jsonLength = Math.ceil(text.length / 4) * 4;
		const total = 12 + 8 + jsonLength + 8 + bin.length;
		const out = new Uint8Array(total);
		const view = new DataView(out.buffer);
		view.setUint32(0, 0x46546c67, true);
		view.setUint32(4, 2, true);
		view.setUint32(8, total, true);
		view.setUint32(12, jsonLength, true);
		view.setUint32(16, 0x4e4f534a, true);
		out.fill(0x20, 20, 20 + jsonLength);
		out.set(text, 20);
		view.setUint32(20 + jsonLength, bin.length, true);
		view.setUint32(24 + jsonLength, 0x004e4942, true);
		out.set(bin, 28 + jsonLength);
		return out;
	}

	/** The file as a .gltf file, whose buffer is a data: address, or `uri` when it is given. */
	gltf(uri?: string): Uint8Array {
		const bin = this.bytes();
		let binary = '';
		for (const byte of bin) binary += String.fromCharCode(byte);
		this.json.buffers = this.buffers({
			byteLength: bin.length,
			uri: uri ?? `data:application/octet-stream;base64,${btoa(binary)}`,
		});
		return new TextEncoder().encode(JSON.stringify(this.json));
	}
}

/**
 * Each face of a box: its normal, and two axes along it whose cross product is the normal, so
 * corners taken in the order (-u, -v), (u, -v), (u, v), (-u, v) turn counter-clockwise seen from
 * outside.
 */
const BOX_FACES = [
	[
		[1, 0, 0],
		[0, 0, -1],
		[0, 1, 0],
	],
	[
		[-1, 0, 0],
		[0, 0, 1],
		[0, 1, 0],
	],
	[
		[0, 1, 0],
		[1, 0, 0],
		[0, 0, -1],
	],
	[
		[0, -1, 0],
		[1, 0, 0],
		[0, 0, 1],
	],
	[
		[0, 0, 1],
		[1, 0, 0],
		[0, 1, 0],
	],
	[
		[0, 0, -1],
		[-1, 0, 0],
		[0, 1, 0],
	],
] as const;

/** A box of side `size` around the origin: 24 vertices with normals and texture coordinates. */
export function boxArrays(size = 1) {
	const h = size / 2;
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (const [n, u, v] of BOX_FACES) {
		const base = positions.length / 3;
		for (const [a, b] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		] as const) {
			for (let i = 0; i < 3; i++)
				positions.push(((n[i] as number) + a * (u[i] as number) + b * (v[i] as number)) * h);
			normals.push(...n);
			uvs.push((a + 1) / 2, (1 - b) / 2);
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		indices: new Uint16Array(indices),
	};
}

/** Adds a box primitive with `material`, and returns the primitive's JSON. */
export function boxPrimitive(builder: GltfBuilder, material?: number, size = 1): GltfJson {
	const box = boxArrays(size);
	const primitive: GltfJson = {
		attributes: {
			POSITION: builder.positions(box.positions),
			NORMAL: builder.accessor(box.normals, 3),
			TEXCOORD_0: builder.accessor(box.uvs, 2),
		},
		indices: builder.accessor(box.indices, 1),
	};
	if (material !== undefined) primitive.material = material;
	return primitive;
}

/**
 * A ship: a root node with a hull of two primitives in two materials, red and blue, and a green
 * turret above it, turned a quarter about Y and half the size. Its node names are Ship, Hull and
 * Turret.
 */
export function shipBuilder(): GltfBuilder {
	const b = new GltfBuilder();
	const red = b.material({
		name: 'red',
		pbrMetallicRoughness: { baseColorFactor: [0.8, 0.05, 0.05, 1], metallicFactor: 0 },
	});
	const blue = b.material({
		name: 'blue',
		pbrMetallicRoughness: { baseColorFactor: [0.05, 0.1, 0.8, 1], metallicFactor: 0 },
	});
	const green = b.material({
		name: 'green',
		pbrMetallicRoughness: { baseColorFactor: [0.1, 0.7, 0.1, 1], metallicFactor: 0 },
	});
	const hullMesh = b.mesh([boxPrimitive(b, red, 1), boxPrimitive(b, blue, 0.6)], 'hull');
	const turretMesh = b.mesh([boxPrimitive(b, green, 1)], 'turret');
	const hull = b.node(
		{ name: 'Hull', mesh: hullMesh, translation: [0, 0, 0], scale: [2, 0.5, 1] },
		true,
	);
	const s = Math.SQRT1_2;
	const turret = b.node(
		{
			name: 'Turret',
			mesh: turretMesh,
			translation: [0, 0.6, 0],
			rotation: [0, s, 0, s],
			scale: [0.5, 0.5, 0.5],
		},
		true,
	);
	b.node({ name: 'Ship', children: [hull, turret] });
	return b;
}

/** A column-major 4 × 4 matrix that moves points by `-x, -y, -z`: a joint's inverse bind matrix. */
function untranslate(x: number, y: number, z: number): number[] {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
}

/**
 * An arm. The root node Arm holds Shoulder, which holds Elbow, which holds Hand, which holds a
 * Sword mesh. Arm also holds a Rock mesh that no clip moves. Shoulder, Elbow and Hand each sit
 * 1 m above their parent. Sleeve, a tall box skinned to the skin's joints Elbow, Shoulder and Hand
 * (in that order), sits at the scene's root: its lower half follows Shoulder, and its upper half
 * follows Elbow at three quarters and Shoulder at one quarter. The clip Wave bends Elbow along a
 * cubic spline and steps Shoulder, and an unnamed clip grows Hand.
 */
export function armBuilder(): GltfBuilder {
	const b = new GltfBuilder();
	const boxMesh = b.mesh([boxPrimitive(b)], 'box');
	const box = boxArrays(0.4);
	const joints = new Uint8Array(24 * 4);
	const weights = new Float32Array(24 * 4);
	for (let v = 0; v < 24; v++) {
		const upper = (box.positions[v * 3 + 1] as number) > 0;
		joints.set(upper ? [0, 1, 0, 0] : [1, 0, 0, 0], v * 4);
		weights.set(upper ? [0.75, 0.25, 0, 0] : [1, 0, 0, 0], v * 4);
	}
	const tall = box.positions.map((p, i) => (i % 3 === 1 ? p * 5 + 2 : p));
	const sleeveMesh = b.mesh(
		[
			{
				attributes: {
					POSITION: b.positions(tall),
					NORMAL: b.accessor(box.normals, 3),
					JOINTS_0: b.accessor(joints, 4),
					WEIGHTS_0: b.accessor(weights, 4),
				},
				indices: b.accessor(box.indices, 1),
			},
		],
		'sleeve',
	);
	const sword = b.node(
		{ name: 'Sword', mesh: boxMesh, translation: [0, 0.5, 0], scale: [0.1, 1, 0.1] },
		true,
	);
	const hand = b.node({ name: 'Hand', translation: [0, 1, 0], children: [sword] }, true);
	const elbow = b.node({ name: 'Elbow', translation: [0, 1, 0], children: [hand] }, true);
	const shoulder = b.node({ name: 'Shoulder', translation: [0, 1, 0], children: [elbow] }, true);
	const rock = b.node({ name: 'Rock', mesh: boxMesh, translation: [2, 0, 0] }, true);
	b.node({ name: 'Arm', translation: [0, 0, 1], children: [shoulder, rock] });
	b.node({ name: 'Sleeve', mesh: sleeveMesh, skin: 0 });
	const binds = new Float32Array([
		...untranslate(0, 2, 1),
		...untranslate(0, 1, 1),
		...untranslate(0, 3, 1),
	]);
	const bindMatrices = b.accessor(binds, 16, { type: 'MAT4', count: 3 });
	b.json.skins = [{ joints: [elbow, shoulder, hand], inverseBindMatrices: bindMatrices }];
	const s = Math.SQRT1_2;
	// Two cubic keys of Elbow's rotation, each an in-tangent, a value and an out-tangent.
	const bend = new Float32Array([
		...[0, 0, 0, 0],
		...[0, 0, 0, 1],
		...[0, 0, 1, 0],
		...[0, 0, 0, 0],
		...[0, 0, s, s],
		...[0, 0, 0, 0],
	]);
	const times = (values: number[]) =>
		b.accessor(new Float32Array(values), 1, { min: [values[0]], max: [values.at(-1)] });
	b.json.animations = [
		{
			name: 'Wave',
			samplers: [
				{ input: times([0, 1]), output: b.accessor(bend, 4), interpolation: 'CUBICSPLINE' },
				{
					input: times([0, 0.5]),
					output: b.accessor(new Float32Array([0, 1, 0, 0.2, 1, 0]), 3),
					interpolation: 'STEP',
				},
			],
			channels: [
				{ sampler: 0, target: { node: elbow, path: 'rotation' } },
				{ sampler: 1, target: { node: shoulder, path: 'translation' } },
			],
		},
		{
			samplers: [
				{ input: times([0, 2]), output: b.accessor(new Float32Array([1, 1, 1, 2, 2, 2]), 3) },
			],
			channels: [{ sampler: 0, target: { node: hand, path: 'scale' } }],
		},
	];
	return b;
}

/**
 * A box with two morph targets, which stretch it up and out, at weights 0.25 and 0.5, and a clip,
 * Pulse, that moves the weights in a straight line.
 */
export function morphBuilder(): GltfBuilder {
	const b = new GltfBuilder();
	const box = boxArrays(1);
	const up = box.positions.map((p, i) => (i % 3 === 1 && p > 0 ? 0.5 : 0));
	const out = box.positions.map((p, i) => (i % 3 === 0 ? p * 0.5 : 0));
	const primitive = boxPrimitive(b);
	primitive.targets = [{ POSITION: b.accessor(up, 3) }, { POSITION: b.accessor(out, 3) }];
	const mesh = b.mesh([primitive], 'blob');
	b.json.meshes[mesh].weights = [0.25, 0.5];
	b.json.meshes[mesh].extras = { targetNames: ['Up', 'Out'] };
	const node = b.node({ name: 'Blob', mesh });
	b.json.animations = [
		{
			name: 'Pulse',
			samplers: [
				{
					input: b.accessor(new Float32Array([0, 1]), 1, { min: [0], max: [1] }),
					output: b.accessor(new Float32Array([0, 0, 1, 1]), 1),
				},
			],
			channels: [{ sampler: 0, target: { node, path: 'weights' } }],
		},
	];
	return b;
}

/** The vertices of each side of the face that `blenderMorphBuilder` writes. */
const FACE_SIDE = 17;

/**
 * The deltas of the three shape keys of `blenderMorphBuilder`'s face, one position array and one
 * normal array per key. Smile lifts the top two rows, whose vertex numbers pass 255, and tilts
 * their normals. Blink lowers the bottom two rows. Rest moves nothing.
 */
export function faceTargets() {
	const n = FACE_SIDE * FACE_SIDE;
	const positions = [new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3)];
	const normals = [new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3)];
	const [smile, blink] = positions as [Float32Array, Float32Array];
	const [smileNormals] = normals as [Float32Array];
	for (let i = 0; i < n; i++) {
		const row = Math.floor(i / FACE_SIDE);
		if (row >= FACE_SIDE - 2) {
			smile[i * 3 + 2] = 0.25;
			smileNormals[i * 3 + 1] = -0.125;
		}
		if (row < 2) blink[i * 3 + 1] = -0.125;
	}
	return { names: ['Smile', 'Blink', 'Rest'], positions, normals };
}

/**
 * A face as Blender's glTF exporter writes a mesh with shape keys: a flat grid of 289 vertices,
 * and three morph targets whose positions and normals are sparse accessors with no buffer view.
 * Their indices take the smallest type that holds the largest one, so Smile's are 16-bit and
 * Blink's 8-bit. A target that moves nothing has no sparse list, so it reads as zeros. The mesh
 * names its targets in its extras, and the clip Talk animates the weights.
 */
export function blenderMorphBuilder(): GltfBuilder {
	const b = new GltfBuilder();
	const positions: number[] = [];
	const indices: number[] = [];
	for (let row = 0; row < FACE_SIDE; row++)
		for (let column = 0; column < FACE_SIDE; column++) {
			positions.push((column / (FACE_SIDE - 1)) * 2 - 1, (row / (FACE_SIDE - 1)) * 2 - 1, 0);
			if (row > 0 && column > 0) {
				const at = row * FACE_SIDE + column;
				indices.push(at - FACE_SIDE - 1, at - FACE_SIDE, at, at - FACE_SIDE - 1, at, at - 1);
			}
		}
	const normals = new Float32Array(positions.length).map((_, k) => (k % 3 === 2 ? 1 : 0));
	const targets = faceTargets();
	const mesh = b.mesh(
		[
			{
				attributes: {
					POSITION: b.positions(new Float32Array(positions)),
					NORMAL: b.accessor(normals, 3),
				},
				indices: b.accessor(new Uint16Array(indices), 1),
				targets: targets.positions.map((delta, k) => ({
					POSITION: b.sparse(delta, 3),
					NORMAL: b.sparse(targets.normals[k] as Float32Array, 3),
				})),
			},
		],
		'Face',
	);
	b.json.meshes[mesh].weights = [0.5, 0, 0];
	b.json.meshes[mesh].extras = { targetNames: targets.names };
	const node = b.node({ name: 'Face', mesh });
	b.json.animations = [
		{
			name: 'Talk',
			samplers: [
				{
					input: b.accessor(new Float32Array([0, 1]), 1, { min: [0], max: [1] }),
					output: b.accessor(new Float32Array([0.5, 0, 0, 1, 1, 0]), 1),
				},
			],
			channels: [{ sampler: 0, target: { node, path: 'weights' } }],
		},
	];
	return b;
}

/** The CRC-32 of `bytes`, as PNG chunks carry it. */
function crc32(bytes: Uint8Array): number {
	let crc = ~0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return ~crc >>> 0;
}

/**
 * A PNG image of `width` x `height` RGBA pixels, row by row, with no color profile. Its data goes
 * into stored deflate blocks, so the bytes need no compressor and are the same on every machine.
 */
export function pngBytes(width: number, height: number, rgba: Uint8Array): Uint8Array {
	const stride = 1 + width * 4;
	const rows = new Uint8Array(height * stride);
	for (let y = 0; y < height; y++)
		rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
	// A zlib stream of stored blocks of at most 65,535 bytes, then its Adler-32 checksum.
	const blocks = Math.max(1, Math.ceil(rows.length / 65535));
	const zlib = new Uint8Array(2 + rows.length + blocks * 5 + 4);
	zlib.set([0x78, 0x01]);
	let at = 2;
	for (let k = 0; k < blocks; k++) {
		const part = rows.subarray(k * 65535, (k + 1) * 65535);
		const n = part.length;
		zlib.set([k === blocks - 1 ? 1 : 0, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255], at);
		zlib.set(part, at + 5);
		at += 5 + n;
	}
	let a = 1;
	let b = 0;
	for (const byte of rows) {
		a = (a + byte) % 65521;
		b = (b + a) % 65521;
	}
	new DataView(zlib.buffer).setUint32(at, ((b << 16) | a) >>> 0);
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(new TextEncoder().encode(type), 4);
		out.set(data, 8);
		view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8);
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', zlib),
		chunk('IEND', new Uint8Array()),
	];
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** The sRGB byte of a linear value from 0 to 1. */
function srgbByte(linear: number): number {
	const s = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.round(s * 255);
}

/**
 * A sphere of `radius` around the origin, as three.js's SphereGeometry builds it with 32 segments
 * around and 16 from pole to pole: positions, normals and indices.
 */
function sphereArrays(radius: number) {
	const across = 32;
	const down = 16;
	const positions: number[] = [];
	const normals: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i <= down; i++) {
		const v = i / down;
		for (let j = 0; j <= across; j++) {
			const u = j / across;
			const x = -Math.cos(u * 2 * Math.PI) * Math.sin(v * Math.PI);
			const y = Math.cos(v * Math.PI);
			const z = Math.sin(u * 2 * Math.PI) * Math.sin(v * Math.PI);
			positions.push(x * radius, y * radius, z * radius);
			normals.push(x, y, z);
		}
	}
	const row = across + 1;
	for (let i = 0; i < down; i++)
		for (let j = 0; j < across; j++) {
			const a = i * row + j + 1;
			const b = i * row + j;
			const c = (i + 1) * row + j;
			const d = (i + 1) * row + j + 1;
			if (i !== 0) indices.push(a, b, d);
			if (i !== down - 1) indices.push(b, c, d);
		}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		indices: new Uint16Array(indices),
	};
}

/** The rotation, as a glTF quaternion, that turns -Z, where a glTF light shines, to `direction`. */
function shineAlong(direction: readonly [number, number, number]): number[] {
	const length = Math.hypot(...direction);
	const [x, y, z] = direction.map((d) => d / length) as [number, number, number];
	// The half-way quaternion from (0, 0, -1): the cross product as its axis, and 1 + cos as w.
	const w = 1 - z;
	if (w < 1e-6) return [0, 1, 0, 0];
	const size = Math.hypot(y, x, w);
	return [y / size, -x / size, 0, w / size];
}

/** A sphere of a test grid: its material, and the u that every vertex of a textured sphere reads. */
interface GridSphere {
	material: GltfJson;
	uv?: number;
}

/**
 * A grid of spheres for a material extension's test: one row per entry of `rows`, one sphere per
 * entry of a row, 1 m apart, the first row on top. A sphere with `uv` reads the texture
 * coordinates (u, 0.5) at every vertex, so it shows one texel of its maps. A directional key
 * light from the front right and a point light behind the grid light it, so the reflection shows
 * head on and at grazing angles. The engine's surfaces show one directional light, so the light
 * from behind is a point light.
 */
function sphereGrid(b: GltfBuilder, rows: readonly (readonly GridSphere[])[]): GltfBuilder {
	const sphere = sphereArrays(0.4);
	const position = b.positions(sphere.positions);
	const normal = b.accessor(sphere.normals, 3);
	const indices = b.accessor(sphere.indices, 1);
	const uvAccessors = new Map<number, number>();
	const uvOf = (u: number) => {
		let accessor = uvAccessors.get(u);
		if (accessor === undefined) {
			const uvs = new Float32Array((sphere.positions.length / 3) * 2);
			for (let k = 0; k < uvs.length; k += 2) uvs.set([u, 0.5], k);
			accessor = b.accessor(uvs, 2);
			uvAccessors.set(u, accessor);
		}
		return accessor;
	};
	rows.forEach((row, r) => {
		row.forEach(({ material, uv }, c) => {
			const attributes: GltfJson = { POSITION: position, NORMAL: normal };
			if (uv !== undefined) attributes.TEXCOORD_0 = uvOf(uv);
			const mesh = b.mesh([{ attributes, indices, material: b.material(material) }]);
			const x = c - (row.length - 1) / 2;
			const y = (rows.length - 1) / 2 - r;
			b.node({ name: material.name, mesh, translation: [x, y, 0] });
		});
	});
	b.uses('KHR_lights_punctual');
	b.json.extensions = {
		KHR_lights_punctual: {
			lights: [
				{ type: 'directional', intensity: 2.5 },
				{ type: 'point', intensity: 80, color: [1, 0.95, 0.9] },
			],
		},
	};
	b.node({
		name: 'Key',
		rotation: shineAlong([-1, -1.5, -2]),
		extensions: { KHR_lights_punctual: { light: 0 } },
	});
	b.node({
		name: 'Rim',
		translation: [-2, 4, -5],
		extensions: { KHR_lights_punctual: { light: 1 } },
	});
	return b;
}

/** The ramp of SpecularTest's factors, from none to all. */
const SPECULAR_RAMP = [0, 0.051269, 0.212231, 0.520996, 1] as const;

/**
 * A small equivalent of the Khronos SpecularTest model for KHR_materials_specular, lit by lights
 * instead of an environment. Its seven rows of five spheres take, in order: the specular factor;
 * the same values in a specular texture's alpha, whose purple color must not show; a gray specular
 * color factor; the same grays in a specular color texture; a yellow factor; a yellow texture; and
 * color factors above 1, which the reflectance caps at 1. The spheres are dark and fairly smooth,
 * so their specular reflection shows.
 */
export function specularBuilder(): GltfBuilder {
	const b = new GltfBuilder().uses('KHR_materials_specular');
	b.json.images = [];
	b.json.textures = [];
	b.json.samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }];
	const texture = (pixels: readonly (readonly number[])[]) => {
		const image = b.view(pngBytes(pixels.length, 1, new Uint8Array(pixels.flat())));
		b.json.images.push({ bufferView: image, mimeType: 'image/png' });
		return b.json.textures.push({ source: b.json.images.length - 1, sampler: 0 }) - 1;
	};
	const intensities = texture(SPECULAR_RAMP.map((v) => [255, 0, 255, Math.round(v * 255)]));
	const grays = texture(SPECULAR_RAMP.map((v) => [srgbByte(v), srgbByte(v), srgbByte(v), 255]));
	const yellows = texture(SPECULAR_RAMP.map((v) => [srgbByte(v), srgbByte(v), 0, 255]));
	const material = (name: string, specular: GltfJson): GltfJson => ({
		name,
		pbrMetallicRoughness: {
			baseColorFactor: [0.04, 0.05, 0.07, 1],
			metallicFactor: 0,
			roughnessFactor: 0.3,
		},
		extensions: { KHR_materials_specular: specular },
	});
	const uv = (c: number) => (c + 0.5) / SPECULAR_RAMP.length;
	const factors = (name: string, specular: (v: number) => GltfJson) =>
		SPECULAR_RAMP.map((v, c): GridSphere => ({ material: material(`${name} ${c}`, specular(v)) }));
	const textured = (name: string, specular: GltfJson) =>
		SPECULAR_RAMP.map(
			(_, c): GridSphere => ({ material: material(`${name} ${c}`, specular), uv: uv(c) }),
		);
	return sphereGrid(b, [
		factors('factor', (v) => ({ specularFactor: v })),
		textured('texture', { specularTexture: { index: intensities } }),
		factors('gray', (v) => ({ specularColorFactor: [v, v, v] })),
		textured('gray texture', { specularColorTexture: { index: grays } }),
		factors('yellow', (v) => ({ specularColorFactor: [v, v, 0] })),
		textured('yellow texture', { specularColorTexture: { index: yellows } }),
		[0, 1.184, 5.441, 13.276, 25].map(
			(v, c): GridSphere => ({
				material: material(`bright ${c}`, { specularColorFactor: [v, v, v] }),
			}),
		),
	]);
}

/**
 * A small equivalent of the Khronos IORTestGrid model for KHR_materials_ior, without its
 * transmission and volume. Its columns take the indices of refraction 1, 1.25, 1.5, 2 and 3, and
 * 0, which stands for a very large index. Its first three rows are a red dielectric of three
 * roughnesses. The fourth is half metal, with KHR_materials_specular's factor and color, and the
 * fifth has a specular color above 1, which the reflectance caps at 1.
 */
export function iorBuilder(): GltfBuilder {
	const b = new GltfBuilder().uses('KHR_materials_ior').uses('KHR_materials_specular');
	const iors = [1, 1.25, 1.5, 2, 3, 0];
	const row = (name: string, pbr: GltfJson, specular?: GltfJson) =>
		iors.map(
			(ior): GridSphere => ({
				material: {
					name: `${name} ior ${ior}`,
					pbrMetallicRoughness: {
						baseColorFactor: [0.5, 0.06, 0.04, 1],
						metallicFactor: 0,
						...pbr,
					},
					extensions: {
						KHR_materials_ior: { ior },
						...(specular && { KHR_materials_specular: specular }),
					},
				},
			}),
		);
	return sphereGrid(b, [
		row('smooth', { roughnessFactor: 0.15 }),
		row('satin', { roughnessFactor: 0.45 }),
		row('rough', { roughnessFactor: 0.8 }),
		row(
			'half metal',
			{ metallicFactor: 0.5, roughnessFactor: 0.3 },
			{ specularFactor: 0.6, specularColorFactor: [1, 0.6, 0.3] },
		),
		row('bright', { roughnessFactor: 0.3 }, { specularColorFactor: [2, 2, 2] }),
	]);
}
