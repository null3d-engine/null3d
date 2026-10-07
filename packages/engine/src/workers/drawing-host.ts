// The drawing of a worker that draws: the render worker, or the sketch worker in low-latency mode.
// When the engine stops, the page asks the worker to stop drawing, and stops the worker only once it
// answers. The worker destroys its GPU objects and its device first, so the GPU's memory comes back
// at once. A browser frees what a stopped worker held only when it collects the worker's objects,
// which Safari does late, and a page that starts many engines then runs out of GPU memory.

import type { Drawing } from '../render/recovery';
import type { Renderer } from '../render/renderer';
import { replyToPage } from './protocol';

export class DrawingHost {
	drawing: Drawing<Renderer> | undefined;
	private stopping = false;
	/**
	 * Settles once the drawing that is starting has started or failed. It settles with no value, so
	 * a worker that keeps its canvas after the stop does not keep the stopped drawing through it,
	 * nor the engine's memory that the drawing reads.
	 */
	private starting: Promise<void> = Promise.resolve();

	/**
	 * Keeps the drawing that `start` makes. A drawing that starts after the page asked the worker
	 * to stop drawing stops at once, and the call resolves with undefined.
	 */
	start(start: Promise<Drawing<Renderer>>): Promise<Drawing<Renderer> | undefined> {
		const started = start.then(async (drawing) => {
			if (!this.stopping) {
				this.drawing = drawing;
				return drawing;
			}
			await drawing.stop();
			return undefined;
		});
		this.starting = started.then(
			() => {},
			() => {},
		);
		return started;
	}

	/** Stops drawing and frees the GPU, without a reply: for a start that failed. */
	async release(): Promise<void> {
		const drawing = this.drawing;
		this.drawing = undefined;
		await drawing?.stop();
	}

	/**
	 * Stops drawing once any drawing that is starting has started, frees every GPU object and the
	 * device, and tells the page, which then stops the worker.
	 */
	async stop(role: 'sketch' | 'render'): Promise<void> {
		this.stopping = true;
		await this.starting;
		await this.release();
		replyToPage({ type: 'stopped', role });
	}
}
