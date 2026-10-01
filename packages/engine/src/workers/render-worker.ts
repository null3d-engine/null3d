// The render worker: owns the canvas and every GPU object, runs no sketch code, and draws only inside
// its own requestAnimationFrame callback.

import { messageOf } from '../errors/message';
import { captureFrame, captureImage, startDrawing } from '../render/draw';
import { controlViews } from '../shared/control';
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

const host = new DrawingHost();
let controlSlots: Int32Array | undefined;

const step = startSteps('render');

startWorker('render', step, async (event: MessageEvent<RenderWorkerInit | RendererRequest>) => {
	const message = event.data;
	if (message.type === 'init') {
		try {
			controlSlots = controlViews(message.control).slots;
			setWakeByMessage(message.wakeByMessage);
			const { glue: core } = await startWorkerCore(message, step);
			const drawing = await host.start(
				startDrawing({
					...message,
					scene: message.memory && { memory: message.memory, control: message.control },
					fail: (reason) => replyToPage({ type: 'lost', role: 'render', reason }),
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
			host.release();
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
	}
});
