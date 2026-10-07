import { describe, expect, it } from 'bun:test';
import { NONE_MISSING } from './gpu-paths.ts';
import { itemsNeeded, judge, PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';
import {
	type TextureCacheCheck,
	type TextureCacheResult,
	textureCachePlan,
	textureCacheProblems,
	textureCacheSummary,
} from './texture-cache.ts';

const result = (fields: Partial<TextureCacheResult> = {}): ItemResult & TextureCacheResult => ({
	ok: true,
	count: 120,
	entriesBefore: 116,
	entriesAfter: 116,
	readyMs: 600,
	texturesMs: 400,
	loadMs: 250,
	writesMs: 80,
	transcoder: false,
	...fields,
});

const check = (load: 'cold' | 'warm', cache: boolean): TextureCacheCheck => ({
	kind: 'texture-cache',
	load,
	cache,
});

describe('the texture cache plan', () => {
	const items = textureCachePlan({ runs: 2 });

	it('fills the caches once, then makes both visits with the cache off and on in each run', () => {
		expect(PLANS['texture-cache']).toBe(textureCachePlan);
		expect(items.map((item) => item.id)).toEqual([
			'texture-cache-warm-on-first',
			'texture-cache-cold-off-1',
			'texture-cache-cold-on-1',
			'texture-cache-warm-off-1',
			'texture-cache-warm-on-1',
			'texture-cache-cold-off-2',
			'texture-cache-cold-on-2',
			'texture-cache-warm-off-2',
			'texture-cache-warm-on-2',
		]);
	});

	it('loads the production build: first visits under addresses of their own, repeat visits under one', () => {
		expect(items[1]?.path).toBe(
			'/__null3d/load/cold/{run}.{runner}.texture-cache-off-1/tests/pages/texture-cache.html?files=city&texture-cache=off&clear&fresh',
		);
		expect(items[4]?.path).toBe(
			'/__null3d/load/warm/{run}.{runner}.texture-cache/tests/pages/texture-cache.html?files=city',
		);
		expect(itemsNeeded(items[4]?.check as TextureCacheCheck)).toEqual([
			'texture-cache-warm-on-first',
		]);
		expect(itemsNeeded(items[1]?.check as TextureCacheCheck)).toEqual([]);
	});

	it('fails a repeat visit that downloaded the transcoder, and a load with the cache off that did not', () => {
		expect(judge(check('warm', true), result(), NONE_MISSING)).toEqual([]);
		expect(textureCacheProblems(check('warm', true), result({ transcoder: true }))).toEqual([
			'a repeat visit downloaded the transcoder, so the cache missed some files',
		]);
		expect(textureCacheProblems(check('warm', false), result())).toEqual([
			'the cache was off, yet the transcoder did not download',
		]);
	});

	it('fails a first visit that found entries or left none, and a page without textures or storage', () => {
		const cold = check('cold', true);
		expect(textureCacheProblems(cold, result({ entriesBefore: 0, transcoder: true }))).toEqual([]);
		expect(textureCacheProblems(cold, result({ entriesBefore: 3, entriesAfter: 0 }))).toEqual([
			'a first visit started with 3 entries in the cache, not 0',
			'a first visit left no entries in the cache',
		]);
		expect(textureCacheProblems(cold, result({ count: 0 }))).toEqual([
			'the page loaded no textures: run bun run samples:fetch on the server',
		]);
		expect(textureCacheProblems(cold, result({ entriesBefore: null }))).toEqual([
			'the page has no Cache Storage: serve it over HTTPS',
		]);
	});

	it('tables the medians of each visit, and says how much sooner a repeat visit is with the cache', () => {
		const results: Record<string, ItemResult> = {
			'texture-cache-cold-off-1': result({ entriesBefore: 0, transcoder: true, readyMs: 2000 }),
			'texture-cache-cold-on-1': result({ entriesBefore: 0, transcoder: true, readyMs: 2100 }),
			'texture-cache-warm-off-1': result({ transcoder: true, readyMs: 1000 }),
			'texture-cache-warm-on-1': result({ readyMs: 500 }),
			'texture-cache-warm-off-2': result({ transcoder: true, readyMs: 1200 }),
			'texture-cache-warm-on-2': result({ readyMs: 700 }),
			'texture-cache-warm-on-first': result({ readyMs: 9999 }),
		};
		const lines = textureCacheSummary(items, (id) => results[id])?.split('\n') ?? [];
		expect(lines.slice(2)).toEqual([
			'| Visit | Cache | Loads | Ready | Textures | Loads ms | Writes |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			'| first | off | 1 | 2000 | 400 | 250 | - |',
			'| first | on | 1 | 2100 | 400 | 250 | 80 |',
			'| repeat | off | 2 | 1100 | 400 | 250 | - |',
			'| repeat | on | 2 | 600 | 400 | 250 | 80 |',
			'',
			'A repeat visit is ready 45% sooner with the cache: keep it (the rule asks 10%, and never later).',
			'2 of 8 loads failed their check and stay out.',
		]);
		expect(textureCacheSummary(PLANS.checks?.() ?? [], () => undefined)).toBeUndefined();
	});
});
