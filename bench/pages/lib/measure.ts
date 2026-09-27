// The timed part of a benchmark run: one frame per animation frame, a warm-up that is not measured,
// then the measured frames. Every engine's page uses this loop, so all reports measure alike.
import { type Summary, summarize } from './stats';

/** No display refreshes faster than this, so the sample buffers never fill during a run. */
const MAX_FRAMES_PER_SECOND = 1000;

export interface FrameTimings {
	/** Frames measured after the warm-up. */
	frames: number;
	/** Main-thread time per frame, from the start of the animation frame callback to the end of the frame function. */
	cpuMs: Summary;
	/** Time between the timestamps of consecutive animation frames. */
	intervalMs: Omit<Summary, 'mean'>;
}

/**
 * Calls `frame` once per animation frame with the scene time in seconds, which is 0 on the first
 * warm-up frame. Frames in the first `warmupSeconds` are not measured; the frames in the next
 * `measureSeconds` are. Recording a frame writes into buffers made up front, so the loop allocates
 * nothing per frame.
 */
export function measureFrames(
	frame: (t: number) => void,
	warmupSeconds: number,
	measureSeconds: number,
): Promise<FrameTimings> {
	if (!(warmupSeconds > 0 && measureSeconds > 0)) {
		throw new RangeError('the warm-up and the measured time must both be above 0 seconds');
	}
	const capacity = Math.ceil(measureSeconds * MAX_FRAMES_PER_SECOND);
	const cpu = new Float64Array(capacity);
	const interval = new Float64Array(capacity);
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
				else resolve(finish(cpu, interval, count));
				return;
			}
			try {
				frame(elapsed / 1000);
			} catch (error) {
				reject(error);
				return;
			}
			const cpuTime = performance.now() - start;
			if (elapsed >= measureFrom) {
				cpu[count] = cpuTime;
				interval[count] = now - previous;
				count++;
			}
			previous = now;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

function finish(cpu: Float64Array, interval: Float64Array, count: number): FrameTimings {
	const { median, p95, p99 } = summarize(interval, count);
	return { frames: count, cpuMs: summarize(cpu, count), intervalMs: { median, p95, p99 } };
}
