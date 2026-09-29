// Holds the thread that draws to a fixed frame rate below the display's, as the ?fps= switch asks,
// so runs on displays of different refresh rates can be compared at one rate. The thread skips frame
// callbacks until the next frame's turn comes. The turns keep a fixed schedule, one frame interval
// apart, instead of counting from the callback that drew last. When the display's refresh period
// does not divide the interval, the gaps between frames alternate between whole periods, and the
// average rate still matches: 60 frames per second on a 144 Hz display, for example.

/**
 * How early a callback may come and still take a frame's turn, in ms: more than callback timestamps
 * jitter around each refresh, and less than half the refresh period of displays up to 500 Hz.
 */
const EARLY_MS = 1;

export class FramePacer {
	/** Time between frames in ms, or 0 to draw at every callback. */
	private readonly interval: number;
	/** When the next frame's turn starts, in the callbacks' clock. */
	private next = Number.NEGATIVE_INFINITY;

	/** `fps` is the rate to hold, or undefined to draw at every callback. */
	constructor(fps: number | undefined) {
		this.interval = fps === undefined ? 0 : 1000 / fps;
	}

	/**
	 * True when the callback at `timestamp` takes a frame's turn; the caller then draws. A callback
	 * more than a whole interval late starts a new schedule, so the thread never draws a burst of
	 * frames to catch up, as after a pause.
	 */
	take(timestamp: number): boolean {
		if (this.interval === 0) return true;
		if (timestamp < this.next - EARLY_MS) return false;
		this.next =
			timestamp - this.next > this.interval ? timestamp + this.interval : this.next + this.interval;
		return true;
	}
}
