// The sketch worker: runs the sketch's code and the engine core. In pipelined mode it computes frame
// N+1 while the render worker draws frame N, and waits for the render worker's signal without
// blocking, so its event loop stays alive for promises and messages. In low-latency mode it
// also owns the canvas and draws each frame itself; only then does it load the renderer. When the
// engine stops, the sketch's onDestroy runs here. A worker that drew keeps the canvas, which cannot
// go back to the page: it frees its GPU device and lets go of the engine's core, and the next
// engine on the same canvas starts it again.

import { messageOf } from '../errors/message';
import { type DrawModule, loadDrawModule, preloadShaders } from '../render/load-draw';
import type { Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { drawingSenders, ImageTable } from '../shared/images';
import { clearJobTasks, type JobTaskHost, setJobTasks } from '../shared/task-host';
import { setWakeByMessage, wakeWaiters } from '../shared/wake';
import { loadSketch } from '../sketch/define-sketch';
import { runPipelined, SketchRunner } from '../sketch/runner';
import { DrawingHost } from './drawing-host';
import {
	replyToPage,
	replyWithCapture,
	type SketchWorkerMessage,
	startSteps,
	startWorker,
	startWorkerCore,
} from './protocol';

let runner: SketchRunner | undefined;
/** The renderer, which this worker loads only in low-latency mode, where it draws. */
let drawLoad: Promise<DrawModule> | undefined;
let draw: DrawModule | undefined;
let host = new DrawingHost();
let controlSlots: Int32Array | undefined;
/** The canvas that the first engine moved here in low-latency mode, which later engines draw on. */
let canvas: OffscreenCanvas | undefined;
let core: CoreGlue | undefined;
/** The job workers' task ports that this worker's on-demand loader uses while the engine runs. */
let jobTaskHost: JobTaskHost | undefined;

const step = startSteps('sketch');

startWorker('sketch', step, async (event: MessageEvent<SketchWorkerMessage>) => {
	const message = event.data;
	if (message.type === 'load-renderer') {
		drawLoad ??= loadDrawModule();
	} else if (message.type === 'load-shaders') {
		drawLoad ??= loadDrawModule();
		preloadShaders(drawLoad, message.tier, message.bits);
	} else if (message.type === 'init') {
		try {
			// The renderer loads while the core and the sketch start, if the page did not ask for it
			// sooner.
			if (message.renderer) drawLoad ??= loadDrawModule();
			const drawModule = message.renderer && drawLoad;
			canvas = message.renderer?.canvas ?? canvas;
			if (message.renderer && !canvas) throw new Error('the page gave the sketch worker no canvas');
			host = new DrawingHost();
			const control = controlViews(message.control);
			controlSlots = control.slots;
			setWakeByMessage(message.wakeByMessage);
			const started = await startWorkerCore(message, step);
			const glue = started.glue;
			core = glue;
			jobTaskHost = { ports: message.taskPorts, call: (index) => glue.callJobWorker(index) };
			setJobTasks(jobTaskHost);
			const memory = started.memory as WebAssembly.Memory;
			// Texture images and custom materials' shaders go to the thread that draws: another
			// through a port, or this one.
			const imageTable = new ImageTable();
			const senders = drawingSenders(imageTable, control.slots, message.imagePort);
			runner = new SketchRunner(
				(name, data, transfer) => replyToPage({ type: 'sketch-message', name, data }, transfer),
				message.metrics,
				{
					glue: core,
					memory,
					control,
					keyCodes: message.keyCodes,
					jobWorkers: message.jobWorkers,
					device: message.device,
					quality: message.quality,
					applyQuality: (update) => replyToPage({ type: 'quality', update }),
					capabilities: message.capabilities,
					...senders,
					pageUrl: message.pageUrl,
					fps: message.fps,
					threads: message.threads,
					showStats: (show) => replyToPage({ type: 'stats', show }),
					sendLabelSlot: (id, slot, generation) =>
						replyToPage({ type: 'label', id, slot, generation }),
				},
				message.hold,
			);
			step('engine created');
			// The sketch downloads while the renderer starts. The renderer starts before the setup,
			// so a warm-up in the setup has a renderer to build its pipelines.
			const sketch = awaitLater(loadSketch(message.sketchUrl));
			/** The GPU path that this worker draws with, in low-latency mode. */
			let tier: Tier | undefined;
			if (message.renderer && drawModule) {
				draw = await drawModule;
				step('renderer loaded');
				const drawing = await host.start(
					draw.startDrawing({
						...message.renderer,
						canvas: canvas as OffscreenCanvas,
						metrics: message.metrics,
						device: message.device,
						scene: { memory, control: message.control },
						control: message.control,
						sketch: runner,
						imageTable,
						fail: (reason) => replyToPage({ type: 'lost', role: 'sketch', reason }),
						fault,
						gpuError: (outOfMemory, text) =>
							replyToPage({ type: 'gpu-error', role: 'sketch', outOfMemory, message: text }),
					}),
				);
				if (!drawing) return;
				tier = drawing.renderer.tier;
			}
			await runner.setup(await sketch);
			step(message.hold === undefined ? 'sketch loaded' : 'sketch loaded and held');
			if (!tier && message.hold === undefined) void runPipelined(runner, message.control, fault);
			replyToPage({
				type: 'ready',
				role: 'sketch',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier,
			});
		} catch (e) {
			await host.release();
			replyToPage({
				type: 'error',
				role: 'sketch',
				message: messageOf(e),
			});
		}
	} else if (message.type === 'wake') {
		wakeWaiters();
	} else if (message.type === 'post') {
		runner?.receive(message.name, message.data);
	} else if (message.type === 'capture' && draw && host.drawing && controlSlots) {
		const capture = message.image ? draw.captureImage : draw.captureFrame;
		await replyWithCapture(capture(host.drawing, controlSlots));
	} else if (message.type === 'lose-gpu') {
		host.drawing?.simulateLoss();
	} else if (message.type === 'stop-drawing') {
		runner?.dispose();
		runner = undefined;
		await host.stop('sketch');
	} else if (message.type === 'park') {
		controlSlots = undefined;
		clearJobTasks(jobTaskHost);
		jobTaskHost = undefined;
		core?.releaseInstance?.();
		core = undefined;
	}
});

/** Tells the page that the sketch's frame loop, or the drawing in low-latency mode, failed. */
function fault(error: unknown): void {
	replyToPage({ type: 'fault', role: 'sketch', message: messageOf(error) });
}
