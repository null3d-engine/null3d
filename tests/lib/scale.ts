// The phone-scale search: the largest count of a scene's objects at which three.js still holds 30
// frames per second on a device, for S1's instances or S5's characters. The benchmark then runs both
// engines at that count, a load the device can carry. The search tries one count at a time: it
// doubles the count until three.js drops below the rate, then narrows the gap between the count that
// held and the one that dropped.
import type { BenchPageKind, BenchScene } from '../../bench/lib/parity.ts';
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
/** The search ends when the count that dropped is at most 5% above the count that held. */
const PRECISION = 1.05;

/** The scenes the search runs, S1 when the run names none. */
export const SCALE_SCENES = ['s1', 's5'] as const satisfies readonly BenchScene[];
export type ScaleScene = (typeof SCALE_SCENES)[number];

/** True for a scene that the search runs. */
export const isScaleScene = (scene: string): scene is ScaleScene =>
	(SCALE_SCENES as readonly string[]).includes(scene);

/**
 * Each scene's counts: the first count the search tries, the most it tries and the fewest, and the
 * word for its objects in a report. Each of S5's characters skins thousands of vertices in every
 * pass, so its search starts at 25 and stops at 3,200, more than six times its desktop count.
 */
export const SCALE_COUNTS: Readonly<
	Record<ScaleScene, { first: number; max: number; min: number; noun: string }>
> = {
	s1: { first: 1_000, max: 4_000_000, min: 10, noun: 'objects' },
	s5: { first: 25, max: 3_200, min: 1, noun: 'characters' },
};

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
export function nextCount({ held, dropped }: ScaleSearch, scene: ScaleScene = 's1'): number | null {
	const { first, max, min } = SCALE_COUNTS[scene];
	if (dropped === null) {
		const next = held === 0 ? first : held * 2;
		return next <= max ? next : null;
	}
	if (held === 0) {
		const next = roundCount(dropped / 2);
		return next >= min && next < dropped ? next : null;
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

/** The runner page's item for one renderer at one count of a scene. */
export function scaleItem(
	page: BenchPageKind,
	count: number,
	scene: ScaleScene = 's1',
): PlanItem<Check> {
	const id = `scale-${scene === 's1' ? '' : `${scene}-`}${page}-${count}`;
	return benchItem(id, page, { seconds: SCALE_SECONDS, n: count }, scene);
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
