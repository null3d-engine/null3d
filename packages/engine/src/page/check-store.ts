// The stored preset check: the result of each sketch's last preset check, kept in the page's
// localStorage, so that a later start of the sketch in the same browser on the same device takes
// the checked preset without measuring again. On a tablet the check takes about a second for each
// preset that it measures. A stored result applies only to a start that would check the same
// preset with the same rules, on a GPU and display that report the same facts, at a canvas size
// close to the measured one, within a week of the measurement. The store also keeps the rounds of
// a check that has not ended yet, each time the check lowers the preset, so a page that closes
// during the check loses no round: the next start begins at the lighter preset, and its own check
// goes on from there. A result measured against a target below the one that the engine starts
// from, as on a display in a power-saving mode, is not stored. The highest target that the page
// allows is one of the facts, so a result never applies to a start that defends another rate.
// Storage that cannot be read or written counts as empty. The GPU's names only tell one GPU from
// another here; the engine never decides anything from what they say.

import {
	CHECK_GRACE_MS,
	CHECK_HOLD_SHARE,
	CHECK_MAX_FPS,
	CHECK_UPLOAD_WAIT_MS,
	CHECK_WINDOW_MS,
	checkTargetFps,
	holdsTarget,
	type PresetCheck,
	type PresetCheckRound,
} from '../quality/check';
import { presetAfterMiss, QUALITY_PRESETS, type QualityPreset } from '../quality/presets';
import type { Tier } from '../shared/tier';
import type { CapabilityReport } from './capabilities';
import { pageStorage } from './start-marker';

/** How long a stored check result applies, in ms: a week. */
export const STORED_CHECK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * The most that the canvas's area may differ from the measured one, as a ratio either way. A
 * larger canvas has more pixels to fill, and a smaller one may hold a heavier preset.
 */
export const STORED_CHECK_AREA_RATIO = 1.25;

const KEY_PREFIX = 'null3d.check:';

/** What the store keeps for a sketch. */
interface StoredCheck {
	/** The facts that the start depended on, as `checkConditions` gives them. */
	conditions: string;
	/** The canvas's area in CSS pixels when the engine started. */
	area: number;
	/** When the check measured its last round, in ms since 1970. */
	savedAt: number;
	/** The check's rounds so far, which end the check when `checkEnded` says so. */
	check: PresetCheck;
}

/**
 * True when a check's rounds end it: its last round held the target, or measured Low, which has no
 * lighter preset. A check that lowered the preset after its last round has not ended.
 */
export function checkEnded(check: Pick<PresetCheck, 'targetFps' | 'rounds'>): boolean {
	const last = check.rounds.at(-1);
	return last !== undefined && (last.preset === 'low' || holdsTarget(last, check.targetFps));
}

/**
 * The preset that a check's rounds leave the engine at: the last round's preset when the check
 * ended there, or else the one that the check lowered to after the last round missed its target.
 */
export function checkedPreset(
	check: Pick<PresetCheck, 'from' | 'targetFps' | 'rounds'>,
): QualityPreset {
	const last = check.rounds.at(-1);
	if (!last) return check.from;
	return checkEnded(check) ? last.preset : presetAfterMiss(last, check.targetFps);
}

const isPreset = (value: unknown): value is QualityPreset =>
	(QUALITY_PRESETS as readonly unknown[]).includes(value);

const isRound = (round: Partial<PresetCheckRound> | null) =>
	round !== null &&
	isPreset(round.preset) &&
	typeof round.presentedFps === 'number' &&
	typeof round.completedFps === 'number';

