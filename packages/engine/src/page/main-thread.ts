// Watches the page's own thread: long tasks and input delay, where the browser reports them
// (Chromium). Other browsers give null. A measurement reads the whole run at its end; the stats
// overlay reads one window after another. A page that draws with another engine can use the same
// watch, which `@null3d/engine/stats` exports, so both engines' figures come from the same code.

import type { StatsMainThread } from '../debug/stats-text';
import { percentiles } from '../shared/stats';
import type { MainThreadStats } from './frame-stats';

interface EventTimingEntry extends PerformanceEntry {
	processingStart: number;
}

/**
 * Collects the page thread's long tasks and input delays, from its creation until `stop`, from
 * the browser's performance entries.
 *
 * @category api/debug
 */
export class MainThreadWatch {
	private readonly tasks: number[] = [];
	private readonly delays: number[] = [];
	private readonly observers: PerformanceObserver[] = [];
	private readonly supported: boolean;
	/** The figures of the window since the last `takeWindow`, and when it began. */
	private windowStart = performance.now();
	private windowTasks = 0;
	private windowLongestTask = 0;
	private windowDelay = -1;

	/** Starts watching. With `keep` false, it keeps no list of every task and delay, for windows. */
	constructor(private readonly keep = true) {
		const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
		this.supported = types.includes('longtask');
		if (!this.supported) return;
		const longTasks = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (this.keep) this.tasks.push(entry.duration);
				this.windowTasks++;
				this.windowLongestTask = Math.max(this.windowLongestTask, entry.duration);
			}
		});
		longTasks.observe({ type: 'longtask' });
		this.observers.push(longTasks);
		if (types.includes('event')) {
			const events = new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as EventTimingEntry[]) {
					const delay = entry.processingStart - entry.startTime;
					if (this.keep) this.delays.push(delay);
					this.windowDelay = Math.max(this.windowDelay, delay);
				}
			});
			events.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
			this.observers.push(events);
		}
	}

	/**
	 * The long tasks and the longest input delay since the last call, or since the watch began,
	 * and starts the next window. Null where the browser does not report long tasks.
	 */
	takeWindow(): StatsMainThread | null {
		if (!this.supported) return null;
		const now = performance.now();
		const figures = {
			seconds: (now - this.windowStart) / 1000,
			longTasks: this.windowTasks,
			longestTaskMs: this.windowLongestTask,
			inputDelayMs: this.windowDelay >= 0 ? this.windowDelay : null,
		};
		this.windowStart = now;
		this.windowTasks = 0;
		this.windowLongestTask = 0;
		this.windowDelay = -1;
		return figures;
	}

	/** Stops watching, and returns the figures of the whole watch, or null where the browser has none. */
	stop(): MainThreadStats | null {
		for (const observer of this.observers) observer.disconnect();
		if (!this.supported) return null;
		return {
			longTasks: this.tasks.length,
			longestTaskMs: this.tasks.length > 0 ? Math.max(...this.tasks) : 0,
			inputDelayMs: this.delays.length > 0 ? percentiles(this.delays) : null,
		};
	}
}
