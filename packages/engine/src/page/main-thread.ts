// Watches the page's own thread during a measurement: long tasks and input delay, where the
// browser reports them (Chromium). Other browsers give null.

import { percentiles } from '../shared/stats';
import type { MainThreadStats } from './frame-stats';

interface EventTimingEntry extends PerformanceEntry {
	processingStart: number;
}

/** Collects the page thread's long tasks and input delays from start until `stop`. */
export class MainThreadWatch {
	private readonly tasks: number[] = [];
	private readonly delays: number[] = [];
	private readonly observers: PerformanceObserver[] = [];
	private readonly supported: boolean;

	constructor() {
		const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
		this.supported = types.includes('longtask');
		if (!this.supported) return;
		const longTasks = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) this.tasks.push(entry.duration);
		});
		longTasks.observe({ type: 'longtask' });
		this.observers.push(longTasks);
		if (types.includes('event')) {
			const events = new PerformanceObserver((list) => {
				for (const entry of list.getEntries() as EventTimingEntry[])
					this.delays.push(entry.processingStart - entry.startTime);
			});
			events.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
			this.observers.push(events);
		}
	}

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
