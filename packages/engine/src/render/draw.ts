// What a thread needs to draw, apart from the renderer of its GPU path: the frame loops and the
// recovery after GPU losses. Each GPU path's renderer module binds them to its renderer, as that
// path's `DrawModule`. The render worker always draws. The page draws in single-threaded mode and
// with ?render=main, and the sketch worker in low-latency mode, so those two load their path's
// module only when they draw. A page then downloads the GPU layer once, for the thread that draws,
// and for its own GPU path only.

import { controlViews, Slot } from '../shared/control';
import type { SketchRunner } from '../sketch/runner';
import { runDirectLoop } from './direct-loop';
import { emptySceneInput, HoldLoop, runRenderLoop } from './loop';
import { Drawing } from './recovery';
import type { CreateRenderer, RenderCanvas, Renderer, RendererOptions } from './renderer';

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
	/**
	 * Hold mode: the thread runs no frame loop. It draws the frame that the sketch holds once, when
	 * a capture first asks for it, and a GPU loss ends the hold instead of starting a new device.
	 */
	hold?: boolean;
	/** Hears the reason when the engine stops drawing after GPU losses. */
	fail: (reason: string) => void;
}

/** What a thread that draws uses: the frame loops with the renderer of one GPU path. */
export interface DrawModule {
	/** Starts drawing on this thread's canvas, with a new renderer after each GPU loss. */
	startDrawing(setup: DrawingSetup): Promise<Drawing<Renderer>>;
	captureFrame: typeof captureFrame;
}

/**
 * Starts drawing on this thread's canvas with the renderer that `createRenderer` makes, and with a
 * new one after each GPU loss.
 */
export async function startDrawingWith(
	createRenderer: CreateRenderer,
	setup: DrawingSetup,
): Promise<Drawing<Renderer>> {
	const { canvas, control, metrics, fps, sketch, hold = false } = setup;
	const { slots } = controlViews(control);
	const create = () => createRenderer(canvas, setup);
	const run = (renderer: Renderer) =>
		hold
			? new HoldLoop(slots, renderer, metrics)
			: sketch
				? runDirectLoop(sketch, renderer, control, metrics, fps)
				: runRenderLoop(renderer, control, metrics, fps);
	return new Drawing(await create(), create, run, slots, setup.fail, !hold);
}

/**
 * Draws the newest frame offscreen and returns its pixels as RGBA8 rows, top row first. In hold
 * mode, it first draws the held frame on the canvas, if it is not there yet.
 */
export async function captureFrame(
	drawing: Drawing<Renderer>,
	slots: Int32Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
	await drawing.drawHeld();
	return drawing.renderer.capture(emptySceneInput(Atomics.load(slots, Slot.FramesTaken)));
}
