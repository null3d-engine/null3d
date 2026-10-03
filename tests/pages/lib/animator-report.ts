// What the animator test page reports: the events that its characters' handlers heard, and the
// codes of the calls that must fail. The browser test reads it outside a browser, so this module
// imports nothing from the engine.

/** One event that a handler heard, and the sketch time it heard it at. */
export interface HeardEvent {
	who: string;
	name: string;
	clip: string;
	layer: number;
	time: number;
}

export interface AnimatorReport {
	heard: HeardEvent[];
	/** The sketch time at which the dancer was destroyed. */
	destroyedAt: number;
	/** The codes of the calls that must fail. */
	errors: Record<string, string>;
	clips: readonly string[];
}
