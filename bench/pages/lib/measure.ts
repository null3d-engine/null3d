// The timed part of a benchmark run: one frame per animation frame, a warm-up that is not measured,
// then the measured frames. Every engine's page uses this loop, so all reports measure alike.
import { countPerSecond, type Percentiles, percentiles, ratePerSecond } from '@null3d/engine/stats';

/** No display refreshes faster than this, so the sample buffers never fill during a run. */
const MAX_FRAMES_PER_SECOND = 1000;

export interface FrameTimings {
	/** Frames measured after the warm-up. */
	frames: number;
	/** Main-thread time per frame, from the start of the animation frame callback to the end of the frame function. */
	cpuMs: Percentiles;
	/** The part of each frame's CPU time that the frame function reports as its scene update. */
	updateMs?: Percentiles;
	/** Time between the timestamps of consecutive animation frames. */
	intervalMs: Percentiles;
	/**
	 * Frames per second the page drew: the measured frames over the time they took. The browser
	 * keeps frame timestamps on the display's beat even when frames run late, so the median interval
	 * can show the display's rate while the page draws far fewer frames.
	 */
	presentedFps: number;
	/** Frames the page drew in each whole second of the measurement, in order. */
	perSecond: number[];
}

/**
 * Calls `frame` once per animation frame with the scene time in seconds, which is 0 on the first
 * warm-up frame. Frames in the first `warmupSeconds` are not measured; the frames in the next
 * `measureSeconds` are. A frame function may return the milliseconds its scene update took, which
 * the timings then report apart. Recording a frame writes into buffers made up front, so the loop
 * allocates nothing per frame.
 */
export function measureFrames(
	frame: (t: number) => number | undefined,
	warmupSeconds: number,
	measureSeconds: number,
): Promise<FrameTimings> {
	if (!(warmupSeconds > 0 && measureSeconds > 0)) {
		throw new RangeError('the warm-up and the measured time must both be above 0 seconds');
	}
	const capacity = Math.ceil(measureSeconds * MAX_FRAMES_PER_SECOND);
	const cpu = new Float64Array(capacity);
	const interval = new Float64Array(capacity);
	const update = new Float64Array(capacity);
	let reportsUpdate = false;
	const measureFrom = warmupSeconds * 1000;
	const measureTo = measureFrom + measureSeconds * 1000;
	return new Promise((resolve, reject) => {
		let first = -1;
		let previous = 0;
		let count = 0;
		const tick = (now: number): void => {
			const start = performance.now();
			if (first < 0) first = now;
			const elapsed = now - first;
			if (elapsed >= measureTo || count === capacity) {
				if (count === 0) reject(new Error('no frame was measured'));
				else resolve(finish(cpu, interval, reportsUpdate ? update : undefined, count));
				return;
			}
			let updateTime: number | undefined;
			try {
				updateTime = frame(elapsed / 1000);
			} catch (error) {
				reject(error);
				return;
			}
			const cpuTime = performance.now() - start;
			if (elapsed >= measureFrom) {
				cpu[count] = cpuTime;
				interval[count] = now - previous;
				if (updateTime !== undefined) {
					update[count] = updateTime;
					reportsUpdate = true;
				}
				count++;
			}
			previous = now;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

function finish(
	cpu: Float64Array,
	interval: Float64Array,
	update: Float64Array | undefined,
	count: number,
): FrameTimings {
	const intervals = interval.subarray(0, count);
	return {
		frames: count,
		cpuMs: percentiles(cpu.subarray(0, count)),
		...(update && { updateMs: percentiles(update.subarray(0, count)) }),
		intervalMs: percentiles(intervals),
		presentedFps: ratePerSecond(intervals) ?? 0,
		perSecond: countPerSecond(intervals),
	};
}
