// The WebGPU renderer of the scene. The game thread records each frame into a draw list in engine
// memory; this renderer replays the frame's list straight from that memory, and records the
// frame's GPU time, upload bytes and draw calls.

import { type CompletionSignal, QueueCompletion } from '../gpu/completion';
import { readbackWebGPU } from '../gpu/readback';
import { WebGPUBackend } from '../gpu/webgpu/backend';
import { GpuTimer } from '../gpu/webgpu/gpu-timer';
import { controlViews, Slot } from '../shared/control';
import { Counter, type FrameRecorder, Phase } from '../shared/metrics';
import { deviceLoss } from './loss';
import type { FrameInput, RenderCanvas, Renderer, Tier } from './renderer';

export class WebGPUSceneRenderer implements Renderer {
	private readonly backend: WebGPUBackend;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly slots: Int32Array;
	private viewsOf: ArrayBufferLike | undefined;
	private words = new Uint32Array(0);
	private floats = new Float32Array(0);
	private readonly completions: QueueCompletion | undefined;
	private simulated = false;
	readonly completion: CompletionSignal = 'queue';
	readonly lost: Promise<string>;

	constructor(
		readonly tier: Tier,
		private readonly device: GPUDevice,
		private readonly canvas: RenderCanvas,
		private readonly memory: WebAssembly.Memory,
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
		this.slots = controlViews(control).slots;
	}

	/** The frame's draw list resizes the canvas, in the frame built for the new size. */
	resize(): void {}

	private replay(frame: number): void {
		const buffer = this.memory.buffer;
		if (buffer !== this.viewsOf) {
			this.words = new Uint32Array(buffer);
			this.floats = new Float32Array(buffer);
			this.viewsOf = buffer;
		}
		const parity = frame & 1;
		const start = Atomics.load(this.slots, Slot.DrawListAddress0 + parity) / 4;
		const length = Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		this.backend.replay(this.words, this.floats, start, start + length, buffer);
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
		record.count(Counter.Rebuilds, backend.counts.bundles);
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
