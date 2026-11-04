// The start-up probe that picks the draw path. WebKit checks every indexed indirect draw whose
// pipeline has vertex buffers with a clamp of its arguments, and the check costs a fixed time for
// each draw in each pass (decision record D-174). The probe draws a fixed workload twice on the
// device that the engine will use: once with the indirect draws that the engine records today, and
// once with direct draws. It picks the direct path only when that arm is clearly faster.
//
// The cost belongs to one combination, an Apple GPU in Apple's WebKit, so the probe runs only
// there (hard rule 14). Elsewhere a noisy measurement, as on a busy machine, could pick a path that
// draws no cluster trees and removes no cost. A software renderer never takes the direct path
// either: its draws are not the GPU work that the path removes, and its pictures must stay the
// ones that the engine's current path draws.
//
// The indirect arm copies the engine's own shape: each draw's arguments in a buffer of their own
// on Apple's WebKit, whose indirect draws from one buffer race (see `indirect-arguments.ts`), and
// one buffer for every draw elsewhere.
//
// The probe runs in the probe worker, on the device it creates to test WebGPU, so it costs the
// render worker no device and the page's first frame no time. Its work is a few hundred draws in a
// 64 pixel target: some tens of milliseconds on a slow device. It is part of the worker's own
// script, not a file that loads on demand: every page starts that worker, so a file of its own
// would load on every page and count outside the start's budget.

import { softwareRendererName } from '../../shared/software';
import { appleGpuInWebKit } from '../../shared/webkit';

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
 * that would spend seconds in the probe.
 */
const LIMIT_MS = 50;
/** The target's side in pixels: the drawn work is the same in both arms and does not matter. */
const SIDE = 64;
/** Indices of the triangle pair that every draw draws. */
const INDICES = 6;

const SHADER = `@vertex fn v(@location(0) p: vec2f) -> @builtin(position) vec4f { return vec4f(p, 0.0, 1.0); }
@fragment fn f() -> @location(0) vec4f { return vec4f(1.0); }`;

/**
 * Why WebGPU draws on the path that the engine takes, in `engine.capabilities.drawPath`:
 *
 * - `probe-faster`: the start-up probe ran on an Apple GPU in WebKit and measured direct draws to
 *   be clearly faster, so the engine draws directly.
 * - `probe-not-faster`: the probe ran there, and direct draws were not clearly faster.
 * - `probe-failed`: the probe ran there and could not measure, as when the device was too slow or
 *   was lost.
 * - `not-apple-gpu-in-webkit`: the device is not an Apple GPU in Safari or in a browser on iPhone
 *   or iPad. The probe did not run, and the engine draws indirectly.
 * - `software-renderer`: the browser draws on the CPU. The probe did not run.
 * - `no-probe`: the worker's WebGPU check gave no answer.
 * - `forced`: `?direct=on` or `?direct=off` chose the path.
 * - `webgl2`: the engine draws with WebGL2, which always draws directly.
 *
 * @category api/engine
 */
export type DrawPathReason =
	| 'probe-faster'
	| 'probe-not-faster'
	| 'probe-failed'
	| 'not-apple-gpu-in-webkit'
	| 'software-renderer'
	| 'no-probe'
	| 'forced'
	| 'webgl2';

/** The probe's answer: whether to draw directly, and why. */
export interface DrawPathProbe {
	directDraws: boolean;
	reason: DrawPathReason;
}

/**
 * Why the probe does not run on a device with the adapter names `info`, in a browser with
 * `userAgent`. Undefined where it runs: on an Apple GPU in Apple's WebKit that is no software
 * renderer.
 */
export function skipDrawPathProbe(
	info: GPUAdapterInfo,
	userAgent: string,
): DrawPathReason | undefined {
	if (softwareRendererName(info.vendor, info.architecture, info.device, info.description))
		return 'software-renderer';
	if (!appleGpuInWebKit(info, userAgent)) return 'not-apple-gpu-in-webkit';
	return undefined;
}

