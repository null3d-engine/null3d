// Runs the WebGPU skinning pass's shader on fixed meshes, on the GPU path that ?gpu= names: core
// WebGPU (webgpu) or compatibility mode (compat). Each case lays out a mesh page, the pass's table
// and the joint texture as the renderer does (crates/null3d-render/src/gpu_driven/skin.rs), runs
// the pass, and reads back the skinned vertices. A draw then reads each part's vertices from its
// region of the skinned vertex buffer, as the scene passes do: an indexed indirect draw with the
// buffer bound at the region's first byte. The draw writes each vertex's position into a pixel of
// a float target, which the page reads back too. The CPU skins the same vertices, and the page
// reports each vertex that differs.
//
// The cases change one thing at a time: the types of the joints and weights (8-bit and 16-bit
// joints, normalized 8-bit and float weights), rigid cubes that each follow one joint, as the glTF
// loader makes of meshes that a clip moves, a column whose vertices blend two joints, as a skinned
// character does, and tangents of three types, which the pass's tangent build skins. Two cases are
// not the renderer's own: one dispatch for each part, and a joint texture written whole. They tell
// a fault of the table from one of the joint texture.
import { PERMUTATION_VERTEX_TANGENT } from '../../packages/engine/src/generated/gpu';
import { loadWgslFeature } from '../../packages/engine/src/generated/shaders';
import { variantFor } from '../../packages/engine/src/gpu/variants';
import type { SkinPassCase, SkinPassResult, SkinPassWrong } from '../lib/skin-pass-checks';
import { progress, run } from './lib/result';

type Tier = 'webgpu' | 'compat';
const tier: Tier =
	new URLSearchParams(location.search).get('gpu') === 'compat' ? 'compat' : 'webgpu';

/** The shader's constants (skin.wgsl): threads per workgroup, joints per texture row, entries. */
const WORKGROUP_SIZE = 64;
const JOINTS_PER_ROW = 512;
const TEXELS_PER_JOINT = 3;
const HEADER_ENTRIES = 4;
const PART_ENTRIES = 2;
const ENTRY_BYTES = 16;
/** Segments of the table start on storage binding boundaries. */
const SEGMENT_ALIGN_BYTES = 256;
const NONE = 0xffffffff;
/** The engine's vertex type codes. */
const TYPE = { f32: 0, unorm8: 1, snorm8: 2, snorm16: 4, uint8: 5, uint16: 7 } as const;
/** Joints that the cases name, and the largest difference a float may show. */
const JOINTS = 6;
const TOLERANCE = 1e-4;
/** Wrong vertices that a case reports in full. */
const SHOWN = 4;

type JointType = 'uint8' | 'uint16';
type WeightType = 'unorm8' | 'f32';
type TangentType = 'f32' | 'snorm8' | 'snorm16';

/** Words of a tangent of each type, and the largest value of its integers. */
const TANGENT_WORDS: Record<TangentType, number> = { f32: 4, snorm8: 1, snorm16: 2 };
const TANGENT_LARGEST: Record<TangentType, number> = { f32: 1, snorm8: 127, snorm16: 32767 };

/** A mesh: its vertices' positions, normals, and four joints and weights each. */
interface Mesh {
	positions: number[];
	normals: number[];
	joints: number[];
	weights: number[];
}

interface Case {
	name: string;
	engine: boolean;
	joints: JointType;
	weights: WeightType;
	meshes: Mesh[];
	/** One dispatch for each part, each with a segment of its own. */
	apart?: boolean;
	/** The joint texture written whole, where the renderer writes only the joints in use. */
	wholeRow?: boolean;
	/** The type of a tangent after the normal, which the pass's tangent build skins. */
	tangent?: TangentType;
}

