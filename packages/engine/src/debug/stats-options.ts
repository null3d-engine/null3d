// The options of the stats overlay, apart from the rest of the debug API, so the page's address
// switches can name them without the scene's types.

/**
 * A corner of the canvas, where the stats overlay sits.
 *
 * @category api/debug
 */
export type StatsCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Options for the stats overlay, which `debug.stats`, `engine.stats` and the `stats` option of
 * `createEngine` take in place of `true`. A field that a call leaves out keeps its last value.
 *
 * @category api/debug
 */
export interface StatsOverlayOptions {
	/** The corner of the canvas that the overlay sits in. The default is `'top-left'`. */
	corner?: StatsCorner;
	/**
	 * True shows only the overlay's header, a button with the frame rate. A click or the Enter or
	 * Space key on it shows and hides the other figures. The default is false: every figure shows.
	 */
	collapsed?: boolean;
}

/** What `debug.stats`, `engine.stats` and the `stats` option ask: hide, show, or show with options. */
export type StatsRequest = boolean | StatsOverlayOptions;