/**
 * Picks the draw path of a device with the adapter names `info`, in a browser with `userAgent`. On
 * an Apple GPU in WebKit it measures both paths, and takes the direct one only when it is clearly
 * faster. `own` gives each indirect draw its own argument buffer, as the engine does on Apple's
 * WebKit. An arm that cannot run, a device lost during the probe, or an inconclusive result keeps
 * the engine's current path.
 */
export async function probeDrawPath(
	device: GPUDevice,
	info: GPUAdapterInfo,
	userAgent: string,
	own: boolean,
): Promise<DrawPathProbe> {
	const skipped = skipDrawPathProbe(info, userAgent);
	if (skipped) return { directDraws: false, reason: skipped };
	try {
		return await measure(device, own);
	} catch {
		return { directDraws: false, reason: 'probe-failed' };
	}
}

/** What one arm draws, in the probe's target. */
type Arm = (pass: GPURenderPassEncoder) => void;

async function measure(device: GPUDevice, own: boolean): Promise<DrawPathProbe> {
	// Each draw's arguments: the index count, one instance, and zeros for the rest.
	const argumentsOf = new Uint32Array(DRAWS * 5);
	for (let d = 0; d < DRAWS; d++) {
		argumentsOf[d * 5] = INDICES;
		argumentsOf[d * 5 + 1] = 1;
	}
	const shared = device.createBuffer({
		size: argumentsOf.byteLength,
		usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(shared, 0, argumentsOf);
	const buffers = own
		? Array.from({ length: DRAWS }, () => {
				const buffer = device.createBuffer({
					size: 20,
					usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
				});
				device.queue.writeBuffer(buffer, 0, argumentsOf.subarray(0, 5));
				return buffer;
			})
		: [shared];
	const vertices = device.createBuffer({
		size: 24,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertices, 0, new Float32Array([-1, -1, 3, -1, -1, 3]));
	const indices = device.createBuffer({
		size: 12,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(indices, 0, new Uint16Array([0, 1, 2, 0, 2, 1]));
	const view = device
		.createTexture({
			size: [SIDE, SIDE],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		})
		.createView();
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
		fragment: { module, entryPoint: 'f', targets: [{ format: 'rgba8unorm' }] },
	});
	/** Records one frame of an arm into the target. */
	const frame = (encoder: GPUCommandEncoder, arm: Arm): void => {
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view,
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
				},
			],
		});
		pass.setPipeline(pipeline);
		pass.setVertexBuffer(0, vertices);
		pass.setIndexBuffer(indices, 'uint16');
		arm(pass);
		pass.end();
	};
	/** One timing run of an arm, in milliseconds a frame, or infinity when the device is slow. */
	const time = async (arm: Arm): Promise<number> => {
		const warm = performance.now();
		const first = device.createCommandEncoder();
		frame(first, arm);
		device.queue.submit([first.finish()]);
		await device.queue.onSubmittedWorkDone();
		if (performance.now() - warm > LIMIT_MS) return Number.POSITIVE_INFINITY;
		const start = performance.now();
		const encoder = device.createCommandEncoder();
		for (let f = 0; f < FRAMES; f++) frame(encoder, arm);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		return (performance.now() - start) / FRAMES;
	};
	const fastest = async (arm: Arm): Promise<number> => {
		let best = Number.POSITIVE_INFINITY;
		for (let round = 0; round < ROUNDS; round++) best = Math.min(best, await time(arm));
		return best;
	};
	const indirect: Arm = (pass) => {
		if (own) for (let d = 0; d < DRAWS; d++) pass.drawIndexedIndirect(buffers[d] as GPUBuffer, 0);
		else for (let d = 0; d < DRAWS; d++) pass.drawIndexedIndirect(shared, d * 20);
	};
	const direct: Arm = (pass) => {
		for (let d = 0; d < DRAWS; d++) pass.drawIndexed(INDICES);
	};
	const indirectMs = await fastest(indirect);
	const directMs = await fastest(direct);
	if (!Number.isFinite(indirectMs) || !Number.isFinite(directMs))
		return { directDraws: false, reason: 'probe-failed' };
	const faster = directMs * MARGIN < indirectMs && indirectMs - directMs >= MIN_GAIN_MS;
	return { directDraws: faster, reason: faster ? 'probe-faster' : 'probe-not-faster' };
}
