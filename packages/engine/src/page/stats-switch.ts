// Shows and hides the stats overlay when the sketch asks for it with `debug.stats`. The overlay's
// code (debug/overlay.ts) downloads at the first request, so a page whose sketch never asks for it
// never downloads it.

import type { OverlaySetup, StatsOverlay } from '../debug/overlay';

export class StatsSwitch {
	private overlay: StatsOverlay | undefined;
	private wanted = false;
	private load: Promise<typeof import('../debug/overlay')> | undefined;

	/** `setup` gives what the overlay reads, when the first request comes. */
	constructor(private readonly setup: () => OverlaySetup) {}

	/** Shows or hides the overlay. The engine hides it when it stops. */
	show(show: boolean): void {
		this.wanted = show;
		if (!show) {
			this.overlay?.remove();
			this.overlay = undefined;
			return;
		}
		this.load ??= import('../debug/overlay');
		this.load.then(({ StatsOverlay }) => {
			if (this.wanted && !this.overlay) this.overlay = new StatsOverlay(this.setup());
		}, console.warn);
	}
}
