import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import type { DeviceShaders } from '../../generated/shaders';
import { WebGPUBackend } from './backend';

const scope = globalThis as Record<string, unknown>;
const GLOBALS = {
	GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
	GPUBufferUsage: { MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8 },
	GPUMapMode: { WRITE: 2 },
};
beforeAll(() => Object.assign(scope, GLOBALS));
afterAll(() => {
	for (const name of Object.keys(GLOBALS)) delete scope[name];
});

/** The device's shaders: each one a single build, whose every pipeline has the same entry points. */
const SHADER = {
	main: {
		permutation: 0,
		wgsl: {
			source: 'a shader',
			pipelines: new Proxy({}, { get: () => ({ vertex: 'vs', fragment: 'fs' }) }),
		},
		glsl: null,
	},
};
const SHADERS = new Proxy({}, { get: () => SHADER }) as unknown as DeviceShaders;

/**
 * A device that records the pipelines it builds, at once or in the background, and the buffers it
 * makes, in order with each submit.
 */
function fakeDevice() {
	const log: string[] = [];
	const buffers: { size: number; destroyed: boolean }[] = [];
	const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
	const pipeline = { getBindGroupLayout: () => ({}) };
	const device = {
		createBindGroupLayout: () => ({}),
		createPipelineLayout: () => ({}),
		createShaderModule: () => ({}),
		createSampler: () => ({}),
		createBindGroup: () => ({}),
		createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
			log.push(`build ${descriptor.fragment?.targets[0]?.format}`);
			return pipeline;
		},
		createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
			log.push(`background build ${descriptor.fragment?.targets[0]?.format}`);
			return Promise.resolve(pipeline);
		},
		createTexture(descriptor: GPUTextureDescriptor) {
			return {
				format: descriptor.format,
				dimension: descriptor.dimension,
				mipLevelCount: descriptor.mipLevelCount,
				createView: () => ({}),
				destroy() {},
			};
		},
		createBuffer({ size }: GPUBufferDescriptor) {
			const buffer = {
				size,
				destroyed: false,
				destroy() {
					buffer.destroyed = true;
					log.push(`destroy ${size}`);
				},
			};
			buffers.push(buffer);
			return buffer;
		},
		createCommandEncoder: () => ({
			beginRenderPass: () => pass,
			copyTextureToBuffer() {},
			copyBufferToTexture() {},
			finish: () => ({}),
		}),
		queue: {
			submit() {
				log.push('submit');
			},
		},
	};
	return { device: device as unknown as GPUDevice, log, buffers };
}

/** A draw list of commands, each a code and its operands. */
function drawList(...commands: [number, ...number[]][]): Uint32Array {
	const words: number[] = [];
	for (const [op, ...operands] of commands)
		words.push(op | ((operands.length + 1) << 8), ...operands);
	return Uint32Array.from(words);
}

function replay(backend: WebGPUBackend, words: Uint32Array): void {
	backend.replay(words, new Float32Array(words.buffer), 0, words.length, new ArrayBuffer(0));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A texture's operands: id, size, layers, format, usage, samples, mip levels and view dimension. */
function texture(id: number, size: number, layers: number, mips: number, view: number) {
	const usage =
		G.TEXTURE_USAGE_COPY_SRC |
		G.TEXTURE_USAGE_COPY_DST |
		G.TEXTURE_USAGE_TEXTURE_BINDING |
		G.TEXTURE_USAGE_RENDER_ATTACHMENT;
	return [
		G.OP_CREATE_TEXTURE,
		id,
		size,
		size,
		layers,
		G.FORMAT_RGBA8_UNORM,
		usage,
		1,
		mips,
		view,
	] as [number, ...number[]];
}

describe('WebGPUBackend', () => {
	it('builds the mip level pipelines in the background when it starts, and the first upload uses them', async () => {
		const { device, log } = fakeDevice();
		const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		expect(log).toEqual(['background build rgba8unorm', 'background build rgba8unorm-srgb']);
		await settle();
		replay(backend, drawList(texture(1, 64, 1, 3, G.VIEW_2D_ARRAY), [G.OP_GENERATE_MIPMAPS, 1, 0]));
		expect(log.filter((entry) => entry.startsWith('build'))).toEqual([]);
	});

	it('destroys a copy buffer that a larger one replaced, once its copies are submitted', () => {
		const { device, log } = fakeDevice();
		const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		// Copies of 2D layers into 3D slices pass through the buffer; the second copy needs more.
		const copy = (size: number): [number, ...number[]] => [
			G.OP_COPY_TEXTURE_TO_TEXTURE,
			...[1, 0, 0, 0, 0],
			...[2, 0, 0, 0, 0],
			size,
			size,
			1,
		];
		replay(
			backend,
			drawList(
				texture(1, 32, 1, 1, G.VIEW_2D_ARRAY),
				texture(2, 32, 4, 1, G.VIEW_3D),
				copy(8),
				copy(32),
			),
		);
		const events = log.filter((entry) => !entry.startsWith('background'));
		expect(events).toEqual(['submit', `destroy ${256 * 8}`]);
	});
});
