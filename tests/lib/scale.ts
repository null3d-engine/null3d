// The phone-scale search: the largest S1 instance count at which three.js still holds 30 frames per
// second on a device. The benchmark then runs both engines at that count, a load the device can
// carry. The search tries one count at a time: it doubles the count until three.js drops below the
// rate, then narrows the gap between the count that held and the one that dropped.
import type { BenchPageKind } from '../../bench/lib/parity.ts';
import { benchItem, type Check } from './plans.ts';
import type { ItemResult, PlanItem } from './runs.ts';

/** The plan name that runs the search instead of a fixed plan. */
export const SCALE_PLAN = 'scale';
/** The frame rate three.js must hold. */
export const HOLD_FPS = 30;
/** A page that draws on every second refresh of a 60 Hz display can measure just under 30. */
const HOLD_TOLERANCE_FPS = 0.5;
/** The warm-up and the measured time at each count: short, so the device heats less. */
export const SCALE_SECONDS = 5;
const FIRST_COUNT = 1_000;
const MAX_COUNT = 4_000_000;
const MIN_COUNT = 10;
/** The search ends when the count that dropped is at most 5% above the count that held. */
const PRECISION = 1.05;

/** three.js's renderers: the page, and the renderer's name. */
export const SCALE_RENDERERS: readonly (readonly [BenchPageKind, string])[] = [
	['threejs-webgl', 'WebGL'],
	['threejs-webgpu', 'WebGPU'],
];

/** What a search knows: the largest count that held the rate, and the smallest that dropped. */
export interface ScaleSearch {
	held: number;
	dropped: number | null;
}

export const NEW_SEARCH: ScaleSearch = { held: 0, dropped: null };

/** A count to two significant figures, so the counts read easily. */
export function roundCount(count: number): number {
	const step = 10 ** Math.max(0, Math.floor(Math.log10(count)) - 1);
	return Math.round(count / step) * step;
}

/**
 * The next count to try, or null when the search is done. It doubles the count until one drops,
 * halves it when the first count already drops, and then halves the gap in proportion.
 */
export function nextCount({ held, dropped }: ScaleSearch): number | null {
	if (dropped === null) {
		const next = held === 0 ? FIRST_COUNT : held * 2;
		return next <= MAX_COUNT ? next : null;
	}
	if (held === 0) {
		const next = roundCount(dropped / 2);
		return next >= MIN_COUNT && next < dropped ? next : null;
	}
	if (dropped <= held * PRECISION) return null;
	const next = roundCount(Math.sqrt(held * dropped));
	return next > held && next < dropped ? next : null;
}

/** The search after a count held the rate or dropped below it. */
export function afterCount(search: ScaleSearch, count: number, held: boolean): ScaleSearch {
	if (held) return { ...search, held: Math.max(search.held, count) };
	return { ...search, dropped: search.dropped === null ? count : Math.min(search.dropped, count) };
}

/** The runner page's item for one renderer at one count. */
export function scaleItem(page: BenchPageKind, count: number): PlanItem<Check> {
	return benchItem(`scale-${page}-${count}`, page, { seconds: SCALE_SECONDS, n: count });
}

/** Frames per second a benchmark page drew, from its result. */
export function drawnFps(result: ItemResult): number {
	const reported = Number(result.presentedFps);
	return Number.isFinite(reported) ? reported : Number(result.frames ?? 0) / SCALE_SECONDS;
}

/** Whether a page's result held the rate. */
export function holdsRate(result: ItemResult): boolean {
	return drawnFps(result) >= HOLD_FPS - HOLD_TOLERANCE_FPS;
}
