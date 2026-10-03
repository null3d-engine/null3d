// Small glTF files made in code, for the loader's unit tests and its test pages: one per extension
// that the loader reads, and the files that break the rules. The builder packs typed arrays into
// one buffer, four bytes apart as glTF asks, and writes a .glb file, or a .gltf file whose buffer
// is a data: address. It imports nothing, so pages and Bun load it alike.

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

	/** Adds bytes to the buffer as a buffer view, and returns the view's index. */
	view(bytes: Uint8Array, stride?: number): number {
		const at = this.length;
		this.chunks.push(bytes);
		this.length += bytes.length;
		const pad = (4 - (this.length % 4)) % 4;
		if (pad) {
			this.chunks.push(new Uint8Array(pad));
			this.length += pad;
		}
		const view: GltfJson = { buffer: 0, byteOffset: at, byteLength: bytes.length };
		if (stride) view.byteStride = stride;
		return this.json.bufferViews.push(view) - 1;
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
		this.json.buffers = [{ byteLength: bin.length }];
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
		this.json.buffers = [
			{
				byteLength: bin.length,
				uri: uri ?? `data:application/octet-stream;base64,${btoa(binary)}`,
			},
		];
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
 * 1 m above their parent. Sleeve, a tall box skinned to the skin's joints Elbow and Shoulder (in
 * that order), sits at the scene's root: its lower half follows Shoulder, and its upper half
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
	const binds = new Float32Array([...untranslate(0, 2, 1), ...untranslate(0, 1, 1)]);
	const bindMatrices = b.accessor(binds, 16, { type: 'MAT4', count: 2 });
	b.json.skins = [{ joints: [elbow, shoulder], inverseBindMatrices: bindMatrices }];
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
