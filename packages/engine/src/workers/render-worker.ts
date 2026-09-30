// The render worker: owns the canvas and every GPU object, runs no sketch code, and draws only inside
// its own requestAnimationFrame callback. Each GPU path has its own entry file, which runs this
// module and gives it that path's renderer, and the page starts the one for its tier. A render
// worker's file then holds one GPU path only.

import { messageOf } from '../errors/message';
import type { DrawModule } from '../render/draw';
import type { Drawing } from '../render/recovery';
import type { Renderer } from '../render/renderer';
import { controlViews } from '../shared/control';
import {
	type RendererRequest,
	type RenderWorkerInit,
	replyToPage,
	replyWithCapture,
	startSteps,
	startWorker,
	startWorkerCore,
} from './protocol';

let draw: DrawModule | undefined;
let drawing: Drawing<Renderer> | undefined;
let controlSlots: Int32Array | undefined;

/** Gives the worker the renderer of its GPU path. The entry file calls it as it loads. */
export function drawWith(module: DrawModule): void {
	draw = module;
}

const step = startSteps('render');

startWorker('render', step, async (event: MessageEvent<RenderWorkerInit | RendererRequest>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			if (!draw) throw new Error('this render worker file has no renderer');
			controlSlots = controlViews(message.control).slots;
			const { glue: core } = await startWorkerCore(message, step);
			drawing = await draw.startDrawing({
				...message,
				scene: message.memory && { memory: message.memory, control: message.control },
				fail: (reason) => replyToPage({ type: 'lost', role: 'render', reason }),
			});
			replyToPage({
				type: 'ready',
				role: 'render',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier: drawing.renderer.tier,
			});
		} catch (e) {
			replyToPage({
				type: 'error',
				role: 'render',
				message: messageOf(e),
			});
		}
	} else if (message.type === 'capture' && draw && drawing && controlSlots) {
		await replyWithCapture(draw.captureFrame(drawing, controlSlots));
	} else if (message.type === 'lose-gpu') {
		drawing?.simulateLoss();
	}
});
