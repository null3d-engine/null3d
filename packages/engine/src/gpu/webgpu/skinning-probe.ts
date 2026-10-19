// The start-up probe that picks how WebGPU skins. A device can skin each character in the vertex
// shader of every pass that draws it, or once a frame in a compute pass whose vertices the passes
// then draw as a plain mesh. The two ways cost different amounts on different GPUs, so the engine
// measures both on the device at start and keeps the vertex way unless the compute way is clearly
// faster (decision records D-20 and D-174).
//
// The probe draws a fixed crowd twice on the device that the engine will use. The vertex arm skins
// each instance in the vertex shader of four passes, as three shadow cascades and the main pass do.
// The compute arm skins every character once into a buffer, then draws each character from its own
// region in those passes. That is the shape the engine records: the vertex way shares an instanced
// draw between copies, while the compute way gives each skinned object a bucket of its own. So the
// draw path the probe picked for the device decides how the compute arm records its draws.
//
// The crowd is small enough for a slow device and large enough that the per-vertex work shows: 64
// characters of 1,024 vertices each. Both arms draw every frame, so the probe measures the cost of
// a moving crowd and gives the compute way no credit for a pose that held still.
//
// A software renderer never takes the compute way. Its vertex work says nothing about a real GPU,
// and its pictures must stay the ones that the vertex shaders draw.
//
// The probe runs in the probe worker, on the device it creates to test WebGPU, so it costs the
// render worker no device and the page's first frame no time. Its work is a few dozen small frames,
// some tens of milliseconds on a slow device. It is part of the worker's own script, not a file
// that loads on demand: every page starts that worker, so a file of its own would load on every
// page and count outside the start's budget.

import { messageOf } from '../../errors/message';

/** Characters in the probe crowd. */
const CHARACTERS = 64;
/** Vertices of each character: enough that the per-vertex skinning work shows over the noise. */
const VERTICES = 1_024;
/** Passes that draw the crowd: three shadow cascades and the main pass, as `skin.rs` records. */
const PASSES = 4;
/** Frames of each arm in one timing run. */
const FRAMES = 6;
/** Timing runs of each arm; each arm's fastest run is its figure. The arms take turns in front. */
const ROUNDS = 4;
/** The compute way must be faster than the vertex way by this factor. */
const MARGIN = 1.05;
/** And by this many milliseconds a frame, so a noise-level win never picks it. */
const MIN_GAIN_MS = 0.05;
/**
 * A warming-up arm that takes longer than this says the device is too slow to probe, or the
 * browser runs a software renderer: the engine keeps the vertex way.
 */
const LIMIT_MS = 50;
/** The target's side in pixels: the drawn work is the same in both arms and does not matter. */
const SIDE = 64;
/** Joints of each character: enough to make the joint texture reads vary. */
const JOINTS = 32;
/** Threads per workgroup of the compute arm. */
const WORKGROUP = 64;
/** 32-bit words of a rest vertex: position, normal, joint ids, weights. */
const REST_WORDS = 11;
/** 32-bit words of a skinned vertex: position, normal, texture coordinates. */
const SKINNED_WORDS = 5;

/** The drawn surface of both arms: a plain vertex reads the skinning's result. */
const FRAGMENT = `
struct Out {
	@builtin(position) position: vec4f,
	@location(0) normal: vec3f,
}

fn clip(world: vec3f) -> vec4f {
	return vec4f(world.xy * 0.4, 0.0, 1.0);
}

@fragment
fn shade(in: Out) -> @location(0) vec4f {
	let n = normalize(in.normal);
	let light = max(dot(n, vec3f(0.3, 0.5, 0.81)), 0.0);
	return vec4f(0.02 + 0.01 * light, 0.01, 0.01, 1.0);
}
`;

