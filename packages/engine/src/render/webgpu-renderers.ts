// The renderers of the WebGPU path. A thread downloads this file only when it draws with WebGPU, so
// a page that draws with WebGL2 never downloads the WebGPU backend.

import { SKINNING_FULL, SKINNING_SKIP_ONLY } from '../generated/core';
import { clearWebGPUCanvas } from '../gpu/canvas-release';
import { QueueCompletion } from '../gpu/completion';
import type { DeviceShaderSet } from '../gpu/device-shaders';
import { captureWebGPU } from '../gpu/readback';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import { RenderPassSetup, submitOne } from '../gpu/webgpu/reusable';
import type { ImageTable } from '../shared/images';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { deviceLoss, type GpuErrorReport, GpuErrorWatch } from './loss';
import {
	type FrameInput,
	linearToSrgb,
	type RenderCanvas,
	type Renderer,
	type RendererOptions,
	type Tier,
} from './renderer';
import { FrameReplay, recordCounts } from './scene-renderer';

/**
 * The renderer on a WebGPU device: the scene's renderer for a thread that draws a scene with
 * `shaders`, else one that clears to each frame's background.
 */
export function webgpuRenderer(
	gpu: { tier: Tier; device: GPUDevice },
	canvas: RenderCanvas,
	options: RendererOptions,
	shaders: DeviceShaderSet | undefined,
): Renderer {
	const { scene, metrics } = options;
	if (!scene || !shaders)
		return new WebGPURenderer(gpu.tier, gpu.device, canvas, metrics, options.gpuError);
	const renderer = new WebGPUSceneRenderer(
		gpu.tier,
		gpu.device,
		canvas,
		scene.memory,
		scene.control,
		metrics,
		options.imageTable,
		shaders,
		options.device.transparent,
		options.gpuError,
	);
	renderer.setSkinningMode(options.device.skinning);
	return renderer;
}

class WebGPURenderer implements Renderer {
	readonly transparent = false;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly timer: GpuTimer | undefined;
	private readonly pass = new RenderPassSetup();
	/** The clear color as the pass setup reads it, opaque. */
	private readonly clearColor = Float32Array.of(0, 0, 0, 1);
	readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly lost: Promise<string>;
	readonly errors: GpuErrorWatch;

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		readonly canvas: RenderCanvas,
		metrics: ArrayBufferLike | undefined,
		gpuError?: GpuErrorReport,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		this.errors = new GpuErrorWatch(device, gpuError);
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
		const color = this.clearColor;
		color[0] = linearToSrgb(background[0]);
		color[1] = linearToSrgb(background[1]);
		color[2] = linearToSrgb(background[2]);
		pass.setColor(view, undefined, true, true, color, 0);
		pass.setTimestampWrites(this.timer?.passWrites(true));
		encoder.beginRenderPass(pass.descriptor).end();
		this.timer?.endFrame();
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
		const pixels = await captureWebGPU(this.device, width, height, 'rgba8unorm', (texture) =>
			this.clear(texture.createView(), input.background),
		);
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
		this.errors.stop();
		this.timer?.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
}

class WebGPUSceneRenderer implements Renderer {
	private readonly backend: WebGPUBackend;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly frames: FrameReplay;
	readonly completions: QueueCompletion | undefined;
	private simulated = false;
	/**
	 * True once a frame has had a reader of the frame figures: the reader of the GPU-culled draws'
	 * counts then loads, so a page that never shows them never downloads it.
	 */
	private culledLoading = false;
	private destroyed = false;
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
		this.backend.timer = metrics && GpuTimer.create(device, metrics, this.backend.gpuMemory);
		this.completions = metrics && new QueueCompletion(device.queue, metrics);
		this.frames = new FrameReplay(this.backend, memory, control);
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	/** Makes the skinning pass write 32-bit float directions where core skinning mode `mode` asks. */
	setSkinningMode(mode: number): void {
		if (mode === SKINNING_FULL || mode === SKINNING_SKIP_ONLY)
			this.backend.skinWithFloatDirections();
	}

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
		const figures = record.figures;
		if (figures && !this.culledLoading) this.loadCulledCounts();
		backend.culled?.beginFrame(figures);
		this.frames.replay(input.frame);
		this.completions?.afterSubmit(input.frame);
		record.addPhase(Phase.Replay, performance.now() - start);
		const culled = backend.culled;
		// Until the culled draws' counts come back, the frame's figures leave its counts out.
		const uncounted = figures && !culled?.known;
		if (culled?.known) {
			backend.counts.triangles += culled.triangles;
			backend.counts.instances += culled.instances;
		}
		record.count(Counter.UncountedFigures, uncounted ? 1 : 0);
		recordCounts(record, backend);
	}

	private loadCulledCounts(): void {
		this.culledLoading = true;
		import('../gpu/webgpu/culled-counts').then(({ CulledCounts }) => {
			if (!this.destroyed)
				this.backend.culled = new CulledCounts(this.device, this.backend.gpuMemory);
		}, console.warn);
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
		this.destroyed = true;
		this.frames.abandon();
		this.errors.stop();
		this.backend.timer?.destroy();
		this.backend.culled?.destroy();
		this.backend.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
}
