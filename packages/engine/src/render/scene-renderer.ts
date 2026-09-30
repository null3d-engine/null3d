// The renderers of the scene, one per GPU path. The sketch thread records each frame into a draw
// list in engine memory; a renderer replays the frame's list straight from that memory, and records
// the frame's GPU time where it has one, its upload bytes and its draw calls. A frame's list starts
// with the pipelines it creates, which begin to build, without blocking, when the frame is first
// prepared. A pipeline whose shader build is in a device module that the thread has not loaded, as
// after a change of anti-aliasing mode, makes its frame wait while that module loads.

import { OP_CREATE_COMPUTE_PIPELINE, OP_CREATE_RENDER_PIPELINE } from '../generated/gpu';
import { DEVICE_BITS, type DeviceShaders } from '../generated/shaders';
import { FenceCompletion, QueueCompletion } from '../gpu/completion';
import { readbackWebGL2, readbackWebGPU } from '../gpu/readback';
import { WebGL2Backend } from '../gpu/webgl2/backend';
import { contextFinished, releaseContext, simulateContextLoss } from '../gpu/webgl2/context';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import type { CoreDevice } from '../page/limits';
import { controlViews, Slot } from '../shared/control';
import type { ImageTable } from '../shared/images';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { contextLoss, deviceLoss } from './loss';
import type { FrameInput, RenderCanvas, Renderer, Tier } from './renderer';

/** How often a capture checks whether the pipelines it waits for are built. */
const BUILD_POLL_MS = 4;

/**
 * The device modules of shader builds: the permutation bits of the module that the thread loaded
 * first, and how to load the module of other bits.
 */
export interface ShaderModules {
	readonly first: number;
	load(bits: number): Promise<DeviceShaders>;
}

/** What the scene renderers ask of a GPU backend. */
interface SceneBackend {
	prepare(words: Uint32Array, start: number, end: number): number;
	readonly building: boolean;
	/** True when the backend holds the shader build of a template's pipelines with a permutation. */
	hasShader(template: number, permutation: number): boolean;
	/** Adds the builds of another device module, whose permutation bits new pipelines can take. */
	addShaders(shaders: DeviceShaders): void;
	replay(
		words: Uint32Array,
		floats: Float32Array,
		start: number,
		end: number,
		memory: ArrayBufferLike,
	): void;
}

/**
 * The replay of each frame's draw list, as the sketch thread published it, which both scene
 * renderers share. It keeps views on engine memory, rebuilt only when memory grows. A frame's
 * pipelines start to build the first time the frame is prepared or replayed. Until a frame has
 * drawn with every pipeline built, a frame waits for its pipelines.
 */
export class FrameReplay {
	private words = new Uint32Array(0);
	private floats = new Float32Array(0);
	private viewsOf: ArrayBufferLike = new ArrayBuffer(0);
	private end = 0;
	private readonly slots: Int32Array;
	/** The frame whose pipelines started to build last, and where the rest of its list starts. */
	private prepared = 0;
	private rest = 0;
	/** True once a frame has drawn with every pipeline built. */
	private complete = false;
	/** The permutation bits of each device module that has loaded or is loading. */
	private readonly modules = new Set<number>();
	/** Device modules that are loading. */
	private loads = 0;
	/** Why a device module failed to load, which the next frame reports. */
	private loadFailure: string | undefined;

	constructor(
		private readonly backend: SceneBackend,
		private readonly memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		private readonly shaders: ShaderModules,
	) {
		this.slots = controlViews(control).slots;
		this.modules.add(shaders.first);
	}

	/** True while a pipeline builds, or while a device module that a frame needs loads. */
	get building(): boolean {
		return this.loads > 0 || this.backend.building;
	}

	/**
	 * Starts the builds of a frame's pipelines, once, and returns true when the frame may draw. A
	 * frame whose device modules load always waits, as its pipelines cannot start before them.
	 */
	prepare(frame: number): boolean {
		if (this.restOf(frame) < 0) return false;
		return this.complete || !this.backend.building;
	}

	/** Replays a frame's list, apart from the pipelines it creates, which are building already. */
	replay(frame: number): void {
		const from = this.restOf(frame);
		if (from < 0) throw new Error(`frame ${frame} replays before its shader builds loaded`);
		this.backend.replay(this.words, this.floats, from, this.end, this.viewsOf);
		if (!this.backend.building) this.complete = true;
	}

