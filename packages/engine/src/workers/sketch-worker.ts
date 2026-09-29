// The sketch worker: runs the sketch's code and the engine core. In pipelined mode it computes frame
// N+1 while the render worker draws frame N, and waits for the render worker's signal with
// Atomics.waitAsync, so its event loop stays alive for promises and messages. In low-latency mode it
// also owns the canvas and draws each frame itself; only then does it load the renderer.

import { type DrawModule, loadDrawModule } from '../render/load-draw';
import type { Drawing } from '../render/recovery';
import type { Renderer } from '../render/renderer';
import { controlViews, Slot } from '../shared/control';
import { startCore } from '../shared/core';
import { SketchRunner } from '../sketch/runner';
import { replyToPage, type SketchWorkerMessage, startSteps } from './protocol';

let runner: SketchRunner | undefined;
let draw: DrawModule | undefined;
let drawing: Drawing<Renderer> | undefined;
let controlSlots: Int32Array | undefined;

/**
 * A promise that settles when the slot no longer holds `value`, or undefined when it already
 * holds another value. A plain function, so a wait makes no promise beyond the browser's own.
 */
function changeOf(slots: Int32Array, slot: Slot, value: number): Promise<unknown> | undefined {
	const wait = Atomics.waitAsync(slots, slot, value);
	return wait.async ? wait.value : undefined;
}

async function runPipelined(sketch: SketchRunner, control: ArrayBufferLike): Promise<void> {
	const { slots } = controlViews(control);
	let published = 0;
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
step('loaded');

self.onmessage = async (event: MessageEvent<SketchWorkerMessage>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			// The renderer loads while the core and the sketch start.
			const drawModule = message.renderer && loadDrawModule();
			controlSlots = controlViews(message.control).slots;
			const started = await startCore(message.build, message.module, message.memory, step);
			const core = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			runner = new SketchRunner(
				(name, data, transfer) => replyToPage({ type: 'sketch-message', name, data }, transfer),
				message.metrics,
				{
					glue: core,
					memory,
					slots: controlSlots,
					jobWorkers: message.jobWorkers,
					device: message.device,
				},
			);
			step('engine created');
			await runner.load(message.sketchUrl);
			step('sketch loaded');
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
					fail: (reason) => replyToPage({ type: 'lost', role: 'sketch', reason }),
				});
			} else {
				void runPipelined(runner, message.control);
			}
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
				message: e instanceof Error ? e.message : String(e),
			});
		}
	} else if (message.type === 'post') {
		runner?.receive(message.name, message.data);
	} else if (message.type === 'capture' && draw && drawing && controlSlots) {
		const captured = await draw.captureFrame(drawing, controlSlots);
		replyToPage({ type: 'captured', ...captured }, [captured.pixels.buffer]);
	} else if (message.type === 'lose-gpu') {
		drawing?.simulateLoss();
	}
};
