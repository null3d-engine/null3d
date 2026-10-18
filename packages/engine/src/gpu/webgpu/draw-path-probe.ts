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
// A software renderer never takes the direct path. Its draws are not the GPU work that this path
// removes, and its pictures must stay the ones that the engine's current path draws.
//
// The probe runs in the probe worker, on the device it creates to test WebGPU, so it costs the
// render worker no device and the page's first frame no time. Its work is a few hundred draws in a
// 64 pixel target: some tens of milliseconds on a slow device. It is part of the worker's own
// script, not a file that loads on demand: every page starts that worker, so a file of its own
// would load on every page and count outside the start's budget.

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
 * Measures the device's two draw paths and returns true when the direct path is clearly faster. An
 * arm that cannot run, a device lost during the probe, or an inconclusive result keeps the
 * engine's current path: the answer is false.
 */
export async function probeDirectDraws(
	device: GPUDevice,
	info: GPUAdapterInfo,
	own: boolean,
): Promise<boolean> {
	// Compose the words that name a software renderer. Its slow indirect draws say nothing about
	// the per-draw GPU cost that the direct path removes, and its pictures must not change.
	const words = [info.vendor, info.architecture, info.device, info.description].join(' ');
	if (/swiftshader|llvmpipe|software/i.test(words)) return false;
	try {
		return await measure(device, own);
	} catch {
		return false;
	}
}

/** What one arm draws, in the probe's target. */
type Arm = (pass: GPURenderPassEncoder) => void;

async function measure(device: GPUDevice, own: boolean): Promise<boolean> {
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
	return (
		Number.isFinite(indirectMs) &&
		Number.isFinite(directMs) &&
		directMs * MARGIN < indirectMs &&
		indirectMs - directMs >= MIN_GAIN_MS
	);
}
