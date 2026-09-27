// Messages between the page and the engine's workers.

import type { Tier } from '../render/renderer';
import type { Build } from '../shared/core';
import type { Percentiles } from '../shared/stats';

export interface CoreHandoff {
	build: Build;
	module: WebAssembly.Module;
	/** The shared memory of the threaded build; absent for the single-threaded build. */
	memory?: WebAssembly.Memory;
	control: ArrayBufferLike;
}

export interface RendererSetup {
	canvas: OffscreenCanvas;
	tier: Tier;
	forceCompat: boolean;
}

export type GameWorkerInit = CoreHandoff & {
	type: 'init';
	gameUrl: string;
	/** Present in low-latency mode, where the game worker also draws. */
	renderer?: RendererSetup;
};

export type RenderWorkerInit = CoreHandoff & RendererSetup & { type: 'init' };

export type JobWorkerInit = CoreHandoff & { type: 'init'; index: number };

/** Requests any worker that owns a renderer answers. */
export type RendererRequest = { type: 'stats' } | { type: 'capture' };

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
	| { type: 'game-message'; name: string; data: unknown }
	| { type: 'stats'; intervals: Percentiles }
	| { type: 'captured'; width: number; height: number; pixels: Uint8Array };

export type GameWorkerMessage =
	| GameWorkerInit
	| RendererRequest
	| { type: 'post'; name: string; data: unknown };