/** The vertex arm: every pass skins each instance's four joints from the joint texture. */
const VERTEX_ARM = `
@group(0) @binding(0) var jointTexture: texture_2d<f32>;

struct SkinIn {
	@location(0) position: vec3f,
	@location(1) normal: vec3f,
	@location(2) jointIds: vec4u,
	@location(3) weights: vec4f,
	@location(4) character: u32,
}

@vertex
fn skinVertex(v: SkinIn) -> Out {
	var row0 = vec4f(0.0);
	var row1 = vec4f(0.0);
	var row2 = vec4f(0.0);
	for (var i = 0u; i < 4u; i++) {
		let x = i32(v.jointIds[i]) * 3;
		let w = v.weights[i];
		row0 += w * textureLoad(jointTexture, vec2i(x, i32(v.character)), 0);
		row1 += w * textureLoad(jointTexture, vec2i(x + 1, i32(v.character)), 0);
		row2 += w * textureLoad(jointTexture, vec2i(x + 2, i32(v.character)), 0);
	}
	let p = vec4f(v.position, 1.0);
	let n = v.normal;
	let moved = vec3f(dot(row0, p), dot(row1, p), dot(row2, p));
	let turned = vec3f(dot(row0.xyz, n), dot(row1.xyz, n), dot(row2.xyz, n));
	return Out(clip(moved), normalize(turned));
}
`;

/** The compute arm: one thread per vertex skins it into the buffer that the passes draw. */
const COMPUTE_ARM = `
@group(0) @binding(0) var<storage, read> rest: array<f32>;
@group(0) @binding(1) var jointTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> skinned: array<f32>;

@compute @workgroup_size(${WORKGROUP})
fn skin(@builtin(global_invocation_id) id: vec3u) {
	let at = id.x;
	if (at >= ${CHARACTERS * VERTICES}u) {
		return;
	}
	let character = at / ${VERTICES}u;
	let v = at % ${VERTICES}u;
	let r = v * ${REST_WORDS}u;
	let p = vec3f(rest[r], rest[r + 1u], rest[r + 2u]);
	let n = vec3f(rest[r + 3u], rest[r + 4u], rest[r + 5u]);
	let ids = unpack4xU8(bitcast<u32>(rest[r + 6u]));
	let w = vec4f(rest[r + 7u], rest[r + 8u], rest[r + 9u], rest[r + 10u]);
	var row0 = vec4f(0.0);
	var row1 = vec4f(0.0);
	var row2 = vec4f(0.0);
	for (var i = 0u; i < 4u; i++) {
		let x = i32(ids[i]) * 3;
		row0 += w[i] * textureLoad(jointTexture, vec2i(x, i32(character)), 0);
		row1 += w[i] * textureLoad(jointTexture, vec2i(x + 1, i32(character)), 0);
		row2 += w[i] * textureLoad(jointTexture, vec2i(x + 2, i32(character)), 0);
	}
	let blend = vec4f(p, 1.0);
	let moved = vec3f(dot(row0, blend), dot(row1, blend), dot(row2, blend));
	let turned = vec3f(dot(row0.xyz, n), dot(row1.xyz, n), dot(row2.xyz, n));
	let s = at * ${SKINNED_WORDS}u;
	skinned[s] = moved.x;
	skinned[s + 1u] = moved.y;
	skinned[s + 2u] = moved.z;
	skinned[s + 3u] = bitcast<f32>(pack4x8snorm(vec4f(normalize(turned), 0.0)));
	skinned[s + 4u] = 0.0;
}
`;

/** The plain vertex shader that the passes draw after the compute arm. */
const PLAIN_ARM = `
struct PlainIn {
	@location(0) position: vec3f,
	@location(1) normal: u32,
	@location(2) uv: u32,
}

@vertex
fn plainVertex(v: PlainIn) -> Out {
	let n = unpack4x8snorm(v.normal).xyz;
	let uv = unpack2x16unorm(v.uv);
	return Out(clip(v.position), n + vec3f(uv.x * 1e-5, 0.0, 0.0));
}
`;

/**
 * What the skinning probe measured, and the way it picked.
 *
 * @category api/engine
 */
export interface SkinningProbeResult {
	/** True when the compute way was clearly faster, so the engine skins in the skinning pass. */
	compute: boolean;
	/** Milliseconds a frame that the vertex way took, or null when the probe could not run. */
	vertexMs: number | null;
	/** Milliseconds a frame that the compute way took, or null when the probe could not run. */
	computeMs: number | null;
	/** Why the probe could not measure, when it threw. */
	error?: string;
}

