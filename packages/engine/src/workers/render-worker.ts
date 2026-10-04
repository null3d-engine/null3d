// The render worker: owns the canvas and every GPU object, runs no sketch code, and draws only inside
// its own requestAnimationFrame callback. The canvas cannot go back to the page once it is here, so
// when the engine stops, the worker keeps it: it frees its GPU device and lets go of the engine's
// core, and the next engine on the same canvas starts it again with a core of its own.

import { messageOf } from '../errors/message';
import { captureFrame, captureImage, startDrawing } from '../render/draw';
import { controlViews } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { setWakeByMessage } from '../shared/wake';
import { DrawingHost } from './drawing-host';
import {
	type RendererRequest,
	type RenderWorkerInit,
	replyToPage,
	replyWithCapture,
	startSteps,
	startWorker,
	startWorkerCore,
} from './protocol';

let host = new DrawingHost();
let controlSlots: Int32Array | undefined;
/** The canvas that the first engine moved here, which every later engine draws on. */
let canvas: OffscreenCanvas | undefined;
/** The running engine's core and image port, which a park lets go of. */
let core: CoreGlue | undefined;
let imagePort: MessagePort | undefined;

const step = startSteps('render');

startWorker('render', step, async (event: MessageEvent<RenderWorkerInit | RendererRequest>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			canvas = message.canvas ?? canvas;
			if (!canvas) throw new Error('the page gave the render worker no canvas');
			host = new DrawingHost();
			imagePort = message.imagePort;
			controlSlots = controlViews(message.control).slots;
			setWakeByMessage(message.wakeByMessage);
			core = (await startWorkerCore(message, step)).glue;
			const drawing = await host.start(
				startDrawing({
					...message,
					canvas,
					scene: message.memory && { memory: message.memory, control: message.control },
					fail: (reason) => replyToPage({ type: 'lost', role: 'render', reason }),
					fault: (error) =>
						replyToPage({ type: 'fault', role: 'render', message: messageOf(error) }),
					gpuError: (outOfMemory, text) =>
						replyToPage({ type: 'gpu-error', role: 'render', outOfMemory, message: text }),
				}),
			);
			if (!drawing) return;
			replyToPage({
				type: 'ready',
				role: 'render',
				threaded: core.isThreadedBuild(),
				version: core.engineVersion(),
				tier: drawing.renderer.tier,
			});
		} catch (e) {
			await host.release();
			replyToPage({
				type: 'error',
				role: 'render',
				message: messageOf(e),
			});
		}
	} else if (message.type === 'capture' && host.drawing && controlSlots) {
		const capture = message.image ? captureImage : captureFrame;
		await replyWithCapture(capture(host.drawing, controlSlots));
	} else if (message.type === 'lose-gpu') {
		host.drawing?.simulateLoss();
	} else if (message.type === 'stop-drawing') {
		await host.stop('render');
	} else if (message.type === 'park') {
		imagePort?.close();
		imagePort = undefined;
		controlSlots = undefined;
		core?.releaseInstance?.();
		core = undefined;
	}
});