/** The stored check in `text`, or undefined for text that is not one. */
function parseStored(text: string | null): StoredCheck | undefined {
	if (text === null) return undefined;
	try {
		const stored = JSON.parse(text) as Partial<StoredCheck> | null;
		const check = stored?.check as Partial<PresetCheck> | undefined;
		return stored &&
			typeof stored.conditions === 'string' &&
			typeof stored.area === 'number' &&
			typeof stored.savedAt === 'number' &&
			check &&
			isPreset(check.from) &&
			typeof check.targetFps === 'number' &&
			Array.isArray(check.rounds) &&
			check.rounds.length > 0 &&
			check.rounds.every(isRound) &&
			(check.lowest === undefined || check.lowest === true)
			? (stored as StoredCheck)
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * The facts that a check's result depends on, apart from the canvas size, as one text: the check's
 * rules, the GPU path and the preset that the check starts from, the frame rate cap, the highest
 * target (`maxTargetFps`), the device hints and the screen's pixel ratio, and what the GPU path reported of the GPU. Two starts with the
 * same text would run the same check on the same device and browser.
 */
export function checkConditions(
	report: CapabilityReport,
	tier: Tier,
	from: QualityPreset,
	fps: number | undefined,
	maxTargetFps: number,
): string {
	const { webgpu, webgl2 } = report;
	const gpu =
		tier === 'webgl2'
			? [
					webgl2.renderer,
					webgl2.extensions,
					webgl2.maxSamples,
					webgl2.maxTextureSize,
					webgl2.floatRenderTargets,
				]
			: [webgpu.adapterInfo, webgpu.features, webgpu.limits, webgpu.preferredCanvasFormat];
	return JSON.stringify([
		[CHECK_MAX_FPS, CHECK_HOLD_SHARE, CHECK_GRACE_MS, CHECK_UPLOAD_WAIT_MS, CHECK_WINDOW_MS],
		tier,
		from,
		fps ?? null,
		String(maxTargetFps),
		report.coarsePointer,
		report.screenMinEdge,
		report.deviceMemoryGB,
		report.devicePixelRatio,
		report.hardwareConcurrency,
		gpu,
	]);
}

/**
 * The stored result that applies to a start under `conditions` with a canvas of `area` CSS
 * pixels at `now`, as a reused check, or undefined when none does. A check that has not ended
 * gives its rounds so far, which the start's own check goes on from (`checkEnded`).
 */
export function reusableCheck(
	text: string | null,
	conditions: string,
	area: number,
	now: number,
): PresetCheck | undefined {
	const stored = parseStored(text);
	if (!stored || stored.conditions !== conditions) return undefined;
	const age = now - stored.savedAt;
	if (!(age >= 0 && age < STORED_CHECK_MS)) return undefined;
	if (!(Math.max(area, stored.area) <= Math.min(area, stored.area) * STORED_CHECK_AREA_RATIO))
		return undefined;
	const { from, targetFps, rounds, lowest } = stored.check;
	return { from, targetFps, rounds, ...(lowest && { lowest }), reused: true };
}

/** The stored preset check of one sketch, for one start of it. */
export class CheckStore {
	private readonly key: string;

	/**
	 * `conditions` are the start's, as `checkConditions` gives them, and `area` the canvas's area in
	 * CSS pixels. `storage` stands in for the page's localStorage in tests.
	 */
	constructor(
		sketchUrl: string,
		private readonly conditions: string,
		private readonly area: number,
		private readonly storage: Storage | undefined = pageStorage(),
	) {
		this.key = KEY_PREFIX + sketchUrl;
	}

	/** The stored result that applies to this start, or undefined. */
	read(now = Date.now()): PresetCheck | undefined {
		if (!(this.area > 0)) return undefined;
		try {
			return reusableCheck(
				this.storage?.getItem(this.key) ?? null,
				this.conditions,
				this.area,
				now,
			);
		} catch {
			return undefined;
		}
	}

	/**
	 * Stores what a check of this start measured: its result once it ended, and its rounds so far
	 * each time it lowers the preset. It stores them when they were measured against at least the
	 * target that the check starts from under the highest target `maxTargetFps`.
	 */
	save(check: PresetCheck, maxTargetFps: number, now = Date.now()): void {
		if (check.reused || !(this.area > 0) || check.targetFps < checkTargetFps(0, maxTargetFps))
			return;
		const { from, targetFps, rounds, lowest } = check;
		const stored: StoredCheck = {
			conditions: this.conditions,
			area: this.area,
			savedAt: now,
			check: { from, targetFps, rounds, ...(lowest && { lowest }), reused: false },
		};
		try {
			this.storage?.setItem(this.key, JSON.stringify(stored));
		} catch {
			// The next start checks the preset again.
		}
	}
}
