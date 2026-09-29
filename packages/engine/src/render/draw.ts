// What a thread needs to draw: the renderer, the GPU layer beneath it and the frame loops. The
// render worker always draws. The page draws in single-threaded mode and with ?render=main, and the
// sketch worker in low-latency mode, so those two load this module only when they draw
// (load-draw.ts). A page then downloads the GPU layer once, for the thread that draws.

import { controlViews, Slot } from '../shared/control';
import type { SketchRunner } from '../sketch/runner';
import { runDirectLoop } from './direct-loop';
import { emptySceneInput, runRenderLoop } from './loop';
import { Drawing } from './recovery';
import { createRenderer, type RenderCanvas, type Renderer, type RendererOptions } from './renderer';

export interface DrawingSetup extends RendererOptions {
	/** The canvas that this thread owns. */
	canvas: RenderCanvas;
	metrics: ArrayBufferLike;
	control: ArrayBufferLike;
	/** The frame rate that ?fps= holds, or undefined to draw at the display's rate. */
	fps?: number;
	/**
	 * The sketch that this thread runs, which it steps before each draw. Without one, the thread
	 * draws the frames that the sketch worker publishes.
	 */
	sketch?: SketchRunner;
	/** Hears the reason when the engine stops drawing after GPU losses. */
	fail: (reason: string) => void;
}

/** Starts drawing on this thread's canvas, with a new renderer after each GPU loss. */
export async function startDrawing(setup: DrawingSetup): Promise<Drawing<Renderer>> {
	const { canvas, control, metrics, fps, sketch } = setup;
	const create = () => createRenderer(canvas, setup);
	const run = (renderer: Renderer) =>
		sketch
			? runDirectLoop(sketch, renderer, control, metrics, fps)
			: runRenderLoop(renderer, control, metrics, fps);
	return new Drawing(await create(), create, run, controlViews(control).slots, setup.fail);
}

/** Draws the newest frame offscreen and returns its pixels as RGBA8 rows, top row first. */
export function captureFrame(
	drawing: Drawing<Renderer>,
	slots: Int32Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
	return drawing.renderer.capture(emptySceneInput(Atomics.load(slots, Slot.FramesTaken)));
}
