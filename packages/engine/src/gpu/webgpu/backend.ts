// The WebGPU backend: owns every GPU object in tables indexed by the core's resource ids, and
// replays binary draw lists into WebGPU calls. The replay loop reads 32-bit words from a view on
// engine memory and allocates nothing per command, except when a command creates a GPU object.

import * as G from '../../generated/gpu';
import { Pipelines } from './pipelines';

const TEXTURE_FORMATS: (GPUTextureFormat | undefined)[] = [];
TEXTURE_FORMATS[G.FORMAT_RGBA8_UNORM] = 'rgba8unorm';
TEXTURE_FORMATS[G.FORMAT_BGRA8_UNORM] = 'bgra8unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA16_FLOAT] = 'rgba16float';
TEXTURE_FORMATS[G.FORMAT_DEPTH24_PLUS] = 'depth24plus';
TEXTURE_FORMATS[G.FORMAT_DEPTH32_FLOAT] = 'depth32float';

export class WebGPUBackend {
	private readonly buffers: (GPUBuffer | undefined)[] = [];
	private readonly textures: (GPUTexture | undefined)[] = [];
	private readonly views: (GPUTextureView | undefined)[] = [];
	private readonly renderPipelines: (GPURenderPipeline | undefined)[] = [];
	private readonly computePipelines: (GPUComputePipeline | undefined)[] = [];
	private readonly bindGroups: (GPUBindGroup | undefined)[] = [];
	private readonly bundles: (GPURenderBundle | undefined)[] = [];
	private readonly bundleList: GPURenderBundle[] = [];
	private readonly dynamicOffsets: number[] = [];
	private readonly pipelines: Pipelines;
	private readonly canvasFormat: GPUTextureFormat;

	constructor(
		readonly device: GPUDevice,
		private readonly context: GPUCanvasContext | undefined,
		canvasFormat: GPUTextureFormat,
	) {
		this.canvasFormat = canvasFormat;
		this.pipelines = new Pipelines(device);
	}

	private format(code: number): GPUTextureFormat | undefined {
		if (code === G.FORMAT_NONE) return undefined;
		if (code === G.FORMAT_CANVAS) return this.canvasFormat;
		const format = TEXTURE_FORMATS[code];
		if (!format) throw new Error(`unknown texture format code ${code}`);
		return format;
	}

	private need<T>(table: (T | undefined)[], id: number, what: string): T {
		const value = table[id];
		if (value === undefined) throw new Error(`draw list names ${what} ${id}, which does not exist`);
		return value;
	}

	/** The texture the canvas shows this frame, or an offscreen target standing in for it. */
	canvasTarget: GPUTexture | undefined;

	private targetView(id: number): GPUTextureView | undefined {
		if (id === G.NO_TARGET) return undefined;
		if (id === 0) {
			const texture = this.canvasTarget ?? this.context?.getCurrentTexture();
			if (!texture) throw new Error('no canvas target to draw into');
			return texture.createView();
		}
		return this.need(this.views, id, 'texture');
	}

	private encoder: GPUCommandEncoder | undefined;

	private commandEncoder(): GPUCommandEncoder {
		if (!this.encoder) this.encoder = this.device.createCommandEncoder();
		return this.encoder;
	}

