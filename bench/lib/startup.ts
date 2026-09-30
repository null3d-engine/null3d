// Startup measurements: one load of the engine test page as points on the page's timeline, from
// navigation start to the first frame, and the medians of repeated loads as a table. Everything here
// is pure, so bench:startup and the device runner share it.
import { type EngineMode, modeProblems } from '../../tests/lib/engine-checks.ts';
import type { Downloads } from '../../tests/lib/load-routes.ts';
import { median } from './report.ts';

/** What the engine test page publishes about its start, with what the server sent for the load. */
export interface StartupResult {
	ok: boolean;
	error?: string;
	/** When the page called createEngine, in milliseconds from navigation start. */
	createEngineAtMs?: number;
	mode?: { build: string; latency: string; renderThread: string; jobWorkers: number };
	capabilities?: { tier: string };
	stats?: {
		load: {
			/** Times from the start of createEngine. */
			probeMs: number;
			coreMs: number;
			engineStartMs: number;
			/** Times from navigation start. */
			firstFrameMs: number | null;
			firstFrameDoneMs: number | null;
		};
	};
	downloads?: Downloads;
}

/** One load's points, each in milliseconds from navigation start, and what the load downloaded. */
export interface LoadSample {
	/** The GPU path the engine chose. */
	tier: string;
	/** The page's script ran and called createEngine. */
	scriptMs: number;
	/** The engine finished testing the GPU paths. */
	probeMs: number;
	/** The engine core was downloaded and compiled. */
	coreMs: number;
	/** The engine had started, with the sketch's setup run, and createEngine was about to resolve. */
	readyMs: number;
	/** The first frame was submitted to the GPU. */
	frameMs: number;
	/** The GPU finished the first frame. */
	frameDoneMs: number;
	requests: number;
	bytes: number;
}

const positive = (value: number | null | undefined): value is number =>
	typeof value === 'number' && value > 0;

/** What is wrong with the result of a load in `mode`, as a list of problems; empty when nothing is. */
export function startupProblems(result: StartupResult, mode: EngineMode): string[] {
	const problems = result.mode ? modeProblems(result.mode, mode) : ['the page reported no mode'];
	const load = result.stats?.load;
	if (!positive(result.createEngineAtMs))
		problems.push('the page did not say when it called createEngine');
	if (!(positive(load?.probeMs) && positive(load?.coreMs) && positive(load?.engineStartMs)))
		problems.push('the probe, core or engine start time is missing');
	if (!(positive(load?.firstFrameMs) && positive(load?.firstFrameDoneMs)))
		problems.push('the first frame times are missing');
	if (!positive(result.downloads?.requests))
		problems.push('the server counted no requests for the load');
	return problems;
}

/**
 * A load's verdict in `mode`: its problems, where a page that failed has its error as the one
 * problem, and its sample when it has no problem.
 */
export function judgeLoad(
	result: StartupResult,
	mode: EngineMode,
): { problems: string[]; sample: LoadSample | undefined } {
	const problems = result.ok
		? startupProblems(result, mode)
		: [result.error ?? 'the page failed without a message'];
	return { problems, sample: problems.length === 0 ? loadSample(result) : undefined };
}

/** A load's points on the page's timeline, or undefined for a result with problems. */
export function loadSample(result: StartupResult): LoadSample | undefined {
	const start = result.createEngineAtMs;
	const load = result.stats?.load;
	const downloads = result.downloads;
	if (
		!positive(start) ||
		!load ||
		!positive(load.firstFrameMs) ||
		!positive(load.firstFrameDoneMs) ||
		!downloads
	)
		return undefined;
	return {
		tier: result.capabilities?.tier ?? 'unknown',
		scriptMs: start,
		probeMs: start + load.probeMs,
		coreMs: start + load.coreMs,
		readyMs: start + load.engineStartMs,
		frameMs: load.firstFrameMs,
		frameDoneMs: load.firstFrameDoneMs,
		requests: downloads.requests,
		bytes: downloads.bytes,
	};
}

/** Loads that share their labels, such as a thread mode and a kind of load. */
export interface SampleGroup {
	labels: string[];
	samples: LoadSample[];
}

/** Groups loads by their labels, in the order each group first appears. */
export function groupSamples(
	loads: readonly { labels: readonly string[]; sample: LoadSample | undefined }[],
): SampleGroup[] {
	const groups = new Map<string, SampleGroup>();
	for (const { labels, sample } of loads) {
		const key = labels.join('\n');
		const group = groups.get(key) ?? { labels: [...labels], samples: [] };
		if (sample) group.samples.push(sample);
		groups.set(key, group);
	}
	return [...groups.values()];
}

/** The table's points, in the order a start reaches them. */
const POINTS = [
	['Script', 'scriptMs'],
	['Probe', 'probeMs'],
	['Core', 'coreMs'],
	['Ready', 'readyMs'],
	['Frame', 'frameMs'],
	['Frame done', 'frameDoneMs'],
] as const;

const count = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/**
 * The medians of each group of loads as a Markdown table: the labels under `heads`, the GPU path,
 * the number of loads, the points in milliseconds from navigation start, and the requests and
 * kilobytes that the server sent.
 */
export function startupTable(heads: readonly string[], groups: readonly SampleGroup[]): string[] {
	const columns = [
		...heads,
		'GPU',
		'Loads',
		...POINTS.map(([name]) => `${name}, ms`),
		'Requests',
		'KB',
	];
	const lines = [`| ${columns.join(' | ')} |`, `|${' --- |'.repeat(columns.length)}`];
	for (const { labels, samples } of groups) {
		const pick = (key: keyof Omit<LoadSample, 'tier'>) => median(samples.map((s) => s[key]));
		const values =
			samples.length === 0
				? ['-', '0', ...POINTS.map(() => '-'), '-', '-']
				: [
						[...new Set(samples.map((s) => s.tier))].join(', '),
						String(samples.length),
						...POINTS.map(([, key]) => pick(key).toFixed(0)),
						count(pick('requests')),
						(pick('bytes') / 1024).toFixed(1),
					];
		lines.push(`| ${[...labels, ...values].join(' | ')} |`);
	}
	return lines;
}

/** What the table's columns mean, as lines to print under it. */
export const STARTUP_LEGEND: readonly string[] = [
	'Each time is a median, in milliseconds from navigation start, of the moment when:',
	'- Script: the page script ran and called createEngine.',
	'- Probe: the engine finished testing the GPU paths.',
	'- Core: the engine core was downloaded and compiled.',
	'- Ready: the engine had started and run the sketch setup.',
	'- Frame: the engine submitted the first frame.',
	'- Frame done: the GPU finished the first frame.',
	'Requests and KB count what the server sent for the load, with KB as sent after compression.',
];
