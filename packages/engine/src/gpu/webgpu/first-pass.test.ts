import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import type { DeviceShaders } from '../../generated/shaders';
import { webgpuRenderer } from '../../render/webgpu-renderers';
import { controlViews, createControlBuffer, Slot } from '../../shared/control';
import type { FrameRecorder } from '../../shared/metrics';
import type { DeviceShaderSet } from '../device-shaders';
import { FirstPass } from './first-pass';

const scope = globalThis as Record<string, unknown>;
const GLOBALS = {
	GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 },
	GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
	GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8 },
	GPUMapMode: { READ: 1, WRITE: 2 },
};
const GPU = { getPreferredCanvasFormat: () => 'rgba8unorm' };
beforeAll(() => {
	Object.assign(scope, GLOBALS);
	Object.defineProperty(navigator, 'gpu', { value: GPU, configurable: true });
});
afterAll(() => {
	for (const name of Object.keys(GLOBALS)) delete scope[name];
	Reflect.deleteProperty(navigator, 'gpu');
});

/** A device whose pipeline builds when `build` settles, and which records the pass's calls. */
function fakeDevice(build: Promise<unknown>) {
	const calls: string[] = [];
	const device = {
		createShaderModule: () => ({}),
		createRenderPipelineAsync: () => build,
		createTexture: () => ({
			createView: () => ({}),
			destroy: () => calls.push('destroy target'),
		}),
		createCommandEncoder: () => ({
			beginRenderPass: () => ({
				setPipeline: () => calls.push('set pipeline'),
				draw: (count: number) => calls.push(`draw ${count}`),
				end: () => calls.push('end'),
			}),
			finish: () => ({}),
		}),
		queue: { submit: () => calls.push('submit') },
	};
	return { device: device as unknown as GPUDevice, calls };
}

describe('the first pass on a device', () => {
	it('holds frames until its pipeline is built, then draws one point once', async () => {
		let built: (pipeline: unknown) => void = () => {};
		const { device, calls } = fakeDevice(new Promise((resolve) => (built = resolve)));
		const pass = new FirstPass(device);
		expect(pass.ready).toBe(false);
		pass.draw();
		expect(calls).toEqual([]);
		built({});
		await pass.built;
		expect(pass.ready).toBe(true);
		pass.draw();
		pass.draw();
		expect(calls).toEqual(['set pipeline', 'draw 1', 'end', 'submit', 'destroy target']);
		expect(pass.ready).toBe(true);
	});

	it('holds no frame when its pipeline fails to build, as on a lost device', async () => {
		const { device, calls } = fakeDevice(Promise.reject(new Error('lost')));
		const pass = new FirstPass(device);
		await pass.built;
		expect(pass.ready).toBe(true);
		pass.draw();
		expect(calls).toEqual([]);
	});

	it("is drawn by the scene renderer before the device's first frame, which waits for its pipeline", async () => {
		const scene = sceneRenderer();
		expect(scene.renderer.prepare(FRAME)).toBe(false);
		scene.build();
		await settle();
		expect(scene.renderer.prepare(FRAME)).toBe(true);
		scene.renderer.drawFrame({ frame: FRAME } as never, RECORDER);
		scene.renderer.drawFrame({ frame: FRAME } as never, RECORDER);
		expect(scene.log).toEqual(['first pass', 'submit', 'frame', 'submit', 'frame', 'submit']);
	});

	it("is drawn by the scene renderer before the device's first capture", async () => {
		const scene = sceneRenderer();
		Atomics.store(controlViews(scene.control).slots, Slot.FramesTaken, FRAME);
		const capture = scene.renderer.capture({ frame: FRAME } as never);
		scene.build();
		await capture;
		expect(scene.log.slice(0, 3)).toEqual(['first pass', 'submit', 'frame']);
	});
});

const FRAME = 2;
const RECORDER = { figures: undefined, addPhase() {}, count() {} } as unknown as FrameRecorder;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A WebGPU scene renderer on a fake device whose first pass builds when `build` is called. Frame
 * 2's list clears a buffer, and the log names each submit, the first pass's draw and the frame's
 * clear, in order.
 */
function sceneRenderer() {
	const log: string[] = [];
	let build: () => void = () => {};
	const firstPipeline = {};
	const pipeline = { getBindGroupLayout: () => ({}) };
	const texture = (descriptor: GPUTextureDescriptor) => {
		const [width, height] = descriptor.size as number[];
		return {
			width,
			height,
			format: descriptor.format,
			createView: () => ({}),
			destroy() {},
		};
	};
	const device = {
		lost: new Promise(() => {}),
		createBindGroupLayout: () => ({}),
		createPipelineLayout: () => ({}),
		createShaderModule: () => ({}),
		createSampler: () => ({}),
		createBindGroup: () => ({}),
		createRenderPipeline: () => pipeline,
		createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
			if (descriptor.primitive?.topology !== 'point-list') return Promise.resolve(pipeline);
			return new Promise((resolve) => {
				build = () => resolve(firstPipeline);
			});
		},
		createTexture: texture,
		createBuffer: ({ size }: GPUBufferDescriptor) => ({
			size,
			destroy() {},
			mapAsync: () => Promise.resolve(),
			getMappedRange: () => new ArrayBuffer(size),
			unmap() {},
		}),
		createCommandEncoder: () => ({
			beginRenderPass: () => ({
				setPipeline: (set: unknown) => set === firstPipeline && log.push('first pass'),
				draw() {},
				end() {},
			}),
			clearBuffer: () => log.push('frame'),
			copyTextureToBuffer() {},
			finish: () => ({}),
		}),
		pushErrorScope() {},
		popErrorScope: () => Promise.resolve(null),
		queue: { submit: () => log.push('submit') },
		destroy() {},
	};
	const context = {
		configure() {},
		unconfigure() {},
		getCurrentTexture: () => texture({ size: [4, 4], format: 'rgba8unorm', usage: 0 }),
	};
	const canvas = { width: 4, height: 4, getContext: () => context };
	const memory = new WebAssembly.Memory({ initial: 1 });
	const control = createControlBuffer(false);
	// Frame 2's list, at byte 1024 of engine memory: make a buffer, then clear it.
	const list = [
		G.OP_CREATE_BUFFER | (4 << 8),
		1,
		256,
		G.BUFFER_USAGE_COPY_DST,
		G.OP_CLEAR_BUFFER | (4 << 8),
		1,
		0,
		256,
	];
	new Uint32Array(memory.buffer, 1024, list.length).set(list);
	const { slots } = controlViews(control);
	slots[Slot.DrawListAddress0] = 1024;
	slots[Slot.DrawListWords0] = list.length;
	const shader = {
		permutation: 0,
		wgsl: {
			source: 'a shader',
			pipelines: new Proxy({}, { get: () => ({ vertex: 'vs', fragment: 'fs' }) }),
		},
		glsl: null,
	};
	const shaders = {
		shaders: new Proxy({}, { get: () => ({ main: shader }) }) as unknown as DeviceShaders,
		onPreloaded() {},
	} as unknown as DeviceShaderSet;
	const renderer = webgpuRenderer(
		{ tier: 'webgpu', device: device as unknown as GPUDevice },
		canvas as never,
		{
			tier: 'webgpu',
			scene: { memory, control },
			device: { transparent: false, skinning: 0 },
		} as never,
		shaders,
	);
	return { renderer, log, control, build: () => build() };
}
