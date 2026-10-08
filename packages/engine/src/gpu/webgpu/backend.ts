// The WebGPU backend: owns every GPU object in tables indexed by the core's resource ids, and
// replays binary draw lists into WebGPU calls. The replay loop reads 32-bit words from a view on
// engine memory and allocates nothing per command, except when a command creates a GPU object.

import { messageOf } from '../../errors/message';
import * as G from '../../generated/gpu';
import type { DeviceShaders, FirstUseShaders } from '../../generated/shaders';
import { DEV } from '../../shared/dev';
import { ImageTable } from '../../shared/images';
import type { DeviceShaderSet } from '../device-shaders';
import { JoinedBuilds, joinedReady } from '../effect-join';
import { floatOfBits } from '../float-bits';
import { GpuMemory, textureBytes } from '../memory';
import type { CulledCounts } from './culled-counts';
import type { CubeGenerator } from './environment';
import type { GpuTimer } from './gpu-timer';
import { IndirectArguments } from './indirect-arguments';
import { Pipelines, type RenderTemplate, SKIN_BUILDS } from './pipelines';
import { RenderPassSetup, submitOne, TexelCopySetup } from './reusable';
import { StagingRing } from './staging';
import { UploadRoutes } from './upload-routes';

/**
 * The operands of a `CreateRenderPipeline` command: its id, template, permutation, color and depth
 * formats, sample count, state flags, vertex format, and depth bias and slope.
 */
const RENDER_PIPELINE_OPERANDS = 10;

const TEXTURE_FORMATS: (GPUTextureFormat | undefined)[] = [];
TEXTURE_FORMATS[G.FORMAT_RGBA8_UNORM] = 'rgba8unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA8_UNORM_SRGB] = 'rgba8unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_BGRA8_UNORM] = 'bgra8unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA16_FLOAT] = 'rgba16float';
TEXTURE_FORMATS[G.FORMAT_RG11B10_UFLOAT] = 'rg11b10ufloat';
TEXTURE_FORMATS[G.FORMAT_DEPTH24_PLUS] = 'depth24plus';
TEXTURE_FORMATS[G.FORMAT_DEPTH32_FLOAT] = 'depth32float';
TEXTURE_FORMATS[G.FORMAT_DEPTH16_UNORM] = 'depth16unorm';
TEXTURE_FORMATS[G.FORMAT_RGBA32_FLOAT] = 'rgba32float';
TEXTURE_FORMATS[G.FORMAT_R32_UINT] = 'r32uint';
TEXTURE_FORMATS[G.FORMAT_ASTC_4X4_UNORM] = 'astc-4x4-unorm';
TEXTURE_FORMATS[G.FORMAT_ASTC_4X4_UNORM_SRGB] = 'astc-4x4-unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_BC7_RGBA_UNORM] = 'bc7-rgba-unorm';
TEXTURE_FORMATS[G.FORMAT_BC7_RGBA_UNORM_SRGB] = 'bc7-rgba-unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_BC6H_RGB_UFLOAT] = 'bc6h-rgb-ufloat';
TEXTURE_FORMATS[G.FORMAT_ETC2_RGB8_UNORM] = 'etc2-rgb8unorm';
TEXTURE_FORMATS[G.FORMAT_ETC2_RGB8_UNORM_SRGB] = 'etc2-rgb8unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_ETC2_RGBA8_UNORM] = 'etc2-rgba8unorm';
TEXTURE_FORMATS[G.FORMAT_ETC2_RGBA8_UNORM_SRGB] = 'etc2-rgba8unorm-srgb';
TEXTURE_FORMATS[G.FORMAT_RGB9E5_UFLOAT] = 'rgb9e5ufloat';
TEXTURE_FORMATS[G.FORMAT_R32_FLOAT] = 'r32float';
TEXTURE_FORMATS[G.FORMAT_RGBA32_UINT] = 'rgba32uint';

/** The bytes that each row of texels in a buffer copy must be a multiple of. */
const ROW_ALIGNMENT = 256;

