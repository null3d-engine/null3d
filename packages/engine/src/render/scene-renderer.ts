// The renderers of the scene, one per GPU path. The sketch thread records each frame into a draw
// list in engine memory; a renderer replays the frame's list straight from that memory, and records
// the frame's GPU time where it has one, its upload bytes and its draw calls. A frame's list starts
// with the pipelines it creates, which begin to build, without blocking, when the frame is first
// prepared.

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

/** What the scene renderers ask of a GPU backend. */
interface SceneBackend {
	prepare(words: Uint32Array, start: number, end: number): number;
	readonly building: boolean;
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
class FrameReplay {
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

	constructor(
		private readonly backend: SceneBackend,
		private readonly memory: WebAssembly.Memory,
		control: ArrayBufferLike,
	) {
		this.slots = controlViews(control).slots;
	}

	/** Starts the builds of a frame's pipelines, once, and returns true when the frame may draw. */
	prepare(frame: number): boolean {
		this.restOf(frame);
		return this.complete || !this.backend.building;
	}

	/** Replays a frame's list, apart from the pipelines it creates, which are building already. */
	replay(frame: number): void {
		const from = this.restOf(frame);
		this.backend.replay(this.words, this.floats, from, this.end, this.viewsOf);
		if (!this.backend.building) this.complete = true;
	}

	/** Resolves once every pipeline is built, including those of a frame's list. */
	async built(frame: number): Promise<void> {
		this.restOf(frame);
		while (this.backend.building)
			await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
	}

	/**
	 * Finds the list of `frame`, starts to build the pipelines it creates the first time, and
	 * returns where the rest of the list starts.
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
			this.rest = this.backend.prepare(this.words, start, this.end);
			this.prepared = frame;
		}
		return this.rest;
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

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		images: ImageTable | undefined,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device, format: this.format, alphaMode: 'opaque' });
		this.backend = new WebGPUBackend(device, context, this.format, undefined, images);
		this.backend.timer = metrics && GpuTimer.create(device, metrics);
		this.completions = metrics && new QueueCompletion(device.queue, metrics);
		this.frames = new FrameReplay(this.backend, memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	prepare(frame: number): boolean {
		return this.frames.prepare(frame);
	}

	get building(): boolean {
		return this.backend.building;
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
	readonly lost: Promise<string>;
	readonly completions: FenceCompletion | undefined;
	private readonly backend: WebGL2Backend;
	private readonly frames: FrameReplay;
	private readonly release = new AbortController();

	/**
	 * `gl` is the canvas's context, made with the engine's settings. Where WebGL refuses views on
	 * shared memory, the device says so, and the backend copies uploads out of engine memory first.
	 * The device also gives the depth mode. `images` holds the images that texture uploads read.
	 */
	constructor(
		private readonly canvas: RenderCanvas,
		private readonly gl: WebGL2RenderingContext,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		device: CoreDevice,
		images: ImageTable | undefined,
	) {
		this.lost = contextLoss(canvas, this.release.signal);
		this.backend = new WebGL2Backend(
			gl,
			canvas,
			device.sharedUploads,
			device.depth,
			images,
			device.parallelCompile,
		);
		this.completions = metrics && new FenceCompletion(gl, metrics);
		this.frames = new FrameReplay(this.backend, memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	prepare(frame: number): boolean {
		return this.frames.prepare(frame);
	}

	get building(): boolean {
		return this.backend.building;
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
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGB8, width, height);
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
