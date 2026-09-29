// Messages between the page and the engine's workers.

import type { PowerPreference } from '../page/capabilities';
import type { CoreDevice } from '../page/limits';
import type { Tier } from '../render/renderer';
import type { Build } from '../shared/core';

export interface CoreHandoff {
	build: Build;
	module: WebAssembly.Module;
	/** The shared memory of the threaded build; absent for the single-threaded build. */
	memory?: WebAssembly.Memory;
	control: ArrayBufferLike;
	/** Per-frame timing records, which every thread writes and the page reads. */
	metrics: ArrayBufferLike;
	/** The device the engine draws with, as the core and the renderer use it. */
	device: CoreDevice;
}

export interface RendererSetup {
	canvas: OffscreenCanvas;
	tier: Tier;
	forceCompat: boolean;
	powerPreference?: PowerPreference;
}

export type SketchWorkerInit = CoreHandoff & {
	type: 'init';
	sketchUrl: string;
	/** Job workers that serve the sketch's job system. */
	jobWorkers: number;
	/** Present in low-latency mode, where the sketch worker also draws. */
	renderer?: RendererSetup;
};

export type RenderWorkerInit = CoreHandoff & RendererSetup & { type: 'init' };

export type JobWorkerInit = CoreHandoff & { type: 'init'; index: number };

/** A request any worker that owns a renderer takes: a capture, which it answers, or a simulated loss. */
export type RendererRequest = { type: 'capture' } | { type: 'lose-gpu' };

export type WorkerReply =
	| {
			type: 'ready';
			role: 'sketch' | 'render' | 'job';
			index?: number;
			threaded: boolean;
			version: string;
			tier?: Tier;
	  }
	| { type: 'error'; role: 'sketch' | 'render' | 'job'; message: string }
	/** The browser took the GPU away from the worker that draws, which stopped drawing. */
	| { type: 'lost'; role: 'sketch' | 'render'; reason: string }
	| { type: 'sketch-message'; name: string; data: unknown }
	| { type: 'captured'; width: number; height: number; pixels: Uint8Array };

export type SketchWorkerMessage =
	| SketchWorkerInit
	| RendererRequest
	| { type: 'post'; name: string; data: unknown };