const VIEW_DIMENSIONS: (GPUTextureViewDimension | undefined)[] = [];
VIEW_DIMENSIONS[G.VIEW_2D] = '2d';
VIEW_DIMENSIONS[G.VIEW_2D_ARRAY] = '2d-array';
VIEW_DIMENSIONS[G.VIEW_CUBE] = 'cube';
VIEW_DIMENSIONS[G.VIEW_3D] = '3d';

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

/**
 * The compute pipelines that a preloaded feature's file builds at once, each a template and its
 * permutation bits: their layouts are fixed, so the scene need not draw first.
 */
const PRECOMPILED: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
	skinning: SKIN_BUILDS.map((bits) => [G.TEMPLATE_SKIN, bits] as const),
	occlusion: [
		[G.TEMPLATE_OCCLUSION_EARLY, 0],
		[G.TEMPLATE_OCCLUSION_LATE, 0],
		[G.TEMPLATE_DEPTH_PYRAMID, 0],
	],
};

/** Reads a code from a table, and fails with its kind when the table has no entry for it. */
function lookUp<T>(table: (T | undefined)[], code: number, what: string): T {
	const value = table[code];
	if (value === undefined) throw new Error(`unknown ${what} ${code}`);
	return value;
}

export class WebGPUBackend {
	private readonly buffers: (GPUBuffer | undefined)[] = [];
	private readonly textures: (GPUTexture | undefined)[] = [];
	/** Each texture's format code, for the blocks of texels of its writes. */
	private readonly formats: number[] = [];
	/** Each texture's bytes on the GPU, which its release takes off the memory total. */
	private readonly textureSizes: number[] = [];
	/** The GPU memory of every texture and buffer that the backend and its helpers hold. */
	readonly gpuMemory = new GpuMemory();
	/** Each texture's view for bind groups: the whole texture, in the dimension it was made with. */
	private readonly bindingViews: (GPUTextureView | undefined)[] = [];
	/** Each render target's view: a texture of one layer and one mip level, or a view of one. */
	private readonly targetViews: (GPUTextureView | undefined)[] = [];
	private readonly samplers: (GPUSampler | undefined)[] = [];
	/** Images for uploads, by id, which outlive the backend when the drawing thread owns them. */
	private readonly images: ImageTable;
	/** The builds of joined effects' shaders, which never stop the engine when they fail. */
	readonly joins: JoinedBuilds;
	private readonly ownsImages: boolean;
	/** The sampler that mip levels read the level before them with. */
	private mipSampler: GPUSampler | undefined;
	/** Pipelines by id: null while one builds, and undefined for an id that names none. */
	private readonly renderPipelines: (GPURenderPipeline | null | undefined)[] = [];
	/** True for each render pipeline, by id, that draws lines rather than triangles. */
	private readonly lineLists: boolean[] = [];
	/** True while the render pass's pipeline draws lines. */
	private lines = false;
	private readonly computePipelines: (GPUComputePipeline | null | undefined)[] = [];
	/** Pipelines that are building, or that wait for their custom material's shader. */
	private builds = 0;
	/**
	 * The operands of each `CreateRenderPipeline` whose custom material's shader has not reached
	 * this thread yet. Each builds once its shader arrives.
	 */
	private readonly parked: Uint32Array[] = [];
	/**
	 * In development builds, the operands of each render pipeline of a custom material, by
	 * pipeline id, which a hot update of the material's shader builds again.
	 */
	private readonly customOperands = new Map<number, Uint32Array>();
	/** The newest hot rebuild of each pipeline, by pipeline id, and the count of rebuilds so far. */
	private readonly swaps = new Map<number, number>();
	private swapCount = 0;
	/**
	 * The operands of each `CreateComputePipeline` whose shader file has not arrived yet: the
	 * skinning pass's, which loads with the first skinned mesh. Each builds once its file arrives.
	 */
	private readonly parkedCompute: Uint32Array[] = [];
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
	/** Each indirect draw's own copy of its arguments, for the render passes that hold several. */
	private readonly indirect: IndirectArguments;
	/** `commandEncoder` as a function made once, for helpers that record commands outside a pass. */
	private readonly openEncoder = () => this.commandEncoder();
	private readonly pipelines: Pipelines;
	/** Staging buffers for the uploads that writeBuffer copies slowly. */
	private readonly staging: StagingRing;
	private readonly canvasFormat: GPUTextureFormat;
	/** Times the passes of each frame, while the page measures. */
	timer: GpuTimer | undefined;
	/** Reads back what the draws culled on the GPU drew, while the page samples. */
	culled: CulledCounts | undefined;
	/**
	 * The device shaders that load another module when a pipeline needs builds with other fixed
	 * bits. Without it, every pipeline's build must be in the shaders that the backend got.
	 */
	moreShaders: DeviceShaderSet | undefined;
	/**
	 * What the replays since the last reset uploaded, the part that went through staging, drew and
	 * built, the other GPU objects they made, and the draw commands they skipped because their
	 * pipeline was still building. The triangles and instances are those of the draws that the CPU
	 * issued, without the indirect draws, whose counts the GPU writes.
	 */
	readonly counts = {
		uploadBytes: 0,
		stagedBytes: 0,
		drawCalls: 0,
		dispatches: 0,
		pipelines: 0,
		objects: 0,
		skippedDraws: 0,
		triangles: 0,
		instances: 0,
	};
	// Descriptors that every frame fills again, so replay allocates none of its own.
	private readonly renderPass = new RenderPassSetup();
	private readonly computePass: GPUComputePassDescriptor = {};
	private readonly copy = new TexelCopySetup();
	private readonly samplerSetup: GPUSamplerDescriptor = {};
	/** The buffer that copies from 2D textures into 3D textures pass through, made on first use. */
	private copyBuffer: GPUBuffer | undefined;
	/** Copy buffers that a larger one replaced, which commands not yet submitted may still read. */
	private readonly retiredCopyBuffers: GPUBuffer[] = [];

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
		this.pipelines.prebuildMipmaps();
		this.staging = new StagingRing(device, this.gpuMemory);
		this.indirect = new IndirectArguments(device, this.gpuMemory);
		this.images = images ?? new ImageTable();
		this.ownsImages = !images;
		this.joins = new JoinedBuilds(this.images.shaders);
		this.images.warmGeneratorsWith((code) => (code as CubeGenerator).prepare(device));
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

