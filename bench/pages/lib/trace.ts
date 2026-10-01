// The trace of each measured second of a benchmark run: the presented and completed frame rates,
// the render scale and the quality steps. The phone scene records it, so a long run on a device
// shows when the frame rate fell and how the engine's quality settings answered. The file imports
// nothing from the engine, so the tools that sum up traces run it without browser types.

/** One second's frame rates from the engine's measurement, as `FrameMetrics.perSecond` holds them. */
interface SecondRates {
	presentedFps: number;
	completedFps: number | null;
}

/** One second of a trace. */
export interface TraceSecond {
	/** Frames presented in the second. */
	presentedFps: number;
	/** Frames that the GPU finished in the second, or null where the page cannot tell. */
	completedFps: number | null;
	/** The render scale at the end of the second: 1 draws the whole canvas. */
	renderScale: number;
	/** Quality steps in the second: steps of the render scale, and changes of live settings. */
	steps: number;
}

/** The render scale and the count of quality steps that a sketch reports, with the page's time. */
export class QualityLog {
	private readonly times: number[] = [];
	private readonly scales: number[] = [];
	private readonly counts: number[] = [];

	/** Adds a report, `[renderScale, steps]`, that arrived at page time `at`. */
	add(report: unknown, at: number = performance.now()): void {
		const [scale, steps] = report as [number, number];
		this.times.push(at);
		this.scales.push(scale);
		this.counts.push(steps);
	}

	/** The render scale and the step count of the last report before `time`: 1 and 0 before any. */
	before(time: number): [scale: number, steps: number] {
		let last = -1;
		while (last + 1 < this.times.length && (this.times[last + 1] as number) < time) last++;
		return last < 0 ? [1, 0] : [this.scales[last] as number, this.counts[last] as number];
	}
}

/**
 * The trace of a null3D run: the engine's frame rates of each second, with the sketch's quality
 * reports. `start` is the page time at which the measurement began.
 */
export function engineTrace(
	perSecond: readonly SecondRates[],
	log: QualityLog,
	start: number,
): TraceSecond[] {
	let [, stepsBefore] = log.before(start);
	return perSecond.map(({ presentedFps, completedFps }, second) => {
		const [renderScale, steps] = log.before(start + (second + 1) * 1000);
		const row = { presentedFps, completedFps, renderScale, steps: steps - stepsBefore };
		stepsBefore = steps;
		return row;
	});
}

/**
 * The trace of a page that draws the whole canvas every frame and learns nothing of the GPU's
 * finish, such as a three.js twin: the frames that it drew in each second.
 */
export function fixedTrace(perSecond: readonly number[]): TraceSecond[] {
	return perSecond.map((presentedFps) => ({
		presentedFps,
		completedFps: null,
		renderScale: 1,
		steps: 0,
	}));
}

/** The highest frame rate that the trace's summary holds a run to, in hertz. */
export const TARGET_CAP_HZ = 60;
/** A second holds the target when its frame rate is at least this share of it. */
export const HELD_SHARE = 0.95;

/** A trace in a few figures. */
export interface TraceSummary {
	seconds: number;
	/** The target frame rate: the display's rate up to `TARGET_CAP_HZ`, or null when unknown. */
	targetFps: number | null;
	/**
	 * The seconds whose frame rate held the target: the completed rate, or the presented rate where
	 * the page cannot tell completion. Null without a target.
	 */
	heldSeconds: number | null;
	/** The lowest frame rate of any second, by the same rate. */
	lowestFps: number;
	lowestRenderScale: number;
	steps: number;
}

/** Sums up a trace, against the target that the display's refresh rate gives. */
export function summarizeTrace(
	trace: readonly TraceSecond[],
	refreshHz: number | null,
): TraceSummary {
	const rate = ({ presentedFps, completedFps }: TraceSecond) => completedFps ?? presentedFps;
	const targetFps = refreshHz === null ? null : Math.min(Math.round(refreshHz), TARGET_CAP_HZ);
	return {
		seconds: trace.length,
		targetFps,
		heldSeconds:
			targetFps === null
				? null
				: trace.filter((second) => rate(second) >= HELD_SHARE * targetFps).length,
		lowestFps: trace.length === 0 ? 0 : Math.min(...trace.map(rate)),
		lowestRenderScale: trace.length === 0 ? 1 : Math.min(...trace.map((s) => s.renderScale)),
		steps: trace.reduce((sum, second) => sum + second.steps, 0),
	};
}
