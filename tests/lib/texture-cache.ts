// The texture cache plan: loads of the texture cache page with the city scene's textures, from the
// production build, which time the cache of transcoded textures on a device. A first visit starts
// with empty caches: the page deletes the cache of transcoded textures, its files download afresh,
// and its load has an address prefix of its own, so the browser compiles everything again. A repeat
// visit repeats the first warm load's prefix and files, so the browser's HTTP cache holds them all,
// and with the cache on, the cache of transcoded textures holds every file's texels. Each run makes
// both visits with the cache off and on, in turns, so the two share the device's warmth.
import { type LoadKind, loadPath, runnerKey } from './load-routes.ts';
import type { ItemResult, PlanItem } from './runs.ts';

/** One load of the texture cache page; `first` marks the warm load that fills the caches. */
export interface TextureCacheCheck {
	kind: 'texture-cache';
	load: LoadKind;
	/** True with the cache of transcoded textures on. */
	cache: boolean;
	first?: true;
}

/** What the texture cache page reports. */
export interface TextureCacheResult {
	count: number;
	entriesBefore: number | null;
	entriesAfter: number | null;
	readyMs: number;
	texturesMs: number;
	loadMs: number;
	writesMs: number;
	transcoder: boolean;
}

/** Runs of the four loads, unless the plan names another number. */
export const TEXTURE_CACHE_RUNS = 5;
/** How long a load may take on a slow device: 120 textures, and on a first visit their downloads. */
const TIMEOUT_SECONDS = 180;
/** The share by which a repeat visit must start sooner with the cache for the engine to keep it. */
export const KEEP_SHARE = 0.1;

const onOff = (cache: boolean) => (cache ? 'on' : 'off');

/** The name of one load's item. */
export const textureCacheItemId = (load: LoadKind, cache: boolean, run: number | 'first') =>
	`texture-cache-${load}-${onOff(cache)}-${run}`;

/** The runner page's item for one load of the texture cache page with the city's textures. */
function textureCacheItem(
	load: LoadKind,
	cache: boolean,
	run: number | 'first',
): PlanItem<TextureCacheCheck> {
	const key = runnerKey(load === 'cold' ? `texture-cache-${onOff(cache)}-${run}` : 'texture-cache');
	const switches = [
		'files=city',
		...(cache ? [] : ['texture-cache=off']),
		...(load === 'cold' ? ['clear', 'fresh'] : []),
	];
	return {
		id: textureCacheItemId(load, cache, run),
		path: loadPath({ kind: load, key }, `tests/pages/texture-cache.html?${switches.join('&')}`),
		timeoutSeconds: TIMEOUT_SECONDS,
		check: { kind: 'texture-cache', load, cache, ...(run === 'first' && { first: true as const }) },
	};
}

/**
 * The first warm load, which fills the browser's caches, then in each run a first visit and a
 * repeat visit, each with the cache off and then on. The first visit with the cache on fills the
 * cache again after the one with the cache off emptied it.
 */
export function textureCachePlan({
	runs = TEXTURE_CACHE_RUNS,
} = {}): PlanItem<TextureCacheCheck>[] {
	return [
		textureCacheItem('warm', true, 'first'),
		...Array.from({ length: runs }, (_, k) => [
			textureCacheItem('cold', false, k + 1),
			textureCacheItem('cold', true, k + 1),
			textureCacheItem('warm', false, k + 1),
			textureCacheItem('warm', true, k + 1),
		]).flat(),
	];
}

/** The items that a load needs earlier in the same run: the first warm load, for a later warm one. */
export const textureCacheNeeds = (check: TextureCacheCheck) =>
	check.load === 'warm' && !check.first ? [textureCacheItemId('warm', true, 'first')] : [];

/**
 * What is wrong with a load: no textures, or a cache that did not do its part. Files with the same
 * bytes share an entry, so the cache may hold fewer entries than the page loads files. A load with
 * the cache off must transcode. With it on, a first visit must start with an empty cache and fill
 * it, and a repeat visit must take every file from it, so it downloads no transcoder.
 */
