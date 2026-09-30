// The renderers of the scene, one per GPU path. The sketch thread records each frame into a draw
// list in engine memory; a renderer replays the frame's list straight from that memory, and records
// the frame's GPU time where it has one, its upload bytes and its draw calls.

import { type CompletionSignal, FenceCompletion, QueueCompletion } from '../gpu/completion';
import { readbackWebGL2, readbackWebGPU } from '../gpu/readback';
import { WebGL2Backend } from '../gpu/webgl2/backend';
import { contextFinished, releaseContext, simulateContextLoss } from '../gpu/webgl2/context';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import type { CoreDevice } from '../page/limits';
import { controlViews, Slot } from '../shared/control';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { contextLoss, deviceLoss } from './loss';
import type { FrameInput, RenderCanvas, Renderer, Tier } from './renderer';

/**
 * The frame's draw list, as the sketch thread published it: views on engine memory, rebuilt only
 * when memory grows, and the list's range of words in them.
 */
class DrawLists {
	words = new Uint32Array(0);
	floats = new Float32Array(0);
	start = 0;
	end = 0;
	private viewsOf: ArrayBufferLike | undefined;
	private readonly slots: Int32Array;

	constructor(
		private readonly memory: WebAssembly.Memory,
		control: ArrayBufferLike,
	) {
		this.slots = controlViews(control).slots;
	}

	/** Finds the list of `frame`, and returns the engine memory its uploads read from. */
	select(frame: number): ArrayBufferLike {
		const buffer = this.memory.buffer;
		if (buffer !== this.viewsOf) {
			this.words = new Uint32Array(buffer);
			this.floats = new Float32Array(buffer);
			this.viewsOf = buffer;
		}
		const parity = frame & 1;
		this.start = Atomics.load(this.slots, Slot.DrawListAddress0 + parity) / 4;
		this.end = this.start + Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		return buffer;
	}
}

export class WebGPUSceneRenderer implements Renderer {
	private readonly backend: WebGPUBackend;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly lists: DrawLists;
	private readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly completion: CompletionSignal = 'queue';
	readonly lost: Promise<string>;

	/** A transparent canvas composites with premultiplied alpha; any other ignores alpha. */
	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		transparent: boolean,
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
		this.backend = new WebGPUBackend(device, context, this.format);
		this.backend.timer = metrics && GpuTimer.create(device, metrics);
		this.completions = metrics && new QueueCompletion(device.queue, metrics);
		this.lists = new DrawLists(memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	private replay(frame: number): void {
		const memory = this.lists.select(frame);
		const { words, floats, start, end } = this.lists;
		this.backend.replay(words, floats, start, end, memory);
	}

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		const { backend } = this;
		backend.timer?.beginFrame(input.frame);
		backend.resetCounts();
		this.replay(input.frame);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		record.count(Counter.UploadBytes, backend.counts.uploadBytes);
		record.count(Counter.DrawCalls, backend.counts.drawCalls);
		record.count(Counter.Dispatches, backend.counts.dispatches);
		record.count(Counter.Pipelines, backend.counts.pipelines);
	}

	/** Replays a frame into an offscreen copy of the canvas and reads its pixels back. */
	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		const { width, height } = this.canvas;
		const texture = this.device.createTexture({
			size: [width, height],
			format: this.format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		this.backend.canvasTarget = texture;
		try {
			this.replay(input.frame);
		} finally {
			this.backend.canvasTarget = undefined;
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
	readonly completion: CompletionSignal = 'fence';
	readonly lost: Promise<string>;
	private readonly backend: WebGL2Backend;
	private readonly lists: DrawLists;
	private readonly completions: FenceCompletion | undefined;
	private readonly release = new AbortController();

	/** The canvas's sized format, which a capture's stand-in for it takes: RGBA8 with alpha. */
	private readonly canvasFormat: number;

	/**
	 * `gl` is the canvas's context, made with the engine's settings. Where WebGL refuses views on
	 * shared memory, the device says so, and the backend copies uploads out of engine memory first.
	 * The device also gives the depth mode, and whether the canvas is transparent, with alpha.
	 */
	constructor(
		private readonly canvas: RenderCanvas,
		private readonly gl: WebGL2RenderingContext,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		device: CoreDevice,
	) {
		this.lost = contextLoss(canvas, this.release.signal);
		this.backend = new WebGL2Backend(
			gl,
			canvas,
			device.sharedUploads,
			device.depth,
			device.transparent,
		);
		this.canvasFormat = device.transparent ? gl.RGBA8 : gl.RGB8;
		this.completions = metrics && new FenceCompletion(gl, metrics);
		this.lists = new DrawLists(memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	private replay(frame: number): void {
		const memory = this.lists.select(frame);
		const { words, floats, start, end } = this.lists;
		this.backend.replay(words, floats, start, end, memory);
	}

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		const { backend } = this;
		this.completions?.poll();
		backend.resetCounts();
		this.replay(input.frame);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		record.count(Counter.UploadBytes, backend.counts.uploadBytes);
		record.count(Counter.DrawCalls, backend.counts.drawCalls);
		record.count(Counter.Pipelines, backend.counts.pipelines);
	}

	/**
	 * Replays a frame into an offscreen stand-in for the canvas, of the canvas's format and size,
	 * and reads its pixels back.
	 */
	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
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
			this.replay(input.frame);
		} finally {
			this.backend.canvasTarget = undefined;
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