	/**
	 * The color targets that resolved into the canvas, by id, and while a capture draws into a
	 * stand-in for the canvas, a texture of the same kind for each of them, which every pass of the
	 * capture draws into in its place. On the Galaxy S25 (Adreno 830), a multisampled color texture
	 * whose first resolve went into the canvas resolves nothing into any other texture, so the
	 * stand-in for the canvas stayed empty.
	 */
	private readonly canvasResolved = new Set<number>();
	private readonly resolveStandIns = new Map<number, GPUTexture>();

	/** Ends a capture: the frames draw into the canvas again, and the capture's own targets go. */
	endCapture(): void {
		this.canvasTarget = undefined;
		for (const [id, texture] of this.resolveStandIns) {
			texture.destroy();
			this.gpuMemory.addTextures(-(this.textureSizes[id] as number));
		}
		this.resolveStandIns.clear();
	}

	/** The view that a render pass draws its color into, before it resolves into `resolveId`. */
	private colorView(id: number, resolveId: number): GPUTextureView | undefined {
		if (!this.canvasTarget) {
			if (resolveId === 0) this.canvasResolved.add(id);
			return this.targetView(id);
		}
		if (!this.canvasResolved.has(id)) return this.targetView(id);
		let standIn = this.resolveStandIns.get(id);
		if (!standIn) {
			const texture = this.need(this.textures, id, 'render target');
			standIn = this.device.createTexture({
				size: [texture.width, texture.height],
				format: texture.format,
				sampleCount: texture.sampleCount,
				usage: texture.usage,
			});
			this.gpuMemory.addTextures(this.textureSizes[id] as number);
			this.resolveStandIns.set(id, standIn);
		}
		return standIn.createView();
	}

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
	 * fixes at creation, and a view to draw into when it has one layer and one mip level. A 3D
	 * texture's layers are its depth; every other kind is 2D, a cube's faces among its layers.
	 */
	private createTexture(words: Uint32Array, a: number): void {
		const id = words[a] as number;
		this.releaseTexture(id);
		const width = words[a + 1] as number;
		const height = words[a + 2] as number;
		const layers = words[a + 3] as number;
		const format = words[a + 4] as number;
		const usage = words[a + 5] as number;
		const samples = words[a + 6] as number;
		const mips = words[a + 7] as number;
		const dimension = lookUp(VIEW_DIMENSIONS, words[a + 8] as number, 'view dimension');
		const bound = (usage & G.TEXTURE_USAGE_TEXTURE_BINDING) !== 0;
		const texture = this.device.createTexture({
			dimension: dimension === '3d' ? '3d' : '2d',
			size: [width, height, layers],
			format: this.format(format) as GPUTextureFormat,
			usage,
			sampleCount: samples,
			mipLevelCount: mips,
			textureBindingViewDimension: bound ? dimension : undefined,
		});
		this.textures[id] = texture;
		this.formats[id] = format;
		const bytes = textureBytes(format, width, height, layers, mips, samples, dimension === '3d');
		this.textureSizes[id] = bytes;
		this.gpuMemory.addTextures(bytes);
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
		this.canvasResolved.delete(id);
		const texture = this.textures[id];
		if (texture) {
			texture.destroy();
			this.gpuMemory.addTextures(-(this.textureSizes[id] as number));
		}
		this.textures[id] = undefined;
		this.bindingViews[id] = undefined;
		this.targetViews[id] = undefined;
	}

