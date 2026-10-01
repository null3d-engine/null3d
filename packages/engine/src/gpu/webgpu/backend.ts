// The WebGPU backend: owns every GPU object in tables indexed by the core's resource ids, and
// replays binary draw lists into WebGPU calls. The replay loop reads 32-bit words from a view on
// engine memory and allocates nothing per command, except when a command creates a GPU object.

import * as G from '../../generated/gpu';
import type { DeviceShaders } from '../../generated/shaders';
import { ImageTable } from '../../shared/images';
import { floatOfBits } from '../float-bits';
import type { GpuTimer } from './gpu-timer';
import { Pipelines, type RenderTemplate } from './pipelines';
import { RenderPassSetup, submitOne, TexelCopySetup } from './reusable';
import { StagingRing } from './staging';
import { UploadRoutes } from './upload-routes';

const TEXTURE_FORMATS: (GPUTextureFormat | undefined)[] = [];
TEXTURE_FORMATS[G.FORMAT_RGBA8_UNORM] = 'rgba8unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA8_UNORM_SRGB] = 'rgba8unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_BGRA8_UNORM] = 'bgra8unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA16_FLOAT] = 'rgba16float';
TEXTURE_FORMATS[G.FORMAT_RG11B10_UFLOAT] = 'rg11b10ufloat';
TEXTURE_FORMATS[G.FORMAT_DEPTH24_PLUS] = 'depth24plus';
TEXTURE_FORMATS[G.FORMAT_DEPTH32_FLOAT] = 'depth32float';
TEXTURE_FORMATS[G.FORMAT_RGBA32_FLOAT] = 'rgba32float';
TEXTURE_FORMATS[G.FORMAT_R32_UINT] = 'r32uint';

const VIEW_DIMENSIONS: (GPUTextureViewDimension | undefined)[] = [];
VIEW_DIMENSIONS[G.VIEW_2D] = '2d';
VIEW_DIMENSIONS[G.VIEW_2D_ARRAY] = '2d-array';

const ADDRESS_MODES: (GPUAddressMode | undefined)[] = [];
ADDRESS_MODES[G.ADDRESS_CLAMP_TO_EDGE] = 'clamp-to-edge';
ADDRESS_MODES[G.ADDRESS_REPEAT] = 'repeat';
ADDRESS_MODES[G.ADDRESS_MIRROR_REPEAT] = 'mirror-repeat';

const FILTERS: (GPUFilterMode | undefined)[] = [];
FILTERS[G.FILTER_NEAREST] = 'nearest';
FILTERS[G.FILTER_LINEAR] = 'linear';

/** Compare functions by code; `COMPARE_NONE` has none, which makes a sampler that reads texels. */
const COMPARE_FUNCTIONS: (GPUCompareFunction | undefined)[] = [];
COMPARE_FUNCTIONS[G.COMPARE_NEVER] = 'never';
COMPARE_FUNCTIONS[G.COMPARE_LESS] = 'less';
COMPARE_FUNCTIONS[G.COMPARE_EQUAL] = 'equal';
COMPARE_FUNCTIONS[G.COMPARE_LESS_EQUAL] = 'less-equal';
COMPARE_FUNCTIONS[G.COMPARE_GREATER] = 'greater';
COMPARE_FUNCTIONS[G.COMPARE_NOT_EQUAL] = 'not-equal';
COMPARE_FUNCTIONS[G.COMPARE_GREATER_EQUAL] = 'greater-equal';
COMPARE_FUNCTIONS[G.COMPARE_ALWAYS] = 'always';

/** Reads a code from a table, and fails with its kind when the table has no entry for it. */
function lookUp<T>(table: (T | undefined)[], code: number, what: string): T {
	const value = table[code];
	if (value === undefined) throw new Error(`unknown ${what} ${code}`);
	return value;
}