export function textureCacheProblems(
	check: TextureCacheCheck,
	result: TextureCacheResult,
): string[] {
	const { count, entriesBefore, entriesAfter, transcoder } = result;
	if (!(count > 0)) return ['the page loaded no textures: run bun run samples:fetch on the server'];
	if (entriesBefore === null) return ['the page has no Cache Storage: serve it over HTTPS'];
	if (!check.cache)
		return transcoder ? [] : ['the cache was off, yet the transcoder did not download'];
	if (check.load === 'cold')
		return [
			...(entriesBefore === 0
				? []
				: [`a first visit started with ${entriesBefore} entries in the cache, not 0`]),
			...(entriesAfter ? [] : ['a first visit left no entries in the cache']),
		];
	return !check.first && transcoder
		? ['a repeat visit downloaded the transcoder, so the cache missed some files']
		: [];
}

/** The median of some numbers, or NaN for none. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	if (sorted.length === 0) return Number.NaN;
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const ms = (value: number) => (Number.isNaN(value) ? '-' : String(Math.round(value)));

/**
 * The texture cache report of one runner's results: for each visit with the cache off and on, the
 * medians of the times, then how much sooner a repeat visit is ready with the cache, against the
 * share at which the engine keeps it. Loads that failed their check stay out, and so does the first
 * warm load. Undefined when the plan has no such loads.
 */
export function textureCacheSummary(
	items: readonly PlanItem<{ kind: string }>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const groups = new Map<string, TextureCacheResult[]>();
	let failed = 0;
	let loads = 0;
	for (const { id, check } of items) {
		if (check.kind !== 'texture-cache') continue;
		const own = check as TextureCacheCheck;
		if (own.first) continue;
		loads++;
		const result = resultOf(id);
		const timed = result?.ok ? (result as ItemResult & TextureCacheResult) : undefined;
		if (!timed || textureCacheProblems(own, timed).length > 0) {
			failed++;
			continue;
		}
		const group = `${own.load} ${onOff(own.cache)}`;
		groups.set(group, [...(groups.get(group) ?? []), timed]);
	}
	if (loads === 0) return undefined;
	const row = (load: LoadKind, cache: boolean) => {
		const results = groups.get(`${load} ${onOff(cache)}`) ?? [];
		const of = (key: 'readyMs' | 'texturesMs' | 'loadMs' | 'writesMs') =>
			median(results.map((result) => result[key]));
		return {
			cells: [
				load === 'cold' ? 'first' : 'repeat',
				onOff(cache),
				String(results.length),
				ms(of('readyMs')),
				ms(of('texturesMs')),
				ms(of('loadMs')),
				cache ? ms(of('writesMs')) : '-',
			],
			ready: of('readyMs'),
		};
	};
	const rows = (['cold', 'warm'] as const).flatMap((load) => [row(load, false), row(load, true)]);
	const [, , repeatOff, repeatOn] = rows.map(({ ready }) => ready) as [
		number,
		number,
		number,
		number,
	];
	const share = (repeatOff - repeatOn) / repeatOff;
	const verdict = Number.isNaN(share)
		? 'No repeat visit was timed both ways.'
		: `A repeat visit is ready ${Math.round(share * 100)}% sooner with the cache: ${share >= KEEP_SHARE ? 'keep it' : 'not enough to keep it'} (the rule asks ${KEEP_SHARE * 100}%, and never later).`;
	return [
		"The city scene's textures, from the production build. Ready: ms from navigation to every texture on the GPU. Textures: ms from the engine's start to then. Loads: ms of the sketch's loads. Writes: ms after ready until the cache holds every texture. Medians.",
		'',
		'| Visit | Cache | Loads | Ready | Textures | Loads ms | Writes |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...rows.map(({ cells }) => `| ${cells.join(' | ')} |`),
		'',
		verdict,
		...(failed > 0 ? [`${failed} of ${loads} loads failed their check and stay out.`] : []),
	].join('\n');
}