	/**
	 * Records a copy between textures. Safari 26 drops a copy from a 2D texture into any slice of a
	 * 3D texture but the first, with no error, while copies through a buffer land. The backend
	 * cannot tell browsers apart, so every such copy goes through a buffer that the backend keeps.
	 */
	private copyTexture(words: Uint32Array, a: number): void {
		const copy = this.copy;
		const source = this.need(this.textures, words[a] as number, 'texture');
		const id = words[a + 5] as number;
		const destination = this.need(this.textures, id, 'texture');
		const width = words[a + 10] as number;
		const height = words[a + 11] as number;
		const layers = words[a + 12] as number;
		copy.setSource(source, words, a);
		copy.setDestination(destination, words, a + 5);
		copy.setSize(width, height, layers);
		const encoder = this.commandEncoder();
		if (destination.dimension !== '3d' || source.dimension === '3d') {
			encoder.copyTextureToTexture(copy.source, copy.destination, copy.size);
			return;
		}
		const block = G.FORMAT_BLOCK_SIZE[this.formats[id] as number] ?? 1;
		const rows = Math.ceil(height / block);
		const rowBytes = Math.ceil(width / block) * this.blockBytes(id);
		const bytesPerRow = Math.ceil(rowBytes / ROW_ALIGNMENT) * ROW_ALIGNMENT;
		const bytes = bytesPerRow * rows * layers;
		if (!this.copyBuffer || this.copyBuffer.size < bytes) {
			// A recorded copy may still read the smaller buffer, so it is destroyed only after the
			// next submit, which WebGPU allows. Safari frees a buffer's memory only when destroyed.
			if (this.copyBuffer) this.retiredCopyBuffers.push(this.copyBuffer);
			this.copyBuffer = this.device.createBuffer({
				size: bytes,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			});
			this.gpuMemory.addBuffers(bytes);
		}
		copy.setVia(this.copyBuffer, bytesPerRow, rows);
		encoder.copyTextureToBuffer(copy.source, copy.via, copy.size);
		encoder.copyBufferToTexture(copy.via, copy.destination, copy.size);
	}

