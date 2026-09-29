// The render worker: owns the canvas and every GPU object, runs no sketch code, and draws only inside
// its own requestAnimationFrame callback.

import { captureFrame, startDrawing } from '../render/draw';
import type { Drawing } from '../render/recovery';
import type { Renderer } from '../render/renderer';
import { controlViews } from '../shared/control';
import {
	type RendererRequest,
	type RenderWorkerInit,
	replyToPage,
	startSteps,
	startWorkerCore,
} from './protocol';

let drawing: Drawing<Renderer> | undefined;
let controlSlots: Int32Array | undefined;

const step = startSteps('render');
step('loaded');

self.onmessage = async (event: MessageEvent<RenderWorkerInit | RendererRequest>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			controlSlots = controlViews(message.control).slots;
			const { glue: core } = await startWorkerCore(message, step);
			drawing = await startDrawing({
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
				message: e instanceof Error ? e.message : String(e),
			});
		}
	} else if (message.type === 'capture' && drawing && controlSlots) {
		const captured = await captureFrame(drawing, controlSlots);
		replyToPage({ type: 'captured', ...captured }, [captured.pixels.buffer]);
	} else if (message.type === 'lose-gpu') {
		drawing?.simulateLoss();
	}
};