/** A cube of 24 vertices, 4 per face, around the origin, that joint `joint` alone moves. */
function cube(joint: number): Mesh {
	const out: Mesh = { positions: [], normals: [], joints: [], weights: [] };
	for (let axis = 0; axis < 3; axis++)
		for (const sign of [-1, 1]) {
			const normal = [0, 0, 0];
			normal[axis] = sign;
			const u = (axis + 1) % 3;
			const v = (axis + 2) % 3;
			for (const [a, b] of [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1],
			] as const) {
				const p = [0, 0, 0];
				p[axis] = sign * 0.5;
				p[u] = a * 0.5;
				p[v] = b * 0.5;
				out.positions.push(...p);
				out.normals.push(...normal);
				out.joints.push(joint, 0, 0, 0);
				out.weights.push(1, 0, 0, 0);
			}
		}
	return out;
}

/**
 * A column of rings, as the skinning benchmark's character: 31 rings of 24 vertices, each blending
 * the two joints below and above it. Its 744 vertices leave the last workgroup part full.
 */
function column(): Mesh {
	const out: Mesh = { positions: [], normals: [], joints: [], weights: [] };
	const rings = 31;
	const around = 24;
	for (let ring = 0; ring < rings; ring++) {
		const t = (ring / (rings - 1)) * (JOINTS - 1);
		const below = Math.min(Math.floor(t), JOINTS - 2);
		const share = t - below;
		for (let k = 0; k < around; k++) {
			const angle = (2 * Math.PI * k) / around;
			out.positions.push(0.3 * Math.cos(angle), ring * 0.1, 0.3 * Math.sin(angle));
			out.normals.push(Math.cos(angle), 0, Math.sin(angle));
			out.joints.push(below, below + 1, 0, 0);
			out.weights.push(1 - share, share, 0, 0);
		}
	}
	return out;
}

/** Joint `j`'s skinning matrix, three rows of four: a turn about z, then a move. */
function jointRows(j: number): number[] {
	const a = 0.2 + 0.3 * j;
	const [c, s] = [Math.cos(a), Math.sin(a)];
	return [c, -s, 0, 1 + 2 * j, s, c, 0, 0.5 - j, 0, 0, 1, 0.25 * j];
}

const CUBES = [0, 1, 2, 3, 4].map(cube);
const CASES: Case[] = [
	// The glTF loader's cubes that a clip moves: 8-bit joints and weights, one page, one dispatch.
	{ name: 'cubes-u8-unorm8', engine: true, joints: 'uint8', weights: 'unorm8', meshes: CUBES },
	{ name: 'cubes-u16-f32', engine: true, joints: 'uint16', weights: 'f32', meshes: CUBES },
	{ name: 'cubes-u8-f32', engine: true, joints: 'uint8', weights: 'f32', meshes: CUBES },
	{ name: 'cubes-u16-unorm8', engine: true, joints: 'uint16', weights: 'unorm8', meshes: CUBES },
	{
		name: 'cubes-u8-unorm8-joint-0',
		engine: true,
		joints: 'uint8',
		weights: 'unorm8',
		meshes: [0, 0, 0, 0, 0].map(cube),
	},
	{ name: 'column-u16-f32', engine: true, joints: 'uint16', weights: 'f32', meshes: [column()] },
	{
		name: 'column-u8-unorm8',
		engine: true,
		joints: 'uint8',
		weights: 'unorm8',
		meshes: [column(), column()],
	},
	{
		name: 'cubes-u8-unorm8-apart',
		engine: false,
		joints: 'uint8',
		weights: 'unorm8',
		meshes: CUBES,
		apart: true,
	},
	{
		name: 'cubes-u8-unorm8-whole-row',
		engine: false,
		joints: 'uint8',
		weights: 'unorm8',
		meshes: CUBES,
		wholeRow: true,
	},
	...(['f32', 'snorm8', 'snorm16'] as const).map(
		(tangent): Case => ({
			name: `cubes-tangent-${tangent}-u8-unorm8`,
			engine: true,
			joints: 'uint8',
			weights: 'unorm8',
			meshes: CUBES,
			tangent,
		}),
	),
];

