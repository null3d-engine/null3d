// Measures the display's refresh period for a worker that draws. The page's frame callbacks follow
// the display in every browser, but Safari runs a worker's from a timer, which can call the worker
// more often than the display shows frames. The page measures the period from its own callbacks and
// writes it into the control block, and the worker holds its frames to it. Each callback only reads
// its timestamp, so the page's thread stays free.

import { RefreshMeter } from '../render/refresh';
import { Slot } from '../shared/control';

const MICROSECONDS_PER_SECOND = 1_000_000;

/** Writes the display's refresh period each time the page measures it, until the returned function stops it. */
export function watchDisplay(slots: Int32Array): () => void {
	const meter = new RefreshMeter();
	let running = true;
	const tick = (timestamp: number) => {
		if (!running) return;
		const hz = meter.tick(timestamp);
		if (hz !== undefined)
			Atomics.store(slots, Slot.DisplayInterval, Math.round(MICROSECONDS_PER_SECOND / hz));
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return () => {
		running = false;
	};
}