/** The answer when the probe could not measure, which keeps the vertex way. */
const UNMEASURED: SkinningProbeResult = { compute: false, vertexMs: null, computeMs: null };

/**
 * True when the compute way is clearly faster than the vertex way. The probe picks it only when it
 * is faster by `MARGIN` and by `MIN_GAIN_MS`, so measurement noise never changes the way.
 */
export function computeSkinningWins(vertexMs: number, computeMs: number): boolean {
	return (
		Number.isFinite(vertexMs) &&
		Number.isFinite(computeMs) &&
		computeMs * MARGIN < vertexMs &&
		vertexMs - computeMs >= MIN_GAIN_MS
	);
}

/**
 * Measures the device's two skinning ways and returns the faster one. An arm that cannot run, a
 * device lost during the probe, or an inconclusive result keeps the vertex way. `direct` and `own`
 * say how the engine records its draws, so the compute arm pays the draw cost that the engine pays:
 * direct draws, or indirect draws with an argument buffer of their own per draw on Apple's WebKit.
 */
export async function probeSkinning(
	device: GPUDevice,
	info: GPUAdapterInfo,
	direct: boolean,
	own: boolean,
): Promise<SkinningProbeResult> {
	// A software renderer's timings say nothing about a real GPU, and its pictures must stay those
	// that the vertex shaders draw.
	const words = [info.vendor, info.architecture, info.device, info.description].join(' ');
	if (/swiftshader|llvmpipe|software/i.test(words)) return UNMEASURED;
	try {
		return await measure(device, direct, own);
	} catch (e) {
		return { ...UNMEASURED, error: messageOf(e) };
	}
}

/** The vertex positions and normals, joint ids and weights of the crowd at rest. */
function restVertices(): ArrayBuffer {
	const data = new ArrayBuffer(VERTICES * REST_WORDS * 4);
	const floats = new Float32Array(data);
	const bytes = new Uint8Array(data);
	const side = Math.sqrt(VERTICES);
	for (let v = 0; v < VERTICES; v++) {
		const at = v * REST_WORDS;
		const x = ((v % side) / (side - 1)) * 2 - 1;
		const y = (Math.floor(v / side) / (side - 1)) * 2 - 1;
		const z = ((v * 37) % 17) / 17 - 0.5;
		floats[at] = x;
		floats[at + 1] = y;
		floats[at + 2] = z;
		const length = Math.hypot(x, y, z + 1) || 1;
		floats[at + 3] = x / length;
		floats[at + 4] = y / length;
		floats[at + 5] = (z + 1) / length;
		bytes.set([v % JOINTS, (v + 7) % JOINTS, (v + 13) % JOINTS, (v + 19) % JOINTS], (at + 6) * 4);
		floats[at + 7] = 0.4;
		floats[at + 8] = 0.3;
		floats[at + 9] = 0.2;
		floats[at + 10] = 0.1;
	}
	return data;
}

/** One joint matrix of each character at each joint, three texels of four floats per joint. */
function jointMatrices(): Float32Array {
	const data = new Float32Array(CHARACTERS * JOINTS * 3 * 4);
	for (let character = 0; character < CHARACTERS; character++) {
		for (let joint = 0; joint < JOINTS; joint++) {
			const angle = character * 0.05 + joint * 0.2;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const at = (character * JOINTS + joint) * 12;
			data[at] = cos;
			data[at + 1] = -sin;
			data[at + 2] = 0;
			data[at + 3] = (joint / JOINTS) * 0.2;
			data[at + 4] = sin;
			data[at + 5] = cos;
			data[at + 6] = 0;
			data[at + 7] = 0.05;
			data[at + 8] = 0;
			data[at + 9] = 0;
			data[at + 10] = 1;
			data[at + 11] = 0.05 * (character / CHARACTERS);
		}
	}
	return data;
}

/** A buffer of `size` bytes with a usage, filled from `data` when one is given. */
function buffer(
	device: GPUDevice,
	size: number,
	usage: GPUBufferUsageFlags,
	data?: BufferSource,
): GPUBuffer {
	const made = device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST });
	if (data) device.queue.writeBuffer(made, 0, data);
	return made;
}

