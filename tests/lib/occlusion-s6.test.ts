import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	differingPixels,
	median,
	medianFigures,
	type OcclusionFigures,
	type OcclusionStop,
	type OcclusionTurnsResult,
	occlusionTurnsProblems,
	occlusionVerdict,
	POP_MARGIN_PIXELS,
	popped,
	roundSides,
	roundStart,
	stopShares,
} from '../pages/lib/occlusion.ts';
import { NONE_MISSING } from './gpu-paths.ts';
import { parseLoadPath } from './load-routes.ts';
import { occlusionS6Plan, occlusionS6Summary, saveOcclusionS6Images } from './occlusion-s6.ts';
import { gpuPathOf, judge, PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';

/** A side's figures: the culling side adds job and culling time and saves render and GPU time. */
const figures = (fields: Partial<OcclusionFigures> = {}): OcclusionFigures => ({
	cpuMs: 4,
	cpuMsAllThreads: 9,
	sketchMs: 4,
	cullMs: 0.5,
	renderMs: 3,
	jobsMs: 1,
	gpuMs: 12,
	intervalMs: 16.7,
	drawCalls: 700,
	visibleEntries: 6000,
	occludedEntries: null,
	...fields,
});

const OFF = figures();
const ON = figures({
	cullMs: 0.8,
	jobsMs: 1.4,
	renderMs: 2.2,
	gpuMs: 9,
	intervalMs: 16.6,
	visibleEntries: 2000,
	occludedEntries: 6000,
});

const stops = (count: number, differing = 0): OcclusionStop[] =>
	stopShares(count).map((share) => ({ share, noise: 0, differing }));

const result = (fields: Partial<OcclusionTurnsResult> = {}): ItemResult & OcclusionTurnsResult => ({
	ok: true,
	tier: 'webgl2',
	preset: 'medium',
	buffer: '256x144',
	window: [915, 412],
	devicePixelRatio: 3.5,
	renderScale: 0.75,
	rounds: 4,
	seconds: 10,
	off: OFF,
	on: ON,
	stops: stops(4),
	failures: [],
	...fields,
});

describe('the occlusion turns', () => {
	it('take the median of the rounds, leaving out sides without a figure', () => {
		expect(median([3, null, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([null])).toBeNull();
		const medians = medianFigures([OFF, ON, { ...ON, gpuMs: null }]);
		expect(medians.renderMs).toBe(2.2);
		expect(medians.gpuMs).toBe(10.5);
		expect(medians.occludedEntries).toBe(6000);
		expect(medianFigures([]).intervalMs).toBeNull();
	});

	it('count the pixels whose color differs, whatever their alpha', () => {
		const a = new Uint8Array([1, 2, 3, 255, 9, 9, 9, 255, 0, 0, 0, 0]);
		const b = new Uint8Array([1, 2, 3, 0, 9, 8, 9, 255, 0, 0, 1, 0]);
		expect(differingPixels(a, b)).toBe(2);
		expect(differingPixels(a, a)).toBe(0);
	});

	it('change which side runs first each round, and spread the rounds over the route', () => {
		expect([0, 1, 2, 3].map(roundSides)).toEqual([
			['off', 'on'],
			['on', 'off'],
			['off', 'on'],
			['on', 'off'],
		]);
		expect([0, 1, 2, 3].map((round) => roundStart(round, 4))).toEqual([0, 0.25, 0.5, 0.75]);
		expect(stopShares(4)).toEqual([0.125, 0.375, 0.625, 0.875]);
	});

	it("count a stop as popped only past the device's noise and the margin", () => {
		expect(popped({ share: 0, noise: 0, differing: POP_MARGIN_PIXELS })).toBe(false);
		expect(popped({ share: 0, noise: 0, differing: POP_MARGIN_PIXELS + 1 })).toBe(true);
		expect(popped({ share: 0, noise: 40, differing: 40 + POP_MARGIN_PIXELS })).toBe(false);
	});

	it('weigh the added culling time against the render and GPU time it saves', () => {
		const verdict = occlusionVerdict(result());
		expect(verdict.hiddenShare).toBe(0.75);
		expect(verdict.addedCpuMs).toBeCloseTo(0.7);
		expect(verdict.savedRenderMs).toBeCloseTo(0.8);
		expect(verdict.savedGpuMs).toBeCloseTo(3);
		expect(verdict.savedIntervalMs).toBeCloseTo(0.1);
		expect(verdict.poppedStops).toBe(0);
		expect(verdict.pays).toBe(true);
	});

	it('leave the GPU out where the device has no GPU timer, and fail a culling that pops', () => {
		const noTimer = occlusionVerdict(
			result({ off: { ...OFF, gpuMs: null }, on: { ...ON, gpuMs: null, renderMs: 2.9 } }),
		);
		expect(noTimer.savedGpuMs).toBeNull();
		expect(noTimer.pays).toBe(false);
		expect(occlusionVerdict(result({ stops: stops(4, 50) })).pays).toBe(false);
	});

	it('find failures, unmeasured sides, nothing hidden, no stops and popped stops', () => {
		expect(occlusionTurnsProblems(result())).toEqual([]);
		expect(
			occlusionTurnsProblems(
				result({
					failures: ['E1109'],
					off: { ...OFF, intervalMs: null },
					on: { ...ON, occludedEntries: 0 },
					stops: [],
				}),
			),
		).toEqual([
			'the engine failed with E1109',
			'the page measured no frame with culling off',
			'occlusion culling hid nothing in the city',
			'the popping check compared no stop',
		]);
		expect(
			occlusionTurnsProblems(result({ stops: [{ share: 0.125, noise: 2, differing: 30 }] })),
		).toEqual([
			'stop 0 at 12.5% of the route: culling on differs from culling off in 30 pixels, past the 2 that two frames with culling off differ',
		]);
	});
});

describe('the occlusion-s6 plan', () => {
	const items = occlusionS6Plan();

	it('loads S6 from the benchmark build at each preset with each buffer size, on WebGL2', () => {
		expect(PLANS['occlusion-s6']).toBe(occlusionS6Plan);
		expect(items.map((item) => item.id)).toEqual([
			'occlusion-s6-low-256x144',
			'occlusion-s6-low-384x216',
			'occlusion-s6-medium-256x144',
			'occlusion-s6-medium-384x216',
			'occlusion-s6-high-256x144',
			'occlusion-s6-high-384x216',
		]);
		const item = items[3]!;
		expect(item.check).toEqual({
			kind: 'occlusion-s6',
			tier: 'webgl2',
			preset: 'medium',
			buffer: '384x216',
		});
		expect(parseLoadPath(item.path.replace('{run}.{runner}', 'r.n'))?.path).toBe(
			'bench/pages/null3d/s6.html',
		);
		const query = new URLSearchParams(item.path.split('?')[1]);
		expect(Object.fromEntries(query)).toEqual({
			gpu: 'webgl2',
			preset: 'medium',
			governor: 'off',
			'occlusion-turns': '',
			'occlusion-buffer': '384x216',
			rounds: '4',
			seconds: '10',
			stops: '24',
		});
		expect(items.map(gpuPathOf)).toEqual(items.map(() => 'webgl2'));
		expect(occlusionS6Plan({ seconds: 20 })[0]!.path).toContain('seconds=20');
		expect(occlusionS6Plan({ seconds: 20 })[0]!.timeoutSeconds).toBeGreaterThan(
			items[0]!.timeoutSeconds,
		);
	});

	it('judges a load by its problems, and skips it on a device without WebGL2', () => {
		const check = items[0]!.check;
		expect(judge(check, result(), NONE_MISSING)).toEqual([]);
		expect(judge(check, result({ stops: [] }), NONE_MISSING)).toEqual([
			'the popping check compared no stop',
		]);
		const noWebGl2 = { ok: false, error: 'no WebGL2 context' };
		expect(judge(check, noWebGl2, { ...NONE_MISSING, webgl2: true })).toBe('skip');
	});

	it("saves a popped stop's frames, and nothing for a load without popping", () => {
		const folder = mkdtempSync(join(tmpdir(), 'occlusion-s6-'));
		try {
			saveOcclusionS6Images(join(folder, 'none'), result());
			expect(existsSync(join(folder, 'none'))).toBe(false);
			const png = Buffer.from('png').toString('base64');
			saveOcclusionS6Images(
				join(folder, 'popped'),
				result({ images: { 'stop-2-off': png, 'stop-2-on': png } }),
			);
			expect(readdirSync(join(folder, 'popped')).sort()).toEqual([
				'stop-2-off.png',
				'stop-2-on.png',
			]);
		} finally {
			rmSync(folder, { recursive: true });
		}
	});

	it('tables each load, marks popping, and lists the loads with problems', () => {
		const results = new Map<string, ItemResult>([
			['occlusion-s6-low-256x144', result({ preset: 'low' })],
			[
				'occlusion-s6-low-384x216',
				result({
					preset: 'low',
					buffer: '384x216',
					off: { ...OFF, gpuMs: null },
					on: { ...ON, gpuMs: null },
					stops: [{ share: 0.5, noise: 3, differing: 90 }],
				}),
			],
			['occlusion-s6-medium-256x144', result({ failures: ['E1109'] })],
			['occlusion-s6-medium-384x216', { ok: false, error: 'the page stopped' }],
		]);
		const table = occlusionS6Summary(items, (id) => results.get(id));
		const lines = table?.split('\n') ?? [];
		expect(lines[2]).toBe(
			'| Preset | Buffer | Hidden | Added | Saved, render | Saved, GPU | Interval, off / on | Popped | Pays |',
		);
		expect(lines[4]).toBe(
			'| low | 256x144 | 75.0% | +0.700 | 0.800 | 3.000 | 16.700 / 16.600 | 0 of 4 (noise 0) | yes |',
		);
		expect(lines[5]).toBe(
			'| low | 384x216 | 75.0% | +0.700 | 0.800 | - | 16.700 / 16.600 | 1 of 1 (noise 3) | no |',
		);
		expect(lines).toHaveLength(13);
		expect(lines.slice(7)).toEqual([
			'Loads with problems:',
			'occlusion-s6-low-384x216: stop 0 at 50.0% of the route: culling on differs from culling off in 90 pixels, past the 3 that two frames with culling off differ',
			'occlusion-s6-medium-256x144: the engine failed with E1109',
			'occlusion-s6-medium-384x216: the page stopped',
			'occlusion-s6-high-256x144: no result',
			'occlusion-s6-high-384x216: no result',
		]);
		expect(occlusionS6Summary([], () => undefined)).toBeUndefined();
	});
});
