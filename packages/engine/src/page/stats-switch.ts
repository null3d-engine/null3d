// Shows and hides the stats overlay when the page asks for it, with `engine.stats`, the `stats`
// option or the `?stats` switch, or when the sketch asks with `debug.stats`. The overlay's code
// (debug/overlay.ts) downloads at the first request, so a page that never shows it never
// downloads it. The options of every request add up for the engine's life, so an overlay that
// shows again keeps the start state that the last requests gave.

import type { OverlaySetup, StatsOverlay } from '../debug/overlay';
import type { StatsOverlayOptions, StatsRequest } from '../debug/stats-options';

export class StatsSwitch {
	private overlay: StatsOverlay | undefined;
	private wanted = false;
	private readonly options: StatsOverlayOptions = {};
	private load: Promise<typeof import('../debug/overlay')> | undefined;

	/** `setup` gives what the overlay reads, when the first request comes. */
	constructor(private readonly setup: () => OverlaySetup) {}

	/**
	 * Shows or hides the overlay. Options show it and change the fields they name, on a shown
	 * overlay too. The engine hides it when it stops.
	 */
	show(show: StatsRequest): void {
		this.wanted = show !== false;
		if (!show) {
			this.overlay?.remove();
			this.overlay = undefined;
			return;
		}
		if (show !== true) {
			if (show.collapsed !== undefined) this.options.collapsed = show.collapsed;
			this.overlay?.configure(show);
		}
		this.load ??= import('../debug/overlay');
		this.load.then(({ StatsOverlay }) => {
			if (this.wanted && !this.overlay) this.overlay = new StatsOverlay(this.setup(), this.options);
		}, console.warn);
	}
}
