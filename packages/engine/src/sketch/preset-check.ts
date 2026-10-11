// The preset check, which the sketch runner loads after the first frame when the engine chose the
// preset itself. It draws the scene as the setup built it, first for a grace time, then for a
// measured window, and reads the rates at which the thread that draws presented frames and the GPU
// finished them. When the lower rate misses the target, it lowers the preset by one, waits for the
// new preset's first frame, and measures again, down to Low. A round during which the page was
// hidden or paused measures again: a hidden page draws no frames, and the first frame after it
// carries the hidden time as its interval. The rules and the thresholds live in quality/check.ts.

import {
	CHECK_GRACE_MS,
	CHECK_UPLOAD_WAIT_MS,
	CHECK_WINDOW_MS,
	frameRate,
	holdsTarget,
	type PresetCheck,
	type PresetCheckRound,
	raiseTarget,
} from '../quality/check';
import type { QualityPreset } from '../quality/presets';
import { RingSums, Role, refreshRate, SUM_INTERVAL_MS, SUM_RECORDS } from '../shared/metrics';

/** What the check needs from the sketch runner. */
export interface CheckHost {
	/** The metrics buffer, whose rings hold the presented and the completed frames. */
	metrics: ArrayBufferLike;
	/** The preset that runs. */
	readonly preset: QualityPreset;
	/** Switches to the next lighter preset, and resolves once its first frame is on screen. */
	lower(): Promise<void>;
	/**
	 * Draws a frame of the scene as it stands, and resolves once the thread that draws has taken
	 * it: with false when the engine stopped.
	 */
	drawFrame(): Promise<boolean>;
	/** True while textures wait to upload. */
	uploading(): boolean;
	/** The highest target that the page's `targetFps` setting and the ?fps= switch allow. */
	maxTargetFps: number;
	/** How many times the page showed again after it was hidden, or resumed after a pause. */
	resumes(): number;
}

/** Draws frames until `until` returns false; resolves with false when the engine stopped. */
async function drawWhile(host: CheckHost, until: () => boolean): Promise<boolean> {
	while (until()) if (!(await host.drawFrame())) return false;
	return true;
}

/** A frame rate to one decimal place. */
const rounded = (fps: number) => Math.round(fps * 10) / 10;

/** The rate of the records that `sums` took in. */
const rateOf = (sums: RingSums) =>
	rounded(frameRate(sums.sums[SUM_RECORDS] as number, sums.sums[SUM_INTERVAL_MS] as number));

/**
 * Measures the preset that runs, and lowers it until one holds the target or the preset is Low.
 * The first grace counts from `graceStart`, when the scene started drawing for the check. Resolves
 * with what the check measured, or undefined when the engine stopped first.
 */
export async function checkPreset(
	host: CheckHost,
	graceStart: number,
): Promise<PresetCheck | undefined> {
	const from = host.preset;
	const rounds: PresetCheckRound[] = [];
	let targetFps = 0;
	let start = graceStart;
	for (;;) {
		const resumes = host.resumes();
		const graceEnd = start + CHECK_GRACE_MS;
		const uploadEnd = graceEnd + CHECK_UPLOAD_WAIT_MS;
		const grace = () => {
			const now = performance.now();
			return now < graceEnd || (now < uploadEnd && host.uploading());
		};
		if (!(await drawWhile(host, grace))) return undefined;
		const presented = new RingSums(host.metrics, Role.Render);
		const completed = new RingSums(host.metrics, Role.Completion);
		const windowEnd = performance.now() + CHECK_WINDOW_MS;
		if (!(await drawWhile(host, () => performance.now() < windowEnd))) return undefined;
		presented.add();
		completed.add();
		if (host.resumes() !== resumes) {
			start = performance.now();
			continue;
		}
		targetFps = raiseTarget(targetFps, refreshRate(host.metrics), host.maxTargetFps);
		const round = {
			preset: host.preset,
			presentedFps: rateOf(presented),
			completedFps: rateOf(completed),
		};
		rounds.push(round);
		if (host.preset === 'low' || holdsTarget(round, targetFps)) break;
		await host.lower();
		start = performance.now();
	}
	return { from, targetFps, rounds, reused: false };
}
