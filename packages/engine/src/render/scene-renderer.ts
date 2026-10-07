// The renderers of the scene, one per GPU path. The sketch thread records each frame into a draw
// list in engine memory; a renderer replays the frame's list straight from that memory, and records
// the frame's GPU time where it has one, its upload bytes and its draw calls. A frame's list starts
// with the pipelines it creates, which begin to build, without blocking, when the frame is first
// prepared.

import { clearWebGL2Canvas, clearWebGPUCanvas } from '../gpu/canvas-release';
import { FenceCompletion, QueueCompletion } from '../gpu/completion';
import type { DeviceShaderSet } from '../gpu/device-shaders';
import type { JoinedBuilds } from '../gpu/effect-join';
import { captureWebGPU, readbackWebGL2 } from '../gpu/readback';
import { WebGL2Backend } from '../gpu/webgl2/backend';
import { contextFinished, releaseContext, simulateContextLoss } from '../gpu/webgl2/context';
import { WebGL2GpuTimer } from '../gpu/webgl2/gpu-timer';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import type { CoreDevice } from '../page/limits';
import { controlViews, frameAfter, frameReached, Slot } from '../shared/control';
import type { ImageTable } from '../shared/images';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { contextLoss, deviceLoss, type GpuErrorReport, GpuErrorWatch } from './loss';
import type { FrameInput, RenderCanvas, Renderer, Tier } from './renderer';

/** How often a capture checks whether the pipelines it waits for are built. */
const BUILD_POLL_MS = 4;
/** The longest that a capture waits for pipelines to build. */
export const BUILD_WAIT_LIMIT_MS = 30_000;

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
	/** What the replays since the last reset did; WebGL2 dispatches no compute work. */
	readonly counts: {
		uploadBytes: number;
		drawCalls: number;
		dispatches?: number;
		pipelines: number;
		skippedDraws: number;
		/** GPU objects other than pipelines that the replays made. */
		objects: number;
	};
	resetCounts(): void;
	/** The backend's builds of joined effects' shaders. */
	readonly joins: JoinedBuilds;
}

/** Adds what the backend did since its last reset to a frame's record, then resets its counts. */
function recordCounts(record: FrameRecorder, backend: SceneBackend): void {
	const { counts } = backend;
	record.count(Counter.UploadBytes, counts.uploadBytes);
	record.count(Counter.DrawCalls, counts.drawCalls);
	record.count(Counter.Dispatches, counts.dispatches ?? 0);
	record.count(Counter.Pipelines, counts.pipelines);
	record.count(Counter.SkippedDraws, counts.skippedDraws);
	record.count(Counter.GpuObjects, counts.objects);
	backend.resetCounts();
}

/**
 * The replay of each frame's draw list, as the sketch thread published it, which both scene
 * renderers share. It keeps views on engine memory, rebuilt only when memory grows. A frame's
 * pipelines start to build the first time the frame is prepared or replayed. Until a frame has
 * drawn with every pipeline built, a frame waits for its pipelines. A change of quality preset
 * starts that wait again, from the frame that the control block's hold names.
 */
export class FrameReplay {
	private words = new Uint32Array(0);
	private floats = new Float32Array(0);
	private viewsOf: ArrayBufferLike = new ArrayBuffer(0);
	private end = 0;
	private readonly slots: Int32Array;
	/** The newest frame whose pipelines started to build. */
	private prepared = 0;
	/**
	 * Where the rest of each list starts, after the pipelines it creates, by the parity of the
	 * frame that the list holds.
	 */
	private readonly rests = new Int32Array(2);
	/** True once the renderer is destroyed: a capture that waits then stops waiting. */
	private abandoned = false;
	/** True once a frame has drawn with every pipeline built, since the last hold began. */
	private complete = false;
	/** The first frame of the last hold that a prepared frame reached. */
	private held = 0;

	constructor(
		private readonly backend: SceneBackend,
		private readonly memory: WebAssembly.Memory,
		control: ArrayBufferLike,
	) {
		this.slots = controlViews(control).slots;
		backend.joins.onFailed = (template) => Atomics.store(this.slots, Slot.JoinFailed, template);
	}

	/** Starts the builds of a frame's pipelines, once, and returns true when the frame may draw. */
	prepare(frame: number): boolean {
		this.restOf(frame);
		const hold = Atomics.load(this.slots, Slot.PipelineHold);
		if (frameAfter(hold, this.held) && frameReached(frame, hold)) {
			this.held = hold;
			this.complete = false;
		}
		return this.complete || !this.backend.building;
	}

	/** Replays a frame's list, apart from the pipelines it creates, which are building already. */
	replay(frame: number): void {
		const from = this.restOf(frame);
		this.backend.replay(this.words, this.floats, from, this.end, this.viewsOf);
		if (!this.backend.building) this.complete = true;
	}

