import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SHADING_CUSTOM_FIRST } from '../../generated/core';
import * as G from '../../generated/gpu';
import type { DeviceShaders } from '../../generated/shaders';
import { ImageTable } from '../../shared/images';
import { MemoryViews } from '../../shared/memory-views';
import { ReadSink } from '../readback';
import { WebGPUBackend } from './backend';
import { needsOwnArguments } from './indirect-arguments';

const scope = globalThis as Record<string, unknown>;
const GLOBALS = {
	GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
	GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8 },
	GPUMapMode: { READ: 1, WRITE: 2 },
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
 * makes, in order with each submit. A buffer maps when its `mapping` settles, and its mapped bytes
 * count up from its offset.
 */
function fakeDevice() {
	const log: string[] = [];
	const passes: GPURenderPassDescriptor[] = [];
	const textures: { sampleCount: number; destroyed: boolean }[] = [];
	const buffers: {
		size: number;
		usage: number;
		destroyed: boolean;
		mapping: Promise<undefined>;
		unmap(): void;
	}[] = [];
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
	const computePass = {
		setPipeline() {},
		setBindGroup() {},
		dispatchWorkgroups(x: number, y: number, z: number) {
			log.push(`dispatch ${x} x ${y} x ${z}`);
		},
		end() {
			log.push('end compute pass');
		},
	};
	const pipeline = { getBindGroupLayout: () => ({}) };
	const device = {
		createBindGroupLayout: () => ({}),
		createPipelineLayout: () => ({}),
		createShaderModule: () => ({}),
		createSampler: () => ({}),
		createBindGroup: () => ({}),
		createComputePipeline() {
			log.push('build compute');
			return pipeline;
		},
		createComputePipelineAsync() {
			log.push('background build compute');
			return Promise.resolve(pipeline);
		},
		createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
			log.push(`build ${descriptor.fragment?.targets[0]?.format}`);
			return pipeline;
		},
		createRenderPipelineAsync(descriptor: GPURenderPipelineDescriptor) {
			log.push(`background build ${descriptor.fragment?.targets[0]?.format}`);
			return Promise.resolve(pipeline);
		},
		createTexture(descriptor: GPUTextureDescriptor) {
			const [width, height] = descriptor.size as number[];
			const texture = {
				width,
				height,
				format: descriptor.format,
				dimension: descriptor.dimension,
				mipLevelCount: descriptor.mipLevelCount,
				sampleCount: descriptor.sampleCount ?? 1,
				usage: descriptor.usage,
				destroyed: false,
				createView: () => ({ of: texture }),
				destroy() {
					texture.destroyed = true;
				},
			};
			textures.push(texture);
			return texture;
		},
		createBuffer({ size, usage }: GPUBufferDescriptor) {
			const buffer = {
				size,
				usage,
				destroyed: false,
				mapping: Promise.resolve(undefined),
				destroy() {
					buffer.destroyed = true;
					log.push(`destroy ${size}`);
				},
				mapAsync(_mode: number, offset: number, length: number) {
					log.push(`map ${name(buffer)} at ${offset}, ${length} bytes`);
					return buffer.mapping;
				},
				getMappedRange: (offset: number, length: number) =>
					Uint8Array.from({ length }, (_, i) => (offset + i) & 0xff).buffer,
				unmap() {
					log.push(`unmap ${name(buffer)}`);
				},
			};
			buffers.push(buffer);
			return buffer;
		},
		createCommandEncoder: () => ({
			beginComputePass() {
				log.push('begin compute pass');
				return computePass;
			},
			beginRenderPass(descriptor: GPURenderPassDescriptor) {
				// The backend fills one descriptor again for each pass, so the log keeps copies.
				const colors = [...descriptor.colorAttachments].map((color) => ({ ...color }));
				passes.push({ ...descriptor, colorAttachments: colors as GPURenderPassColorAttachment[] });
				log.push('begin pass');
				return pass;
			},
			copyBufferToBuffer(source: unknown, offset: number, target: unknown) {
				log.push(`copy ${name(source)} at ${offset} to ${name(target)}`);
			},
			copyTextureToBuffer(
				_source: unknown,
				{ buffer, offset, bytesPerRow, rowsPerImage }: GPUTexelCopyBufferInfo,
				{ width, height }: { width: number; height: number },
			) {
				log.push(
					`copy ${width} x ${height} to ${name(buffer)} at ${offset}, ${bytesPerRow} per row, ${rowsPerImage} rows`,
				);
			},
			copyBufferToTexture() {},
			finish: () => ({}),
		}),
		queue: {
			submit() {
				log.push('submit');
			},
		},
	};
	return { device: device as unknown as GPUDevice, log, buffers, passes, textures };
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

