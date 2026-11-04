// The real-browser plan's page times on CI, by which its shards split a browser's plan. Each real-
// browser job keeps the time of each of its pages (tests/real-browsers.ts, page-times.json), and
// `bun tools/real-browser-times.ts` writes their medians here. Pages run at very different speeds
// in Safari on CI's Macs and in Firefox on its Linux machines, and a model of a few slow pages at
// fixed times put up to twice the mean of either browser's shards in one shard.
import table from './page-seconds.json' with { type: 'json' };

/** The table's file, from the repository's root. */
export const PAGE_TIMES_FILE = 'tests/lib/page-seconds.json';

/**
 * Pages that take at least this many seconds keep a time of their own. Every other page counts
 * the mean of the others, which keeps the table to the pages that matter for the split.
 */
export const KEPT_SECONDS = 4;

/** One browser's page times: the time of each slow page, and the time of every other page. */
export interface BrowserPageTimes {
	/** The mean time of the pages that the table leaves out, in seconds. */
	fallback: number;
	/** The median time of each page that takes `KEPT_SECONDS` or more, by page id. */
	pages: Record<string, number>;
}

/** The table: the CI runs that it comes from, and each browser's page times. */
export interface PageTimes {
	runs: number[];
	browsers: Record<string, BrowserPageTimes>;
}

/**
 * Each browser's page times from the page times of real-browser shards: each page's median over
 * the shards that ran it, which come from several runs when the tool takes several.
 */
export function pageTimesOf(
	shards: readonly { browser: string; pages: readonly { id: string; seconds: number }[] }[],
): Record<string, BrowserPageTimes> {
	const byBrowser = new Map<string, Map<string, number[]>>();
	for (const { browser, pages } of shards) {
		const byPage = byBrowser.get(browser) ?? new Map<string, number[]>();
		byBrowser.set(browser, byPage);
		for (const { id, seconds } of pages) byPage.set(id, [...(byPage.get(id) ?? []), seconds]);
	}
	const browsers: Record<string, BrowserPageTimes> = {};
	for (const [browser, byPage] of [...byBrowser].sort(([a], [b]) => a.localeCompare(b))) {
		const medians = [...byPage]
			.map(([id, seconds]) => [id, median(seconds)] as const)
			.sort(([a], [b]) => a.localeCompare(b));
		const slow = medians.filter(([, seconds]) => seconds >= KEPT_SECONDS);
		const rest = medians.filter(([, seconds]) => seconds < KEPT_SECONDS);
		const mean = rest.reduce((sum, [, seconds]) => sum + seconds, 0) / Math.max(1, rest.length);
		browsers[browser] = {
			fallback: Math.round(mean * 10) / 10,
			pages: Object.fromEntries(slow),
		};
	}
	return browsers;
}

/** The middle value of `values`, or the mean of the middle two. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * A page's time in `browser` on CI, by the table: its own time when it is a slow page there, else
 * undefined when the table has no times of that browser or the page is new to the table.
 */
export function measuredSeconds(id: string, browser: string): number | undefined {
	return (table as PageTimes).browsers[browser]?.pages[id];
}

/** The time of a page that the table leaves out in `browser`, or undefined without that browser. */
export function fallbackSeconds(browser: string): number | undefined {
	return (table as PageTimes).browsers[browser]?.fallback;
}
