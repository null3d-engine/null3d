// The renderers of the WebGL2 path. A thread downloads this file only when it draws with WebGL2, so
// a page that draws with WebGPU never downloads the WebGL2 backend.

import { clearWebGL2Canvas } from '../gpu/canvas-release';
import { FenceCompletion } from '../gpu/completion';
import type { DeviceShaderSet } from '../gpu/device-shaders';
import { readbackWebGL2 } from '../gpu/readback';
import { WebGL2Backend } from '../gpu/webgl2/backend';
import { contextFinished, releaseContext, simulateContextLoss } from '../gpu/webgl2/context';
import { WebGL2GpuTimer } from '../gpu/webgl2/gpu-timer';
import type { CoreDevice } from '../page/limits';
import type { ImageTable } from '../shared/images';
import { type FrameRecorder, Phase } from '../shared/metrics';
import { contextLoss } from './loss';
import {
	type FrameInput,
	linearToSrgb,
	type RenderCanvas,
	type Renderer,
	type RendererOptions,
	type Tier,
} from './renderer';
import { FrameReplay, recordCounts } from './scene-renderer';

/** The WebGL call timing of a benchmark page, which loads only with its switch. */
type CallTiming = typeof import('../gpu/webgl2/call-timing');

/**
 * The renderer on the canvas's WebGL2 context `gl`: the scene's renderer for a thread that draws a
 * scene with `shaders`, through `timing` where the page times each call, else one that clears to
 * each frame's background.
 */
export function webgl2Renderer(
	canvas: RenderCanvas,
	gl: WebGL2RenderingContext,
	options: RendererOptions,
	shaders: DeviceShaderSet | undefined,
	timing: CallTiming | undefined,
): Renderer {
	const { scene, metrics } = options;
	if (!scene || !shaders) return new WebGL2Renderer(canvas, gl, metrics);
	return new WebGL2SceneRenderer(
		canvas,
		timing && options.glTiming ? timing.timeGlCalls(gl, metrics, options.glTiming) : gl,
		scene.memory,
		scene.control,
		metrics,
		options.device,
		options.imageTable,
		shaders,
	);
}

class WebGL2Renderer implements Renderer {
	readonly tier: Tier = 'webgl2';
	readonly transparent = false;
	readonly completions: FenceCompletion | undefined;
	private readonly release = new AbortController();
	readonly lost: Promise<string>;

	constructor(
		readonly canvas: RenderCanvas,
		private readonly gl: WebGL2RenderingContext,
		metrics: ArrayBufferLike | undefined,
	) {
		this.lost = contextLoss(canvas, this.release.signal);
		this.completions = metrics && new FenceCompletion(gl, metrics);
	}

	resize(width: number, height: number): void {
		this.canvas.width = Math.max(1, width);
		this.canvas.height = Math.max(1, height);
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
	}

	private clear(background: FrameInput['background']): void {
		const gl = this.gl;
		gl.clearColor(
			linearToSrgb(background[0]),
			linearToSrgb(background[1]),
			linearToSrgb(background[2]),
			1,
		);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	prepare(): boolean {
		return true;
	}

	readonly building = false;

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		this.clear(input.background);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
	}

	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		this.clear(input.background);
		const { width, height } = this.canvas;
		return { width, height, pixels: readbackWebGL2(this.gl, width, height) };
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
		this.release.abort();
		releaseContext(this.gl);
	}
}

class WebGL2SceneRenderer implements Renderer {
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
