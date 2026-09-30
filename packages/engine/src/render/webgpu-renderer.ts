// The WebGPU renderers, for core WebGPU and compatibility mode. A thread that draws with WebGPU
// loads this module, and never the WebGL2 renderers, so a page downloads one GPU path only.
// With the frame loops, the module is the path's `DrawModule`.

import { type CompletionSignal, QueueCompletion } from '../gpu/completion';
import { readbackWebGPU } from '../gpu/readback';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import { RenderPassSetup, submitOne } from '../gpu/webgpu/reusable';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { captureFrame, type DrawingSetup, startDrawingWith } from './draw';
import { DrawLists } from './draw-lists';
import { deviceLoss } from './loss';
import type { Drawing } from './recovery';
import {
	type FrameInput,
	linearToSrgb,
	type RenderCanvas,
	type Renderer,
	type RendererOptions,
	type Tier,
} from './renderer';

/** WebGPU's default `maxBufferSize`, which every device offers. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

class WebGPURenderer implements Renderer {
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly timer: GpuTimer | undefined;
	private readonly pass = new RenderPassSetup();
	private readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly completion: CompletionSignal = 'queue';
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

	destroy(): void {
		this.timer?.destroy();
		this.context.unconfigure();
		this.device.destroy();
	}
}

class WebGPUSceneRenderer implements Renderer {
	private readonly backend: WebGPUBackend;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly lists: DrawLists;
	private readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly completion: CompletionSignal = 'queue';
	readonly lost: Promise<string>;

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		memory: WebAssembly.Memory,
		control: ArrayBufferLike,
		metrics: ArrayBufferLike | undefined,
	) {
		this.lost = deviceLoss(device, () => this.simulated);
		const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
		if (!context) throw new Error('the canvas has no WebGPU context');
		this.context = context;
		this.format = navigator.gpu.getPreferredCanvasFormat();
		context.configure({ device, format: this.format, alphaMode: 'opaque' });
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

/** Creates the WebGPU renderer on the canvas this thread owns. */
export async function createRenderer(
	canvas: RenderCanvas,
	options: RendererOptions,
): Promise<Renderer> {
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
	const binding = options.device.storageBindingBytes;
	const device = await adapter.requestDevice({
		requiredFeatures,
		// A buffer as large as a binding must fit the device's largest buffer too.
		requiredLimits: {
			maxStorageBufferBindingSize: binding,
			maxBufferSize: Math.max(binding, DEFAULT_MAX_BUFFER_BYTES),
		},
	});
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

/** Starts drawing with WebGPU on this thread's canvas, with a new renderer after each GPU loss. */
export function startDrawing(setup: DrawingSetup): Promise<Drawing<Renderer>> {
	return startDrawingWith(createRenderer, setup);
}

export { captureFrame };
