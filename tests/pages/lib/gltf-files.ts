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

/** The quads per side of each panel of `colorMorphBuilder`. */
const PANEL_SIDE = 6;

/**
 * A flat panel of `PANEL_SIDE` × `PANEL_SIDE` quads, one unit wide, centered on `x` and facing +Z,
 * with each vertex's place across it from 0 to 1.
 */
function panel(x: number) {
	const positions: number[] = [];
	const places: [number, number][] = [];
	const indices: number[] = [];
	const n = PANEL_SIDE + 1;
	for (let row = 0; row < n; row++)
		for (let column = 0; column < n; column++) {
			const [u, v] = [column / PANEL_SIDE, row / PANEL_SIDE];
			positions.push(x + u - 0.5, v - 0.5, 0);
			places.push([u, v]);
			if (row > 0 && column > 0) {
				const at = row * n + column;
				indices.push(at - n - 1, at - n, at, at - n - 1, at, at - 1);
			}
		}
	const normals = new Float32Array(positions.length).map((_, k) => (k % 3 === 2 ? 1 : 0));
	return {
		positions: new Float32Array(positions),
		normals,
		places,
		indices: new Uint16Array(indices),
	};
}

/** For each vertex at `places`, the first `components` values that `channels` gives. */
function perVertex(
	places: readonly [number, number][],
	components: number,
	channels: (u: number, v: number) => readonly number[],
): Float32Array {
	return Float32Array.from(places.flatMap(([u, v]) => channels(u, v).slice(0, components)));
}

/** The weights of `colorMorphBuilder`'s two targets. */
export const COLOR_MORPH_WEIGHTS = [0.75, 0.4] as const;

/**
 * Three panels side by side: one mesh of three primitives with two morph targets, which move
 * vertex colors as glTF's COLOR_0 targets do, at the mesh's weights `COLOR_MORPH_WEIGHTS`. The
 * left panel has 8-bit colors, and targets of three values, without alpha. Its first target
 * bulges the panel toward the camera and warms its colors, and its second, a sparse accessor as
 * Blender writes one, blues its right half. The middle panel blends, with float colors and alpha: its first target's deltas are
 * normalized 16-bit integers that fade the alpha upward, and its second target's are floats that
 * fade it to the right. The right panel's 16-bit colors stay as they are, as its targets move only
 * its positions. Every morphed color stays between 0 and 1, where three.js, which does not clamp,
 * draws what the glTF specification asks. Every target that moves a panel's colors gives their
 * deltas, as three.js reads a left-out color delta as the base color. Every panel's colors have
 * alpha, as three.js r186's WebGLRenderer cannot compile color targets of colors without it.
 */
export function colorMorphBuilder(): GltfBuilder {
	const b = new GltfBuilder();
	const matte = (fields: GltfJson = {}) =>
		b.material({
			pbrMetallicRoughness: {
				baseColorFactor: [1, 1, 1, 1],
				metallicFactor: 0,
				roughnessFactor: 0.8,
			},
			...fields,
		});
	const bulge = (places: readonly [number, number][]) =>
		perVertex(places, 3, (u, v) => [
			0,
			0,
			0.35 * Math.max(0, 1 - 2 * Math.hypot(u - 0.5, v - 0.5)),
		]);
	const lift = (places: readonly [number, number][]) =>
		perVertex(places, 3, (u) => [0, 0.15 * u, 0]);
	const primitive = (x: number, material: number, color: number, targets: GltfJson[]) => {
		const shape = panel(x);
		return {
			attributes: {
				POSITION: b.positions(shape.positions),
				NORMAL: b.accessor(shape.normals, 3),
				COLOR_0: color,
			},
			indices: b.accessor(shape.indices, 1),
			material,
			targets: targets.map((target, k) => ({
				...target,
				POSITION: b.positions((k === 0 ? bulge : lift)(shape.places)),
			})),
		};
	};

	const left = panel(-1.1).places;
	const leftColors = perVertex(left, 4, (u, v) => [0.15 + 0.2 * u, 0.6 - 0.2 * v, 0.2, 1]);
	const warm = perVertex(left, 3, (u, v) => [0.8 * v, -0.5 * u, 0]);
	const blue = perVertex(left, 3, (u) => (u > 0.5 ? [-0.2, 0, 1.6 * (u - 0.5)] : [0, 0, 0]));
	const bytes = Uint8Array.from(leftColors, (c) => Math.round(c * 255));
	const leftPanel = primitive(-1.1, matte(), b.accessor(bytes, 4, { normalized: true }), [
		{ COLOR_0: b.accessor(warm, 3) },
		{ COLOR_0: b.sparse(blue, 3) },
	]);

	const middle = panel(0).places;
	const middleColors = perVertex(middle, 4, (u, v) => [0.8, 0.2 + 0.3 * u, 0.2 + 0.3 * v, 1]);
	const fadeUp = perVertex(middle, 4, (u, v) => [-0.8 * u, 0.6, 0, -0.5 * v]);
	const fadeRight = perVertex(middle, 4, (u) => [0, 0, 0.9 * u, -0.3 * u]);
	const shorts = Int16Array.from(fadeUp, (d) => Math.round(d * 32767));
	const middlePanel = primitive(0, matte({ alphaMode: 'BLEND' }), b.accessor(middleColors, 4), [
		{ COLOR_0: b.accessor(shorts, 4, { normalized: true }) },
		{ COLOR_0: b.accessor(fadeRight, 4) },
	]);

	const right = panel(1.1).places;
	const rightColors = perVertex(right, 4, (u, v) => [0.2 + 0.5 * v, 0.5, 0.7 - 0.4 * u, 1]);
	const wide = Uint16Array.from(rightColors, (c) => Math.round(c * 65535));
	const rightPanel = primitive(1.1, matte(), b.accessor(wide, 4, { normalized: true }), [{}, {}]);

	const mesh = b.mesh([leftPanel, middlePanel, rightPanel], 'Swatches');
	b.json.meshes[mesh].weights = [...COLOR_MORPH_WEIGHTS];
	b.json.meshes[mesh].extras = { targetNames: ['Warm', 'Cool'] };
	b.node({ name: 'Swatches', mesh });
	return b;
}

/** The glTF files made in code that model scenes draw, by name. */
export const MADE_MODELS = { 'color-morph': colorMorphBuilder } as const;

export type MadeModel = keyof typeof MADE_MODELS;

/**
 * The address that a page loads a model scene's file from: the file's own, or for a file made in
 * code, an address of its bytes in the page.
 */
export function modelAddress(model: { url?: string; made?: MadeModel }): string {
	if (model.made) {
		const bytes = MADE_MODELS[model.made]().glb() as Uint8Array<ArrayBuffer>;
		return URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
	}
	if (!model.url) throw new Error('a model scene names no file');
	return model.url;
}
