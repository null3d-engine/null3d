// The renderer interface. The same renderer runs in the render worker (pipelined mode), in the sketch
// worker (low-latency mode) or on the page's main thread (single-threaded mode and ?render=main).

import type { CompletionSignal } from '../gpu/completion';
import type { PowerPreference } from '../page/capabilities';
import type { CoreDevice } from '../page/limits';
import type { ImageTable } from '../shared/images';
import type { FrameRecorder } from '../shared/metrics';

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
	/** How the renderer learns that the GPU finished a frame, which it counts while the page measures. */
	readonly completion: CompletionSignal;
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
	 * The device as the engine uses it: the storage binding to request, and how WebGL2 uploads and
	 * stores depth.
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

/** Encodes a linear color channel as sRGB, the way the final output does. */
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/**
 * Creates the renderer of one GPU path on the canvas this thread owns. Each path's module
 * exports its own, so a thread loads only the path it draws with.
 */
export type CreateRenderer = (canvas: RenderCanvas, options: RendererOptions) => Promise<Renderer>;
