// The start-up probe that picks the draw path. WebKit checks every indexed indirect draw whose
// pipeline has vertex buffers with a clamp of its arguments, and the check costs a fixed time for
// each draw in each pass (decision record D-174). The probe draws a fixed workload twice on the
// device that the engine will use: once with the indirect draws that the engine records today, and
// once with direct draws. It picks the direct path only when that arm is clearly faster.
//
// The indirect arm copies the engine's own shape: each draw's arguments in a buffer of their own
// on Apple's WebKit, whose indirect draws from one buffer race (see `indirect-arguments.ts`), and
// one buffer for every draw elsewhere. The browser's user agent decides that shape, as it already
// does for the engine's copies; the path itself is chosen from the measurement alone.
//
// The probe runs in the probe worker, on the device it creates to test WebGPU, so it costs the
// render worker no device and the page's first frame no time. Its work is a few hundred draws in a
// 64 pixel target: some tens of milliseconds on a slow device.

import { needsOwnArguments } from './indirect-arguments';

/** The draws of each arm: enough that a per-draw cost of a few microseconds shows over the noise. */
const DRAWS = 512;
/** Frames of each arm in one timing run. */
const FRAMES = 6;
/** Timing runs of each arm; each arm's fastest run is its figure. */
const ROUNDS = 3;
/** The direct path must be faster than the indirect path by this factor. */
const MARGIN = 1.25;
/** And by this many milliseconds a frame, so a noise-level win never picks it. */
const MIN_GAIN_MS = 0.15;
/**
 * A warming-up arm that takes longer than this says the device is too slow to probe, or the
 * browser runs a software renderer: the engine keeps its current path. A device whose indirect
 * draws the probe can measure draws 512 of them in a few milliseconds, so this catches a device
 * that would spend seconds in the probe, such as a software renderer in CI.
 */
const LIMIT_MS = 50;
/** The target's side in pixels: the drawn work is the same in both arms and does not matter. */
const SIDE = 64;
/** Indices of the triangle pair that every draw draws. */
const INDICES = 6;

const SHADER = `@vertex fn v(@location(0) pos: vec2f) -> @builtin(position) vec4f {
	return vec4f(pos, 0.0, 1.0);
}
@fragment fn f() -> @location(0) vec4f { return vec4f(1.0); }`;

/**
 * Measures the device's two draw paths and returns true when the direct path is clearly faster.
 * An arm that cannot run, a device lost during the probe, or an inconclusive result keeps the
 * engine's current path: the answer is false.
 */
export async function probeDirectDraws(device: GPUDevice): Promise<boolean> {
	try {
		return await measure(device);
	} catch {
		return false;
	}
}

/** The probe's GPU objects, made once for both arms. */
interface Probe {
	device: GPUDevice;
	pipeline: GPURenderPipeline;
	target: GPUTextureView;
	vertices: GPUBuffer;
	indices: GPUBuffer;
	/** The shared argument buffer, or the draws' own where the browser needs one for each. */
	arguments: GPUBuffer[];
	own: boolean;
}