/** Words of a source vertex: position, normal, the tangent if any, joints, then weights. */
function sourceWords(c: Case): { stride: number; joints: number; weights: number } {
	const joints = 6 + (c.tangent ? TANGENT_WORDS[c.tangent] : 0);
	const jointWords = c.joints === 'uint8' ? 1 : 2;
	const weightWords = c.weights === 'unorm8' ? 1 : 4;
	return { stride: joints + jointWords + weightWords, joints, weights: joints + jointWords };
}

/** Words of a skinned vertex: its position and normal, then its tangent if any, as floats. */
function skinnedWords(c: Case): number {
	return c.tangent ? 10 : 6;
}

/** A cube vertex's tangent: along its face, with a handedness that differs by face. */
function tangentOf(mesh: Mesh, i: number): number[] {
	const n = [0, 1, 2].map((k) => mesh.normals[i * 3 + k] as number);
	const axis = n.findIndex((x) => x !== 0);
	const t = [0, 0, 0];
	t[(axis + 1) % 3] = 1;
	return [...t, (n[axis] as number) > 0 ? 1 : -1];
}

/** The weights as the vertex stores them, which the CPU reads back as the shader does. */
function storedWeight(c: Case, w: number): number {
	return c.weights === 'unorm8' ? Math.round(w * 255) / 255 : Math.fround(w);
}

/** The mesh page's bytes: every mesh's vertices, one after another. */
function pageBytes(c: Case): ArrayBuffer {
	const { stride, joints, weights } = sourceWords(c);
	const vertices = c.meshes.reduce((n, m) => n + m.positions.length / 3, 0);
	const bytes = new ArrayBuffer(vertices * stride * 4);
	const view = new DataView(bytes);
	let v = 0;
	for (const mesh of c.meshes)
		for (let i = 0; i < mesh.positions.length / 3; i++, v++) {
			const at = v * stride * 4;
			for (let k = 0; k < 3; k++) {
				view.setFloat32(at + k * 4, mesh.positions[i * 3 + k] as number, true);
				view.setFloat32(at + 12 + k * 4, mesh.normals[i * 3 + k] as number, true);
			}
			if (c.tangent)
				for (const [k, x] of tangentOf(mesh, i).entries()) {
					const whole = Math.round(x * TANGENT_LARGEST[c.tangent]);
					if (c.tangent === 'f32') view.setFloat32(at + 24 + k * 4, x, true);
					else if (c.tangent === 'snorm8') view.setInt8(at + 24 + k, whole);
					else view.setInt16(at + 24 + k * 2, whole, true);
				}
			for (let k = 0; k < 4; k++) {
				const joint = mesh.joints[i * 4 + k] as number;
				const weight = mesh.weights[i * 4 + k] as number;
				if (c.joints === 'uint8') view.setUint8(at + joints * 4 + k, joint);
				else view.setUint16(at + joints * 4 + k * 2, joint, true);
				if (c.weights === 'unorm8') view.setUint8(at + weights * 4 + k, Math.round(weight * 255));
				else view.setFloat32(at + weights * 4 + k * 4, weight, true);
			}
		}
	return bytes;
}

/** A vertex skinned on the CPU: its position, its normal, then its tangent if any. */
function skinnedOnCpu(c: Case, mesh: Mesh, i: number): number[] {
	const rows = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (let k = 0; k < 4; k++) {
		const w = storedWeight(c, mesh.weights[i * 4 + k] as number);
		if (w === 0) continue;
		const m = jointRows(mesh.joints[i * 4 + k] as number);
		for (let e = 0; e < 12; e++) rows[e] = (rows[e] as number) + w * (m[e] as number);
	}
	const p = [0, 1, 2].map((k) => mesh.positions[i * 3 + k] as number);
	const n = [0, 1, 2].map((k) => mesh.normals[i * 3 + k] as number);
	const row = (r: number, x: number[], w: number) =>
		(rows[r * 4] as number) * (x[0] as number) +
		(rows[r * 4 + 1] as number) * (x[1] as number) +
		(rows[r * 4 + 2] as number) * (x[2] as number) +
		(rows[r * 4 + 3] as number) * w;
	const out = [row(0, p, 1), row(1, p, 1), row(2, p, 1), row(0, n, 0), row(1, n, 0), row(2, n, 0)];
	if (!c.tangent) return out;
	const t = tangentOf(mesh, i);
	return [...out, row(0, t, 0), row(1, t, 0), row(2, t, 0), t[3] as number];
}

