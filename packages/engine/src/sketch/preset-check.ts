// The preset check, which the sketch runner loads after the first frame when the engine chose the
// preset itself. Once the first frame's pipelines are built and the GPU draws at play's rate, it
// draws the scene for a grace time, then for a measured window, and reads the rates at which the
// thread that draws presented frames and the GPU finished them. When the lower rate misses the
// target, it lowers the preset by one, or straight to Low when the rate is far below the target,
// waits for the new preset's first frame, and measures again. It ends at a preset that holds the
// target, or at Low, after which a Low far below the target takes the lowest quality tier. So the
// engine runs only a preset that the check measured. A round during which the page was hidden or
// paused measures again: a hidden page draws no frames, and the first frame after it carries the
// hidden time as its interval. The target starts at the refresh rate that the meter read before
// the check's frames began: a GPU that falls behind slows the frame callbacks, which then read as
// a slower display. A check can go on from the rounds that an earlier start measured before its
// check ended. The rules and the thresholds live in quality/check.ts.

import {
	CHECK_GRACE_MS,
	CHECK_SETTLE_FRAMES,
	CHECK_SETTLE_INTERVAL_MS,
	CHECK_SETTLE_WAIT_MS,
	CHECK_UPLOAD_WAIT_MS,
	CHECK_WINDOW_MS,
	farBelowTarget,
	frameRate,
	holdsTarget,
	type PresetCheck,
	type PresetCheckRound,
	raiseTarget,
} from '../quality/check';
import { presetAfterMiss, type QualityPreset } from '../quality/presets';
import { RingSums, Role, refreshRate, SUM_INTERVAL_MS, SUM_RECORDS } from '../shared/metrics';

/** What the check needs from the sketch runner. */
export interface CheckHost {
	/** The metrics buffer, whose rings hold the presented and the completed frames. */
	metrics: ArrayBufferLike;
	/** The preset that runs. */
	readonly preset: QualityPreset;
	/**
	 * Switches to the lighter preset `to`, and resolves once its first frame is on screen. `check`
	 * is the check's rounds so far, whose last missed its target, for the page to keep.
	 */
	lower(check: PresetCheck, to: QualityPreset): Promise<void>;
	/**
	 * Takes the lowest quality tier, where the page and the sketch allow it, and resolves once its
	 * first frame is on screen: with true when it took the tier.
	 */
	enterLowest(): Promise<boolean>;
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

/**
 * Draws frames after the first frame, and after a lowering, until the GPU has finished enough
 * frames at play's rate. So the frame that carries the first frame's long finish, or the new
 * preset's pipelines and remade shadow map, does not fall inside the next measured window.
 * Resolves false when the engine stopped.
 */
async function settle(host: CheckHost): Promise<boolean> {
	const completed = new RingSums(host.metrics, Role.Completion);
	const end = performance.now() + CHECK_SETTLE_WAIT_MS;
	let settled = 0;
	while (performance.now() < end) {
		if (!(await host.drawFrame())) return false;
		const frames = completed.sums[SUM_RECORDS] as number;
		const interval = completed.sums[SUM_INTERVAL_MS] as number;
		completed.add();
		const added = (completed.sums[SUM_RECORDS] as number) - frames;
		if (added === 0) continue;
		const mean = ((completed.sums[SUM_INTERVAL_MS] as number) - interval) / added;
		if (mean > CHECK_SETTLE_INTERVAL_MS) settled = 0;
		else settled += added;
		if (settled >= CHECK_SETTLE_FRAMES) break;
	}
	return true;
}

/** A frame rate to one decimal place. */
const rounded = (fps: number) => Math.round(fps * 10) / 10;

/** The rate of the records that `sums` took in. */
const rateOf = (sums: RingSums) =>
	rounded(frameRate(sums.sums[SUM_RECORDS] as number, sums.sums[SUM_INTERVAL_MS] as number));

/** Where a check starts: its first preset, its target so far and its rounds so far. */
export type CheckStart = Pick<PresetCheck, 'from' | 'targetFps' | 'rounds'>;

/**
 * Where a check of `preset` starts, before its first frame. Its target starts at `refreshHz`, the
 * rate that the meter read then, once the meter has read one, and at most `maxTargetFps`.
 * `resume` holds the rounds that an earlier start measured before its check ended: the check then
 * goes on from them, and reports them with its own from the earlier start's first preset.
 */
export function checkStart(
	preset: QualityPreset,
	refreshHz: number,
	maxTargetFps: number,
	resume?: CheckStart,
): CheckStart {
	const targetFps = resume?.targetFps ?? 0;
	return {
		from: resume?.from ?? preset,
		targetFps: refreshHz > 0 ? raiseTarget(targetFps, refreshHz, maxTargetFps) : targetFps,
		rounds: [...(resume?.rounds ?? [])],
	};
}

/**
 * Measures the preset that runs, and lowers it until one holds the target or the preset is Low.
 * Each round starts once the GPU draws at play's rate. `begin` is where the check starts, as
 * `checkStart` gives it; without it, the check starts from the preset that runs, with no target
 * until the meter reads one. Resolves with what the check measured, or undefined when the engine
 * stopped first.
 */
export async function checkPreset(
	host: CheckHost,
	begin: CheckStart = { from: host.preset, targetFps: 0, rounds: [] },
): Promise<PresetCheck | undefined> {
	const { from } = begin;
	const rounds: PresetCheckRound[] = [...begin.rounds];
	let targetFps = begin.targetFps;
	let lowest = false;
	if (!(await settle(host))) return undefined;
	let start = performance.now();
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
		if (holdsTarget(round, targetFps)) break;
		if (host.preset === 'low') {
			lowest = farBelowTarget(round, targetFps) && (await host.enterLowest());
			break;
		}
		await host.lower(
			{ from, targetFps, rounds: [...rounds], reused: false },
			presetAfterMiss(round, targetFps),
		);
		if (!(await settle(host))) return undefined;
		start = performance.now();
	}
	return { from, targetFps, rounds, ...(lowest && { lowest: true as const }), reused: false };
}
