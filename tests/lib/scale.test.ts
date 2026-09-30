import { describe, expect, it } from 'bun:test';
import {
	afterCount,
	drawnFps,
	holdsRate,
	NEW_SEARCH,
	nextCount,
	roundCount,
	type ScaleSearch,
	scaleItem,
} from './scale.ts';

/** Runs the search against a device that holds the rate up to `scale` objects; returns the counts tried. */
function search(scale: number): { tried: number[]; result: ScaleSearch } {
	const tried: number[] = [];
	let state = NEW_SEARCH;
	for (let count = nextCount(state); count !== null; count = nextCount(state)) {
		tried.push(count);
		state = afterCount(state, count, count <= scale);
	}
	return { tried, result: state };
}

describe('the phone-scale search', () => {
	it('rounds counts to two significant figures', () => {
		expect([362_039, 1_000, 707, 125, 8.5].map(roundCount)).toEqual([360_000, 1_000, 710, 130, 9]);
	});

	it('doubles until three.js drops below the rate, then narrows the gap to 5%', () => {
		const { tried, result } = search(250_000);
		expect(tried.slice(0, 9)).toEqual([
			1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000,
		]);
		expect(result).toEqual({ held: 250_000, dropped: 256_000 });
		expect(tried.length).toBe(14);
	});

	it('halves the count on a device that drops at the first count', () => {
		const { tried, result } = search(300);
		expect(tried.slice(0, 3)).toEqual([1_000, 500, 250]);
		expect(result.held).toBe(300);
		expect((result.dropped as number) / result.held).toBeLessThanOrEqual(1.05);
	});

	it('stops at its highest count on a device that never drops', () => {
		const { tried, result } = search(Number.POSITIVE_INFINITY);
		expect(tried.at(-1)).toBe(2_048_000);
		expect(result).toEqual({ held: 2_048_000, dropped: null });
	});

	it('times three.js at each count with a short run', () => {
		expect(scaleItem('threejs-webgl', 250_000)).toEqual({
			id: 'scale-threejs-webgl-250000',
			path: '/__null3d/load/warm/{run}.{runner}.bench/bench/pages/threejs/s1.html?renderer=webgl&seconds=5&n=250000',
			timeoutSeconds: 70,
			check: { kind: 'bench', tier: 'webgl2', scene: 's1', page: 'threejs-webgl' },
		});
	});

	it('counts the frames a page drew, with a little room for timer jitter', () => {
		expect(drawnFps({ ok: true, presentedFps: 41.8, frames: 300 })).toBe(41.8);
		expect(drawnFps({ ok: true, frames: 150 })).toBe(30);
		expect(holdsRate({ ok: true, presentedFps: 29.6 })).toBe(true);
		expect(holdsRate({ ok: true, presentedFps: 29.4 })).toBe(false);
	});
});
