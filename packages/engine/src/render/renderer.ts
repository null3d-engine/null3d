// The renderer interface. The same renderer runs in the render worker (pipelined mode), in the sketch
// worker (low-latency mode) or on the page's main thread (single-threaded mode and ?render=main).

import { FORMAT_RG11B10_UFLOAT } from '../generated/gpu';
import { type DeviceShaders, loadGlslShaders, loadWgslShaders } from '../generated/shaders';
import { type CanvasHolder, clearWebGL2Canvas, clearWebGPUCanvas } from '../gpu/canvas-release';
import { type Completion, FenceCompletion, QueueCompletion } from '../gpu/completion';
import { readbackWebGL2, readbackWebGPU } from '../gpu/readback';
import {
	contextFinished,
	releaseContext,
	simulateContextLoss,
	webgl2Context,
} from '../gpu/webgl2/context';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import { RenderPassSetup, submitOne } from '../gpu/webgpu/reusable';
import type { PowerPreference } from '../page/capabilities';
import { type CoreDevice, TEXTURE_COMPRESSION } from '../page/limits';
import type { ImageTable } from '../shared/images';
import { type FrameRecorder, Phase } from '../shared/metrics';
import type { Tier } from '../shared/tier';
import { contextLoss, contextRestored, deviceLoss } from './loss';
import { WebGL2SceneRenderer, WebGPUSceneRenderer } from './scene-renderer';
import { freshSalt, saltShaders } from './shader-salt';

export type { Tier } from '../shared/tier';

export type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

/** What the renderer draws for one frame. */
export interface FrameInput {
	/** The frame number, counting from 1. */
	frame: number;
	/** Background color in linear RGB, 0 to 1. */
	background: readonly [number, number, number];
}

export interface Renderer extends CanvasHolder {
	readonly tier: Tier;
	/** True when the canvas keeps premultiplied alpha, so a captured image keeps the frame's alpha. */
	readonly transparent: boolean;
	/**
	 * Counts the frames that the GPU finished, and says how many it has not; undefined without a
	 * metrics buffer.
	 */
	readonly completions: Completion | undefined;
	/** The canvas it draws on. */
	readonly canvas: RenderCanvas;
	/** Resizes the drawing buffer, in device pixels. Only the thread that owns the canvas calls this. */
	resize(width: number, height: number): void;
	/**
	 * Starts to build the pipelines that a frame's list creates, the first time it is asked for that
	 * frame, and returns true when the frame may draw. Until the renderer has drawn a frame with
	 * every pipeline built, a frame waits for its pipelines. After that, a frame draws at once, and
	 * objects whose pipelines are still building appear once they are built.
	 */
	prepare(frame: number): boolean;
	/** True while a pipeline is building. */
	readonly building: boolean;
	/** Draws a frame to the canvas, adding its phase times and counters to the frame's record. */
	drawFrame(input: FrameInput, record: FrameRecorder): void;
	/**
	 * Draws the frame taken last into an offscreen target and returns its pixels as RGBA8 rows, top
	 * row first. A renderer that first waits for its pipelines reads the frame taken last again once
	 * they are built, since frames go on during the wait and `input` falls behind.
	 */
	capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/** Resolves with the browser's reason if it takes the GPU away; destroying the renderer does not. */
	readonly lost: Promise<string>;
	/** Acts out a loss of the GPU, as a driver reset would cause, so the page can test recovery. */
	simulateLoss(): void;
	/** Resolves when the GPU has finished every frame submitted so far. */
	finished(): Promise<void>;
	destroy(): void;
}

export interface RendererOptions {
	tier: Tier;
	/** Requests a compatibility-mode device without `core-features-and-limits` (the ?gpu=compat switch). */
	forceCompat?: boolean;
	/** The metrics buffer, which receives GPU times where the device has timestamp queries. */
	metrics?: ArrayBufferLike;
	/**
	 * The device and the canvas as the engine uses them: the storage binding to request, how WebGL2
	 * uploads and stores depth, the scene color's format and whether the canvas is transparent.
	 */
	device: CoreDevice;
	/** Which GPU to draw with on a device with two; the browser chooses without it. */
	powerPreference?: PowerPreference;
	/**
	 * Engine memory and the control block: with both, the renderer draws the scene from the draw
	 * lists the sketch thread records; without them it clears to the frame's background.
	 */
	scene?: { memory: WebAssembly.Memory; control: ArrayBufferLike };
	/** The images that texture uploads read, which the thread keeps across GPU devices. */
	imageTable?: ImageTable;
}

/** WebGPU's default `maxBufferSize`, which every device offers. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** Encodes a linear color channel as sRGB, the way the final output does. */
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

