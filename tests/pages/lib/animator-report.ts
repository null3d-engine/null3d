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
	/**
	 * The soldier's aim: the largest angle, in radians, between its chain's last joint's forward
	 * direction and the direction from that joint to the target, over the frames it checked.
	 */
	aimError: number;
	/** The frames whose aim the soldier checked. */
	aimFrames: number;
	/** How far the soldier's last joint turned from its walk, in radians, at the last check. */
	aimTurn: number;
}
