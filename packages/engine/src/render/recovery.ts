// Keeps a thread drawing through GPU losses. When the browser takes the GPU away, the thread makes a
// new renderer on the same canvas, tells the sketch thread to record a frame that creates every GPU
// object again, and starts a new loop. After too many losses in a short time, or when no new device
// starts, it stops and reports the loss. Hold mode draws one frame on one device, so there a loss
// is reported at once.

import { messageOf } from '../errors/message';
import { Slot } from '../shared/control';

/** What recovery needs of a renderer: its loss signal, a simulated loss and a way to release it. */
export interface Recoverable {
	readonly lost: Promise<string>;
	simulateLoss(): void;
	destroy(): void;
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
		this.loop = run(renderer);
		this.watch();
	}

	private watch(): void {
		const renderer = this.renderer;
		void renderer.lost.then((reason) => {
			if (!this.stopped && renderer === this.renderer) void this.recover(reason);
		});
	}

	private async recover(reason: string): Promise<void> {
		this.loop.stop();
		// Releases the old device's canvas setup before a new device configures the canvas.
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
		try {
			this.renderer = await this.create();
		} catch (error) {
			this.fail(`${reason}, and no new GPU device started: ${messageOf(error)}`);
			return;
		}
		if (this.stopped) {
			this.renderer.destroy();
			return;
		}
		Atomics.add(this.slots, Slot.GpuEpoch, 1);
		this.loop = this.run(this.renderer);
		this.watch();
		console.warn(
			`null3D: the browser took the GPU away (${reason}); the engine started a new device.`,
		);
	}

	/**
	 * In hold mode, draws the held frame on the canvas unless it is there already, and resolves once
	 * it is. With a live loop it resolves at once.
	 */
	async drawHeld(): Promise<void> {
		await this.loop.drawHeld?.();
	}

	/** Acts out a loss of the GPU, which the engine then recovers from as from a real one. */
	simulateLoss(): void {
		this.renderer.simulateLoss();
	}

	stop(): void {
		this.stopped = true;
		this.loop.stop();
		this.renderer.destroy();
		this.release?.();
	}
}