	/** Bytes of one block of texels of a texture: one texel unless its format is compressed. */
	private blockBytes(id: number): number {
		return G.FORMAT_BLOCK_BYTES[this.formats[id] as number] ?? 0;
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

	/**
	 * Runs a generator that the table holds, which fills a whole cube texture on the GPU. The
	 * generator submits its commands at once, ahead of the frame's, which never write the texture.
	 */
	private generateTexture(words: Uint32Array, a: number): void {
		const texture = this.need(this.textures, words[a] as number, 'texture');
		const generator = words[a + 1] as number;
		const [source, code] = this.images.generator<CubeGenerator>(generator);
		code.run(this.device, texture, source);
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
		this.timer?.endFrame();
		this.culled?.copy(encoder);
		submitOne(this.device.queue, encoder.finish());
		if (this.retiredCopyBuffers.length > 0) this.destroyRetired();
		const start = this.routes.timing ? performance.now() : 0;
		this.staging.afterSubmit();
		if (this.routes.timing) this.routes.ringWork(performance.now() - start);
		this.routes.submitted(this.staging.takeMadeBuffer());
		this.encoder = undefined;
		this.timer?.afterSubmit();
		this.culled?.afterSubmit();
	}

	/** Destroys the copy buffers that a larger one replaced, once their commands are submitted. */
	private destroyRetired(): void {
		for (const buffer of this.retiredCopyBuffers) this.destroyBuffer(buffer);
		this.retiredCopyBuffers.length = 0;
	}

	resetCounts(): void {
		this.counts.uploadBytes = 0;
		this.counts.stagedBytes = 0;
		this.counts.drawCalls = 0;
		this.counts.dispatches = 0;
		this.counts.pipelines = 0;
		this.counts.objects = 0;
		this.counts.skippedDraws = 0;
		this.counts.triangles = 0;
		this.counts.instances = 0;
	}

	/** Counts a draw of `count` vertices or indices, `instances` times, with the current pipeline. */
	private countDraw(count: number, instances: number): void {
		this.counts.drawCalls++;
		this.counts.instances += instances;
		if (!this.lines) this.counts.triangles += Math.floor(count / 3) * instances;
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

	/**
	 * True while a pipeline is building. Pipelines whose shaders arrived start to build first, and
	 * so do those of custom materials whose shader a hot update replaced.
	 */
	get building(): boolean {
		if (DEV && this.images.replaced.length > 0) this.swapReplaced();
		if (this.parked.length > 0 || this.parkedCompute.length > 0) this.unpark();
		return this.builds > 0;
	}

	/**
	 * Builds each pipeline of a custom material whose shader a hot update replaced again, in the
	 * background. The old pipeline draws until the new one is built, so no frame loses the
	 * material's objects. A pipeline that fails to build keeps the old one and logs why.
	 */
	private swapReplaced(): void {
		if (!DEV) return;
		for (const template of this.images.replaced.splice(0)) {
			const shader = this.images.shaders.get(template);
			// A template that no pipeline has used takes the new shader at its first use.
			if (!shader || !this.pipelines.has(template)) continue;
			this.pipelines.replaceCustom(template, shader);
			for (const [id, operands] of this.customOperands) {
				if (operands[1] !== template) continue;
				const swap = ++this.swapCount;
				this.swaps.set(id, swap);
				this.builds++;
				this.counts.pipelines++;
				const keep = (error: unknown) =>
					console.error(
						`null3D could not build the new WGSL of a custom material on this GPU, so its objects keep the old shader: ${messageOf(error)}`,
					);
				Promise.resolve()
					.then(() => this.device.createRenderPipelineAsync(this.renderDescriptor(operands, 0)))
					.then((pipeline) => {
						// A pipeline destroyed meanwhile stays gone, and a later swap wins.
						if (this.swaps.get(id) === swap) this.renderPipelines[id] = pipeline;
					}, keep)
					.finally(() => {
						this.builds--;
					});
			}
		}
	}

	/**
	 * True when a render pipeline template can build a pipeline of `permutation` now: an engine
	 * template whose build for it is loaded, or a custom material's whose shader arrived, which it
	 * defines at its first use. A group's or a fold's shader is joined then too, once its host's
	 * file has arrived.
	 */
	private templateReady(template: number, permutation: number): boolean {
		if (!this.pipelines.has(template)) {
			const shader = this.images.shaders.get(template);
			if (!shader || !joinedReady(shader, this.images.shaders, this.moreShaders, 'wgsl'))
				return false;
			this.pipelines.defineCustom(template, shader);
		}
		return this.moreShaders?.ready(this.pipelines.variants(template), permutation, 'wgsl') ?? true;
	}

	/**
	 * Prepares the shaders of `module`, a feature's module that the page or the sketch preloaded:
	 * it creates each build's shader module, which the feature's pipelines then share, and builds
	 * the compute pipelines of skinning and occlusion culling, whose layouts are fixed. A render
	 * pipeline also needs the targets, the vertex format and the state of the objects that draw with
	 * it, which the scene gives, so `scene.warmUp()` builds those. Skinning's builds for the vertex
	 * shader serve only the `?skinning=vertex` switch, and are left out.
	 */
	precompile(feature: string, module: FirstUseShaders): void {
		const compute = PRECOMPILED[feature];
		if (compute) {
			for (const [template, bits] of compute)
				this.device
					.createComputePipelineAsync(this.pipelines.compute(template, bits))
					.catch(() => undefined);
			return;
		}
		for (const [name, builds] of Object.entries(module))
			for (const build of Object.values(builds))
				if (build.wgsl) this.pipelines.prepareModule(name, build.wgsl);
	}

	/**
	 * Makes the skinning pass write normals and tangents as 32-bit floats, as the core's skinned
	 * vertices hold them in the skinning modes that measure 8-bit ones against floats.
	 */
	skinWithFloatDirections(): void {
		this.pipelines.floatSkinnedDirections = true;
	}

	/** True when a compute template's shader is loaded: one that loads on first use, once its file arrives. */
	private computeReady(template: number, permutation: number): boolean {
		const variants = this.pipelines.computeVariants(template);
		return (
			variants === undefined || (this.moreShaders?.ready(variants, permutation, 'wgsl') ?? true)
		);
	}

	/** Starts to build each parked pipeline whose shader has arrived. */
	private unpark(): void {
		this.unparkEach(this.parked, G.OP_CREATE_RENDER_PIPELINE, (operands) =>
			this.templateReady(operands[1] as number, operands[2] as number),
		);
		this.unparkEach(this.parkedCompute, G.OP_CREATE_COMPUTE_PIPELINE, (operands) =>
			this.computeReady(operands[1] as number, operands[2] as number),
		);
	}

	/** Starts to build each pipeline of `parked` that is `ready`, with the command `op`. */
	private unparkEach(
		parked: Uint32Array[],
		op: number,
		ready: (operands: Uint32Array) => boolean,
	): void {
		for (let k = parked.length - 1; k >= 0; k--) {
			const operands = parked[k] as Uint32Array;
			if (!ready(operands)) continue;
			parked.splice(k, 1);
			this.builds--;
			this.counts.pipelines--;
			this.createPipeline(op, operands, 0, true);
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
			if (!this.computeReady(words[a + 1] as number, words[a + 2] as number)) {
				// Its dispatches do nothing until its shader file arrives and the pipeline builds.
				this.computePipelines[id] = null;
				this.builds++;
				this.parkedCompute.push(words.slice(a, a - 1 + ((words[a - 1] as number) >>> 8)));
				return;
			}
			const descriptor = this.pipelines.compute(words[a + 1] as number, words[a + 2] as number);
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
		this.lineLists[id] = ((words[a + 6] as number) & G.STATE_LINE_LIST) !== 0;
		if (!this.templateReady(words[a + 1] as number, words[a + 2] as number)) {
			// Its draws draw nothing until the shader arrives and the pipeline builds.
			this.renderPipelines[id] = null;
			this.builds++;
			// The command's header, before its operands, gives its length in words.
			this.parked.push(words.slice(a, a - 1 + ((words[a - 1] as number) >>> 8)));
			return;
		}
		const descriptor = this.renderDescriptor(words, a);
		// A joined shader always builds in the background, so a frame never waits for it and its
		// failure only sends its effects back to a pass each.
		const template = words[a + 1] as number;
		const joined = this.joins.joined(template);
		if (DEV && !joined && this.images.shaders.has(template))
			this.customOperands.set(id, words.slice(a, a + RENDER_PIPELINE_OPERANDS));
		if (!background && !joined) {
			this.renderPipelines[id] = device.createRenderPipeline(descriptor);
			return;
		}
		this.renderPipelines[id] = null;
		this.builds++;
		const start = performance.now();
		device.createRenderPipelineAsync(descriptor).then(
			(pipeline) => {
				if (joined) this.joins.built(template, performance.now() - start);
				this.built(this.renderPipelines, id, pipeline);
			},
			(error: unknown) => {
				if (!joined) return this.failed(error);
				this.builds--;
				this.joins.failed(template, error);
			},
		);
	}

	/** How to build the render pipeline of a `CreateRenderPipeline` command with its operands at `a`. */
	private renderDescriptor(words: Uint32Array, a: number): GPURenderPipelineDescriptor {
		return this.pipelines.render(
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
	}

	private built<T>(table: (T | null | undefined)[], id: number, pipeline: T): void {
		// A pipeline destroyed while it built stays gone.
		if (table[id] === null) table[id] = pipeline;
		this.builds--;
	}

	/**
	 * Forgets a render pipeline, which the browser frees once nothing holds it. One that waits for
	 * its custom material's shader stops waiting. A pipeline that is gone already, as when a
	 * capture replays a list again, changes nothing.
	 */
	private destroyPipeline(id: number): void {
		const parked = this.parked.findIndex((operands) => operands[0] === id);
		if (parked >= 0) {
			this.parked.splice(parked, 1);
			this.builds--;
		}
		this.renderPipelines[id] = undefined;
		if (DEV) {
			this.customOperands.delete(id);
			this.swaps.delete(id);
		}
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
				case G.OP_CREATE_BUFFER: {
					this.counts.objects++;
					this.releaseBuffer(words[a] as number);
					// A buffer of indirect draws is also a source of copies: of each draw's arguments
					// where a render pass with several of its draws copies them out
					// (./indirect-arguments.ts), and of the counts that the culling shaders wrote
					// while the page samples (./culled-counts.ts).
					const usage = words[a + 2] as number;
					this.buffers[words[a] as number] = device.createBuffer({
						size: words[a + 1] as number,
						usage: usage & G.BUFFER_USAGE_INDIRECT ? usage | G.BUFFER_USAGE_COPY_SRC : usage,
					});
					this.gpuMemory.addBuffers(words[a + 1] as number);
					break;
				}
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
					this.releaseBuffer(words[a] as number);
					break;
				case G.OP_CREATE_TEXTURE:
					this.counts.objects++;
					this.createTexture(words, a);
					break;
				case G.OP_CREATE_TEXTURE_VIEW:
					this.counts.objects++;
					this.createView(words, a);
					break;
				case G.OP_WRITE_TEXTURE: {
					// A texel write lands when the queue receives it, as writeBuffer does, before the
					// commands recorded since the last submit. WebGPU counts a compressed write in
					// whole blocks, which may reach past a small mip level's edge.
					const copy = this.copy;
					const id = words[a] as number;
					const block = G.FORMAT_BLOCK_SIZE[this.formats[id] as number] ?? 1;
					const blocksWide = Math.ceil((words[a + 5] as number) / block);
					const blocksHigh = Math.ceil((words[a + 6] as number) / block);
					copy.setDestination(this.need(this.textures, id, 'texture'), words, a);
					copy.setSize(blocksWide * block, blocksHigh * block, words[a + 7] as number);
					copy.setLayout(words[a + 8] as number, blocksWide * this.blockBytes(id), blocksHigh);
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
					this.counts.uploadBytes += width * height * this.blockBytes(id);
					if (flags & G.UPLOAD_RELEASE) this.images.release(imageId);
					break;
				}
				case G.OP_RELEASE_IMAGE:
					this.images.release(words[a] as number);
					break;
				case G.OP_DESTROY_PIPELINE:
					this.destroyPipeline(words[a] as number);
					break;
				case G.OP_GENERATE_TEXTURE:
					this.generateTexture(words, a);
					break;
				case G.OP_GENERATE_MIPMAPS:
					this.generateMipmaps(words[a] as number, words[a + 1] as number);
					break;
				case G.OP_COPY_TEXTURE_TO_TEXTURE:
					this.copyTexture(words, a);
					break;
				case G.OP_CREATE_SAMPLER:
					this.counts.objects++;
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
					this.counts.objects++;
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
						this.colorView(words[a] as number, words[a + 1] as number),
						this.targetView(words[a + 1] as number),
						(flags & G.PASS_CLEAR_COLOR) !== 0,
						(flags & G.PASS_STORE_COLOR) !== 0,
						floats,
						a + 3,
					);
					setup.setDepth(
						this.targetView(words[a + 2] as number),
						(flags & G.PASS_CLEAR_DEPTH) !== 0,
						(flags & G.PASS_STORE_DEPTH) !== 0,
						floats,
						a + 7,
					);
					setup.setTimestampWrites(this.timer?.passWrites(true));
					this.indirect.begin(words, i + length, end, this.bundles, this.buffers, this.openEncoder);
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
		this.staging.endFrame();
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
				const id = words[a] as number;
				const pipeline = this.need(this.renderPipelines, id, 'render pipeline');
				this.skipDraws = pipeline === null;
				this.lines = this.lineLists[id] === true;
				if (pipeline) pass.setPipeline(pipeline);
				return true;
			}
			case G.OP_SET_BIND_GROUP:
				this.setBindGroup(pass, words, a);
				return true;
			// A size of 0 binds the rest of the buffer. The browser compiles each call for the kinds of
			// argument it has seen, and throws the compiled code away when a number turns undefined,
			// so the size goes to a call of its own.
			case G.OP_SET_VERTEX_BUFFER: {
				const slot = words[a] as number;
				const buffer = this.need(this.buffers, words[a + 1] as number, 'buffer');
				const offset = words[a + 2] as number;
				const size = words[a + 3] as number;
				if (size === 0) pass.setVertexBuffer(slot, buffer, offset);
				else pass.setVertexBuffer(slot, buffer, offset, size);
				return true;
			}
			case G.OP_SET_INDEX_BUFFER: {
				const buffer = this.need(this.buffers, words[a] as number, 'buffer');
				const format = words[a + 1] === G.INDEX_FORMAT_UINT32 ? 'uint32' : 'uint16';
				const offset = words[a + 2] as number;
				const size = words[a + 3] as number;
				if (size === 0) pass.setIndexBuffer(buffer, format, offset);
				else pass.setIndexBuffer(buffer, format, offset, size);
				return true;
			}
			case G.OP_DRAW:
				if (this.skipDraws) return this.skipDraw();
				this.countDraw(words[a] as number, words[a + 1] as number);
				pass.draw(
					words[a] as number,
					words[a + 1] as number,
					words[a + 2] as number,
					words[a + 3] as number,
				);
				return true;
			case G.OP_DRAW_INDEXED:
				if (this.skipDraws) return this.skipDraw();
				this.countDraw(words[a] as number, words[a + 1] as number);
				pass.drawIndexed(
					words[a] as number,
					words[a + 1] as number,
					words[a + 2] as number,
					(words[a + 3] as number) | 0,
					words[a + 4] as number,
				);
				return true;
			case G.OP_DRAW_INDEXED_INDIRECT: {
				const id = words[a] as number;
				const offset = words[a + 1] as number;
				const copy = this.indirect.take(id, offset);
				if (this.skipDraws) return this.skipDraw();
				this.counts.drawCalls++;
				const buffer = this.need(this.buffers, id, 'buffer');
				this.culled?.note(buffer, offset, this.lines);
				if (copy) pass.drawIndexedIndirect(copy, 0);
				else pass.drawIndexedIndirect(buffer, offset);
				return true;
			}
			default:
				return false;
		}
	}

	/** Counts a draw that its pipeline's build keeps from drawing, and reports the command as handled. */
	private skipDraw(): true {
		this.counts.skippedDraws++;
		return true;
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

	/** Destroys a buffer that the backend made, and takes its bytes off the memory total. */
	private destroyBuffer(buffer: GPUBuffer): void {
		buffer.destroy();
		this.gpuMemory.addBuffers(-buffer.size);
	}

	/** Destroys the draw list's buffer of an id, where there is one. */
	private releaseBuffer(id: number): void {
		const buffer = this.buffers[id];
		if (!buffer) return;
		this.destroyBuffer(buffer);
		this.buffers[id] = undefined;
	}

	destroy(): void {
		for (let id = 0; id < this.buffers.length; id++) this.releaseBuffer(id);
		for (let id = 0; id < this.textures.length; id++) this.releaseTexture(id);
		this.endCapture();
		if (this.ownsImages) this.images.clear();
		this.staging.destroy();
		this.indirect.destroy();
		if (this.copyBuffer) this.destroyBuffer(this.copyBuffer);
		this.copyBuffer = undefined;
		this.destroyRetired();
	}
}
