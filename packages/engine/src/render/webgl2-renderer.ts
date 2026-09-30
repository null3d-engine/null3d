// The WebGL2 renderers. A thread that draws with WebGL2 loads this module, and never the WebGPU
// renderers, so a page downloads one GPU path only.
// With the frame loops, the module is the path's `DrawModule`.

import { type CompletionSignal, FenceCompletion } from '../gpu/completion';
import { readbackWebGL2 } from '../gpu/readback';
import { WebGL2Backend } from '../gpu/webgl2/backend';
import {
	contextFinished,
	releaseContext,
	simulateContextLoss,
	webgl2Context,
} from '../gpu/webgl2/context';
import type { CoreDevice } from '../page/limits';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { captureFrame, type DrawingSetup, startDrawingWith } from './draw';
import { DrawLists } from './draw-lists';
import { contextLoss, contextRestored } from './loss';
import type { Drawing } from './recovery';
import {
	type FrameInput,
	linearToSrgb,
	type RenderCanvas,
	type Renderer,
	type RendererOptions,
	type Tier,
} from './renderer';

class WebGL2Renderer implements Renderer {
	readonly tier: Tier = 'webgl2';
	readonly completion: CompletionSignal = 'fence';
	private readonly completions: FenceCompletion | undefined;
	private readonly release = new AbortController();
	readonly lost: Promise<string>;

	constructor(
		private readonly canvas: RenderCanvas,
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

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		this.completions?.poll();
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

	destroy(): void {
		this.release.abort();
		releaseContext(this.gl);
	}
}

class WebGL2SceneRenderer implements Renderer {
	readonly tier: Tier = 'webgl2';
	readonly completion: CompletionSignal = 'fence';
	readonly lost: Promise<string>;
	private readonly backend: WebGL2Backend;
	private readonly lists: DrawLists;
	private readonly completions: FenceCompletion | undefined;
	private readonly release = new AbortController();

	/**
	 * `gl` is the canvas's context, made with the engine's settings. Where WebGL refuses views on
	 * shared memory, the device says so, and the backend copies uploads out of engine memory first.
	 * The device also gives the depth mode.
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
		this.backend = new WebGL2Backend(gl, canvas, device.sharedUploads, device.depth);
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
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGB8, width, height);
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

/** Creates the WebGL2 renderer on the canvas this thread owns. */
export async function createRenderer(
	canvas: RenderCanvas,
	options: RendererOptions,
): Promise<Renderer> {
	// A canvas keeps the settings of the first request for its context and ignores later ones,
	// so the context is made here with the engine's settings, before anything else asks for it.
	const gl = webgl2Context(canvas, options.powerPreference);
	// After a loss, the context must come back before the engine can draw with it again.
	await contextRestored(gl);
	if (options.scene)
		return new WebGL2SceneRenderer(
			canvas,
			gl,
			options.scene.memory,
			options.scene.control,
			options.metrics,
			options.device,
		);
	return new WebGL2Renderer(canvas, gl, options.metrics);
}

/** Starts drawing with WebGL2 on this thread's canvas, with a new renderer after each GPU loss. */
export function startDrawing(setup: DrawingSetup): Promise<Drawing<Renderer>> {
	return startDrawingWith(createRenderer, setup);
}

export { captureFrame };
