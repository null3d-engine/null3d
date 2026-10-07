import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as G from '../../generated/gpu';
import type { DeviceShaders } from '../../generated/shaders';
import { WebGPUBackend } from './backend';
import { needsOwnArguments } from './indirect-arguments';

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
const INDIRECT = G.BUFFER_USAGE_INDIRECT | G.BUFFER_USAGE_STORAGE;
const SAFARI_26 =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15';
const MAC_CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

/**
 * A device that records the pipelines it builds, at once or in the background, and the buffers it
 * makes, in order with each submit.
 */
function fakeDevice() {
	const log: string[] = [];
	const buffers: { size: number; usage: number; destroyed: boolean }[] = [];
	const name = (buffer: unknown) => `buffer ${buffers.indexOf(buffer as (typeof buffers)[number])}`;
	const pass = {
		setPipeline() {},
		setBindGroup() {},
		draw() {},
		drawIndexedIndirect(buffer: unknown, offset: number) {
			log.push(`draw from ${name(buffer)} at ${offset}`);
		},
		end() {
			log.push('end pass');
		},
	};
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
		createBuffer({ size, usage }: GPUBufferDescriptor) {
			const buffer = {
				size,
				usage,
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
			beginRenderPass() {
				log.push('begin pass');
				return pass;
			},
			copyBufferToBuffer(source: unknown, offset: number, target: unknown) {
				log.push(`copy ${name(source)} at ${offset} to ${name(target)}`);
			},
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

	it('makes no layout with storage buffers in vertex shaders at the start, which compatibility mode refuses', () => {
		const { device } = fakeDevice();
		const made: string[] = [];
		const vertexStorage = (entry: GPUBindGroupLayoutEntry) =>
			(entry.visibility & GPUShaderStage.VERTEX) !== 0 &&
			entry.buffer?.type !== undefined &&
			entry.buffer.type !== 'uniform';
		device.createBindGroupLayout = (descriptor: GPUBindGroupLayoutDescriptor) => {
			const entries = [...descriptor.entries];
			if (entries.some(vertexStorage))
				throw new Error(`${descriptor.label}: no storage buffers in the vertex stage`);
			made.push(descriptor.label ?? '');
			return {} as GPUBindGroupLayout;
		};
		new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		expect(made.length).toBeGreaterThan(0);
		expect(made).not.toContain('instance index');
	});

	it('binds at most 8 storage buffers to each shader stage of a pipeline, the default limit', () => {
		const { device } = fakeDevice();
		const STAGES = { vertex: 1, fragment: 2, compute: 4 };
		const storage = (layout: GPUBindGroupLayoutDescriptor, stage: number) =>
			[...layout.entries].filter(
				(entry) =>
					(entry.visibility & stage) !== 0 &&
					entry.buffer?.type !== undefined &&
					entry.buffer.type !== 'uniform',
			).length;
		const pipelineLayouts: GPUBindGroupLayoutDescriptor[][] = [];
		device.createBindGroupLayout = (descriptor: GPUBindGroupLayoutDescriptor) =>
			descriptor as unknown as GPUBindGroupLayout;
		device.createPipelineLayout = (descriptor: GPUPipelineLayoutDescriptor) => {
			pipelineLayouts.push([
				...descriptor.bindGroupLayouts,
			] as unknown as GPUBindGroupLayoutDescriptor[]);
			return {} as GPUPipelineLayout;
		};
		new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		const cull = pipelineLayouts.find((groups) => groups.some((g) => g.label === 'cull'));
		// Culling sits at the limit: the scene's tables, the compacted instances, which hold the
		// index entries too, the indirect draws, which hold occlusion culling's history too, and the
		// depth pyramid.
		expect(cull?.reduce((sum, group) => sum + storage(group, STAGES.compute), 0)).toBe(8);
		for (const groups of pipelineLayouts)
			for (const [name, stage] of Object.entries(STAGES)) {
				const count = groups.reduce((sum, group) => sum + storage(group, stage), 0);
				const labels = groups.map((group) => group.label).join(', ');
				expect(count, `${name} stage of ${labels}`).toBeLessThanOrEqual(8);
			}
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

	/** A backend in a browser with `userAgent`, which replays a list of indirect draws. */
	function drawIndirect(userAgent: string) {
		const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
		const { device, log, buffers } = fakeDevice();
		let backend: WebGPUBackend;
		try {
			backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		} finally {
			if (real) Object.defineProperty(globalThis, 'navigator', real);
		}
		backend.canvasTarget = { createView: () => ({}) } as unknown as GPUTexture;
		const begin: [number, ...number[]] = [
			G.OP_BEGIN_RENDER_PASS,
			...[0, G.NO_TARGET, G.NO_TARGET, 0, 0, 0, 0, 0, G.PASS_CLEAR_COLOR],
		];
		replay(
			backend,
			drawList(
				[G.OP_CREATE_BUFFER, 1, 40, INDIRECT],
				[G.OP_BEGIN_BUNDLE, 5, G.FORMAT_CANVAS, G.FORMAT_NONE, 1],
				[G.OP_DRAW_INDEXED_INDIRECT, 1, 0],
				[G.OP_END_BUNDLE],
				begin,
				[G.OP_EXECUTE_BUNDLES, 1, 5],
				[G.OP_DRAW_INDEXED_INDIRECT, 1, 20],
				[G.OP_END_RENDER_PASS],
				// A pass with one indirect draw has nothing for it to race with, and copies nothing.
				begin,
				[G.OP_DRAW_INDEXED_INDIRECT, 1, 20],
				[G.OP_END_RENDER_PASS],
			),
		);
		return {
			usage: buffers[0]?.usage,
			log: log.filter((entry) => !entry.startsWith('background')),
		};
	}

	it('copies the arguments of each indirect draw of a pass into a buffer of its own in Safari 26', () => {
		const { usage, log } = drawIndirect(SAFARI_26);
		expect(usage).toBe(INDIRECT | G.BUFFER_USAGE_COPY_SRC);
		expect(log).toEqual([
			'copy buffer 0 at 0 to buffer 1',
			'copy buffer 0 at 20 to buffer 2',
			'begin pass',
			'draw from buffer 1 at 0',
			'draw from buffer 2 at 0',
			'end pass',
			'begin pass',
			'draw from buffer 0 at 20',
			'end pass',
			'submit',
		]);
	});

	it('draws straight from the shared buffer of arguments in other browsers', () => {
		const { usage, log } = drawIndirect(MAC_CHROME);
		expect(usage).toBe(INDIRECT);
		expect(log).toEqual([
			'begin pass',
			'draw from buffer 0 at 0',
			'draw from buffer 0 at 20',
			'end pass',
			'begin pass',
			'draw from buffer 0 at 20',
			'end pass',
			'submit',
		]);
	});

	it("gives each draw its own arguments in every browser on Apple's WebKit, and in no other", () => {
		const iPhoneChrome =
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1';
		const macFirefox =
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0';
		const androidChrome =
			'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36';
		expect(needsOwnArguments(SAFARI_26)).toBe(true);
		expect(needsOwnArguments(iPhoneChrome)).toBe(true);
		for (const userAgent of [MAC_CHROME, macFirefox, androidChrome, ''])
			expect(needsOwnArguments(userAgent), userAgent).toBe(false);
	});
});
