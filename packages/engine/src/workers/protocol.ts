// Messages between the page and the engine's workers.

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
}

export interface RendererSetup {
	canvas: OffscreenCanvas;
	tier: Tier;
	forceCompat: boolean;
}

export type GameWorkerInit = CoreHandoff & {
	type: 'init';
	gameUrl: string;
	/** Job workers that serve the game's job system. */
	jobWorkers: number;
	/** Present in low-latency mode, where the game worker also draws. */
	renderer?: RendererSetup;
};

export type RenderWorkerInit = CoreHandoff & RendererSetup & { type: 'init' };

export type JobWorkerInit = CoreHandoff & { type: 'init'; index: number };

/** A request any worker that owns a renderer takes: a capture, which it answers, or a simulated loss. */
export type RendererRequest = { type: 'capture' } | { type: 'lose-gpu' };

export type WorkerReply =
	| {
			type: 'ready';
			role: 'game' | 'render' | 'job';
			index?: number;
			threaded: boolean;
			version: string;
			tier?: Tier;
	  }
	| { type: 'error'; role: 'game' | 'render' | 'job'; message: string }
	/** The browser took the GPU away from the worker that draws, which stopped drawing. */
	| { type: 'lost'; role: 'game' | 'render'; reason: string }
	| { type: 'game-message'; name: string; data: unknown }
	| { type: 'captured'; width: number; height: number; pixels: Uint8Array };

export type GameWorkerMessage =
	| GameWorkerInit
	| RendererRequest
	| { type: 'post'; name: string; data: unknown };
