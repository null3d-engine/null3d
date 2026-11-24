// The preset check on a fake thread that draws: frames come at 60 per second, and the page can be
// hidden for a while in the middle of a round, which the first frame after it carries as its
// interval.
import { expect, test } from 'bun:test';
import type { PresetCheck } from '../quality/check';
import type { QualityPreset } from '../quality/presets';
import { createMetricsBuffer, FrameRecorder, Role } from '../shared/metrics';
import { type CheckHost, type CheckStart, checkPreset, checkStart } from './preset-check';

const FRAME_MS = 1000 / 60;

/** A host whose frames hold 60 per second, and whose page is hidden once for `hiddenMs`. */
function host(hiddenMs: number): CheckHost & { lowered: number } {
	const metrics = createMetricsBuffer(false, 0);
	const presented = new FrameRecorder(metrics, Role.Render);
	const completed = new FrameRecorder(metrics, Role.Completion);
	presented.setRefreshHz(60);
	let frame = 0;
	let resumes = 0;
	let hidden = hiddenMs > 0;
	let started = 0;
	const check: CheckHost & { lowered: number } = {
		metrics,
		preset: 'high',
		lowered: 0,
		lower: async () => {
			check.lowered++;
		},
		enterLowest: async () => false,
		async drawFrame() {
			await new Promise((resolve) => setTimeout(resolve, 4));
			started ||= performance.now();
			// Hidden once, part way into the first round's measured window.
			const interval = hidden && performance.now() - started > 400 ? hiddenMs : FRAME_MS;
			if (interval !== FRAME_MS) {
				hidden = false;
				resumes++;
			}
			frame++;
			for (const recorder of [presented, completed]) {
				recorder.begin(frame);
				recorder.interval(interval);
				recorder.commit(1);
			}
			return true;
		},
		uploading: () => false,
		maxTargetFps: 60,
		resumes: () => resumes,
	};
	return check;
}

/**
 * A host whose Medium round draws at 50 per second, so the check lowers it, and whose rebuilt Low
 * preset finishes no frame for `rebuildMs`: the GPU carries the shadow map and pipeline builds.
 */
function rebuildingHost(
	rebuildMs: number,
	start: QualityPreset = 'medium',
): CheckHost & { lowered: number; heard: PresetCheck[] } {
	const metrics = createMetricsBuffer(false, 0);
	const presented = new FrameRecorder(metrics, Role.Render);
	const completed = new FrameRecorder(metrics, Role.Completion);
	presented.setRefreshHz(60);
	let frame = 0;
	let loweredAt = 0;
	let rebuilt = false;
	let preset: QualityPreset = start;
	const check: CheckHost & { lowered: number; heard: PresetCheck[] } = {
		metrics,
		get preset() {
			return preset;
		},
		lowered: 0,
		heard: [],
		lower: async (soFar, to) => {
			check.lowered++;
			check.heard.push(soFar);
			preset = to;
			loweredAt = performance.now();
		},
		enterLowest: async () => false,
		async drawFrame() {
			await new Promise((resolve) => setTimeout(resolve, 4));
			frame++;
			presented.begin(frame);
			presented.interval(FRAME_MS);
			presented.commit(1);
			if (check.lowered === 0) {
				completed.begin(frame);
				completed.interval(1000 / 50);
				completed.commit(1);
			} else if (!rebuilt && performance.now() >= loweredAt + rebuildMs) {
				rebuilt = true;
				completed.begin(frame);
				completed.interval(rebuildMs);
				completed.commit(1);
			} else if (rebuilt) {
				completed.begin(frame);
				completed.interval(FRAME_MS);
				completed.commit(1);
			}
			return true;
		},
		uploading: () => false,
		maxTargetFps: 60,
		resumes: () => 0,
	};
	return check;
}

test('a rebuilt lower preset settles before the check measures it', async () => {
	const check = rebuildingHost(500);
	const result = await checkPreset(check);
	expect(check.lowered).toBe(1);
	expect(result?.rounds).toHaveLength(2);
	expect(result?.rounds[1]?.preset).toBe('low');
	// The window holds play's frames, not the rebuild's one long frame, which read about 2.
	expect(result?.rounds[1]?.completedFps).toBeGreaterThan(50);
});

test('a page that holds its frame rate keeps its preset', async () => {
	const check = host(0);
	const result = await checkPreset(check);
	expect(result?.rounds).toHaveLength(1);
	expect(check.lowered).toBe(0);
});

test('a round during which the page was hidden measures again, and keeps the preset', async () => {
	const check = host(10_000);
	const result = await checkPreset(check);
	expect(check.lowered).toBe(0);
	expect(result?.rounds).toHaveLength(1);
	expect(result?.rounds[0]?.presentedFps).toBeGreaterThan(50);
});

test('each lowering hands on the rounds so far, whose last missed the target', async () => {
	const check = rebuildingHost(0);
	await checkPreset(check);
	expect(check.heard).toHaveLength(1);
	expect(check.heard[0]?.from).toBe('medium');
	expect(check.heard[0]?.targetFps).toBe(60);
	expect(check.heard[0]?.rounds.map((round) => [round.preset, round.completedFps])).toEqual([
		['medium', 50],
	]);
});