/** Replays a draw list from `from`, after the pipelines that its front creates. */
function replayFrom(backend: WebGPUBackend, words: Uint32Array, from: number): void {
	backend.replay(words, new Float32Array(words.buffer), from, words.length, new ArrayBuffer(0));
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

	it('skips a compute pass’s dispatches while its pipeline is pending, and runs them once it is built', async () => {
		const { device, log } = fakeDevice();
		const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		await settle();
		log.length = 0;
		// A compute pass whose pipeline the list's front creates: it builds in the background, so the
		// pass sets a pipeline that is still pending and dispatches into nothing.
		const words = drawList(
			[G.OP_CREATE_COMPUTE_PIPELINE, 1, G.TEMPLATE_SKIN, 0],
			[G.OP_BEGIN_COMPUTE_PASS],
			[G.OP_SET_COMPUTE_PIPELINE, 1],
			[G.OP_DISPATCH, 2, 1, 1],
			[G.OP_END_COMPUTE_PASS],
		);
		const from = backend.prepare(words, 0, words.length);
		replayFrom(backend, words, from);
		expect(log.filter((entry) => entry.startsWith('dispatch'))).toEqual([]);
		expect(backend.counts.dispatches).toBe(0);
		await settle();
		replayFrom(backend, words, from);
		expect(log.filter((entry) => entry.startsWith('dispatch'))).toEqual(['dispatch 2 x 1 x 1']);
		expect(backend.counts.dispatches).toBe(1);
	});

	it('skips an add-on compute pass’s dispatches while its pipeline is pending, as it does a built-in pass’s', async () => {
		const { device, log } = fakeDevice();
		// An add-on's pass brings a whole WGSL module of its own, under a template id of its own.
		const images = new ImageTable();
		images.setShader(SHADING_CUSTOM_FIRST, {
			kind: 'compute',
			variants: {
				compute: {
					permutation: 0,
					wgsl: { source: '@compute @workgroup_size(1) fn main() {}', pipelines: {} },
					glsl: null,
				},
			},
			locations: [],
			textures: 0,
		});
		const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS, undefined, images);
		await settle();
		log.length = 0;
		const words = drawList(
			[G.OP_CREATE_COMPUTE_PIPELINE, 1, SHADING_CUSTOM_FIRST, G.FORMAT_RGBA16_FLOAT],
			[G.OP_BEGIN_COMPUTE_PASS],
			[G.OP_SET_COMPUTE_PIPELINE, 1],
			[G.OP_DISPATCH, 3, 1, 1],
			[G.OP_END_COMPUTE_PASS],
		);
		const from = backend.prepare(words, 0, words.length);
		replayFrom(backend, words, from);
		expect(log.filter((entry) => entry.startsWith('dispatch'))).toEqual([]);
		expect(backend.counts.dispatches).toBe(0);
		await settle();
		replayFrom(backend, words, from);
		expect(log.filter((entry) => entry.startsWith('dispatch'))).toEqual(['dispatch 3 x 1 x 1']);
		expect(backend.counts.dispatches).toBe(1);
	});

	it('draws a capture of a frame that resolves into the canvas into color targets of its own', () => {
		const { device, passes, textures } = fakeDevice();
		const canvas = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: 0 });
		const context = { getCurrentTexture: () => canvas } as unknown as GPUCanvasContext;
		const backend = new WebGPUBackend(device, context, 'rgba8unorm', SHADERS);
		const multisampled: [number, ...number[]] = [
			G.OP_CREATE_TEXTURE,
			...[3, 64, 64, 1, G.FORMAT_RGBA8_UNORM, G.TEXTURE_USAGE_RENDER_ATTACHMENT, 4, 1, G.VIEW_2D],
		];
		// The scene's multisampled color resolves into the canvas, id 0.
		const frame = drawList(
			[G.OP_BEGIN_RENDER_PASS, 3, 0, G.NO_TARGET, 0, 0, 0, 0, G.PASS_CLEAR_COLOR],
			[G.OP_END_RENDER_PASS],
		);
		replay(backend, drawList(multisampled));
		replay(backend, frame);
		backend.canvasTarget = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: 0 });
		replay(backend, frame);
		replay(backend, frame);
		backend.endCapture();
		replay(backend, frame);
		const drawn = passes.map((pass) => {
			const [color] = pass.colorAttachments as unknown as { view: { of: never } }[];
			return color ? textures.indexOf(color.view.of) : -1;
		});
		const scene = textures.findIndex((texture) => texture.sampleCount === 4);
		const standIn = textures.findLastIndex((texture) => texture.sampleCount === 4);
		expect(standIn).not.toBe(scene);
		expect(drawn).toEqual([scene, standIn, standIn, scene]);
		expect(textures[standIn]?.destroyed).toBe(true);
		expect(textures[scene]?.destroyed).toBe(false);
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
		// Each copy passes through a buffer of its own, and the smaller one goes once its copies
		// are submitted, because the device may still hold them.
		expect(events).toEqual([
			'copy 8 x 8 to buffer 0 at 0, 256 per row, 8 rows',
			'copy 32 x 32 to buffer 1 at 0, 256 per row, 32 rows',
			'submit',
			`destroy ${256 * 8}`,
		]);
		// The buffer that stays counts as GPU memory, with its rows padded to 256 bytes, and the
		// one destroyed no longer does.
		expect(backend.gpuMemory.bytes[1]).toBe(256 * 32);
	});

	it('keeps a running total of the GPU memory that its textures and buffers take', () => {
		const { device, textures } = fakeDevice();
		const canvas = device.createTexture({ size: [64, 64], format: 'rgba8unorm', usage: 0 });
		const context = { getCurrentTexture: () => canvas } as unknown as GPUCanvasContext;
		const backend = new WebGPUBackend(device, context, 'rgba8unorm', SHADERS);
		const [textureBytes, bufferBytes] = backend.gpuMemory.bytes;
		expect([textureBytes, bufferBytes]).toEqual([0, 0]);
		const target = G.TEXTURE_USAGE_RENDER_ATTACHMENT;
		replay(
			backend,
			drawList(
				[G.OP_CREATE_BUFFER, 1, 1000, G.BUFFER_USAGE_VERTEX],
				[G.OP_CREATE_BUFFER, 2, 512, G.BUFFER_USAGE_UNIFORM],
				// 64 x 64 with its levels of 32 x 32 and 16 x 16, in 2 layers.
				texture(3, 64, 2, 3, G.VIEW_2D_ARRAY),
				[G.OP_CREATE_TEXTURE, 4, 64, 64, 1, G.FORMAT_RGBA8_UNORM, target, 4, 1, G.VIEW_2D],
				[G.OP_CREATE_TEXTURE, 5, 128, 128, 1, G.FORMAT_DEPTH24_PLUS, target, 1, 1, G.VIEW_2D],
				[G.OP_CREATE_TEXTURE_VIEW, 6, 3, 0, 1],
			),
		);
		const layered = 2 * (64 * 64 + 32 * 32 + 16 * 16) * 4;
		const multisampled = 64 * 64 * 4 * 4;
		const depth = 128 * 128 * 4;
		expect([...backend.gpuMemory.bytes]).toEqual([layered + multisampled + depth, 1512]);
		// A buffer made again under its id replaces the old one's bytes, and a destroyed one's go.
		replay(
			backend,
			drawList(
				[G.OP_CREATE_BUFFER, 1, 4000, G.BUFFER_USAGE_VERTEX],
				[G.OP_DESTROY_BUFFER, 2],
				[G.OP_DESTROY_TEXTURE, 5],
				[G.OP_DESTROY_TEXTURE, 6],
			),
		);
		expect([...backend.gpuMemory.bytes]).toEqual([layered + multisampled, 4000]);
		// A capture's stand-in for a target that resolved into the canvas counts while it lasts.
		const frame = drawList(
			[G.OP_BEGIN_RENDER_PASS, 4, 0, G.NO_TARGET, 0, 0, 0, 0, G.PASS_CLEAR_COLOR],
			[G.OP_END_RENDER_PASS],
		);
		replay(backend, frame);
		backend.canvasTarget = canvas;
		replay(backend, frame);
		expect(backend.gpuMemory.bytes[0]).toBe(layered + 2 * multisampled);
		backend.endCapture();
		expect(backend.gpuMemory.bytes[0]).toBe(layered + multisampled);
		backend.destroy();
		expect([...backend.gpuMemory.bytes]).toEqual([0, 0]);
		// Every texture but the canvas, the first one made, is gone.
		expect(textures.slice(1).filter((made) => !made.destroyed)).toEqual([]);
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
		expect(usage).toBe(INDIRECT | G.BUFFER_USAGE_COPY_SRC);
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

	it('reads a copied box into engine memory once the frame is submitted, and raises its slot after the unmap', async () => {
		const { device, log, buffers } = fakeDevice();
		const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', SHADERS);
		const memory = new WebAssembly.Memory({ initial: 1 });
		const slots = new Int32Array(8);
		backend.readSink = new ReadSink(new MemoryViews(memory), slots);
		const ids = G.TEXTURE_USAGE_RENDER_ATTACHMENT | G.TEXTURE_USAGE_COPY_SRC;
		replay(
			backend,
			drawList(
				[G.OP_CREATE_TEXTURE, 1, 8, 8, 1, G.FORMAT_RGBA32_UINT, ids, 1, 1, G.VIEW_2D],
				[G.OP_CREATE_BUFFER, 2, 1024, G.BUFFER_USAGE_MAP_READ | G.BUFFER_USAGE_COPY_DST],
			),
		);
		const read = buffers.length - 1;
		const buffer = buffers[read];
		if (!buffer) throw new Error('no read buffer');
		// The slot tells the sketch thread that it may use the buffer again, so it rises after the unmap.
		let slotAtUnmap = -1;
		const { unmap } = buffer;
		buffer.unmap = () => {
			slotAtUnmap = slots[5] as number;
			unmap();
		};
		log.length = 0;
		// Two rows of three texels from (2, 4), 256 bytes apart, read into engine memory at 64.
		const frame = drawList(
			[G.OP_COPY_TEXTURE_TO_BUFFER, 1, 0, 2, 4, 0, 2, 0, 256, 2, 3, 2],
			[G.OP_READ_BUFFER, 2, 0, 304, 64, 5],
		);
		replay(backend, frame);
		expect(log).toEqual([
			`copy 3 x 2 to buffer ${read} at 0, 256 per row, 2 rows`,
			'submit',
			`map buffer ${read} at 0, 304 bytes`,
		]);
		expect(slots[5]).toBe(0);
		await settle();
		const bytes = new Uint8Array(memory.buffer, 64, 304);
		expect([...bytes]).toEqual(Array.from({ length: 304 }, (_, i) => i & 0xff));
		expect(slots[5]).toBe(1);
		expect(slotAtUnmap).toBe(0);
		expect(log.at(-1)).toBe(`unmap buffer ${read}`);

		// A capture replays the frame that the loop drew already: its copy and read do not run again.
		log.length = 0;
		backend.canvasTarget = device.createTexture({ size: [8, 8], format: 'rgba8unorm', usage: 0 });
		replay(backend, frame);
		backend.endCapture();
		await settle();
		expect(log.filter((entry) => !entry.startsWith('destroy'))).toEqual([]);
		expect(slots[5]).toBe(1);

		// A buffer destroyed before its read maps drops the read, which never maps.
		replay(backend, drawList([G.OP_READ_BUFFER, 2, 0, 16, 64, 5], [G.OP_DESTROY_BUFFER, 2]));
		await settle();
		expect(log.filter((entry) => entry.startsWith('map'))).toEqual([]);
		expect(slots[5]).toBe(1);

		// A buffer destroyed during its map drops the read too: its slot never rises.
		replay(
			backend,
			drawList([G.OP_CREATE_BUFFER, 3, 256, G.BUFFER_USAGE_MAP_READ | G.BUFFER_USAGE_COPY_DST]),
		);
		const later = buffers.at(-1);
		if (!later) throw new Error('no read buffer');
		later.mapping = Promise.reject(new DOMException('destroyed', 'AbortError'));
		replay(backend, drawList([G.OP_READ_BUFFER, 3, 0, 16, 64, 5]));
		replay(backend, drawList([G.OP_DESTROY_BUFFER, 3]));
		await settle();
		expect(slots[5]).toBe(1);
	});
});
