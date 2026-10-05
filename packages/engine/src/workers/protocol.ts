// Messages between the page and the engine's workers.

import { setErrorFixes } from '../errors/engine-error';
import type { ErrorFixes } from '../errors/fixes';
import { messageOf } from '../errors/message';
import type { PowerPreference } from '../page/capabilities';
import type { EngineCapabilities } from '../page/engine';
import type { CoreDevice } from '../page/limits';
import type { GlTimingMode } from '../page/switches';
import type { FramePacing } from '../render/loop';
import type { Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { type Build, loadGlue, type StartedCore, startCore } from '../shared/core';
import type { WAKE } from '../shared/wake';
import type { QualityStart, QualityUpdate } from '../sketch/quality';

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
	/**
	 * True when the threads wake each other with messages, where the browser lacks
	 * `Atomics.waitAsync` or ?wake=message acts that out.
	 */
	wakeByMessage: boolean;
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
export interface RendererSetup extends FramePacing {
	canvas: OffscreenCanvas;
	tier: Tier;
	forceCompat: boolean;
	powerPreference?: PowerPreference;
	/** Hold mode: the thread runs no frame loop, and draws the held frame once, when a capture asks. */
	hold?: boolean;
	/** How ?gl-timing asks the WebGL2 path to time each WebGL call for a benchmark page. */
	glTiming?: GlTimingMode;
	/** The features whose shader files load before the first frame, as `createEngine` lists them. */
	preload?: readonly string[];
}

export type SketchWorkerInit = CoreHandoff & {
	type: 'init';
	sketchUrl: string;
	/** The page's address, which the sketch's relative asset addresses resolve against. */
	pageUrl: string;
	/**
	 * The key names, in the order of the numbers that the page gives keys in the input ring. The
	 * page hands them over, so the sketch worker's file needs no copy.
	 */
	keyCodes: readonly string[];
	/** Job workers that serve the sketch's job system. */
	jobWorkers: number;
	/** The GPU path the engine chose, and what it offers, for the sketch's `engine.capabilities`. */
	capabilities: EngineCapabilities;
	/**
	 * Present in low-latency mode, where the sketch worker also draws. A worker that kept the canvas
	 * of an engine that stopped gets no canvas: it draws on the one it kept.
	 */
	renderer?: DrawingWorkerSetup;
	/** Hold mode's sketch time in seconds, which the sketch worker steps the sketch to after setup. */
	hold?: number;
	/** The quality preset and settings that the page chose. */
	quality: QualityStart;
	/** The frame rate that ?fps= holds, or undefined to draw at the display's rate. */
	fps?: number;
	/** The port that texture images go through to the thread that draws, when that is another. */
	imagePort?: MessagePort;
	/** Each engine thread's name and the roles it runs, for `debug.frameStats`. */
	threads: [string, number[]][];
};

/** The setup of a worker that draws, whose canvas is absent when it kept one from an engine before. */
export type DrawingWorkerSetup = Omit<RendererSetup, 'canvas'> & { canvas?: OffscreenCanvas };

export type RenderWorkerInit = CoreHandoff &
	DrawingWorkerSetup & {
		type: 'init';
		/** The port that texture images come through from the sketch worker. */
		imagePort: MessagePort;
	};

export type JobWorkerInit = CoreHandoff & { type: 'init'; index: number };

/**
 * A request any worker that owns a renderer takes: a capture, which it answers with the frame's
 * pixels, or with a PNG file of the frame when `image` is true; a simulated loss; a stop, which it
 * answers once it has destroyed its GPU objects and its device; or a park after the stop, which lets
 * go of the engine's core and keeps the canvas for the next engine.
 */
export type RendererRequest =
	| { type: 'capture'; image?: boolean }
	| { type: 'lose-gpu' }
	| { type: 'stop-drawing' }
	| { type: 'park' };

/**
 * Sent to the worker that draws as soon as the probe has chosen the GPU path, before the core
 * arrives: start the download of the device's shaders for that path and the fixed bits `bits`.
 */
export interface ShaderPreload {
	type: 'load-shaders';
	tier: Tier;
	bits: number;
}

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
	/**
	 * A thread's loop failed after the start, such as the sketch's frame loop, the render loop or a
	 * job worker's part in the job system. The page reports it as E1404.
	 */
	| { type: 'fault'; role: 'sketch' | 'render' | 'job'; index?: number; message: string }
	/** The GPU of the thread that draws ran out of memory or rejected a command; the engine draws on. */
	| { type: 'gpu-error'; role: 'sketch' | 'render'; outOfMemory: boolean; message: string }
	/** A job worker left the job system after the engine stopped, so it no longer blocks. */
	| { type: 'stopped'; role: 'job'; index: number }
	/** The worker that draws stopped drawing, and destroyed its GPU objects and its device. */
	| { type: 'stopped'; role: 'sketch' | 'render' }
	/**
	 * A step of a worker's start, sent as the worker finishes it. The page ignores these; a test
	 * that gets no reply from a worker reads them to learn which step never finished.
	 */
	| { type: 'progress'; role: 'sketch' | 'render' | 'job'; step: string }
	/** The browser took the GPU away from the worker that draws, which stopped drawing. */
	| { type: 'lost'; role: 'sketch' | 'render'; reason: string }
	| { type: 'sketch-message'; name: string; data: unknown }
	/**
	 * The quality preset and settings after a change, for the settings that the page applies, with
	 * the preset check's result once it has run.
	 */
	| { type: 'quality'; update: QualityUpdate }
	/** The sketch asked to show or hide the stats overlay, which the page draws. */
	| { type: 'stats'; show: boolean }
	/** The slot in the label table of a label's id and its generation, or -1 once it has none. */
	| { type: 'label'; id: string; slot: number; generation: number }
	| ({ type: 'captured' } & CapturedFrame)
	| { type: 'captured-image'; image: Blob }
	| { type: 'capture-failed'; message: string };

export type SketchWorkerMessage =
	| SketchWorkerInit
	/** Sent before the core in low-latency mode, where the sketch worker draws: load the renderer. */
	| { type: 'load-renderer' }
	| ShaderPreload
	| RendererRequest
	| { type: 'post'; name: string; data: unknown }
	/** Ends the sketch worker's waits, where the threads wake each other with messages. */
	| typeof WAKE;

/** Sends a reply from a worker to the page, moving the `transfer` objects instead of copying them. */
export function replyToPage(message: WorkerReply, transfer: Transferable[] = []): void {
	postMessage(message, { transfer });
}

/**
 * Sends the page a captured frame, as pixels or as an image file, once `capture` resolves, or the
 * reason it failed.
 */
export async function replyWithCapture(capture: Promise<CapturedFrame | Blob>): Promise<void> {
	try {
		const captured = await capture;
		if (captured instanceof Blob) replyToPage({ type: 'captured-image', image: captured });
		else replyToPage({ type: 'captured', ...captured }, [captured.pixels.buffer]);
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
	// Workers run only the threaded build. The page starts them before the core has compiled, so
	// each imports the core's loader now, and finds it ready when the core arrives.
	void awaitLater(loadGlue('threaded'));
	step('loaded');
	self.onmessage = handle;
}
