// Keeps a thread drawing through GPU losses. When the browser takes the GPU away, the thread makes a
// new renderer on the same canvas, tells the sketch thread to record a frame that creates every GPU
// object again, and starts a new loop. After too many losses in a short time, or when no new device
// starts, it stops and reports the loss. Hold mode draws one frame on one device, so there a loss
// is reported at once. A page that the browser keeps in its back/forward cache gives its GPU back
// the same way, and takes a new one when it shows again, without counting a loss.

import { messageOf } from '../errors/message';
import { type CanvasHolder, releaseCanvas } from '../gpu/canvas-release';
import { Slot } from '../shared/control';
import { nextFrameTaken } from './loop';

/**
 * What recovery needs of a renderer: its loss signal, a simulated loss, and its canvas and GPU
 * objects to release.
 */
export interface Recoverable extends CanvasHolder {
	readonly lost: Promise<string>;
	simulateLoss(): void;
}

/** A loop that draws with one renderer until it stops. */
interface Loop {
	stop(): void;
	/** Hold mode's loop: draws the held frame when first asked, and resolves once it has. */
	drawHeld?(): Promise<void>;
}

/** Losses within one window that the engine recovers from; the next one within it is reported. */
export const MAX_RECOVERIES = 2;
export const RECOVERY_WINDOW_MS = 60_000;

/** A renderer and its loop, replaced after each loss the engine recovers from. */
export class Drawing<R extends Recoverable> {
	private loop: Loop;
	private losses: number[] = [];
	private stopped = false;
	/** The renderer that holds the canvas and has not been destroyed, if any. */
	private live: R | undefined;
	/** The recovery under way, which a stop waits for. */
	private recovering: Promise<void> | undefined;
	/** True while the page sits in the back/forward cache, with no renderer. */
	private released = false;

	/**
	 * Starts drawing with `renderer`. `create` makes a replacement on the same canvas, `run` starts a
	 * loop with a renderer, and `fail` hears the reason when the engine gives up. Without
	 * `recovers`, the first loss is reported at once. `release` frees what the renderers shared,
	 * once drawing stops.
	 */
	constructor(
		public renderer: R,
		private readonly create: () => Promise<R>,
		private readonly run: (renderer: R) => Loop,
		private readonly slots: Int32Array,
		private readonly fail: (reason: string) => void,
		private readonly recovers = true,
		private readonly release?: () => void,
	) {
		this.live = renderer;
		this.loop = run(renderer);
		this.watch();
	}

	private watch(): void {
		const renderer = this.renderer;
		void renderer.lost.then((reason) => {
			if (!this.stopped && renderer === this.renderer) {
				this.recovering = this.recover(reason);
				void this.recovering.finally(() => {
					this.recovering = undefined;
				});
			}
		});
	}

	/**
	 * Replaces the lost renderer. When the engine stops meanwhile, the new renderer starts no loop,
	 * and the stop releases it.
	 */
	private async recover(reason: string): Promise<void> {
		this.loop.stop();
		// Releases the old device's canvas setup before a new device configures the canvas.
		this.live = undefined;
		this.renderer.destroy();
		if (!this.recovers) {
			this.fail(`${reason}, in hold mode, which draws on one device only`);
			return;
		}
		const now = performance.now();
		this.losses = this.losses.filter((at) => now - at < RECOVERY_WINDOW_MS);
		this.losses.push(now);
		if (this.losses.length > MAX_RECOVERIES) {
			this.fail(`${reason}, and the GPU was lost ${this.losses.length} times within a minute`);
			return;
		}
		if (await this.restart(reason))
			console.warn(
				`null3D: the browser took the GPU away (${reason}); the engine started a new device.`,
			);
	}

	/**
	 * Makes a new renderer on the canvas, tells the sketch thread to create every GPU object again,
	 * and starts a new loop. Returns false when the engine stopped meanwhile, or when no device
	 * started, which `reason` explains to the page.
	 */
	private async restart(reason: string): Promise<boolean> {
		try {
			this.renderer = await this.create();
		} catch (error) {
			this.fail(`${reason}, and no new GPU device started: ${messageOf(error)}`);
			return false;
		}
		this.live = this.renderer;
		if (this.stopped) return false;
		Atomics.add(this.slots, Slot.GpuEpoch, 1);
		this.loop = this.run(this.renderer);
		this.watch();
		return true;
	}

	/**
	 * Resolves once the frame to capture is on the canvas. In hold mode, that is the held frame,
	 * which the loop draws when first asked. A live loop first takes a frame after this call.
	 */
	async nextFrame(): Promise<void> {
		await (this.loop.drawHeld?.() ?? nextFrameTaken(this.slots));
	}

	/**
	 * Gives the GPU back while the page sits in the browser's back/forward cache: stops the loop and
	 * destroys the renderer, with its textures, buffers and device. A small device then has the
	 * room for the next page. Hold mode, and a drawing that recovers from a loss or has stopped, keep
	 * what they have.
	 */
	enterPageCache(): void {
		if (!this.recovers || this.stopped || this.released || this.recovering) return;
		this.released = true;
		this.loop.stop();
		this.live = undefined;
		this.renderer.destroy();
	}

	/**
	 * Takes a new renderer once the page shows again after `enterPageCache`, as a recovery from a GPU loss
	 * does: the sketch thread records a frame that creates every GPU object again. It counts no loss.
	 */
	leavePageCache(): Promise<void> {
		if (!this.released || this.stopped) return Promise.resolve();
		this.released = false;
		this.recovering = this.restart('the page came back from the back/forward cache').then(
			() => undefined,
		);
		void this.recovering.finally(() => {
			this.recovering = undefined;
		});
		return this.recovering;
	}

	/** Acts out a loss of the GPU, which the engine then recovers from as from a real one. */
	simulateLoss(): void {
		this.renderer.simulateLoss();
	}

	/**
	 * Stops drawing, and resolves once the renderer has given back the canvas and the GPU. A stop
	 * during a recovery first waits for the new renderer, so that no renderer takes the canvas
	 * after the stop.
	 */
	async stop(): Promise<void> {
		this.stopped = true;
		this.loop.stop();
		if (this.recovering) await this.recovering;
		const live = this.live;
		this.live = undefined;
		if (live) await releaseCanvas(live);
		this.release?.();
	}
}
