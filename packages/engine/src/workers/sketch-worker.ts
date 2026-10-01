// The sketch worker: runs the sketch's code and the engine core. In pipelined mode it computes frame
// N+1 while the render worker draws frame N, and waits for the render worker's signal without
// blocking, so its event loop stays alive for promises and messages. In low-latency mode it
// also owns the canvas and draws each frame itself; only then does it load the renderer.

import { messageOf } from '../errors/message';
import { type DrawModule, loadDrawModule } from '../render/load-draw';
import type { Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews } from '../shared/control';
import { drawingSenders, ImageTable } from '../shared/images';
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
const host = new DrawingHost();
let controlSlots: Int32Array | undefined;

const step = startSteps('sketch');

startWorker('sketch', step, async (event: MessageEvent<SketchWorkerMessage>) => {
	const message = event.data;
	if (message.type === 'load-renderer') {
		drawLoad ??= loadDrawModule();
	} else if (message.type === 'init') {
		try {
			// The renderer loads while the core and the sketch start, if the page did not ask for it
			// sooner.
			if (message.renderer) drawLoad ??= loadDrawModule();
			const drawModule = message.renderer && drawLoad;
			const control = controlViews(message.control);
			controlSlots = control.slots;
			setWakeByMessage(message.wakeByMessage);
			const started = await startWorkerCore(message, step);
			const core = started.glue;
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
						metrics: message.metrics,
						device: message.device,
						scene: { memory, control: message.control },
						control: message.control,
						sketch: runner,
						imageTable,
						fail: (reason) => replyToPage({ type: 'lost', role: 'sketch', reason }),
					}),
				);
				if (!drawing) return;
				tier = drawing.renderer.tier;
			}
			await runner.setup(await sketch);
			step(message.hold === undefined ? 'sketch loaded' : 'sketch loaded and held');
			if (!tier && message.hold === undefined) void runPipelined(runner, message.control);
			replyToPage({
				type: 'ready',
				role: 'sketch',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier,
			});
		} catch (e) {
			host.release();
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
		await host.stop('sketch');
	}
});