	/** Resolves once every pipeline is built, including those of a frame's list. */
	async built(frame: number): Promise<void> {
		while (this.restOf(frame) < 0 || this.backend.building)
			await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
	}

	/**
	 * Finds the list of `frame`, starts to build the pipelines it creates the first time, and
	 * returns where the rest of the list starts, or -1 while device modules that its pipelines need
	 * load.
	 */
	private restOf(frame: number): number {
		const buffer = this.memory.buffer;
		if (buffer !== this.viewsOf) {
			this.words = new Uint32Array(buffer);
			this.floats = new Float32Array(buffer);
			this.viewsOf = buffer;
		}
		const parity = frame & 1;
		const start = Atomics.load(this.slots, Slot.DrawListAddress0 + parity) / 4;
		this.end = start + Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		if (frame !== this.prepared) {
			if (!this.modulesLoaded(start)) return -1;
			this.rest = this.backend.prepare(this.words, start, this.end);
			this.prepared = frame;
		}
		return this.rest;
	}

	/**
	 * Starts to load the device module of each pipeline that the list at `start` creates, whose
	 * shader build the backend lacks, and returns true once none loads. Pipelines come first in a
	 * list, so the scan stops at the first other command.
	 */
	private modulesLoaded(start: number): boolean {
		const words = this.words;
		for (let i = start; i < this.end; ) {
			const header = words[i] as number;
			const op = header & 0xff;
			if (op !== OP_CREATE_RENDER_PIPELINE && op !== OP_CREATE_COMPUTE_PIPELINE) break;
			if (op === OP_CREATE_RENDER_PIPELINE) {
				const template = words[i + 2] as number;
				const permutation = words[i + 3] as number;
				const bits = permutation & DEVICE_BITS;
				if (!this.modules.has(bits) && !this.backend.hasShader(template, permutation))
					this.loadModule(bits);
			}
			i += header >>> 8;
		}
		if (this.loadFailure !== undefined)
			throw new Error(`null3D could not load shader builds: ${this.loadFailure}`);
		return this.loads === 0;
	}

	/** Loads the device module of `bits`, and gives its builds to the backend. */
	private loadModule(bits: number): void {
		this.modules.add(bits);
		this.loads++;
		this.shaders.load(bits).then(
			(shaders) => {
				this.backend.addShaders(shaders);
				this.loads--;
			},
			(error: unknown) => {
				this.loadFailure ??= error instanceof Error ? error.message : String(error);
				this.loads--;
			},
		);
	}
}

export class WebGPUSceneRenderer implements Renderer {
	private readonly backend: WebGPUBackend;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly frames: FrameReplay;
	readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly lost: Promise<string>;

