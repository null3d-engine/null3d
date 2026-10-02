// The time of each WebGL call on the thread that draws, as the -timed benchmark pages publish it
// (?gl-timing), and the sum of a page's runs. The file imports nothing from the engine, so the tools
// that sum up runs load it without browser types.

/** One WebGL call's figures over the measured frames of a run. */
export interface GlCallTimes {
	/** The call's name, as `extension.call` for a call of an extension object. */
	name: string;
	/** Time in the call, summed over the measured frames, in milliseconds. */
	ms: number;
	calls: number;
	/** The longest single call, in milliseconds. */
	longestMs: number;
}

/** A run's call times: its measured frames, and each call's figures over them. */
export interface GlTiming {
	frames: number;
	calls: GlCallTimes[];
}

/**
 * The call times of several runs as one: frames and times summed, the longest call of any run,
 * and the calls in order of their summed time, longest first. Undefined when no run has them.
 */
export function sumGlTiming(runs: readonly (GlTiming | undefined)[]): GlTiming | undefined {
	const timed = runs.filter((run): run is GlTiming => run !== undefined);
	if (timed.length === 0) return undefined;
	const calls = new Map<string, GlCallTimes>();
	for (const run of timed)
		for (const call of run.calls) {
			const sum = calls.get(call.name);
			if (!sum) calls.set(call.name, { ...call });
			else {
				sum.ms += call.ms;
				sum.calls += call.calls;
				sum.longestMs = Math.max(sum.longestMs, call.longestMs);
			}
		}
	return {
		frames: timed.reduce((frames, run) => frames + run.frames, 0),
		calls: [...calls.values()].sort((a, b) => b.ms - a.ms),
	};
}