async function measure(device: GPUDevice): Promise<boolean> {
	const target = device.createTexture({
		size: [SIDE, SIDE],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT,
	});
	const vertices = device.createBuffer({
		size: 3 * 8,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertices, 0, new Float32Array([-1, -1, 3, -1, -1, 3]));
	const indices = device.createBuffer({
		size: INDICES * 2,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(indices, 0, new Uint16Array([0, 1, 2, 0, 2, 1]));
	// Each draw's arguments: the index count, one instance, and zeros for the rest.
	const argumentsOf = new Uint32Array(DRAWS * 5);
	for (let d = 0; d < DRAWS; d++) {
		argumentsOf[d * 5] = INDICES;
		argumentsOf[d * 5 + 1] = 1;
	}
	const own = needsOwnArguments(globalThis.navigator?.userAgent ?? '');
	const shared = device.createBuffer({
		size: argumentsOf.byteLength,
		usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(shared, 0, argumentsOf);
	const argumentsBuffers = own
		? Array.from({ length: DRAWS }, () => {
				const buffer = device.createBuffer({
					size: 20,
					usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
				});
				device.queue.writeBuffer(buffer, 0, argumentsOf.subarray(0, 5));
				return buffer;
			})
		: [shared];
	const module = device.createShaderModule({ code: SHADER });
	const pipeline = await device.createRenderPipelineAsync({
		layout: 'auto',
		vertex: {
			module,
			entryPoint: 'v',
			buffers: [
				{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
			],
		},
		fragment: {
			module,
			entryPoint: 'f',
			targets: [{ format: 'rgba8unorm' }],
		},
	});
	const probe: Probe = {
		device,
		pipeline,
		target: target.createView(),
		vertices,
		indices,
		arguments: argumentsBuffers,
		own,
	};
	const indirectMs = await fastest(probe, indirect);
	const directMs = await fastest(probe, direct);
	for (const buffer of argumentsBuffers) if (own) buffer.destroy();
	shared.destroy();
	vertices.destroy();
	indices.destroy();
	target.destroy();
	// A run that met the limit says nothing about the device: keep the engine's current path.
	if (!Number.isFinite(indirectMs) || !Number.isFinite(directMs)) return false;
	return directMs * MARGIN < indirectMs && indirectMs - directMs >= MIN_GAIN_MS;
}

/** The fastest of `ROUNDS` timing runs of an arm, in milliseconds a frame, or infinity when the
 * device is too slow to probe. */
async function fastest(probe: Probe, arm: (pass: GPURenderPassEncoder, p: Probe) => void) {
	let best = Number.POSITIVE_INFINITY;
	for (let round = 0; round < ROUNDS; round++) best = Math.min(best, await time(probe, arm));
	return best;
}

/**
 * Times `FRAMES` frames of an arm back to back: the GPU's work, not the display's rate. A leading
 * frame of the arm warms the driver, and a device that spends longer than the limit on it is not
 * probed further.
 */
async function time(
	probe: Probe,
	arm: (pass: GPURenderPassEncoder, p: Probe) => void,
): Promise<number> {
	const warmStart = performance.now();
	probe.device.queue.submit([encode(probe, arm)]);
	await probe.device.queue.onSubmittedWorkDone();
	if (performance.now() - warmStart > LIMIT_MS) return Number.POSITIVE_INFINITY;
	const start = performance.now();
	const encoder = probe.device.createCommandEncoder();
	for (let frame = 0; frame < FRAMES; frame++) {
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: probe.target,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
				},
			],
		});
		pass.setPipeline(probe.pipeline);
		pass.setVertexBuffer(0, probe.vertices);
		pass.setIndexBuffer(probe.indices, 'uint16');
		arm(pass, probe);
		pass.end();
	}
	probe.device.queue.submit([encoder.finish()]);
	await probe.device.queue.onSubmittedWorkDone();
	return (performance.now() - start) / FRAMES;
}

/** One frame of an arm, for the warm-up. */
function encode(probe: Probe, arm: (pass: GPURenderPassEncoder, p: Probe) => void) {
	const encoder = probe.device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: probe.target,
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
			},
		],
	});
	pass.setPipeline(probe.pipeline);
	pass.setVertexBuffer(0, probe.vertices);
	pass.setIndexBuffer(probe.indices, 'uint16');
	arm(pass, probe);
	pass.end();
	return encoder.finish();
}

/** The indirect draws that the engine records: one draw for each part of the workload. */
function indirect(pass: GPURenderPassEncoder, probe: Probe): void {
	if (probe.own) {
		for (let d = 0; d < DRAWS; d++) {
			pass.drawIndexedIndirect(probe.arguments[d] as GPUBuffer, 0);
		}
	} else {
		const shared = probe.arguments[0] as GPUBuffer;
		for (let d = 0; d < DRAWS; d++) pass.drawIndexedIndirect(shared, d * 20);
	}
}

/** The same draws, each with its count known on the CPU. */
function direct(pass: GPURenderPassEncoder): void {
	for (let d = 0; d < DRAWS; d++) pass.drawIndexed(INDICES);
}