/** The size the renderer creates a buffer at to hold `needed` bytes (frame.rs, `grown_size`). */
function grownSize(needed: number): number {
	return Math.max(needed, Math.ceil((needed + Math.floor(needed / 2)) / 256) * 256);
}

/** A part as the renderer lists it: its first vertex in the page, its vertices and its region. */
interface Part {
	firstVertex: number;
	vertices: number;
	/** Its first word in the skinned vertex buffer. */
	out: number;
}

function partsOf(c: Case): Part[] {
	const parts: Part[] = [];
	let first = 0;
	let out = 0;
	for (const mesh of c.meshes) {
		const vertices = mesh.positions.length / 3;
		parts.push({ firstVertex: first, vertices, out });
		first += vertices;
		out += vertices * skinnedWords(c);
	}
	return parts;
}

/** The table's words for segments of `parts`, each segment on its own binding boundary. */
function tableOf(c: Case, segments: Part[][]): { words: Uint32Array; offsets: number[] } {
	const { stride, joints, weights } = sourceWords(c);
	const format = [
		[stride, skinnedWords(c), 0 | (TYPE.f32 << 8), 3 | (TYPE.f32 << 8)],
		[
			c.tangent ? 6 | (TYPE[c.tangent] << 8) | (6 << 16) : NONE,
			joints | (TYPE[c.joints] << 8),
			weights | (TYPE[c.weights] << 8),
			NONE,
		],
		[0, 0, 0, 0],
	];
	const offsets: number[] = [];
	let bytes = 0;
	for (const parts of segments) {
		offsets.push(bytes);
		const used = (HEADER_ENTRIES + PART_ENTRIES * parts.length) * ENTRY_BYTES;
		bytes += Math.ceil(used / SEGMENT_ALIGN_BYTES) * SEGMENT_ALIGN_BYTES;
	}
	const words = new Uint32Array(bytes / 4);
	segments.forEach((parts, s) => {
		const at = (offsets[s] as number) / 4;
		words[at] = parts.length;
		words.set(format.flat(), at + 4);
		let group = 0;
		parts.forEach((part, k) => {
			const entry = at + (HEADER_ENTRIES + PART_ENTRIES * k) * 4;
			words.set([group, part.vertices, part.firstVertex, part.out, 0, NONE, 0, 0], entry);
			group += Math.ceil(part.vertices / WORKGROUP_SIZE);
		});
	});
	return { words, offsets };
}

/** The draw that reads skinned positions back: each vertex into its own pixel of a float target. */
const DRAW_WGSL = `
override WIDTH: f32 = 1.0;
override HEIGHT: f32 = 1.0;
struct Out {
    @builtin(position) clip: vec4f,
    @location(0) value: vec4f,
}
@vertex
fn vs(
    @location(0) position: vec3f,
    @location(2) row: f32,
    @builtin(vertex_index) vertex: u32,
) -> Out {
    let x = (f32(vertex) + 0.5) / WIDTH * 2.0 - 1.0;
    let y = 1.0 - (row + 0.5) / HEIGHT * 2.0;
    return Out(vec4f(x, y, 0.0, 1.0), vec4f(position, 1.0));
}
@fragment
fn fs(in: Out) -> @location(0) vec4f {
    return in.value;
}
`;