test("a check goes on from an earlier start's rounds, and reports them with its own", async () => {
	const earlier: PresetCheck = {
		from: 'medium',
		targetFps: 60,
		rounds: [{ preset: 'medium', presentedFps: 60, completedFps: 50 }],
		reused: true,
	};
	// The earlier start lowered the preset to Low, where this start begins.
	const check = rebuildingHost(0, 'low');
	const result = await checkPreset(check, checkStart('low', 0, 60, earlier));
	expect(check.lowered).toBe(0);
	expect(result?.from).toBe('medium');
	expect(result?.reused).toBe(false);
	expect(result?.rounds.map((round) => round.preset)).toEqual(['medium', 'low']);
	expect(result?.rounds[0]).toEqual(earlier.rounds[0]);
});

test('a check starts its target at the rate that the meter read before it, once it read one', () => {
	expect(checkStart('high', 0, 60)).toEqual({ from: 'high', targetFps: 0, rounds: [] });
	expect(checkStart('high', 90, 60).targetFps).toBe(60);
	expect(checkStart('high', 30, 60).targetFps).toBe(30);
	expect(checkStart('high', 90, 30).targetFps).toBe(30);
	const earlier: CheckStart = {
		from: 'ultra',
		targetFps: 60,
		rounds: [{ preset: 'ultra', presentedFps: 30, completedFps: 30 }],
	};
	const resumed = checkStart('high', 30, 60, earlier);
	// The earlier start's target stays: a target never falls during a check.
	expect(resumed).toEqual({ from: 'ultra', targetFps: 60, rounds: [...earlier.rounds] });
	expect(resumed.rounds).not.toBe(earlier.rounds);
});

/**
 * A host whose presets draw at the given rates, both presented and completed, and whose GPU
 * finishes no frame for `firstFinishMs` after the check starts, as a phone does while it finishes
 * the first frame. `tier` says whether the lowest quality tier may enter.
 */
function rateHost(
	rates: Partial<Record<QualityPreset, number>>,
	start: QualityPreset,
	{ firstFinishMs = 0, tier = true } = {},
): CheckHost & { lowered: QualityPreset[]; tiers: number } {
	const metrics = createMetricsBuffer(false, 0);
	const presented = new FrameRecorder(metrics, Role.Render);
	const completed = new FrameRecorder(metrics, Role.Completion);
	presented.setRefreshHz(60);
	let frame = 0;
	let preset = start;
	const began = performance.now();
	let finished = firstFinishMs === 0;
	const check: CheckHost & { lowered: QualityPreset[]; tiers: number } = {
		metrics,
		get preset() {
			return preset;
		},
		lowered: [],
		tiers: 0,
		lower: async (_, to) => {
			check.lowered.push(to);
			preset = to;
		},
		enterLowest: async () => {
			check.tiers++;
			return tier;
		},
		async drawFrame() {
			await new Promise((resolve) => setTimeout(resolve, 4));
			frame++;
			const interval = 1000 / (rates[preset] as number);
			presented.begin(frame);
			presented.interval(interval);
			presented.commit(1);
			const now = performance.now();
			if (!finished && now - began < firstFinishMs) return true;
			completed.begin(frame);
			completed.interval(finished ? interval : now - began);
			completed.commit(1);
			finished = true;
			return true;
		},
		uploading: () => false,
		maxTargetFps: 60,
		resumes: () => 0,
	};
	return check;
}

test("the first round waits for the first frame's long finish before it measures", async () => {
	// The GPU finishes the first frame after a second, as a tablet's did, and then draws at 60.
	const check = rateHost({ high: 60 }, 'high', { firstFinishMs: 1000 });
	const result = await checkPreset(check);
	expect(check.lowered).toEqual([]);
	expect(result?.rounds).toHaveLength(1);
	expect(result?.rounds[0]?.completedFps).toBeGreaterThan(50);
});

test('a preset that misses its target by less than the far share steps down by one', async () => {
	const check = rateHost({ ultra: 40, high: 60 }, 'ultra');
	const result = await checkPreset(check);
	expect(check.lowered).toEqual(['high']);
	expect(result?.rounds.map((round) => round.preset)).toEqual(['ultra', 'high']);
});

test('a preset far below its target goes straight to Low, which the check then measures', async () => {
	const check = rateHost({ ultra: 12.5, low: 60 }, 'ultra');
	const result = await checkPreset(check);
	expect(check.lowered).toEqual(['low']);
	expect(result?.rounds.map((round) => round.preset)).toEqual(['ultra', 'low']);
	expect(result?.lowest).toBeUndefined();
	expect(check.tiers).toBe(0);
});

test('Low far below its target takes the lowest quality tier, where it may enter', async () => {
	const check = rateHost({ high: 12.5, low: 12.5 }, 'high');
	const result = await checkPreset(check);
	expect(check.lowered).toEqual(['low']);
	expect(check.tiers).toBe(1);
	expect(result?.lowest).toBe(true);
	expect(result?.rounds.map((round) => round.preset)).toEqual(['high', 'low']);
	// Where the tier may not enter, the check ends at Low.
	const closed = rateHost({ low: 12.5 }, 'low', { tier: false });
	expect((await checkPreset(closed))?.lowest).toBeUndefined();
	// Low that misses by less takes no tier.
	const near = rateHost({ low: 30 }, 'low');
	expect((await checkPreset(near))?.lowest).toBeUndefined();
	expect(near.tiers).toBe(0);
});
