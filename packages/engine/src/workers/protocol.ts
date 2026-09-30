// Messages between the page and the engine's workers.

import { setErrorFixes } from '../errors/engine-error';
import type { ErrorFixes } from '../errors/fixes';
import { messageOf } from '../errors/message';
import type { PowerPreference } from '../page/capabilities';
import type { CoreDevice } from '../page/limits';
import type { Tier } from '../render/renderer';
import { type Build, type StartedCore, startCore } from '../shared/core';

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
	/** The page's table of error fixes, so a worker's errors carry the same messages as the page's. */
	errorFixes: ErrorFixes;
}

/**
 * Starts the engine core in a worker from what the page handed it. The worker takes the page's
 * error fixes first, so every error it raises from then on carries its full message.
 */
export function startWorkerCore(
	handoff: CoreHandoff,
	step: (name: string) => void,
): Promise<StartedCore> {
	setErrorFixes(handoff.errorFixes);
	return startCore(handoff.build, handoff.module, handoff.memory, step);
}

/** A frame read back from the GPU: its pixels as RGBA8 rows, top row first. */
export interface CapturedFrame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** What the thread that draws needs: its canvas, the GPU path and how it paces its frames. */
export interface RendererSetup {
	canvas: OffscreenCanvas;
	tier: Tier;
	forceCompat: boolean;
	powerPreference?: PowerPreference;
	/** The frame rate that ?fps= holds, or undefined to draw at the display's rate. */
	fps?: number;
	/** The most frames that ?queue= lets wait on the GPU, or undefined for the engine's limit. */
	queue?: number;
	/** Hold mode: the thread runs no frame loop, and draws the held frame once, when a capture asks. */
	hold?: boolean;
}

export type SketchWorkerInit = CoreHandoff & {
	type: 'init';
	sketchUrl: string;
	/**
	 * The key names, in the order of the numbers that the page gives keys in the input ring. The
	 * page hands them over, so the sketch worker's file needs no copy.
	 */
	keyCodes: readonly string[];
	/** Job workers that serve the sketch's job system. */
	jobWorkers: number;
	/** Present in low-latency mode, where the sketch worker also draws. */
	renderer?: RendererSetup;
	/** Hold mode's sketch time in seconds, which the sketch worker steps the sketch to after setup. */
	hold?: number;
	/** The port that texture images go through to the thread that draws, when that is another. */
	imagePort?: MessagePort;
};

export type RenderWorkerInit = CoreHandoff &
	RendererSetup & {
		type: 'init';
		/** The port that texture images come through from the sketch worker. */
		imagePort: MessagePort;
	};

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
	/** A job worker left the job system after the engine stopped, so it no longer blocks. */
	| { type: 'stopped'; role: 'job'; index: number }
	/**
	 * A step of a worker's start, sent as the worker finishes it. The page ignores these; a test
	 * that gets no reply from a worker reads them to learn which step never finished.
	 */
	| { type: 'progress'; role: 'sketch' | 'render' | 'job'; step: string }
	/** The browser took the GPU away from the worker that draws, which stopped drawing. */
	| { type: 'lost'; role: 'sketch' | 'render'; reason: string }
	| { type: 'sketch-message'; name: string; data: unknown }
	| ({ type: 'captured' } & CapturedFrame)
	| { type: 'capture-failed'; message: string };

export type SketchWorkerMessage =
	| SketchWorkerInit
	| RendererRequest
	| { type: 'post'; name: string; data: unknown };

/** Sends a reply from a worker to the page, moving the `transfer` objects instead of copying them. */
export function replyToPage(message: WorkerReply, transfer: Transferable[] = []): void {
	postMessage(message, { transfer });
}

/** Sends the page a captured frame once `capture` resolves, or the reason it failed. */
export async function replyWithCapture(capture: Promise<CapturedFrame>): Promise<void> {
	try {
		const captured = await capture;
		replyToPage({ type: 'captured', ...captured }, [captured.pixels.buffer]);
	} catch (e) {
		replyToPage({ type: 'capture-failed', message: messageOf(e) });
	}
}

/** Returns a function that reports each step of a worker's start to the page as it finishes. */
export function startSteps(role: 'sketch' | 'render' | 'job'): (step: string) => void {
	return (step) => replyToPage({ type: 'progress', role, step });
}

/**
 * Starts a worker on the first run of its entry file in the thread: reports the first step, and
 * handles the page's messages with `handle`. Safari runs a module worker's entry file again when
 * another file imports it (WebKit bug 324459). A production build's files that a worker loads later
 * import the entry file for the code they share with it. A later run starts nothing, so the handler
 * of the first run keeps the worker's state.
 */
export function startWorker<Message>(
	role: 'sketch' | 'render' | 'job',
	step: (name: string) => void,
	handle: (event: MessageEvent<Message>) => unknown,
): void {
	const started = Symbol.for(`null3d.${role}WorkerStarted`);
	const thread = globalThis as { [started]?: true };
	if (thread[started]) return;
	thread[started] = true;
	step('loaded');
	self.onmessage = handle;
}