async function readBuffer(
	device: GPUDevice,
	source: GPUBuffer,
	bytes: number,
): Promise<ArrayBuffer> {
	const read = device.createBuffer({
		size: bytes,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyBufferToBuffer(source, 0, read, 0, bytes);
	device.queue.submit([encoder.finish()]);
	await read.mapAsync(GPUMapMode.READ);
	const out = read.getMappedRange().slice(0);
	read.destroy();
	return out;
}

/** Lists the vertices whose values differ from those expected by more than the tolerance. */
function compare(
	expected: number[][][],
	got: (part: number, vertex: number) => number[],
): { wrong: number; first: SkinPassWrong[] } {
	let wrong = 0;
	const first: SkinPassWrong[] = [];
	for (const [part, vertices] of expected.entries())
		for (const [vertex, want] of vertices.entries()) {
			const have = got(part, vertex);
			if (want.every((value, k) => Math.abs(value - (have[k] as number)) <= TOLERANCE)) continue;
			wrong++;
			if (first.length < SHOWN)
				first.push({
					part,
					vertex,
					got: have.map((x) => Number(x.toPrecision(5))),
					expected: want.map((x) => Number(x.toPrecision(5))),
				});
		}
	return { wrong, first };
}

async function runCase(
	device: GPUDevice,
	pipelines: { plain: GPUComputePipeline; tangent: GPUComputePipeline },
	layout: GPUBindGroupLayout,
	c: Case,
): Promise<SkinPassCase & { jointsRead: boolean }> {
	const page = pageBytes(c);
	const source = device.createBuffer({
		size: grownSize(page.byteLength),
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
	});
	device.queue.writeBuffer(source, 0, page);
	const parts = partsOf(c);
	const segments = c.apart ? parts.map((part) => [part]) : [parts];
	const { words, offsets } = tableOf(c, segments);
	const table = device.createBuffer({
		size: grownSize(words.byteLength),
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(table, 0, words);
	const stride = skinnedWords(c);
	const skinnedBytes = parts.reduce((n, p) => n + p.vertices, 0) * stride * 4;
	const skinned = device.createBuffer({
		size: grownSize(skinnedBytes),
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
	});
	const joints = device.createTexture({
		size: [JOINTS_PER_ROW * TEXELS_PER_JOINT, 1],
		format: 'rgba32float',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
	});
	// The renderer writes the joints in use, a texel row of three texels each.
	const written = c.wholeRow ? JOINTS_PER_ROW : JOINTS;
	const matrices = new Float32Array(written * 12);
	for (let j = 0; j < JOINTS; j++) matrices.set(jointRows(j), j * 12);
	device.queue.writeTexture(
		{ texture: joints },
		matrices,
		{ bytesPerRow: written * TEXELS_PER_JOINT * 16 },
		[written * TEXELS_PER_JOINT, 1],
	);
	const empty = device.createTexture({
		size: [1, 1],
		format: 'rgba32float',
		usage: GPUTextureUsage.TEXTURE_BINDING,
	});
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(c.tangent ? pipelines.tangent : pipelines.plain);
	segments.forEach((segmentParts, s) => {
		const size = (HEADER_ENTRIES + PART_ENTRIES * segmentParts.length) * ENTRY_BYTES;
		pass.setBindGroup(
			0,
			device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: { buffer: table, offset: offsets[s] as number, size } },
					{ binding: 1, resource: { buffer: source } },
					{ binding: 2, resource: { buffer: skinned } },
					{ binding: 3, resource: joints.createView() },
					{ binding: 4, resource: empty.createView() },
					{ binding: 5, resource: empty.createView() },
				],
			}),
		);
		const groups = segmentParts.reduce((n, p) => n + Math.ceil(p.vertices / WORKGROUP_SIZE), 0);
		pass.dispatchWorkgroups(groups);
	});
	pass.end();
	device.queue.submit([encoder.finish()]);

	const expected = c.meshes.map((mesh) =>
		Array.from({ length: mesh.positions.length / 3 }, (_, i) => skinnedOnCpu(c, mesh, i)),
	);
	const out = new Float32Array(await readBuffer(device, skinned, skinnedBytes));
	const pass1 = compare(expected, (part, vertex) => {
		const at = (parts[part] as Part).out + vertex * stride;
		return Array.from(out.subarray(at, at + stride));
	});
	const positions = expected.map((vertices) => vertices.map((v) => v.slice(0, 3)));
	const pass2 = compare(positions, await drawRegions(device, skinned, stride, parts, false));
	const pass3 = compare(positions, await drawRegions(device, skinned, stride, parts, true));
	const jointsRead = await readJoints(device, joints);
	for (const buffer of [source, table, skinned]) buffer.destroy();
	joints.destroy();
	empty.destroy();
	return {
		name: c.name,
		engine: c.engine,
		ok: pass1.wrong === 0 && pass2.wrong === 0 && pass3.wrong === 0,
		wrong: pass1.wrong,
		first: pass1.first,
		drawnWrong: pass2.wrong,
		drawnFirst: pass2.first,
		bundledWrong: pass3.wrong,
		bundledFirst: pass3.first,
		jointsRead,
	};
}

