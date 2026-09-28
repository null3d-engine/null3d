// The renderer interface. The same renderer runs in the render worker (pipelined mode), in the game
// worker (low-latency mode) or on the page's main thread (single-threaded mode and ?render=main).

import { readbackWebGL2, readbackWebGPU } from '../gpu/readback';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import { RenderPassSetup, submitOne } from '../gpu/webgpu/reusable';
import { type FrameRecorder, Phase } from '../shared/metrics';
import { contextLoss, contextRestored, deviceLoss } from './loss';
import { WebGPUSceneRenderer } from './scene-renderer';

/**
 * The GPU path the engine draws with: core WebGPU, WebGPU in compatibility mode on devices that
 * cannot run core WebGPU, or WebGL2.
 *
 * @category api/engine
 */
export type Tier = 'webgpu' | 'webgpu-compat' | 'webgl2';

export type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

/** What the renderer draws for one frame. */
export interface FrameInput {
	/** The frame number, counting from 1. */
	frame: number;
	/** Background color in linear RGB, 0 to 1. */
	background: readonly [number, number, number];
}

export interface Renderer {
	readonly tier: Tier;
	/** Resizes the drawing buffer, in device pixels. Only the thread that owns the canvas calls this. */
	resize(width: number, height: number): void;
	/** Draws a frame to the canvas, adding its phase times and counters to the frame's record. */
	drawFrame(input: FrameInput, record: FrameRecorder): void;
	/** Draws one frame into an offscreen target and returns its pixels as RGBA8 rows, top row first. */
	capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/** Resolves with the browser's reason if it takes the GPU away; destroying the renderer does not. */
	readonly lost: Promise<string>;
	/** Acts out a loss of the GPU, as a driver reset would cause, so the page can test recovery. */
	simulateLoss(): void;
	destroy(): void;
}

export interface RendererOptions {
	tier: Tier;
	/** Requests a compatibility-mode device without `core-features-and-limits` (the ?gpu=compat switch). */
	forceCompat?: boolean;
	/** The metrics buffer, which receives GPU times where the device has timestamp queries. */
	metrics?: ArrayBufferLike;
	/**
	 * Engine memory and the control block: with both, a WebGPU renderer draws the scene from the
	 * draw lists the game thread records; without them it clears to the frame's background.
	 */
	scene?: { memory: WebAssembly.Memory; control: ArrayBufferLike };
}

/** How long a simulated WebGL2 loss keeps the context away. */
const SIMULATED_RESTORE_MS = 50;

/** Encodes a linear color channel as sRGB, the way the final output does. */
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

class WebGPURenderer implements Renderer {
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly timer: GpuTimer | undefined;
	private readonly pass = new RenderPassSetup();
	private simulated = false;
	readonly lost: Promise<string>;

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		metrics: ArrayBufferLike | undefined,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
		this.timer = metrics && GpuTimer.create(device, metrics);
	}

	resize(width: number, height: number): void {
		this.canvas.width = Math.max(1, width);
		this.canvas.height = Math.max(1, height);
	}

	private clear(view: GPUTextureView, background: FrameInput['background']): void {
		const encoder = this.device.createCommandEncoder();
		const pass = this.pass;
		pass.setColor(
			view,
			undefined,
			true,
			true,
			linearToSrgb(background[0]),
			linearToSrgb(background[1]),
			linearToSrgb(background[2]),
			1,
		);
		pass.setTimestampWrites(this.timer?.passWrites());
		encoder.beginRenderPass(pass.descriptor).end();
		this.timer?.resolve(encoder);
		submitOne(this.device.queue, encoder.finish());
		this.timer?.afterSubmit();
	}

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		this.timer?.beginFrame(input.frame);
		this.clear(this.context.getCurrentTexture().createView(), input.background);
		record.addPhase(Phase.Replay, performance.now() - start);
	}

	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		const { width, height } = this.canvas;
		const texture = this.device.createTexture({
			size: [width, height],
			format: 'rgba8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		this.clear(texture.createView(), input.background);
		const pixels = await readbackWebGPU(this.device, texture);
		texture.destroy();
		return { width, height, pixels };
	}

	simulateLoss(): void {
		this.simulated = true;
		this.device.destroy();
	}

	destroy(): void {
		this.timer?.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
}

class WebGL2Renderer implements Renderer {
	readonly tier: Tier = 'webgl2';
	private readonly gl: WebGL2RenderingContext;
	private released = false;
	readonly lost: Promise<string>;

	constructor(private readonly canvas: RenderCanvas) {
		this.lost = contextLoss(canvas, () => this.released);
		const gl = canvas.getContext('webgl2', {
			antialias: false,
			alpha: false,
		}) as WebGL2RenderingContext | null;
		if (!gl) throw new Error('the canvas has no WebGL2 context');
		this.gl = gl;
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
		this.clear(input.background);
		record.addPhase(Phase.Replay, performance.now() - start);
	}

	async capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }> {
		this.clear(input.background);
		const { width, height } = this.canvas;
		return { width, height, pixels: readbackWebGL2(this.gl, width, height) };
	}

	simulateLoss(): void {
		const lose = this.gl.getExtension('WEBGL_lose_context');
		lose?.loseContext();
		// A driver reset gives the context back after a moment; so does this.
		setTimeout(() => lose?.restoreContext(), SIMULATED_RESTORE_MS);
	}

	destroy(): void {
		this.released = true;
		if (!this.gl.isContextLost()) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}

/** Creates the renderer for a tier on the canvas this thread owns. */
export async function createRenderer(
	canvas: RenderCanvas,
	options: RendererOptions,
): Promise<Renderer> {
	if (options.tier === 'webgl2') {
		// After a loss, the context must come back before the engine can draw with it again.
		await contextRestored(canvas);
		return new WebGL2Renderer(canvas);
	}
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const core = !options.forceCompat && adapter.features.has('core-features-and-limits');
	const requiredFeatures: GPUFeatureName[] = [];
	if (core) requiredFeatures.push('core-features-and-limits' as GPUFeatureName);
	if (options.metrics && adapter.features.has('timestamp-query'))
		requiredFeatures.push('timestamp-query');
	const device = await adapter.requestDevice({ requiredFeatures });
	const tier = core ? 'webgpu' : 'webgpu-compat';
	if (options.scene)
		return new WebGPUSceneRenderer(
			tier,
			device,
			canvas,
			options.scene.memory,
			options.scene.control,
			options.metrics,
		);
	return new WebGPURenderer(tier, device, canvas, options.metrics);
}