export class WebGPUBackend {
	private readonly buffers: (GPUBuffer | undefined)[] = [];
	private readonly textures: (GPUTexture | undefined)[] = [];
	/** Each texture's format code, for the bytes per texel of its writes. */
	private readonly formats: number[] = [];
	/** Each texture's view for bind groups: the whole texture, in the dimension it was made with. */
	private readonly bindingViews: (GPUTextureView | undefined)[] = [];
	/** Each render target's view: a texture of one layer and one mip level, or a view of one. */
	private readonly targetViews: (GPUTextureView | undefined)[] = [];
	private readonly samplers: (GPUSampler | undefined)[] = [];
	/** Images for uploads, by id, which outlive the backend when the drawing thread owns them. */
	private readonly images: ImageTable;
	private readonly ownsImages: boolean;
	/** The sampler that mip levels read the level before them with. */
	private mipSampler: GPUSampler | undefined;
	/** Pipelines by id: null while one builds, and undefined for an id that names none. */
	private readonly renderPipelines: (GPURenderPipeline | null | undefined)[] = [];
	private readonly computePipelines: (GPUComputePipeline | null | undefined)[] = [];
	/** Pipelines that are building, or that wait for their custom material's shader. */
	private builds = 0;
	/**
	 * The operands of each `CreateRenderPipeline` whose custom material's shader has not reached
	 * this thread yet. Each builds once its shader arrives.
	 */
	private readonly parked: Uint32Array[] = [];
	/** Why a pipeline failed to build, which the next replay reports. */
	private buildFailure: string | undefined;
	/** True while the render pass's pipeline is building: its draws draw nothing until it is set again. */
	private skipDraws = false;
	/** True while the compute pass's pipeline is building: its dispatches do nothing. */
	private skipDispatches = false;
	private readonly bindGroups: (GPUBindGroup | undefined)[] = [];
	/**
	 * Each bundle's commands as the draw list recorded them, which `ExecuteBundles` replays into the
	 * render pass. The backend makes no native render bundles: Safari 26 encodes a bundle that holds
	 * an indirect draw again at every execution, which costs its GPU process milliseconds per frame.
	 */
	private readonly bundles: (Uint32Array | undefined)[] = [];
	private readonly pipelines: Pipelines;
	/** Staging buffers for the uploads that writeBuffer copies slowly. */
	private readonly staging: StagingRing;
	private readonly canvasFormat: GPUTextureFormat;
	/** Times the passes of each frame, while the page measures. */
	timer: GpuTimer | undefined;
	/** What the replays since the last reset uploaded, the part that went through staging, and drew. */
	readonly counts = {
		uploadBytes: 0,
		stagedBytes: 0,
		drawCalls: 0,
		dispatches: 0,
		pipelines: 0,
	};
	// Descriptors that every frame fills again, so replay allocates none of its own.
	private readonly renderPass = new RenderPassSetup();
	private readonly computePass: GPUComputePassDescriptor = {};
	private readonly copy = new TexelCopySetup();
	private readonly samplerSetup: GPUSamplerDescriptor = {};