	/**
	 * Replays the draw list in `words[start, end)`. `floats` views the same memory as `words`, for
	 * float operands; the caller keeps both views and rebuilds them only when engine memory grows.
	 * `memory` is the engine memory that WriteBuffer commands read from.
	 */
	replay(
		words: Uint32Array,
		floats: Float32Array,
		start: number,
		end: number,
		memory: ArrayBufferLike,
	): void {
		const device = this.device;
		let pass: GPURenderPassEncoder | undefined;
		let computePass: GPUComputePassEncoder | undefined;
		let bundleEncoder: GPURenderBundleEncoder | undefined;
		let bundleId = 0;

		for (let i = start; i < end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			const length = header >>> 8;
			if (length === 0 || i + length > end) throw new Error(`draw list is truncated at word ${i}`);
			const a = i + 1;
			const draw = bundleEncoder ?? pass;
			switch (op) {
				case G.OP_CREATE_BUFFER:
					this.buffers[words[a] as number]?.destroy();
					this.buffers[words[a] as number] = device.createBuffer({
						size: words[a + 1] as number,
						usage: words[a + 2] as number,
					});
					break;
				case G.OP_WRITE_BUFFER:
					device.queue.writeBuffer(
						this.need(this.buffers, words[a] as number, 'buffer'),
						words[a + 1] as number,
						memory,
						words[a + 2] as number,
						words[a + 3] as number,
					);
					break;
				case G.OP_DESTROY_BUFFER:
					this.buffers[words[a] as number]?.destroy();
					this.buffers[words[a] as number] = undefined;
					break;
				case G.OP_CREATE_TEXTURE: {
					const id = words[a] as number;
					this.textures[id]?.destroy();
					const texture = device.createTexture({
						size: [words[a + 1] as number, words[a + 2] as number, words[a + 3] as number],
						format: this.format(words[a + 4] as number) as GPUTextureFormat,
						usage: words[a + 5] as number,
						sampleCount: words[a + 6] as number,
						mipLevelCount: words[a + 7] as number,
					});
					this.textures[id] = texture;
					this.views[id] = texture.createView();
					break;
				}
				case G.OP_DESTROY_TEXTURE:
					this.textures[words[a] as number]?.destroy();
					this.textures[words[a] as number] = undefined;
					this.views[words[a] as number] = undefined;
					break;
				case G.OP_CREATE_RENDER_PIPELINE:
					this.renderPipelines[words[a] as number] = this.pipelines.render(
						words[a + 1] as number,
						this.format(words[a + 3] as number) as GPUTextureFormat,
						this.format(words[a + 4] as number),
						words[a + 5] as number,
						words[a + 6] as number,
					);
					break;
				case G.OP_CREATE_COMPUTE_PIPELINE:
					this.computePipelines[words[a] as number] = this.pipelines.compute(
						words[a + 1] as number,
					);
					break;
				case G.OP_CREATE_BIND_GROUP: {
					const layout = this.pipelines.layouts[words[a + 1] as number];
					if (!layout) throw new Error(`unknown bind group layout ${words[a + 1]}`);
					const entries: GPUBindGroupEntry[] = [];
					for (let e = 0, at = a + 3; e < (words[a + 2] as number); e++, at += 5) {
						const kind = words[at + 1] as number;
						const id = words[at + 2] as number;
						if (kind !== G.RESOURCE_BUFFER)
							throw new Error(`unsupported bind group resource kind ${kind}`);
						const size = words[at + 4] as number;
						entries.push({
							binding: words[at] as number,
							resource: {
								buffer: this.need(this.buffers, id, 'buffer'),
								offset: words[at + 3] as number,
								size: size === 0 ? undefined : size,
							},
						});
					}
					this.bindGroups[words[a] as number] = device.createBindGroup({ layout, entries });
					break;
				}
				case G.OP_CLEAR_BUFFER:
					this.commandEncoder().clearBuffer(
						this.need(this.buffers, words[a] as number, 'buffer'),
						words[a + 1] as number,
						words[a + 2] as number,
					);
					break;
				case G.OP_BEGIN_RENDER_PASS: {
					const flags = words[a + 8] as number;
					const color = this.targetView(words[a] as number);
					const resolve = this.targetView(words[a + 1] as number);
					const depth = this.targetView(words[a + 2] as number);
					pass = this.commandEncoder().beginRenderPass({
						colorAttachments: color
							? [
									{
										view: color,
										resolveTarget: resolve,
										loadOp: flags & G.PASS_CLEAR_COLOR ? 'clear' : 'load',
										storeOp: flags & G.PASS_STORE_COLOR ? 'store' : 'discard',
										clearValue: {
											r: floats[a + 3] as number,
											g: floats[a + 4] as number,
											b: floats[a + 5] as number,
											a: floats[a + 6] as number,
										},
									},
								]
							: [],
						depthStencilAttachment: depth
							? {
									view: depth,
									depthLoadOp: flags & G.PASS_CLEAR_DEPTH ? 'clear' : 'load',
									depthStoreOp: flags & G.PASS_STORE_DEPTH ? 'store' : 'discard',
									depthClearValue: floats[a + 7] as number,
								}
							: undefined,
					});
					break;
				}
				case G.OP_SET_PIPELINE:
					draw?.setPipeline(this.need(this.renderPipelines, words[a] as number, 'render pipeline'));
					break;
				case G.OP_SET_BIND_GROUP: {
					const count = words[a + 2] as number;
					this.dynamicOffsets.length = count;
					for (let k = 0; k < count; k++) this.dynamicOffsets[k] = words[a + 3 + k] as number;
					const group = this.need(this.bindGroups, words[a + 1] as number, 'bind group');
					if (computePass) computePass.setBindGroup(words[a] as number, group, this.dynamicOffsets);
					else draw?.setBindGroup(words[a] as number, group, this.dynamicOffsets);
					break;
				}
				case G.OP_SET_VERTEX_BUFFER: {
					const size = words[a + 3] as number;
					draw?.setVertexBuffer(
						words[a] as number,
						this.need(this.buffers, words[a + 1] as number, 'buffer'),
						words[a + 2] as number,
						size === 0 ? undefined : size,
					);
					break;
				}
				case G.OP_SET_INDEX_BUFFER: {
					const size = words[a + 3] as number;
					draw?.setIndexBuffer(
						this.need(this.buffers, words[a] as number, 'buffer'),
						words[a + 1] === G.INDEX_FORMAT_UINT32 ? 'uint32' : 'uint16',
						words[a + 2] as number,
						size === 0 ? undefined : size,
					);
					break;
				}
				case G.OP_DRAW:
					draw?.draw(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 3] as number,
					);
					break;
				case G.OP_DRAW_INDEXED:
					draw?.drawIndexed(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						(words[a + 3] as number) | 0,
						words[a + 4] as number,
					);
					break;
				case G.OP_DRAW_INDEXED_INDIRECT:
					draw?.drawIndexedIndirect(
						this.need(this.buffers, words[a] as number, 'buffer'),
						words[a + 1] as number,
					);
					break;
				case G.OP_EXECUTE_BUNDLES: {
					const count = words[a] as number;
					this.bundleList.length = count;
					for (let k = 0; k < count; k++)
						this.bundleList[k] = this.need(this.bundles, words[a + 1 + k] as number, 'bundle');
					pass?.executeBundles(this.bundleList);
					break;
				}
				case G.OP_END_RENDER_PASS:
					pass?.end();
					pass = undefined;
					break;
				case G.OP_BEGIN_BUNDLE: {
					bundleId = words[a] as number;
					const depthFormat = this.format(words[a + 2] as number);
					bundleEncoder = device.createRenderBundleEncoder({
						colorFormats: [this.format(words[a + 1] as number) as GPUTextureFormat],
						depthStencilFormat: depthFormat,
						sampleCount: words[a + 3] as number,
					});
					break;
				}
				case G.OP_END_BUNDLE:
					if (bundleEncoder) this.bundles[bundleId] = bundleEncoder.finish();
					bundleEncoder = undefined;
					break;
				case G.OP_BEGIN_COMPUTE_PASS:
					computePass = this.commandEncoder().beginComputePass();
					break;
				case G.OP_SET_COMPUTE_PIPELINE:
					computePass?.setPipeline(
						this.need(this.computePipelines, words[a] as number, 'compute pipeline'),
					);
					break;
				case G.OP_DISPATCH:
					computePass?.dispatchWorkgroups(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
					);
					break;
				case G.OP_END_COMPUTE_PASS:
					computePass?.end();
					computePass = undefined;
					break;
				case G.OP_COPY_BUFFER_TO_BUFFER:
					this.commandEncoder().copyBufferToBuffer(
						this.need(this.buffers, words[a] as number, 'buffer'),
						words[a + 1] as number,
						this.need(this.buffers, words[a + 2] as number, 'buffer'),
						words[a + 3] as number,
						words[a + 4] as number,
					);
					break;
				case G.OP_SUBMIT:
					if (this.encoder) device.queue.submit([this.encoder.finish()]);
					this.encoder = undefined;
					break;
				default:
					throw new Error(`unknown draw list command ${op} at word ${i}`);
			}
			i += length;
		}
		if (this.encoder) device.queue.submit([this.encoder.finish()]);
		this.encoder = undefined;
	}

	/** A buffer by id, for readback in tests. */
	buffer(id: number): GPUBuffer | undefined {
		return this.buffers[id];
	}

	destroy(): void {
		for (const buffer of this.buffers) buffer?.destroy();
		for (const texture of this.textures) texture?.destroy();
	}
}