/** Bytes of a part's row number in the buffer of rows, an instance attribute as the engine's are. */
const ROW_STRIDE = 16;

/**
 * Draws each part's vertices from its region of the skinned vertex buffer, as the scene passes
 * draw a skinned part: the buffer bound at the region's first byte, the part's indices from its
 * place in a shared index buffer, an instance attribute bound at the part's own offset, and an
 * indexed indirect draw, in a render bundle with `bundled` as the scene passes record them. Returns
 * each vertex's position as the draw read it.
 */
async function drawRegions(
	device: GPUDevice,
	skinned: GPUBuffer,
	stride: number,
	parts: Part[],
	bundled: boolean,
): Promise<(part: number, vertex: number) => number[]> {
	const width = Math.max(...parts.map((p) => p.vertices));
	const height = parts.length;
	const module = device.createShaderModule({ code: DRAW_WGSL });
	const pipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: {
			module,
			entryPoint: 'vs',
			constants: { WIDTH: width, HEIGHT: height },
			buffers: [
				{
					arrayStride: stride * 4,
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x3' },
						{ shaderLocation: 1, offset: 12, format: 'float32x3' },
					],
				},
				{
					arrayStride: ROW_STRIDE,
					stepMode: 'instance',
					attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }],
				},
			],
		},
		fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] },
		primitive: { topology: 'point-list' },
	});
	// An even count of 16-bit indices, so the buffer's writes are whole 4-byte words.
	const total = parts.reduce((n, p) => n + p.vertices, 0);
	const indices = new Uint16Array(total + (total % 2));
	const draws = new Uint32Array(parts.length * 5);
	const rowNumbers = new Float32Array((parts.length * ROW_STRIDE) / 4);
	let first = 0;
	parts.forEach((part, k) => {
		for (let i = 0; i < part.vertices; i++) indices[first + i] = i;
		draws.set([part.vertices, 1, first, 0, 0], k * 5);
		rowNumbers[(k * ROW_STRIDE) / 4] = k;
		first += part.vertices;
	});
	const buffer = (data: ArrayBufferView<ArrayBuffer>, usage: number) => {
		const out = device.createBuffer({
			size: data.byteLength,
			usage: usage | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(out, 0, data);
		return out;
	};
	const indexBuffer = buffer(indices, GPUBufferUsage.INDEX);
	const indirect = buffer(draws, GPUBufferUsage.INDIRECT);
	const rows = buffer(rowNumbers, GPUBufferUsage.VERTEX);
	const target = device.createTexture({
		size: [width, height],
		format: 'rgba32float',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const record = (pass: GPURenderPassEncoder | GPURenderBundleEncoder) => {
		pass.setPipeline(pipeline);
		pass.setIndexBuffer(indexBuffer, 'uint16');
		parts.forEach((part, k) => {
			pass.setVertexBuffer(1, rows, k * ROW_STRIDE, ROW_STRIDE);
			pass.setVertexBuffer(0, skinned, part.out * 4);
			pass.drawIndexedIndirect(indirect, k * 20);
		});
	};
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: target.createView(),
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: [-1000, -1000, -1000, -1000],
			},
		],
	});
	if (bundled) {
		const bundle = device.createRenderBundleEncoder({ colorFormats: ['rgba32float'] });
		record(bundle);
		pass.executeBundles([bundle.finish()]);
	} else record(pass);
	pass.end();
	const rowBytes = Math.ceil((width * 16) / 256) * 256;
	const read = device.createBuffer({
		size: rowBytes * height,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});
	encoder.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: rowBytes }, [
		width,
		height,
	]);
	device.queue.submit([encoder.finish()]);
	await read.mapAsync(GPUMapMode.READ);
	const texels = new Float32Array(read.getMappedRange().slice(0));
	read.destroy();
	for (const b of [indexBuffer, indirect, rows]) b.destroy();
	target.destroy();
	return (part, vertex) => {
		const at = (part * rowBytes) / 4 + vertex * 4;
		return Array.from(texels.subarray(at, at + 3));
	};
}

