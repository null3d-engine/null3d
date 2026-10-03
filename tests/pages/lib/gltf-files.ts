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