	/**
	 * Resolves with the frame that this thread took last, once every pipeline is built, including
	 * those of that frame's list. Frames go on while it waits, and the sketch thread records into a
	 * taken frame's list again once the next frame is taken, so the caller replays the frame at
	 * once, before this thread can take another. It fails when the renderer is destroyed during the
	 * wait, as after a GPU loss, or when the builds take longer than the wait's limit.
	 */
	async builtTaken(): Promise<number> {
		const deadline = performance.now() + BUILD_WAIT_LIMIT_MS;
		for (;;) {
			if (this.abandoned)
				throw new Error('the GPU was lost or the engine stopped during the capture');
			const frame = Atomics.load(this.slots, Slot.FramesTaken);
			this.restOf(frame);
			if (!this.backend.building) return frame;
			if (performance.now() >= deadline)
				throw new Error(
					`the frame's pipelines were still building after ${BUILD_WAIT_LIMIT_MS / 1000} s`,
				);
			await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_MS));
		}
	}

	/** Ends every wait for builds, for a renderer that is destroyed. */
	abandon(): void {
		this.abandoned = true;
	}

	/**
	 * Finds the list of `frame`, and returns where the rest of the list starts. Frames only grow,
	 * so the pipelines of a list start to build only for a frame newer than any prepared before.
	 * An older frame, such as one that a capture replays while the loop has prepared the next,
	 * reuses the place that its list's preparation found.
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
		if (frameAfter(frame, this.prepared)) {
			this.rests[parity] = this.backend.prepare(this.words, start, this.end);
			this.prepared = frame;
		}
		return this.rests[parity] as number;
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
	readonly errors: GpuErrorWatch;

	/**
	 * A transparent canvas composites with premultiplied alpha; any other ignores alpha.
	 * `gpuError` hears the first WebGPU error of each kind that no error scope caught.
	 */
	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		readonly canvas: RenderCanvas,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		images: ImageTable | undefined,
		shaders: DeviceShaderSet,
		readonly transparent: boolean,
		gpuError?: GpuErrorReport,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		this.errors = new GpuErrorWatch(device, gpuError);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({
			device,
			format: this.format,
			alphaMode: transparent ? 'premultiplied' : 'opaque',
		});
		this.backend = new WebGPUBackend(
			device,
			context,
			this.format,
			shaders.shaders,
			undefined,
			images,
		);
		this.backend.moreShaders = shaders;
		shaders.onPreloaded((feature, module) => this.backend.precompile(feature, module));
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
		recordCounts(record, backend);
	}

	/**
	 * Replays the frame taken last into an offscreen copy of the canvas, once every pipeline is
	 * built, and reads its pixels back.
	 */
	async capture(): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		const frame = await this.frames.builtTaken();
		const { width, height } = this.canvas;
		const pixels = await captureWebGPU(this.device, width, height, this.format, (texture) => {
			this.backend.canvasTarget = texture;
			try {
				this.frames.replay(frame);
			} finally {
				this.backend.endCapture();
				this.backend.resetCounts();
			}
		});
		return { width, height, pixels };
	}

	simulateLoss(): void {
		this.simulated = true;
		this.device.destroy();
	}

	finished(): Promise<void> {
		return this.device.queue.onSubmittedWorkDone();
	}

	drawBlank(): void {
		clearWebGPUCanvas(this.device, this.context);
	}

	destroy(): void {
		this.frames.abandon();
		this.errors.stop();
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
	/** GPU time per frame, where the context has timer queries and the page measures. */
	private readonly timer: WebGL2GpuTimer | undefined;
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
	 * device loaded, which load another module when a pipeline needs it.
	 */
	constructor(
		readonly canvas: RenderCanvas,
		private readonly gl: WebGL2RenderingContext,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
		device: CoreDevice,
		images: ImageTable | undefined,
		shaders: DeviceShaderSet,
	) {
		this.lost = contextLoss(canvas, this.release.signal);
		this.backend = new WebGL2Backend(
			gl,
			canvas,
			shaders.shaders,
			device.sharedUploads,
			device.depth,
			images,
			device.parallelCompile,
			device.transparent,
		);
		this.backend.moreShaders = shaders;
		shaders.onPreloaded((feature, module) => this.backend.precompile(feature, module));
		this.transparent = device.transparent;
		this.canvasFormat = device.transparent ? gl.RGBA8 : gl.RGB8;
		this.completions = metrics && new FenceCompletion(gl, metrics);
		this.timer = metrics && WebGL2GpuTimer.create(gl, metrics);
		this.frames = new FrameReplay(this.backend, memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	/**
	 * Ends a frame's work quietly when the browser took the context away during it. WebGL counts
	 * the context as lost at once, so the GL calls after the loss fail, but the loss event comes
	 * later, in a task of its own, and starts the recovery. Any other error goes on.
	 */
	private lostDuring(error: unknown): void {
		if (!this.gl.isContextLost()) throw error;
	}

	prepare(frame: number): boolean {
		try {
			return this.frames.prepare(frame);
		} catch (error) {
			this.lostDuring(error);
			return false;
		}
	}

	/** True while a pipeline is building, and while the context is lost, which builds nothing. */
	get building(): boolean {
		try {
			return this.backend.building;
		} catch (error) {
			this.lostDuring(error);
			return true;
		}
	}

	/**
	 * Draws a frame, and records what the backend did since the last draw: the frame's work, and
	 * the pipelines that started to build for it. A frame during which the context is lost draws
	 * nothing more, and the loss's recovery follows.
	 */
	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		try {
			this.timer?.beginFrame(input.frame);
			this.frames.replay(input.frame);
			this.timer?.endFrame();
		} catch (error) {
			this.lostDuring(error);
		}
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		recordCounts(record, this.backend);
	}

	/**
	 * Replays the frame taken last into an offscreen stand-in for the canvas, of the canvas's format
	 * and size, once every pipeline is built, and reads its pixels back.
	 */
	async capture(): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		const frame = await this.frames.builtTaken();
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
			this.frames.replay(frame);
		} catch (error) {
			this.lostDuring(error);
			throw new Error('the browser took the WebGL2 context away during the capture');
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

	drawBlank(): void {
		clearWebGL2Canvas(this.gl);
	}

	destroy(): void {
		this.frames.abandon();
		this.release.abort();
		if (!this.gl.isContextLost()) this.timer?.destroy();
		this.backend.destroy();
		releaseContext(this.gl);
	}
}
