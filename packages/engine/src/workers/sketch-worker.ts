// The sketch worker: runs the sketch's code and the engine core. In pipelined mode it computes frame
// N+1 while the render worker draws frame N, and waits for the render worker's signal with
// Atomics.waitAsync, so its event loop stays alive for promises and messages. In low-latency mode it
// also owns the canvas and draws each frame itself; only then does it load the renderer.

import { messageOf } from '../errors/message';
import { type DrawModule, loadDrawModule } from '../render/load-draw';
import type { Drawing } from '../render/recovery';
import type { Renderer } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews, Slot } from '../shared/control';
import { ImageTable, sendThrough, sendToTable } from '../shared/images';
import { loadSketch } from '../sketch/define-sketch';
import { SketchRunner } from '../sketch/runner';
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
let drawing: Drawing<Renderer> | undefined;
let controlSlots: Int32Array | undefined;

/**
 * A promise that settles when the slot no longer holds `value`, or undefined when it already
 * holds another value. A plain function, so a wait makes no promise beyond the browser's own.
 */
function changeOf(slots: Int32Array, slot: number, value: number): Promise<unknown> | undefined {
	const wait = Atomics.waitAsync(slots, slot, value);
	return wait.async ? wait.value : undefined;
}

async function runPipelined(sketch: SketchRunner, control: ArrayBufferLike): Promise<void> {
	const { slots } = controlViews(control);
	// A warm-up during the setup may have published a frame that the render worker has not taken.
	let published = Atomics.load(slots, Slot.FramesPublished);
	while (Atomics.load(slots, Slot.Running) !== 0) {
		const paused = Atomics.load(slots, Slot.Paused);
		if (paused !== 0) {
			const change = changeOf(slots, Slot.Paused, paused);
			if (change) await change;
			continue;
		}
		const taken = Atomics.load(slots, Slot.FramesTaken);
		if (taken < published) {
			const change = changeOf(slots, Slot.FramesTaken, taken);
			if (change) await change;
			continue;
		}
		published = sketch.step(performance.now());
		Atomics.store(slots, Slot.FramesPublished, published);
		Atomics.notify(slots, Slot.FramesPublished);
	}
}

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
			const started = await startWorkerCore(message, step);
			const core = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			// Texture images go to the thread that draws: another through a port, or this one.
			const imageTable = new ImageTable();
			const sendImage = message.imagePort
				? sendThrough(message.imagePort)
				: sendToTable(imageTable, control.slots);
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
					sendImage,
					pageUrl: message.pageUrl,
				},
				message.hold,
			);
			step('engine created');
			// The sketch downloads while the renderer starts. The renderer starts before the setup,
			// so a warm-up in the setup has a renderer to build its pipelines.
			const sketch = awaitLater(loadSketch(message.sketchUrl));
			if (message.renderer && drawModule) {
				draw = await drawModule;
				step('renderer loaded');
				drawing = await draw.startDrawing({
					...message.renderer,
					metrics: message.metrics,
					device: message.device,
					scene: { memory, control: message.control },
					control: message.control,
					sketch: runner,
					imageTable,
					fail: (reason) => replyToPage({ type: 'lost', role: 'sketch', reason }),
				});
			}
			await runner.setup(await sketch);
			step(message.hold === undefined ? 'sketch loaded' : 'sketch loaded and held');
			if (!drawing && message.hold === undefined) void runPipelined(runner, message.control);
			replyToPage({
				type: 'ready',
				role: 'sketch',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier: drawing?.renderer.tier,
			});
		} catch (e) {
			replyToPage({
				type: 'error',
				role: 'sketch',
				message: messageOf(e),
			});
		}
	} else if (message.type === 'post') {
		runner?.receive(message.name, message.data);
	} else if (message.type === 'capture' && draw && drawing && controlSlots) {
		const capture = message.image ? draw.captureImage : draw.captureFrame;
		await replyWithCapture(capture(drawing, controlSlots));
	} else if (message.type === 'lose-gpu') {
		drawing?.simulateLoss();
	}
});