async function measure(
	device: GPUDevice,
	direct: boolean,
	own: boolean,
): Promise<SkinningProbeResult> {
	const rest = buffer(
		device,
		VERTICES * REST_WORDS * 4,
		GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
		restVertices(),
	);
	const characters = buffer(
		device,
		CHARACTERS * 4,
		GPUBufferUsage.VERTEX,
		new Uint32Array(Array.from({ length: CHARACTERS }, (_, c) => c)),
	);
	const skinned = buffer(
		device,
		CHARACTERS * VERTICES * SKINNED_WORDS * 4,
		GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
	);
	const indices = buffer(
		device,
		VERTICES * 2,
		GPUBufferUsage.INDEX,
		new Uint16Array(Array.from({ length: VERTICES }, (_, v) => v)),
	);
	const joints = device.createTexture({
		size: [JOINTS * 3, CHARACTERS],
		format: 'rgba32float',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture(
		{ texture: joints },
		jointMatrices(),
		{ bytesPerRow: JOINTS * 3 * 16 },
		[JOINTS * 3, CHARACTERS],
	);
	const jointView = joints.createView();
	const target = device
		.createTexture({
			size: [SIDE, SIDE],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		})
		.createView();
	// The compute arm draws each character on its own, so it pays for a draw of each in each pass.
	// The engine's indirect path records those draws with arguments, one buffer each on Apple's
	// WebKit, whose draws from one buffer race (see `indirect-arguments.ts`).
	const argumentsOf = new Uint32Array(CHARACTERS * 5);
	for (let c = 0; c < CHARACTERS; c++) {
		// The index count, one instance, the first index, the character's first vertex, and no
		// first instance.
		argumentsOf[c * 5] = VERTICES;
		argumentsOf[c * 5 + 1] = 1;
		argumentsOf[c * 5 + 3] = c * VERTICES;
	}
	const sharedArguments = direct
		? undefined
		: buffer(device, argumentsOf.byteLength, GPUBufferUsage.INDIRECT, argumentsOf);
	const ownArguments =
		direct || !own
			? undefined
			: Array.from({ length: CHARACTERS }, (_, c) =>
					buffer(
						device,
						argumentsOf.subarray(c * 5, c * 5 + 5).byteLength,
						GPUBufferUsage.INDIRECT,
						argumentsOf.subarray(c * 5, c * 5 + 5),
					),
				);
	const skinModule = device.createShaderModule({ code: `${FRAGMENT}${VERTEX_ARM}` });
	const plainModule = device.createShaderModule({ code: `${FRAGMENT}${PLAIN_ARM}` });
	const computeModule = device.createShaderModule({ code: COMPUTE_ARM });
	const skinPipeline = await device.createRenderPipelineAsync({
		layout: 'auto',
		vertex: {
			module: skinModule,
			entryPoint: 'skinVertex',
			buffers: [
				{
					arrayStride: REST_WORDS * 4,
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x3' },
						{ shaderLocation: 1, offset: 12, format: 'float32x3' },
						{ shaderLocation: 2, offset: 24, format: 'uint8x4' },
						{ shaderLocation: 3, offset: 28, format: 'float32x4' },
					],
				},
				{
					arrayStride: 4,
					stepMode: 'instance',
					attributes: [{ shaderLocation: 4, offset: 0, format: 'uint32' }],
				},
			],
		},
		fragment: { module: skinModule, entryPoint: 'shade', targets: [{ format: 'rgba8unorm' }] },
	});
	const plainPipeline = await device.createRenderPipelineAsync({
		layout: 'auto',
		vertex: {
			module: plainModule,
			entryPoint: 'plainVertex',
			buffers: [
				{
					arrayStride: SKINNED_WORDS * 4,
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x3' },
						{ shaderLocation: 1, offset: 12, format: 'uint32' },
						{ shaderLocation: 2, offset: 16, format: 'uint32' },
					],
				},
			],
		},
		fragment: { module: plainModule, entryPoint: 'shade', targets: [{ format: 'rgba8unorm' }] },
	});
	const skinPipelineLayout = skinPipeline.getBindGroupLayout(0);
	const skinGroup = device.createBindGroup({
		layout: skinPipelineLayout,
		entries: [{ binding: 0, resource: jointView }],
	});
	const computePipeline = await device.createComputePipelineAsync({
		layout: 'auto',
		compute: { module: computeModule, entryPoint: 'skin' },
	});
	const computeGroup = device.createBindGroup({
		layout: computePipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: rest } },
			{ binding: 1, resource: jointView },
			{ binding: 2, resource: { buffer: skinned } },
		],
	});
	/** Records one render pass that clears the target and lets `record` draw into it. */
	const pass = (encoder: GPUCommandEncoder, record: (pass: GPURenderPassEncoder) => void): void => {
		const made = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: target,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
				},
			],
		});
		record(made);
		made.end();
	};
	/** One frame of the vertex arm: every pass skins the crowd in its vertex shader. */
	const vertexFrame = (encoder: GPUCommandEncoder): void => {
		for (let p = 0; p < PASSES; p++) {
			pass(encoder, (made) => {
				made.setPipeline(skinPipeline);
				made.setVertexBuffer(0, rest);
				made.setVertexBuffer(1, characters);
				made.setBindGroup(0, skinGroup);
				made.setIndexBuffer(indices, 'uint16');
				made.drawIndexed(VERTICES, CHARACTERS);
			});
		}
	};
	/** One frame of the compute arm: one dispatch skins the crowd, then each pass draws it. */
	const computeFrame = (encoder: GPUCommandEncoder): void => {
		const dispatch = encoder.beginComputePass();
		dispatch.setPipeline(computePipeline);
		dispatch.setBindGroup(0, computeGroup);
		dispatch.dispatchWorkgroups(Math.ceil((CHARACTERS * VERTICES) / WORKGROUP));
		dispatch.end();
		for (let p = 0; p < PASSES; p++) {
			pass(encoder, (made) => {
				made.setPipeline(plainPipeline);
				made.setVertexBuffer(0, skinned);
				made.setIndexBuffer(indices, 'uint16');
				for (let c = 0; c < CHARACTERS; c++) {
					if (direct) made.drawIndexed(VERTICES, 1, 0, c * VERTICES);
					else if (ownArguments) made.drawIndexedIndirect(ownArguments[c] as GPUBuffer, 0);
					else made.drawIndexedIndirect(sharedArguments as GPUBuffer, c * 20);
				}
			});
		}
	};
	/**
	 * Runs one frame of an arm, so the driver compiles what it needs before the timing, and says
	 * whether the device is too slow to probe.
	 */
	const warm = async (frame: (encoder: GPUCommandEncoder) => void): Promise<boolean> => {
		const start = performance.now();
		const encoder = device.createCommandEncoder();
		frame(encoder);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		return performance.now() - start <= LIMIT_MS;
	};
	/** One timing run of an arm, in milliseconds a frame. */
	const time = async (frame: (encoder: GPUCommandEncoder) => void): Promise<number> => {
		const start = performance.now();
		const encoder = device.createCommandEncoder();
		for (let f = 0; f < FRAMES; f++) frame(encoder);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		return (performance.now() - start) / FRAMES;
	};
	const probeable = (await warm(vertexFrame)) && (await warm(computeFrame));
	let vertexMs = Number.POSITIVE_INFINITY;
	let computeMs = Number.POSITIVE_INFINITY;
	// The arms take turns in the lead, so neither meets a colder GPU or a busier queue than the
	// other. Each arm keeps its fastest run, which is the run that its own work set.
	for (let round = 0; probeable && round < ROUNDS; round++) {
		const vertexFirst = round % 2 === 0;
		if (vertexFirst) vertexMs = Math.min(vertexMs, await time(vertexFrame));
		else computeMs = Math.min(computeMs, await time(computeFrame));
		if (vertexFirst) computeMs = Math.min(computeMs, await time(computeFrame));
		else vertexMs = Math.min(vertexMs, await time(vertexFrame));
	}
	const measured = Number.isFinite(vertexMs) && Number.isFinite(computeMs);
	return {
		compute: measured && computeSkinningWins(vertexMs, computeMs),
		vertexMs: Number.isFinite(vertexMs) ? vertexMs : null,
		computeMs: Number.isFinite(computeMs) ? computeMs : null,
	};
}
