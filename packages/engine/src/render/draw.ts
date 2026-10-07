// What a thread needs to draw: the renderer, the GPU layer beneath it and the frame loops. The
// render worker always draws. The page draws in single-threaded mode and with ?render=main, and the
// sketch worker in low-latency mode, so those two load this module only when they draw
// (load-draw.ts). A page then downloads the GPU layer once, for the thread that draws.

import { controlViews, Slot } from '../shared/control';
import { encodeFrame } from '../shared/frame-image';
import { type GeneratorName, ImageTable, receiveImages } from '../shared/images';
import type { Tier } from '../shared/tier';
import type { SketchRunner } from '../sketch/runner';
import { runDirectLoop } from './direct-loop';
import { emptySceneInput, type FramePacing, HoldLoop, type LoopFault, runRenderLoop } from './loop';
import { Drawing } from './recovery';
import { createRenderer, type RenderCanvas, type Renderer, type RendererOptions } from './renderer';

export { preloadDeviceShaders } from './renderer';

export interface DrawingSetup extends RendererOptions, FramePacing {
	/** The canvas that this thread owns. */
	canvas: RenderCanvas;
	metrics: ArrayBufferLike;
	control: ArrayBufferLike;
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
	/**
	 * Hears an error that ended the frame loop. Without it the error goes on to the thread's error
	 * handler, which in a worker tells the page that the worker failed.
	 */
	fault?: LoopFault;
	/**
	 * Runs after each frame that this thread presents, once the frame's labels are in place: the
	 * page moves its label elements there when it draws.
	 */
	presented?: () => void;
	/**
	 * The port through which the sketch thread sends texture images, when another thread runs it.
	 * Wake messages go back to the sketch thread through it.
	 */
	imagePort?: MessagePort;
}

/**
 * Starts drawing on this thread's canvas, with a new renderer after each GPU loss. The images for
 * texture uploads come through the setup's port, or into its table from the sketch that this thread
 * runs, and every renderer reads them.
 */
export async function startDrawing(setup: DrawingSetup): Promise<Drawing<Renderer>> {
	const { canvas, control, metrics, sketch, hold = false, fault, presented } = setup;
	const { slots } = controlViews(control);
	const imageTable = setup.imageTable ?? new ImageTable();
	imageTable.loadGeneratorsWith(generatorLoader(setup.tier));
	const receiving = setup.imagePort && receiveImages(setup.imagePort, imageTable, slots);
	const options = { ...setup, imageTable };
	const create = () => createRenderer(canvas, options);
	const run = (renderer: Renderer) =>
		hold
			? new HoldLoop(slots, renderer, metrics, presented)
			: sketch
				? runDirectLoop(sketch, renderer, control, metrics, setup, fault, presented)
				: runRenderLoop(renderer, control, metrics, setup, setup.imagePort, fault, presented);
	const renderer = await create();
	// Firefox can fail to read an image that reached this thread while it made its first renderer,
	// so the sketch thread sends its images only once the renderer exists.
	receiving?.();
	return new Drawing(renderer, create, run, slots, setup.fail, !hold, () => imageTable.clear());
}

/**
 * Loads the texture generators' code and shaders for a GPU path, as the backend of that path runs
 * them: a page downloads them with the first generator that its sketch asks for.
 */
function generatorLoader(tier: Tier): () => Promise<unknown> {
	if (tier === 'webgl2')
		return async () => {
			const [code, shaders] = await Promise.all([
				import('../gpu/environment'),
				import('../generated/shaders-environment-glsl'),
			]);
			const room = code.webgl2RoomGenerator(shaders.ENVIRONMENT_SHADER.webgl2);
			return { room } satisfies Record<GeneratorName, unknown>;
		};
	return async () => {
		const [code, shaders] = await Promise.all([
			import('../gpu/environment'),
			import('../generated/shaders-environment-wgsl'),
		]);
		const room = code.webgpuRoomGenerator(shaders.ENVIRONMENT_SHADER.webgpu);
		return { room } satisfies Record<GeneratorName, unknown>;
	};
}

/**
 * Waits for the frame loop to take its next frame, then draws that frame again offscreen and returns
 * its pixels as RGBA8 rows, top row first. In hold mode, it first draws the held frame on the
 * canvas, if it is not there yet.
 */
export async function captureFrame(
	drawing: Drawing<Renderer>,
	slots: Int32Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
	await drawing.nextFrame();
	return drawing.renderer.capture(emptySceneInput(Atomics.load(slots, Slot.FramesTaken)));
}

/**
 * Draws the next frame offscreen, as `captureFrame` does, and encodes it as a PNG file, as
 * `encodeFrame` describes.
 */
export async function captureImage(drawing: Drawing<Renderer>, slots: Int32Array): Promise<Blob> {
	return encodeFrame(await captureFrame(drawing, slots), drawing.renderer.transparent);
}