	/**
	 * `shaders` are the WGSL builds that the device loaded (`loadWgslShaders`). `routes` chooses
	 * between writeBuffer and the staging ring for mid-size uploads; by default it times both routes
	 * and takes the faster one. `images` holds the images that uploads read, which the thread that
	 * draws keeps across GPU devices; by default the backend has its own.
	 */
	constructor(
		readonly device: GPUDevice,
		private readonly context: GPUCanvasContext | undefined,
		canvasFormat: GPUTextureFormat,
		shaders: DeviceShaders,
		private readonly routes = new UploadRoutes(),
		images?: ImageTable,
	) {
		this.canvasFormat = canvasFormat;
		this.pipelines = new Pipelines(device, shaders);
		this.staging = new StagingRing(device);
		this.images = images ?? new ImageTable();
		this.ownsImages = !images;
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

	/**
	 * Adds a bind group layout, which `CreateBindGroup` and templates then name by `id`. The id
	 * must be one that no engine layout has.
	 */
	defineLayout(id: number, label: string, entries: GPUBindGroupLayoutEntry[]): void {
		this.pipelines.defineLayout(id, label, entries);
	}

	/**
	 * Adds a render pipeline template, which `CreateRenderPipeline` then builds pipelines from. The
	 * id must be one that no engine template has.
	 */
	defineTemplate(id: number, template: RenderTemplate): void {
		this.pipelines.defineTemplate(id, template);
	}

	/** Hands the backend an image for `UploadImage` commands to copy from, under the draw list's id. */
	setImage(id: number, image: ImageBitmap): void {
		this.images.set(id, image);
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
		return this.need(this.targetViews, id, 'render target');
	}

	/**
	 * Creates a texture with a view for bind groups, in the view dimension that compatibility mode
	 * fixes at creation, and a view to draw into when it has one layer and one mip level.
	 */
	private createTexture(words: Uint32Array, a: number): void {
		const id = words[a] as number;
		this.releaseTexture(id);
		const layers = words[a + 3] as number;
		const usage = words[a + 5] as number;
		const mips = words[a + 7] as number;
		const dimension = lookUp(VIEW_DIMENSIONS, words[a + 8] as number, 'view dimension');
		const bound = (usage & G.TEXTURE_USAGE_TEXTURE_BINDING) !== 0;
		const texture = this.device.createTexture({
			size: [words[a + 1] as number, words[a + 2] as number, layers],
			format: this.format(words[a + 4] as number) as GPUTextureFormat,
			usage,
			sampleCount: words[a + 6] as number,
			mipLevelCount: mips,
			textureBindingViewDimension: bound ? dimension : undefined,
		});
		this.textures[id] = texture;
		this.formats[id] = words[a + 4] as number;
		if (bound)
			this.bindingViews[id] = texture.createView({
				dimension,
				usage: G.TEXTURE_USAGE_TEXTURE_BINDING,
			});
		// A view of a transient texture must keep all of the texture's usage.
		if (usage & G.TEXTURE_USAGE_RENDER_ATTACHMENT && layers === 1 && mips === 1)
			this.targetViews[id] = texture.createView({
				dimension: '2d',
				usage: usage & (G.TEXTURE_USAGE_RENDER_ATTACHMENT | G.TEXTURE_USAGE_TRANSIENT_ATTACHMENT),
			});
	}

	/** A view of one mip level and one layer of a texture, to draw into. */
	private createView(words: Uint32Array, a: number): void {
		const id = words[a] as number;
		this.releaseTexture(id);
		this.targetViews[id] = this.need(this.textures, words[a + 1] as number, 'texture').createView({
			dimension: '2d',
			usage: G.TEXTURE_USAGE_RENDER_ATTACHMENT,
			baseMipLevel: words[a + 2] as number,
			mipLevelCount: 1,
			baseArrayLayer: words[a + 3] as number,
			arrayLayerCount: 1,
		});
	}

	/** Destroys a texture, or releases a view. */
	private releaseTexture(id: number): void {
		this.textures[id]?.destroy();
		this.textures[id] = undefined;
		this.bindingViews[id] = undefined;
		this.targetViews[id] = undefined;
	}

	/** Bytes per texel of a texture. */
	private texelBytes(id: number): number {
		return G.FORMAT_TEXEL_BYTES[this.formats[id] as number] ?? 0;
	}

	/**
	 * Makes mip levels 1 and up of one layer of a texture array, a render pass per level. Each pass
	 * draws into its level of the layer, and reads the level before it through a view of every
	 * layer, as compatibility mode binds whole arrays only.
	 */
	private generateMipmaps(id: number, layer: number): void {
		const texture = this.need(this.textures, id, 'texture');
		const pipeline = this.pipelines.mipmaps(texture.format);
		this.mipSampler ??= this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
		const encoder = this.commandEncoder();
		for (let level = 1; level < texture.mipLevelCount; level++) {
			const source = texture.createView({
				dimension: '2d-array',
				baseMipLevel: level - 1,
				mipLevelCount: 1,
				usage: G.TEXTURE_USAGE_TEXTURE_BINDING,
			});
			const group = this.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: source },
					{ binding: 1, resource: this.mipSampler },
				],
			});
			const target = texture.createView({
				dimension: '2d',
				baseMipLevel: level,
				mipLevelCount: 1,
				baseArrayLayer: layer,
				arrayLayerCount: 1,
				usage: G.TEXTURE_USAGE_RENDER_ATTACHMENT,
			});
			const pass = encoder.beginRenderPass({
				colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }],
			});
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, group);
			pass.draw(3, 1, 0, layer);
			pass.end();
		}
	}

	private createSampler(words: Uint32Array, floats: Float32Array, a: number): void {
		const setup = this.samplerSetup;
		setup.addressModeU = lookUp(ADDRESS_MODES, words[a + 1] as number, 'address mode');
		setup.addressModeV = lookUp(ADDRESS_MODES, words[a + 2] as number, 'address mode');
		setup.addressModeW = lookUp(ADDRESS_MODES, words[a + 3] as number, 'address mode');
		setup.magFilter = lookUp(FILTERS, words[a + 4] as number, 'filter');
		setup.minFilter = lookUp(FILTERS, words[a + 5] as number, 'filter');
		setup.mipmapFilter = lookUp(FILTERS, words[a + 6] as number, 'filter');
		setup.lodMinClamp = floats[a + 7] as number;
		setup.lodMaxClamp = floats[a + 8] as number;
		const compare = words[a + 9] as number;
		setup.compare =
			compare === G.COMPARE_NONE
				? undefined
				: lookUp(COMPARE_FUNCTIONS, compare, 'compare function');
		setup.maxAnisotropy = words[a + 10] as number;
		this.samplers[words[a] as number] = this.device.createSampler(setup);
	}

	private encoder: GPUCommandEncoder | undefined;

	/**
	 * The frame's encoder, with the staged uploads recorded ahead of the command about to go in. A
	 * new encoder opens with the GPU timer's start mark when the timer times the frame.
	 */
	private commandEncoder(): GPUCommandEncoder {
		if (!this.encoder) {
			this.encoder = this.device.createCommandEncoder();
			this.timer?.markStart(this.encoder);
		}
		if (this.staging.pending) {
			const start = this.routes.timing ? performance.now() : 0;
			this.staging.flush(this.encoder);
			if (this.routes.timing) this.routes.ringWork(performance.now() - start);
		}
		return this.encoder;
	}

	private submit(): void {
		if (!this.encoder && !this.staging.pending) return;
		const encoder = this.commandEncoder();
		this.timer?.resolve(encoder);
		submitOne(this.device.queue, encoder.finish());
		const start = this.routes.timing ? performance.now() : 0;
		this.staging.afterSubmit();
		if (this.routes.timing) this.routes.ringWork(performance.now() - start);
		this.routes.submitted(this.staging.takeMadeBuffer());
		this.encoder = undefined;
		this.timer?.afterSubmit();
	}

	resetCounts(): void {
		this.counts.uploadBytes = 0;
		this.counts.stagedBytes = 0;
		this.counts.drawCalls = 0;
		this.counts.dispatches = 0;
		this.counts.pipelines = 0;
	}

	/**
	 * Starts to build each pipeline that the list in `words[start, end)` creates before its first
	 * other command, and returns where the rest of the list starts. The builds run without
	 * blocking. Until a pipeline is built, `building` is true and the draws that use it draw
	 * nothing.
	 */
	prepare(words: Uint32Array, start: number, end: number): number {
		let i = start;
		while (i < end) {
			const header = words[i] as number;
			const op = header & 0xff;
			if (op !== G.OP_CREATE_RENDER_PIPELINE && op !== G.OP_CREATE_COMPUTE_PIPELINE) break;
			this.createPipeline(op, words, i + 1, true);
			i += header >>> 8;
		}
		return i;
	}

	/** True while a pipeline is building. Pipelines whose shaders arrived start to build first. */
	get building(): boolean {
		if (this.parked.length > 0) this.unpark();
		return this.builds > 0;
	}

	/**
	 * True when a render pipeline template can build pipelines now: an engine template, or a custom
	 * material's whose shader arrived, which it defines at its first use.
	 */
	private templateReady(template: number): boolean {
		if (this.pipelines.has(template)) return true;
		const shader = this.images.shaders.get(template);
		if (shader) this.pipelines.defineCustom(template, shader);
		return shader !== undefined;
	}

	/** Starts to build each parked pipeline whose custom material's shader has arrived. */
	private unpark(): void {
		const parked = this.parked;
		for (let k = parked.length - 1; k >= 0; k--) {
			const operands = parked[k] as Uint32Array;
			if (!this.templateReady(operands[1] as number)) continue;
			parked.splice(k, 1);
			this.builds--;
			this.counts.pipelines--;
			this.createPipeline(G.OP_CREATE_RENDER_PIPELINE, operands, 0, true);
		}
	}

	/**
	 * Creates the pipeline of a `CreateRenderPipeline` or `CreateComputePipeline` command with its
	 * operands at `a`: in the background when `background` is set, else at once.
	 */
	private createPipeline(op: number, words: Uint32Array, a: number, background: boolean): void {
		this.counts.pipelines++;
		const id = words[a] as number;
		const device = this.device;
		if (op === G.OP_CREATE_COMPUTE_PIPELINE) {
			const descriptor = this.pipelines.compute(words[a + 1] as number);
			if (!background) {
				this.computePipelines[id] = device.createComputePipeline(descriptor);
				return;
			}
			this.computePipelines[id] = null;
			this.builds++;
			device.createComputePipelineAsync(descriptor).then(
				(pipeline) => this.built(this.computePipelines, id, pipeline),
				(error: unknown) => this.failed(error),
			);
			return;
		}
		if (!this.templateReady(words[a + 1] as number)) {
			// Its draws draw nothing until the shader arrives and the pipeline builds.
			this.renderPipelines[id] = null;
			this.builds++;
			// The command's header, before its operands, gives its length in words.
			this.parked.push(words.slice(a, a - 1 + ((words[a - 1] as number) >>> 8)));
			return;
		}
		const descriptor = this.pipelines.render(
			words[a + 1] as number,
			words[a + 2] as number,
			this.format(words[a + 3] as number),
			this.format(words[a + 4] as number),
			words[a + 5] as number,
			words[a + 6] as number,
			words[a + 7] as number,
			(words[a + 8] as number) | 0,
			floatOfBits(words[a + 9] as number),
		);
		if (!background) {
			this.renderPipelines[id] = device.createRenderPipeline(descriptor);
			return;
		}
		this.renderPipelines[id] = null;
		this.builds++;
		device.createRenderPipelineAsync(descriptor).then(
			(pipeline) => this.built(this.renderPipelines, id, pipeline),
			(error: unknown) => this.failed(error),
		);
	}

	private built<T>(table: (T | null | undefined)[], id: number, pipeline: T): void {
		table[id] = pipeline;
		this.builds--;
	}

	private failed(error: unknown): void {
		this.builds--;
		this.buildFailure ??= error instanceof Error ? error.message : String(error);
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
		if (this.buildFailure !== undefined)
			throw new Error(`a pipeline failed to build: ${this.buildFailure}`);

		for (let i = start; i < end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			let length = header >>> 8;
			if (length === 0 || i + length > end) throw new Error(`draw list is truncated at word ${i}`);
			const a = i + 1;
			switch (op) {
				case G.OP_CREATE_BUFFER:
					this.buffers[words[a] as number]?.destroy();
					this.buffers[words[a] as number] = device.createBuffer({
						size: words[a + 1] as number,
						usage: words[a + 2] as number,
					});
					break;
				case G.OP_WRITE_BUFFER: {
					const target = this.need(this.buffers, words[a] as number, 'buffer');
					const offset = words[a + 1] as number;
					const source = words[a + 2] as number;
					const size = words[a + 3] as number;
					// A staged upload is a copy in the frame's commands, recorded before the next
					// command, while writeBuffer lands before them all. A frame's writes never overlap
					// and come before its passes, so either route leaves the same data. Mid-size
					// uploads take the route that the timings of this device favor.
					const covered = UploadRoutes.covers(size);
					const timed = covered && this.routes.timing;
					let staged = false;
					let start = timed ? performance.now() : 0;
					if (covered && !pass && !computePass && this.routes.takesRing(size)) {
						staged = this.staging.write(target, offset, memory, source, size);
						if (staged && timed) this.routes.wroteToRing(size, performance.now() - start);
						else if (timed) start = performance.now();
					}
					if (staged) this.counts.stagedBytes += size;
					else {
						device.queue.writeBuffer(target, offset, memory, source, size);
						if (timed) this.routes.wroteDirect(size, performance.now() - start);
					}
					this.counts.uploadBytes += size;
					break;
				}
				case G.OP_DESTROY_BUFFER:
					this.buffers[words[a] as number]?.destroy();
					this.buffers[words[a] as number] = undefined;
					break;
				case G.OP_CREATE_TEXTURE:
					this.createTexture(words, a);
					break;
				case G.OP_CREATE_TEXTURE_VIEW:
					this.createView(words, a);
					break;
				case G.OP_WRITE_TEXTURE: {
					// A texel write lands when the queue receives it, as writeBuffer does, before the
					// commands recorded since the last submit.
					const copy = this.copy;
					const id = words[a] as number;
					const width = words[a + 5] as number;
					const height = words[a + 6] as number;
					copy.setDestination(this.need(this.textures, id, 'texture'), words, a);
					copy.setSize(width, height, words[a + 7] as number);
					copy.setLayout(words[a + 8] as number, width * this.texelBytes(id), height);
					device.queue.writeTexture(copy.destination, memory, copy.layout, copy.size);
					this.counts.uploadBytes += words[a + 9] as number;
					break;
				}
				case G.OP_UPLOAD_IMAGE: {
					const copy = this.copy;
					const id = words[a] as number;
					const imageId = words[a + 7] as number;
					const flags = words[a + 8] as number;
					const image = this.images.need(imageId);
					const width = words[a + 5] as number;
					const height = words[a + 6] as number;
					copy.setDestination(this.need(this.textures, id, 'texture'), words, a);
					copy.destination.premultipliedAlpha = (flags & G.UPLOAD_PREMULTIPLIED_ALPHA) !== 0;
					copy.setImage(image, words[a + 9] as number, words[a + 10] as number);
					copy.setSize(width, height, 1);
					device.queue.copyExternalImageToTexture(copy.image, copy.destination, copy.size);
					this.counts.uploadBytes += width * height * this.texelBytes(id);
					if (flags & G.UPLOAD_RELEASE) this.images.release(imageId);
					break;
				}
				case G.OP_RELEASE_IMAGE:
					this.images.release(words[a] as number);
					break;
				case G.OP_GENERATE_MIPMAPS:
					this.generateMipmaps(words[a] as number, words[a + 1] as number);
					break;
				case G.OP_COPY_TEXTURE_TO_TEXTURE: {
					const copy = this.copy;
					copy.setSource(this.need(this.textures, words[a] as number, 'texture'), words, a);
					copy.setDestination(
						this.need(this.textures, words[a + 5] as number, 'texture'),
						words,
						a + 5,
					);
					copy.setSize(words[a + 10] as number, words[a + 11] as number, words[a + 12] as number);
					this.commandEncoder().copyTextureToTexture(copy.source, copy.destination, copy.size);
					break;
				}
				case G.OP_CREATE_SAMPLER:
					this.createSampler(words, floats, a);
					break;
				case G.OP_RESIZE_CANVAS: {
					const canvas = this.context?.canvas;
					const width = words[a] as number;
					const height = words[a + 1] as number;
					if (canvas && (canvas.width !== width || canvas.height !== height)) {
						canvas.width = width;
						canvas.height = height;
					}
					break;
				}
				case G.OP_DESTROY_TEXTURE:
					this.releaseTexture(words[a] as number);
					break;
				case G.OP_CREATE_RENDER_PIPELINE:
				case G.OP_CREATE_COMPUTE_PIPELINE:
					// A list that creates a pipeline after other commands builds it at once.
					this.createPipeline(op, words, a, false);
					break;
				case G.OP_CREATE_BIND_GROUP: {
					const layout = this.pipelines.layout(words[a + 1] as number);
					const entries: GPUBindGroupEntry[] = [];
					for (let e = 0, at = a + 3; e < (words[a + 2] as number); e++, at += 5) {
						const kind = words[at + 1] as number;
						const id = words[at + 2] as number;
						const size = words[at + 4] as number;
						let resource: GPUBindingResource;
						if (kind === G.RESOURCE_BUFFER)
							resource = {
								buffer: this.need(this.buffers, id, 'buffer'),
								offset: words[at + 3] as number,
								size: size === 0 ? undefined : size,
							};
						else if (kind === G.RESOURCE_TEXTURE)
							resource = this.need(this.bindingViews, id, 'bound texture');
						else if (kind === G.RESOURCE_SAMPLER)
							resource = this.need(this.samplers, id, 'sampler');
						else throw new Error(`unknown bind group resource kind ${kind}`);
						entries.push({ binding: words[at] as number, resource });
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
					const setup = this.renderPass;
					setup.setColor(
						this.targetView(words[a] as number),
						this.targetView(words[a + 1] as number),
						(flags & G.PASS_CLEAR_COLOR) !== 0,
						(flags & G.PASS_STORE_COLOR) !== 0,
						floats[a + 3] as number,
						floats[a + 4] as number,
						floats[a + 5] as number,
						floats[a + 6] as number,
					);
					setup.setDepth(
						this.targetView(words[a + 2] as number),
						(flags & G.PASS_CLEAR_DEPTH) !== 0,
						(flags & G.PASS_STORE_DEPTH) !== 0,
						floats[a + 7] as number,
					);
					setup.setTimestampWrites(this.timer?.passWrites(true));
					pass = this.commandEncoder().beginRenderPass(setup.descriptor);
					this.skipDraws = false;
					break;
				}
				case G.OP_SET_VIEWPORT:
					pass?.setViewport(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 3] as number,
						floats[a + 4] as number,
						floats[a + 5] as number,
					);
					break;
				case G.OP_SET_SCISSOR:
					pass?.setScissorRect(
						words[a] as number,
						words[a + 1] as number,
						words[a + 2] as number,
						words[a + 3] as number,
					);
					break;
				case G.OP_SET_BIND_GROUP:
					if (computePass) this.setBindGroup(computePass, words, a);
					else if (pass) this.setBindGroup(pass, words, a);
					break;
				case G.OP_SET_PIPELINE:
				case G.OP_SET_VERTEX_BUFFER:
				case G.OP_SET_INDEX_BUFFER:
				case G.OP_DRAW:
				case G.OP_DRAW_INDEXED:
				case G.OP_DRAW_INDEXED_INDIRECT:
					if (pass) this.passCommand(op, words, a, pass);
					break;
				case G.OP_EXECUTE_BUNDLES:
					for (let k = 0; pass && k < (words[a] as number); k++)
						this.replayBundle(this.need(this.bundles, words[a + 1 + k] as number, 'bundle'), pass);
					break;
				case G.OP_END_RENDER_PASS:
					pass?.end();
					pass = undefined;
					break;
				case G.OP_BEGIN_BUNDLE: {
					// The commands up to the bundle's end are kept to replay, and not carried out now.
					const first = i + length;
					let last = first;
					while (last < end && ((words[last] as number) & 0xff) !== G.OP_END_BUNDLE) {
						const size = (words[last] as number) >>> 8;
						if (size === 0) break;
						last += size;
					}
					if (last >= end) throw new Error(`the bundle at word ${i} has no end`);
					this.bundles[words[a] as number] = words.slice(first, last);
					length = last - i + ((words[last] as number) >>> 8);
					break;
				}
				case G.OP_BEGIN_COMPUTE_PASS:
					this.computePass.timestampWrites = this.timer?.passWrites(false);
					computePass = this.commandEncoder().beginComputePass(this.computePass);
					this.skipDispatches = false;
					break;
				case G.OP_SET_COMPUTE_PIPELINE: {
					const pipeline = this.need(this.computePipelines, words[a] as number, 'compute pipeline');
					this.skipDispatches = pipeline === null;
					if (pipeline) computePass?.setPipeline(pipeline);
					break;
				}
				case G.OP_DISPATCH:
					if (this.skipDispatches) break;
					this.counts.dispatches++;
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
					this.submit();
					break;
				default:
					throw new Error(`unknown draw list command ${op} at word ${i}`);
			}
			i += length;
		}
		this.submit();
	}

	/** Sets a bind group on a pass. The dynamic offsets are read straight from the draw list. */
	private setBindGroup(pass: GPUBindingCommandsMixin, words: Uint32Array, a: number): void {
		pass.setBindGroup(
			words[a] as number,
			this.need(this.bindGroups, words[a + 1] as number, 'bind group'),
			words,
			a + 3,
			words[a + 2] as number,
		);
	}

	/**
	 * Carries out a command that sets render pass state or draws, with its operands at `a`, and
	 * returns false for any other command. Draw lists and recorded bundles share it.
	 */
	private passCommand(
		op: number,
		words: Uint32Array,
		a: number,
		pass: GPURenderPassEncoder,
	): boolean {
		switch (op) {
			case G.OP_SET_PIPELINE: {
				const pipeline = this.need(this.renderPipelines, words[a] as number, 'render pipeline');
				this.skipDraws = pipeline === null;
				if (pipeline) pass.setPipeline(pipeline);
				return true;
			}
			case G.OP_SET_BIND_GROUP:
				this.setBindGroup(pass, words, a);
				return true;
			case G.OP_SET_VERTEX_BUFFER: {
				const size = words[a + 3] as number;
				pass.setVertexBuffer(
					words[a] as number,
					this.need(this.buffers, words[a + 1] as number, 'buffer'),
					words[a + 2] as number,
					size === 0 ? undefined : size,
				);
				return true;
			}
			case G.OP_SET_INDEX_BUFFER: {
				const size = words[a + 3] as number;
				pass.setIndexBuffer(
					this.need(this.buffers, words[a] as number, 'buffer'),
					words[a + 1] === G.INDEX_FORMAT_UINT32 ? 'uint32' : 'uint16',
					words[a + 2] as number,
					size === 0 ? undefined : size,
				);
				return true;
			}
			case G.OP_DRAW:
				if (this.skipDraws) return true;
				this.counts.drawCalls++;
				pass.draw(
					words[a] as number,
					words[a + 1] as number,
					words[a + 2] as number,
					words[a + 3] as number,
				);
				return true;
			case G.OP_DRAW_INDEXED:
				if (this.skipDraws) return true;
				this.counts.drawCalls++;
				pass.drawIndexed(
					words[a] as number,
					words[a + 1] as number,
					words[a + 2] as number,
					(words[a + 3] as number) | 0,
					words[a + 4] as number,
				);
				return true;
			case G.OP_DRAW_INDEXED_INDIRECT:
				if (this.skipDraws) return true;
				this.counts.drawCalls++;
				pass.drawIndexedIndirect(
					this.need(this.buffers, words[a] as number, 'buffer'),
					words[a + 1] as number,
				);
				return true;
			default:
				return false;
		}
	}

	/** Replays a recorded bundle's commands into the render pass. */
	private replayBundle(commands: Uint32Array, pass: GPURenderPassEncoder): void {
		for (let i = 0; i < commands.length; ) {
			const header = commands[i] as number;
			if (!this.passCommand(header & 0xff, commands, i + 1, pass))
				throw new Error(`a bundle holds command ${header & 0xff}, which only a pass can run`);
			i += header >>> 8;
		}
	}

	/** A buffer by id, for readback in tests. */
	buffer(id: number): GPUBuffer | undefined {
		return this.buffers[id];
	}

	destroy(): void {
		for (const buffer of this.buffers) buffer?.destroy();
		for (const texture of this.textures) texture?.destroy();
		if (this.ownsImages) this.images.clear();
		this.staging.destroy();
	}
}