class WebGPURenderer implements Renderer {
	readonly transparent = false;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly timer: GpuTimer | undefined;
	private readonly pass = new RenderPassSetup();
	readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly lost: Promise<string>;

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		readonly canvas: RenderCanvas,
		metrics: ArrayBufferLike | undefined,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
		this.timer = metrics && GpuTimer.create(device, metrics);
		this.completions = metrics && new QueueCompletion(device.queue, metrics);
	}

	resize(width: number, height: number): void {
		this.canvas.width = Math.max(1, width);
		this.canvas.height = Math.max(1, height);
	}

	private clear(view: GPUTextureView, background: FrameInput['background']): void {
		const encoder = this.device.createCommandEncoder();
		this.timer?.markStart(encoder);
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
		pass.setTimestampWrites(this.timer?.passWrites(true));
		encoder.beginRenderPass(pass.descriptor).end();
		this.timer?.resolve(encoder);
		submitOne(this.device.queue, encoder.finish());
		this.timer?.afterSubmit();
	}

	prepare(): boolean {
		return true;
	}

	readonly building = false;

	drawFrame(input: FrameInput, record: FrameRecorder): void {
		const start = performance.now();
		this.timer?.beginFrame(input.frame);
		this.clear(this.context.getCurrentTexture().createView(), input.background);
		this.completions?.afterSubmit(input.frame);
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

	finished(): Promise<void> {
		return this.device.queue.onSubmittedWorkDone();
	}

	drawBlank(): void {
		clearWebGPUCanvas(this.device, this.context);
	}

	destroy(): void {
		this.timer?.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
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

/** The loaded shaders, or a fresh copy that the browser must compile again when the device asks. */
const freshIf = (device: CoreDevice, shaders: DeviceShaders) =>
	device.freshShaders ? saltShaders(shaders, freshSalt()) : shaders;

/** Creates the renderer for a tier on the canvas this thread owns. */
export async function createRenderer(
	canvas: RenderCanvas,
	options: RendererOptions,
): Promise<Renderer> {
	const { scene, device, metrics } = options;
	if (options.tier === 'webgl2') {
		// A canvas keeps the settings of the first request for its context and ignores later ones,
		// so the context is made here with the engine's settings, before anything else asks for it.
		const gl = webgl2Context(canvas, options.powerPreference, device.transparent);
		// After a loss, the context must come back before the engine can draw with it again. A
		// scene's shaders download meanwhile.
		const [, shaders] = await Promise.all([
			contextRestored(gl),
			scene && loadGlslShaders(device.shaderBits).then((loaded) => freshIf(device, loaded)),
		]);
		if (scene && shaders)
			return new WebGL2SceneRenderer(
				canvas,
				gl,
				scene.memory,
				scene.control,
				metrics,
				device,
				options.imageTable,
				shaders,
			);
		return new WebGL2Renderer(canvas, gl, metrics);
	}
	const [gpu, shaders] = await Promise.all([
		requestDevice(options),
		scene && loadWgslShaders(device.shaderBits).then((loaded) => freshIf(device, loaded)),
	]);
	if (scene && shaders)
		return new WebGPUSceneRenderer(
			gpu.tier,
			gpu.device,
			canvas,
			scene.memory,
			scene.control,
			metrics,
			options.imageTable,
			shaders,
			device.transparent,
		);
	return new WebGPURenderer(gpu.tier, gpu.device, canvas, metrics);
}

/** Requests a WebGPU device with the features and limits that the engine uses, and its tier. */
async function requestDevice(options: RendererOptions): Promise<{ tier: Tier; device: GPUDevice }> {
	const adapter = await navigator.gpu?.requestAdapter({
		featureLevel: 'compatibility',
		powerPreference: options.powerPreference,
	});
	if (!adapter) throw new Error('no WebGPU adapter');
	const core = !options.forceCompat && adapter.features.has('core-features-and-limits');
	const requiredFeatures: GPUFeatureName[] = [];
	if (core) requiredFeatures.push('core-features-and-limits' as GPUFeatureName);
	if (options.metrics && adapter.features.has('timestamp-query'))
		requiredFeatures.push('timestamp-query');
	// The compressed formats that the sketch thread picks for KTX2 files, from the same adapter.
	for (const [flag, feature] of TEXTURE_COMPRESSION)
		if (options.device.capabilities & flag && adapter.features.has(feature))
			requiredFeatures.push(feature);
	if (options.device.sceneColor === FORMAT_RG11B10_UFLOAT)
		requiredFeatures.push('rg11b10ufloat-renderable');
	const binding = options.device.storageBindingBytes;
	const device = await adapter.requestDevice({
		requiredFeatures,
		// A buffer as large as a binding must fit the device's largest buffer too.
		requiredLimits: {
			maxStorageBufferBindingSize: binding,
			maxBufferSize: Math.max(binding, DEFAULT_MAX_BUFFER_BYTES),
		},
	});
	return { tier: core ? 'webgpu' : 'webgpu-compat', device };
}