	/** A transparent canvas composites with premultiplied alpha; any other ignores alpha. */
	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		images: ImageTable | undefined,
		shaders: DeviceShaders,
		modules: ShaderModules,
		readonly transparent: boolean,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device,
			format: this.format,
			alphaMode: transparent ? 'premultiplied' : 'opaque',
		});
		this.backend = new WebGPUBackend(device, context, this.format, shaders, undefined, images);
		this.backend.timer = metrics && GpuTimer.create(device, metrics);
		this.completions = metrics && new QueueCompletion(device.queue, metrics);
		this.frames = new FrameReplay(this.backend, memory, control, modules);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	prepare(frame: number): boolean {
		return this.frames.prepare(frame);
	}

	get building(): boolean {
		return this.frames.building;
	}

	/**
	 * Draws a frame, and records what the backend did since the last draw: the frame's work, and
	 * the pipelines that started to build for it.
	 */
	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		const { backend } = this;
		backend.timer?.beginFrame(input.frame);
		this.frames.replay(input.frame);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		record.count(Counter.UploadBytes, backend.counts.uploadBytes);
		record.count(Counter.DrawCalls, backend.counts.drawCalls);
		record.count(Counter.Dispatches, backend.counts.dispatches);
		record.count(Counter.Pipelines, backend.counts.pipelines);
		backend.resetCounts();
	}

	/**
	 * Replays a frame into an offscreen copy of the canvas, once every pipeline is built, and reads
	 * its pixels back.
	 */
	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		await this.frames.built(input.frame);
		const { width, height } = this.canvas;
		const texture = this.device.createTexture({
			size: [width, height],
			format: this.format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		this.backend.canvasTarget = texture;
		try {
			this.frames.replay(input.frame);
		} finally {
			this.backend.canvasTarget = undefined;
			this.backend.resetCounts();
		}
		const pixels = await readbackWebGPU(this.device, texture);
		texture.destroy();
		return { width, height, pixels };
	}

	simulateLoss(): void {
		this.simulated = true;
		this.device.destroy();
	}

	finished(): Promise<void> {
		return this.device.queue.onSubmittedWorkDone();
	}

	destroy(): void {
		this.backend.timer?.destroy();
		this.backend.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
}

export class WebGL2SceneRenderer implements Renderer {
	readonly tier: Tier = 'webgl2';
	readonly transparent: boolean;
	readonly lost: Promise<string>;
	readonly completions: FenceCompletion | undefined;
	private readonly backend: WebGL2Backend;
	private readonly frames: FrameReplay;
	private readonly release = new AbortController();

	/** The canvas's sized format, which a capture's stand-in takes: RGBA8 with alpha, else RGB8. */
	private readonly canvasFormat: number;

	/**
	 * `gl` is the canvas's context, made with the engine's settings. Where WebGL refuses views on
	 * shared memory, the device says so, and the backend copies uploads out of engine memory first.
	 * The device also gives the depth mode, and whether the canvas is transparent, with alpha.
	 * `images` holds the images that texture uploads read. `shaders` are the GLSL builds that the
	 * device loaded, and `modules` loads the builds of other device modules.
	 */
	constructor(
		private readonly canvas: RenderCanvas,
		private readonly gl: WebGL2RenderingContext,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		device: CoreDevice,
		images: ImageTable | undefined,
		shaders: DeviceShaders,
		modules: ShaderModules,
	) {
		this.lost = contextLoss(canvas, this.release.signal);
		this.backend = new WebGL2Backend(
			gl,
			canvas,
			shaders,
			device.sharedUploads,
			device.depth,
			images,
			device.parallelCompile,
			device.transparent,
		);
		this.transparent = device.transparent;
		this.canvasFormat = device.transparent ? gl.RGBA8 : gl.RGB8;
		this.completions = metrics && new FenceCompletion(gl, metrics);
		this.frames = new FrameReplay(this.backend, memory, control, modules);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	prepare(frame: number): boolean {
		return this.frames.prepare(frame);
	}

	get building(): boolean {
		return this.frames.building;
	}

	/**
	 * Draws a frame, and records what the backend did since the last draw: the frame's work, and
	 * the pipelines that started to build for it.
	 */
	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		const { backend } = this;
		this.frames.replay(input.frame);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		record.count(Counter.UploadBytes, backend.counts.uploadBytes);
		record.count(Counter.DrawCalls, backend.counts.drawCalls);
		record.count(Counter.Pipelines, backend.counts.pipelines);
		backend.resetCounts();
	}

	/**
	 * Replays a frame into an offscreen stand-in for the canvas, of the canvas's format and size,
	 * once every pipeline is built, and reads its pixels back.
	 */
	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		await this.frames.built(input.frame);
		const gl = this.gl;
		const { width, height } = this.canvas;
		const framebuffer = gl.createFramebuffer();
		const color = gl.createRenderbuffer();
		if (!framebuffer || !color) throw new Error('WebGL2 could not make a capture target');
		gl.bindRenderbuffer(gl.RENDERBUFFER, color);
		gl.renderbufferStorage(gl.RENDERBUFFER, this.canvasFormat, width, height);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
		this.backend.canvasTarget = { framebuffer, width, height };
		try {
			this.frames.replay(input.frame);
		} finally {
			this.backend.canvasTarget = undefined;
			this.backend.resetCounts();
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		const pixels = readbackWebGL2(gl, width, height);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteRenderbuffer(color);
		return { width, height, pixels };
	}

	simulateLoss(): void {
		simulateContextLoss(this.gl);
	}

	finished(): Promise<void> {
		return contextFinished(this.gl);
	}

	destroy(): void {
		this.release.abort();
		this.backend.destroy();
		releaseContext(this.gl);
	}
}
