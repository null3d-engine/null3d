// Draws a pass of indexed indirect draws, whose arguments the CPU wrote, as the first pass that
// draws on a new device, on the GPU path that ?gpu= names: core WebGPU (webgpu) or compatibility
// mode (compat). It draws once as it is, and once on another new device after the pass that the
// engine draws before its first frame. Some drivers draw nothing in the first such pass on a device
// (`.dev/driver-bugs.md`). Each draw reads its points from its own region of a vertex buffer, and
// writes each point's position into a pixel of a float target, which the page reads back.
import { FirstPass } from '../../packages/engine/src/gpu/webgpu/first-pass';
import type { FirstDrawOutcome, FirstDrawResult } from '../lib/first-draw-checks';
import { progress, run } from './lib/result';

const compat = new URLSearchParams(location.search).get('gpu') === 'compat';

/** Draws, and points in each: every draw writes the same row of pixels, so the last one shows. */
const DRAWS = 5;
const POINTS = 24;
/** Words per vertex: a position of three floats and a fourth word, as a skinned vertex has. */
const STRIDE = 4;
/** Arguments of an indexed indirect draw, in words. */
const ARGUMENTS = 5;
/** What the target holds where no point landed. */
const CLEAR = -1000;

const SHADER = `
override WIDTH: f32 = 1.0;
struct Out {
    @builtin(position) clip: vec4f,
    @location(0) value: vec4f,
}
@vertex
fn vs(@location(0) position: vec3f, @builtin(vertex_index) vertex: u32) -> Out {
    let x = (f32(vertex) + 0.5) / WIDTH * 2.0 - 1.0;
    return Out(vec4f(x, 0.0, 0.0, 1.0), vec4f(position, 1.0));
}
@fragment
fn fs(in: Out) -> @location(0) vec4f {
    return in.value;
}
`;

function written(device: GPUDevice, data: ArrayBufferView<ArrayBuffer>, usage: number): GPUBuffer {
	const buffer = device.createBuffer({
		size: data.byteLength,
		usage: usage | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(buffer, 0, data);
	return buffer;
}

/** Draws the pass on `device` and reads back the points that the last draw should have written. */
async function drawPass(device: GPUDevice): Promise<FirstDrawOutcome> {
	const vertices = new Float32Array(DRAWS * POINTS * STRIDE);
	const indices = new Uint16Array(POINTS);
	const draws = new Uint32Array(DRAWS * ARGUMENTS);
	for (let i = 0; i < POINTS; i++) indices[i] = i;
	for (let d = 0; d < DRAWS; d++) {
		draws.set([POINTS, 1, 0, 0, 0], d * ARGUMENTS);
		for (let i = 0; i < POINTS; i++) vertices.set([d, i, 7], (d * POINTS + i) * STRIDE);
	}
	const vertexBuffer = written(device, vertices, GPUBufferUsage.VERTEX);
	const indexBuffer = written(device, indices, GPUBufferUsage.INDEX);
	const indirect = written(device, draws, GPUBufferUsage.INDIRECT);
	const module = device.createShaderModule({ code: SHADER });
	const pipeline = device.createRenderPipeline({
		layout: 'auto',
		vertex: {
			module,
			entryPoint: 'vs',
			constants: { WIDTH: POINTS },
			buffers: [
				{
					arrayStride: STRIDE * 4,
					attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
				},
			],
		},
		fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] },
		primitive: { topology: 'point-list' },
	});
	const target = device.createTexture({
		size: [POINTS, 1],
		format: 'rgba32float',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: target.createView(),
				loadOp: 'clear',
				storeOp: 'store',
				clearValue: [CLEAR, CLEAR, CLEAR, CLEAR],
			},
		],
	});
	pass.setPipeline(pipeline);
	pass.setIndexBuffer(indexBuffer, 'uint16');
	for (let d = 0; d < DRAWS; d++) {
		pass.setVertexBuffer(0, vertexBuffer, d * POINTS * STRIDE * 4);
		pass.drawIndexedIndirect(indirect, d * ARGUMENTS * 4);
	}
	pass.end();
	const rowBytes = Math.ceil((POINTS * 16) / 256) * 256;
	const read = device.createBuffer({
		size: rowBytes,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});
	encoder.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: rowBytes }, [
		POINTS,
		1,
	]);
	device.queue.submit([encoder.finish()]);
	await read.mapAsync(GPUMapMode.READ);
	const texels = new Float32Array(read.getMappedRange().slice(0));
	read.destroy();
	for (const buffer of [vertexBuffer, indexBuffer, indirect]) buffer.destroy();
	target.destroy();
	let drawn = 0;
	let right = 0;
	for (let i = 0; i < POINTS; i++) {
		const [x, y, z] = texels.subarray(i * 4, i * 4 + 3);
		if (x !== CLEAR) drawn++;
		if (x === DRAWS - 1 && y === i && z === 7) right++;
	}
	return { expected: POINTS, drawn, right };
}

/** A new device on the page's GPU path, and the errors that no scope caught on it. */
async function newDevice(): Promise<{ device: GPUDevice; errors: string[] }> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	if (!compat && !adapter.features.has(coreFeatures))
		throw new Error('E1301: the adapter has no core WebGPU');
	const device = await adapter.requestDevice({
		requiredFeatures: compat ? [] : [coreFeatures],
	});
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	return { device, errors };
}

run('first-draw', async () => {
	progress('the draws as the first pass on a new device');
	const bareDevice = await newDevice();
	const bare = await drawPass(bareDevice.device);
	bareDevice.device.destroy();
	progress("the draws after the engine's first pass");
	const warmed = await newDevice();
	const firstPass = new FirstPass(warmed.device);
	await firstPass.built;
	firstPass.draw();
	const afterFirstPass = await drawPass(warmed.device);
	warmed.device.destroy();
	const result: FirstDrawResult = {
		tier: compat ? 'webgpu-compat' : 'webgpu',
		bare,
		afterFirstPass,
		errors: [...bareDevice.errors, ...warmed.errors],
	};
	return { ...result };
});
