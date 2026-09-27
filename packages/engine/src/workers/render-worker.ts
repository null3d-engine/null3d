// The render worker: owns the canvas and every GPU object, runs no game code, and draws only inside
// its own requestAnimationFrame callback.

import { emptySceneInput, runRenderLoop } from '../render/loop';
import { createRenderer, type Renderer } from '../render/renderer';
import { controlViews, Slot } from '../shared/control';
import { startCore } from '../shared/core';
import type { RendererRequest, RenderWorkerInit, WorkerReply } from './protocol';

let renderer: Renderer | undefined;
let controlSlots: Int32Array | undefined;

const reply = (message: WorkerReply, transfer: Transferable[] = []) =>
	postMessage(message, { transfer });

self.onmessage = async (event: MessageEvent<RenderWorkerInit | RendererRequest>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			controlSlots = controlViews(message.control).slots;
			const { glue: core } = await startCore(message.build, message.module, message.memory);
			renderer = await createRenderer(message.canvas, {
				...message,
				scene: message.memory && { memory: message.memory, control: message.control },
			});
			runRenderLoop(renderer, message.control, message.metrics);
			reply({
				type: 'ready',
				role: 'render',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier: renderer.tier,
			});
		} catch (e) {
			reply({ type: 'error', role: 'render', message: e instanceof Error ? e.message : String(e) });
		}
	} else if (message.type === 'capture' && renderer && controlSlots) {
		const captured = await renderer.capture(
			emptySceneInput(Atomics.load(controlSlots, Slot.FramesTaken)),
		);
		reply({ type: 'captured', ...captured }, [captured.pixels.buffer]);
	}
};
