// What a comparison page and its three.js worker say to each other. three.js runs in one worker
// with an OffscreenCanvas, so the page starts, counts, measures and stops it with these messages.

import type { CompareMode, Effects } from './compare-scene';

/** three.js's two renderers: WebGLRenderer, and WebGPURenderer on WebGPU. */
export type ThreeRenderer = 'webgl' | 'webgpu';

/** How the worker starts its scene. */
export interface ThreeStart {
	/** The largest count of this run, which the instanced mode makes room for up front. */
	capacity: number;
	/** The count to start at. */
	count: number;
	/** How the scene is built: a tree of objects per part, or a batch of copies per part kind. */
	mode: CompareMode;
	effects: Effects;
	renderer: ThreeRenderer;
	/** WebGPURenderer in its WebGL2 mode: a comparison that needs it on the WebGL2 path. */
	forceWebGL?: boolean;
	/** The canvas's size in CSS pixels, and the device pixels per CSS pixel to draw at. */
	width: number;
	height: number;
	pixelRatio: number;
	/** Draw one frame at this simulation time, read it back and stop, or null for a live run. */
	hold: number | null;
	/** True times the GPU's work where the renderer can: the stats panel shows it while open. */
	gpuTimer: boolean;
}

/** The worker's figures, which the page's stats panel shows. Means over the last window of frames. */
export interface ThreeFigures {
	/** Frames in the window, 0 before the first window ended. */
	frames: number;
	fps: number;
	/** CPU time per frame on the worker: the scene's code and three.js's drawing. */
	busyMs: number;
	/** The part that the scene's own code takes: its simulation steps and its poses. */
	codeMs: number;
	/** The part that three.js's render calls take. */
	renderMs: number;
	gpuMs: number | null;
	drawCalls: number;
	triangles: number;
	/** Instances drawn, over every draw of every pass. */
	objects: number;
	geometries: number;
	textures: number;
}

export type ToThree =
	| { type: 'start'; canvas: OffscreenCanvas; options: ThreeStart }
	| { type: 'count'; count: number }
	| { type: 'measure'; id: number; seconds: number }
	/** True while the page's stats panel is open: the worker then samples its costly figures. */
	| { type: 'sample'; on: boolean }
	| { type: 'resize'; width: number; height: number; pixelRatio: number }
	| { type: 'stop' };

export type FromThree =
	| { type: 'started'; renderer: string; version: string; gpuTimer: boolean }
	| { type: 'failed'; message: string }
	| {
			type: 'measured';
			id: number;
			fps: number;
			cpuMs: number | null;
			/** The scene's own code and the render calls, the two parts of `cpuMs`. */
			codeMs: number | null;
			renderMs: number | null;
			frames: number;
	  }
	/** The frame rate, a few times a second, which the panel's header shows. */
	| { type: 'rate'; frames: number; fps: number }
	| { type: 'figures'; figures: ThreeFigures }
	| { type: 'held'; width: number; height: number; pixels: Uint8Array };