/** True when the joint texture's joints read back as written. */
async function readJoints(device: GPUDevice, joints: GPUTexture): Promise<boolean> {
	const rowBytes = JOINTS_PER_ROW * TEXELS_PER_JOINT * 16;
	const read = device.createBuffer({
		size: rowBytes,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer({ texture: joints }, { buffer: read, bytesPerRow: rowBytes }, [
		JOINTS_PER_ROW * TEXELS_PER_JOINT,
		1,
	]);
	device.queue.submit([encoder.finish()]);
	await read.mapAsync(GPUMapMode.READ);
	const texels = new Float32Array(read.getMappedRange().slice(0));
	read.destroy();
	for (let j = 0; j < JOINTS; j++) {
		const want = jointRows(j);
		for (let e = 0; e < 12; e++)
			if (Math.abs((texels[j * 12 + e] as number) - (want[e] as number)) > TOLERANCE) return false;
	}
	return true;
}

run('skin-pass', async () => {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const core = adapter.features.has(coreFeatures);
	if (tier === 'webgpu' && !core) throw new Error('E1301: the adapter has no core WebGPU');
	const device = await adapter.requestDevice({
		requiredFeatures: tier === 'webgpu' ? [coreFeatures] : [],
	});
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	// The pass's builds load on first use, with the skinning feature's own module.
	const { skin: skinBuilds } = await loadWgslFeature('skinning', 0);
	if (!skinBuilds) throw new Error('the skinning module has no skinning pass');
	// The renderer's layout of the pass (packages/engine/src/gpu/webgpu/pipelines.ts).
	const compute = GPUShaderStage.COMPUTE;
	const data: GPUTextureBindingLayout = { sampleType: 'unfilterable-float' };
	const layout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 1, visibility: compute, buffer: { type: 'read-only-storage' } },
			{ binding: 2, visibility: compute, buffer: { type: 'storage' } },
			{ binding: 3, visibility: compute, texture: data },
			{ binding: 4, visibility: compute, texture: data },
			{ binding: 5, visibility: compute, texture: data },
		],
	});
	// The pass's two builds, as the renderer picks them: for formats without a tangent, and with one.
	const build = (bits: number) => {
		const skin = variantFor(skinBuilds, bits, 'wgsl')?.wgsl;
		if (!skin) throw new Error(`the shader module has no skinning build of bits ${bits}`);
		return device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			compute: { module: device.createShaderModule({ code: skin.source }), entryPoint: 'main' },
		});
	};
	const pipelines = { plain: build(0), tangent: build(PERMUTATION_VERTEX_TANGENT) };
	const cases: SkinPassCase[] = [];
	let jointsRead = true;
	for (const c of CASES) {
		progress(`case ${c.name}`);
		const { jointsRead: read, ...result } = await runCase(device, pipelines, layout, c);
		jointsRead &&= read;
		cases.push(result);
	}
	const result: SkinPassResult = {
		tier: tier === 'webgpu' ? 'webgpu' : 'webgpu-compat',
		jointsRead,
		cases,
		errors,
	};
	device.destroy();
	return { ...result };
});
