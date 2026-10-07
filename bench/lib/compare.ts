// A comparison of two builds of the engine: the baseline, such as the previous commit on main, and
// the new build. Both run the same benchmark pages on one machine, taking turns page by page, so a
// change in the machine's speed during the job reaches both builds alike. Everything here is pure,
// so the benchmark command and its tests share it.
//
// The comparison judges CPU time only: the busiest thread's time per frame, and the engine's own
// work on its busiest thread. Machines without a real GPU, or with a shared one, time the GPU
// poorly, so GPU time is reported and never judged.
import type { Shard } from '../../tests/lib/runs.ts';
import { findAckValues, isBareAck } from '../../tools/hooks/commit-ack.ts';
import { REFERENCE_PRESET_SWITCH } from './parity';
import { type BenchResult, median, ownWorkMs, summarizeRuns } from './report';

/** The two builds of a comparison. */
export const BUILDS = ['baseline', 'new'] as const;
export type Build = (typeof BUILDS)[number];

/** One run of one page of one build. */
export interface BuildRun {
	build: Build;
	scene: string;
	/** The page kind, such as null3d-webgpu. */
	kind: string;
	/** The round the run belongs to, from 1. */
	round: number;
	result: BenchResult;
}

/**
 * The order in which a round runs the two builds of each page: the baseline first in odd rounds
 * and the new build first in even rounds, so neither build always runs on a machine that the
 * other one has just warmed.
 */
export function roundOrder(round: number): readonly Build[] {
	return round % 2 === 1 ? BUILDS : [...BUILDS].reverse();
}

/** A run that the comparison leaves out, and why. */
export interface DroppedRun {
	run: BuildRun;
	reason: string;
}

/**
 * The page switches of every comparison, so that both builds draw the same work in every run. The
 * engine otherwise chooses the quality preset itself and checks it with the first frames' rate, and
 * on a busy machine that check lowers it in some runs and not in others. A named preset turns the
 * check and the crash marker off, and the desktop's preset, High within each GPU path's ceiling,
 * keeps the work that a desktop draws. The governor stays off, because a step during the measured
 * seconds would change what the rest of the run draws. .dev/benchmarks.md gives the measurements.
 */
export const COMPARISON_SWITCHES: readonly string[] = [REFERENCE_PRESET_SWITCH, 'governor=off'];

/** The comparison's own switches, less those that the command's `switches` set themselves. */
export function comparisonSwitches(switches: string): string[] {
	const named = new Set(switches.split('&').map((entry) => entry.split('=')[0]));
	return COMPARISON_SWITCHES.filter((entry) => !named.has(entry.split('=')[0]));
}

/**
 * The files that each build's benchmark pages are made from, as git pathspecs: what the pages draw
 * and how they time it. Test files are left out, because no page runs them.
 */
export const PAGE_SOURCES: readonly string[] = [
	'bench/pages',
	'bench/scenes',
	':(exclude)*.test.ts',
];

/** How many changed page files a measurement change names before it gives the count of the rest. */
const NAMED_FILES = 5;

const switchesText = (switches: readonly string[]) =>
	switches.length > 0 ? `\`${switches.join('&')}\`` : 'none';

/**
 * Why the two builds of a comparison measure in different ways, or none. Each build runs its own
 * commit's pages, so a change to the pages between the two commits changes what one build draws or
 * how it is timed, not the engine. A change to the comparison's switches means that the baseline's
 * pages get switches that its own runs never had. `pageFiles` lists the page sources that the new
 * commit changes, and `baselineSwitches` the comparison switches of the baseline commit.
 */
export function measurementChanges(
	pageFiles: readonly string[],
	baselineSwitches: readonly string[],
	newSwitches: readonly string[] = COMPARISON_SWITCHES,
): string[] {
	const changes: string[] = [];
	if (pageFiles.length > 0) {
		const named = pageFiles.slice(0, NAMED_FILES).join(', ');
		const rest = pageFiles.length - NAMED_FILES;
		changes.push(
			`the benchmark pages changed: ${named}${rest > 0 ? ` and ${rest} more ${rest === 1 ? 'file' : 'files'}` : ''}`,
		);
	}
	if (switchesText(baselineSwitches) !== switchesText(newSwitches))
		changes.push(
			`the comparison's switches changed from ${switchesText(baselineSwitches)} to ${switchesText(newSwitches)}`,
		);
	return changes;
}

/** The runs that a comparison uses and those it leaves out. */
export interface RunSelection {
	kept: BuildRun[];
	dropped: DroppedRun[];
	/**
	 * For each page, by its scene and page kind, the display refresh rate that most of its runs
	 * measured, or null when none measured one.
	 */
	refreshHz: Record<string, number | null>;
}

/** A page's name in reports and keys: its scene and page kind. */
export const pageName = ({ scene, kind }: { scene: string; kind: string }) => `${scene} ${kind}`;

/** The value that occurs most often, the larger one on a tie; null for an empty list. */
function mostCommon(values: readonly number[]): number | null {
	const counts = new Map<number, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	let best: number | null = null;
	let bestCount = 0;
	for (const [value, count] of counts)
		if (count > bestCount || (count === bestCount && best !== null && value > best)) {
			best = value;
			bestCount = count;
		}
	return best;
}

/**
 * Leaves out the runs that cannot be compared: a run that failed or measured no frames, and a run
 * whose engine measured another display refresh rate than most runs of its page did. The CPU time
 * per frame changes with the refresh rate. A run that did not measure the rate stays. The rate is
 * found per page, because a software GPU slows the frame callbacks of some pages and not others.
 */
export function selectRuns(runs: readonly BuildRun[]): RunSelection {
	const dropped: DroppedRun[] = [];
	const measured = runs.filter((run) => {
		const { ok, error, frames } = run.result;
		const reason = !ok
			? `the page failed: ${error ?? 'no message'}`
			: frames > 0
				? null
				: 'it measured no frames';
		if (reason !== null) dropped.push({ run, reason });
		return reason === null;
	});
	const refreshHz: Record<string, number | null> = {};
	for (const run of runs) refreshHz[pageName(run)] ??= null;
	for (const page of Object.keys(refreshHz))
		refreshHz[page] = mostCommon(
			measured
				.filter((run) => pageName(run) === page)
				.map((run) => run.result.stats?.refreshHz)
				.filter((hz): hz is number => hz != null),
		);
	const kept = measured.filter((run) => {
		const hz = run.result.stats?.refreshHz;
		const most = refreshHz[pageName(run)];
		if (hz == null || hz === most) return true;
		dropped.push({ run, reason: `it measured a refresh rate of ${hz} Hz, not ${most} Hz` });
		return false;
	});
	return { kept, dropped, refreshHz };
}

/** What the comparison judges on each page, with the name its report gives each measure. */
export const MEASURES = {
	'busiest-thread': {
		name: 'busiest thread',
		of: (result: BenchResult) => result.cpuMs.median,
	},
	'own-work': {
		name: 'own work',
		// null3D times the sketch's update itself, so its own work needs no scene-code page.
		of: (result: BenchResult) => ownWorkMs(summarizeRuns([result]), 0),
	},
} as const;
export type Measure = keyof typeof MEASURES;
export const MEASURE_NAMES = Object.keys(MEASURES) as Measure[];

/**
 * How much slower the new build may get before the comparison fails: a share of the baseline's
 * median, and at least a fixed time. The fixed time decides on pages whose frames take well under
 * a millisecond, where a share of the frame is a few steps of the browser's 5-microsecond timer
 * and a short stall moves a round far.
 */
export interface Rule {
	share: number;
	floorMs: number;
}

/**
 * The rule of each measure, chosen by replaying the recorded comparisons of identical builds on
 * GitHub's Mac machine: no recorded comparison breaks it, with the noise check below. The engine's
 * own work is the busiest thread's time less the scene's update: a small difference of two larger
 * times, which moves more from run to run, so its share is wider. .dev/benchmarks.md gives the
 * measurements.
 */
export const RULES: Readonly<Record<Measure, Rule>> = {
	'busiest-thread': { share: 0.08, floorMs: 0.05 },
	'own-work': { share: 0.15, floorMs: 0.05 },
};

/**
 * How many times its rounds' noise a change must reach to count as slower or faster. A run whose
 * rounds spread far, as on a busy machine, then needs a larger change to fail.
 */
export const NOISE_TIMES = 2;

/**
 * The noise of a change: the standard error of the median of the rounds' ratios, estimated from
 * their spread. The median absolute deviation, times 1.4826, estimates the standard deviation, and
 * times 1.2533 over the root of the count, the error of a median. Both factors hold for values
 * spread as a normal distribution. The deviation ignores the odd round that a stall moves far.
 */
export function roundNoise(ratios: readonly number[]): number {
	if (ratios.length < 2) return 0;
	const middle = median(ratios);
	const deviation = median(ratios.map((ratio) => Math.abs(ratio - middle)));
	return (1.4826 * 1.2533 * deviation) / Math.sqrt(ratios.length);
}

/** The most that the new build may add to a baseline median of `baselineMs` under a rule. */
export function allowedMs(baselineMs: number, rule: Rule): number {
	return Math.max(baselineMs * rule.share, rule.floorMs);
}

/** A rule in words: "3% and 0.01 ms". */
export const ruleText = ({ share, floorMs }: Rule) =>
	`${Number((share * 100).toFixed(1))}% and ${floorMs} ms`;

/** The runs of one build of one page: how many there were and their values of one measure. */
export interface BuildValues {
	runs: number;
	median: number;
	min: number;
	max: number;
}

function valuesOf(values: readonly number[]): BuildValues {
	return {
		runs: values.length,
		median: median(values),
		min: Math.min(...values),
		max: Math.max(...values),
	};
}

/** One measure of one page, compared between the two builds. */
export interface Comparison {
	scene: string;
	kind: string;
	measure: Measure;
	/** Each build's median over its kept runs, with the lowest and highest run. */
	baseline: BuildValues;
	new: BuildValues;
	/** Rounds in which both builds have a kept run. */
	rounds: number;
	/**
	 * The change from the baseline to the new build: the median, over those rounds, of the new
	 * build's value over the baseline's, less 1. Above 0 is slower.
	 */
	change: number;
	/** The change's noise, as a share like the change: see `roundNoise`. */
	noise: number;
	/** The change in milliseconds: the change times the baseline's median. */
	deltaMs: number;
	/** The most the change may add under the measure's rule, in milliseconds. */
	allowedMs: number;
	/**
	 * Slower or faster by more than the measure's rule allows and by more than `NOISE_TIMES` its
	 * noise, or the same.
	 */
	result: 'slower' | 'faster' | 'same';
	/** The expected-change trailer that names this measure, when one does. */
	expected: ExpectedChange | null;
}

/** A page with too few rounds in which both builds have a kept run. */
export interface MissingPage {
	scene: string;
	kind: string;
	/** Kept runs of each build, and the runs each had. */
	kept: Record<Build, number>;
	runs: Record<Build, number>;
	/** Rounds in which both builds have a kept run. */
	rounds: number;
}

/** A comparison needs at least this many rounds in which both builds have a kept run. */
export const MIN_ROUNDS = 2;

/** GPU time per frame of one page in each build, reported and never judged. */
export interface GpuTime {
	scene: string;
	kind: string;
	baselineMs: number | null;
	newMs: number | null;
}

export interface BuildComparison {
	comparisons: Comparison[];
	missing: MissingPage[];
	gpu: GpuTime[];
}

/** The median GPU time per frame over runs that timed the GPU, or null when none did. */
function gpuMedian(runs: readonly BuildRun[]): number | null {
	const times = runs
		.map((run) => run.result.stats?.gpuMs?.median)
		.filter((ms): ms is number => ms != null);
	return times.length > 0 ? median(times) : null;
}

/**
 * Compares the kept runs of the two builds, page by page and measure by measure. The builds ran in
 * turns, so each round holds a run of each build measured moments apart, and the change is the
 * median of the rounds' changes: a machine that changes speed between rounds changes both runs of
 * a round alike. A change counts only beyond the measure's rule and beyond its rounds' noise. A
 * page with too few rounds in which both builds have a kept run is named instead.
 */
export function compareBuilds(
	{ kept, dropped }: Pick<RunSelection, 'kept' | 'dropped'>,
	expected: readonly ExpectedChange[] = [],
	rules: Readonly<Record<Measure, Rule>> = RULES,
	noiseTimes = NOISE_TIMES,
): BuildComparison {
	const all = [...kept, ...dropped.map(({ run }) => run)];
	const pages = [...new Map(all.map((run) => [pageName(run), run])).values()];
	const out: BuildComparison = { comparisons: [], missing: [], gpu: [] };
	for (const { scene, kind } of pages) {
		const of = (runs: readonly BuildRun[], build: Build) =>
			runs.filter((r) => r.build === build && r.scene === scene && r.kind === kind);
		const baseline = of(kept, 'baseline');
		const next = of(kept, 'new');
		const pairs = baseline.flatMap((before) => {
			const after = next.find((run) => run.round === before.round);
			return after ? [[before.result, after.result] as const] : [];
		});
		if (pairs.length < MIN_ROUNDS) {
			out.missing.push({
				scene,
				kind,
				kept: { baseline: baseline.length, new: next.length },
				runs: { baseline: of(all, 'baseline').length, new: of(all, 'new').length },
				rounds: pairs.length,
			});
			continue;
		}
		out.gpu.push({ scene, kind, baselineMs: gpuMedian(baseline), newMs: gpuMedian(next) });
		for (const measure of MEASURE_NAMES) {
			const { of: value } = MEASURES[measure];
			const before = valuesOf(baseline.map((run) => value(run.result)));
			const after = valuesOf(next.map((run) => value(run.result)));
			const ratios = pairs.filter(([b]) => value(b) > 0).map(([b, n]) => value(n) / value(b));
			const change = ratios.length > 0 ? median(ratios) - 1 : 0;
			const noise = roundNoise(ratios);
			const deltaMs = change * before.median;
			const allowed = allowedMs(before.median, rules[measure]);
			const clear = Math.abs(change) > noiseTimes * noise;
			const slower = clear && deltaMs > allowed;
			const named = (entry: ExpectedChange) => names(entry, { scene, kind, measure });
			out.comparisons.push({
				scene,
				kind,
				measure,
				baseline: before,
				new: after,
				rounds: pairs.length,
				change,
				noise,
				deltaMs,
				allowedMs: allowed,
				result: slower ? 'slower' : clear && deltaMs < -allowed ? 'faster' : 'same',
				expected: slower ? (expected.find(named) ?? null) : null,
			});
		}
	}
	return out;
}

// The expected-change trailer: a commit that makes a benchmark slower on purpose names the change
// and gives the reason, for example
//   Bench-Expected: s1/null3d-webgl2: the batch pass now writes normals, about 0.1 ms per frame

/** The trailer that names a slower median as expected. */
export const EXPECTED_TRAILER = 'Bench-Expected';

/** Benchmarks that a trailer names: a scene, a page kind and a measure, where null means any. */
export interface Selector {
	scene: string | null;
	kind: string | null;
	measure: Measure | null;
}

/** An expected-change trailer: the benchmarks it names and why they get slower. */
export interface ExpectedChange {
	selectors: Selector[];
	reason: string;
	/** The trailer as a line: its name, then its value as the commit wrote it. */
	line: string;
}

/** The trailers in commit messages that parse, and a problem for each one that does not. */
export interface ExpectedChanges {
	changes: ExpectedChange[];
	problems: string[];
}

/** The scenes and page kinds that a trailer may name. */
export interface KnownNames {
	scenes: readonly string[];
	kinds: readonly string[];
}

/** The format of the trailer's value, for error messages. */
export const EXPECTED_FORMAT = `${EXPECTED_TRAILER}: <scene>[/<page>[/<measure>]], ...: <reason>`;

/** Reads one part of a selector: `*` for any, or one of the known names. */
function selectorPart<T extends string>(
	part: string | undefined,
	known: readonly T[],
	what: string,
) {
	if (part === undefined || part === '*') return null;
	if (!known.includes(part as T))
		throw new Error(`"${part}" is not a ${what}; use one of ${known.join(', ')}, or *`);
	return part as T;
}

function parseSelector(text: string, known: KnownNames): Selector {
	const parts = text.split('/').map((part) => part.trim());
	if (parts.length > 3 || parts.some((part) => part === ''))
		throw new Error(`"${text}" is not a benchmark; write <scene>[/<page>[/<measure>]]`);
	return {
		scene: selectorPart(parts[0], known.scenes, 'scene'),
		kind: selectorPart(parts[1], known.kinds, 'page'),
		measure: selectorPart(parts[2], MEASURE_NAMES, 'measure'),
	};
}

/**
 * Reads every expected-change trailer in the messages. A trailer's value names benchmarks, each as
 * `<scene>[/<page>[/<measure>]]` with `*` for any part and a comma between them, then a colon and
 * the reason. Lines that start with the trailer's name count anywhere in a message, because a
 * squash merge lists the messages of each commit it joins.
 */
export function readExpectedChanges(
	messages: readonly string[],
	known: KnownNames,
): ExpectedChanges {
	const out: ExpectedChanges = { changes: [], problems: [] };
	for (const message of messages) {
		for (const value of findAckValues(message, EXPECTED_TRAILER)) {
			const line = `${EXPECTED_TRAILER}: ${value}`;
			const colon = value.indexOf(':');
			const reason = colon < 0 ? '' : value.slice(colon + 1).trim();
			try {
				if (colon < 0 || isBareAck(reason))
					throw new Error(`it needs the benchmarks, a colon and a reason: ${EXPECTED_FORMAT}`);
				const selectors = value
					.slice(0, colon)
					.split(',')
					.map((text) => parseSelector(text.trim(), known));
				out.changes.push({ selectors, reason, line });
			} catch (error) {
				out.problems.push(`"${line}" does not count: ${(error as Error).message}`);
			}
		}
	}
	return out;
}

/** True when the trailer names the page and the measure. */
function names(
	change: ExpectedChange,
	{ scene, kind, measure }: Pick<Comparison, 'scene' | 'kind' | 'measure'>,
): boolean {
	return change.selectors.some(
		(s) =>
			(s.scene === null || s.scene === scene) &&
			(s.kind === null || s.kind === kind) &&
			(s.measure === null || s.measure === measure),
	);
}

// The quality that each run drew with.

/** The quality preset and the quality steps of one run, which the summary lists round by round. */
export interface RunQuality {
	build: Build;
	scene: string;
	kind: string;
	round: number;
	/** The preset that the engine drew with, or null when the page did not report one. */
	preset: string | null;
	/** Quality steps during the measured seconds, or null for a page that records no trace. */
	steps: number | null;
}

/** The preset and the quality steps of each run that published a result. */
export function runQualities(runs: readonly BuildRun[]): RunQuality[] {
	return runs
		.filter((run) => run.result.ok)
		.map(({ build, scene, kind, round, result }) => ({
			build,
			scene,
			kind,
			round,
			preset: result.mode?.preset ?? null,
			steps: result.trace ? result.trace.reduce((sum, second) => sum + second.steps, 0) : null,
		}));
}

const presetText = (preset: string | null | undefined) =>
	preset === undefined ? 'no run' : (preset ?? 'not reported');

/**
 * The presets and the quality steps of a comparison's runs, as lines of its report. A page whose
 * runs all drew at one preset takes a few words. A page whose runs differ lists each round's preset
 * in each build, because a round whose builds drew different work compares nothing.
 */
export function qualityLines(qualities: readonly RunQuality[]): string[] {
	const pages = new Map<string, RunQuality[]>();
	for (const quality of qualities)
		pages.set(pageName(quality), [...(pages.get(pageName(quality)) ?? []), quality]);
	const same = new Map<string, string[]>();
	const mixed: string[] = [];
	for (const [page, runs] of pages) {
		const presets = new Set(runs.map((run) => presetText(run.preset)));
		const [only] = presets;
		if (presets.size === 1 && only !== undefined) {
			same.set(only, [...(same.get(only) ?? []), page]);
			continue;
		}
		const rounds = [...new Set(runs.map((run) => run.round))].sort((a, b) => a - b);
		const preset = (round: number, build: Build) =>
			presetText(runs.find((run) => run.round === round && run.build === build)?.preset);
		mixed.push(
			`- ${page}: ${rounds.map((round) => `round ${round} ${BUILDS.map((build) => `${build} ${preset(round, build)}`).join(', ')}`).join('; ')}`,
		);
	}
	const lines: string[] = [];
	if (same.size > 0)
		lines.push(
			'',
			`Quality preset in every run of both builds: ${[...same].map(([preset, names]) => `${preset} on ${names.join(', ')}`).join('; ')}.`,
		);
	if (mixed.length > 0)
		lines.push('', 'Pages whose runs drew at different quality presets, round by round:', ...mixed);
	const traced = qualities.filter((quality) => quality.steps !== null);
	const stepped = traced.filter((quality) => (quality.steps ?? 0) > 0);
	if (traced.length > 0)
		lines.push(
			'',
			stepped.length === 0
				? `Quality steps in the measured seconds: none in any run of ${[...new Set(traced.map(pageName))].join(', ')}.`
				: `Quality steps in the measured seconds: ${stepped.map((q) => `${q.build} ${pageName(q)} round ${q.round} took ${q.steps}`).join('; ')}.`,
		);
	return lines;
}

// The verdict and the report.

/**
 * Whether the new build passes, and why it fails when it does not. When the measurement changed,
 * the failures are reported and not judged, and the new build passes.
 */
export interface Verdict {
	pass: boolean;
	failures: string[];
	/** Why the two builds measure in different ways, or none. */
	measurementChanges: string[];
}

const runsText = (count: number) => `${count} ${count === 1 ? 'run' : 'runs'}`;

/** Why a page was not compared: how many runs of each build it kept, and how many rounds pair up. */
const missingText = ({ kept, runs, rounds }: MissingPage) =>
	`the new build kept ${runsText(kept.new)} of ${runs.new} and the baseline ${runsText(kept.baseline)} of ${runs.baseline}, so ${rounds} ${rounds === 1 ? 'round has' : 'rounds have'} a run of each, and a comparison needs ${MIN_ROUNDS}`;

/** True when the new build's own runs, not the baseline's, keep a page from its comparison. */
const newBuildShort = (page: MissingPage) => page.kept.new < MIN_ROUNDS;

/**
 * The new build fails when a page gets slower than its rule allows and no trailer names it, and
 * when it kept too few runs of a page to compare. A page that the baseline's runs keep from its
 * comparison is left out without failing, so a commit that mends a broken page can pass. When the
 * measurement changed, nothing fails: the two builds' times do not measure the engine alone.
 */
export function judge(
	{ comparisons, missing }: BuildComparison,
	measurementChanges: readonly string[] = [],
): Verdict {
	const failures = [
		...missing.filter(newBuildShort).map((page) => `${pageName(page)}: ${missingText(page)}`),
		...comparisons
			.filter((c) => c.result === 'slower' && c.expected === null)
			.map(
				(c) =>
					`${pageName(c)}, ${MEASURES[c.measure].name}: ${percentText(c)} slower, noise ${noiseText(c)} (medians ${ms3(c.baseline.median)} ms and ${ms3(c.new.median)} ms)`,
			),
	];
	return {
		pass: failures.length === 0 || measurementChanges.length > 0,
		failures,
		measurementChanges: [...measurementChanges],
	};
}

/** Milliseconds with three decimals, as a comparison needs for the timer's 5-microsecond steps. */
export const ms3 = (value: number | null) => (value === null ? 'n/a' : value.toFixed(3));

/** The change as a signed percentage. */
function percentText({ change }: Pick<Comparison, 'change'>): string {
	const percent = change * 100;
	return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

/** The change's noise as a percentage. */
const noiseText = ({ noise }: Pick<Comparison, 'noise'>) => `${(noise * 100).toFixed(1)}%`;

const spread = (v: BuildValues) => `${ms3(v.median)} (${ms3(v.min)} to ${ms3(v.max)})`;

/** A comparison's result in words, with the trailer's reason when it names a slower median. */
function resultText(c: Comparison): string {
	if (c.result === 'slower')
		return c.expected ? `slower, expected: ${c.expected.reason}` : '**slower**';
	return c.result;
}

/** What the report says about the two builds and how the runs ran. */
export interface ReportContext {
	/** Each build's commit, such as its short hash and subject. */
	baseline: string;
	new: string;
	/** Runs of each page per build, and each run's warm-up and measured seconds. */
	runs: number;
	warmupSeconds: number;
	measureSeconds: number;
	/** The browser and the machine, in a few words. */
	browser: string;
	selection: RunSelection;
	trailers: ExpectedChanges;
	rules?: Readonly<Record<Measure, Rule>>;
}

const problemsText = (count: number) => (count === 1 ? 'one problem' : `${count} problems`);

/** The verdict's lines of the report. */
function verdictLines({ pass, failures, measurementChanges }: Verdict): string[] {
	if (measurementChanges.length > 0)
		return [
			`**Measurement changed**: the run reports every page and judges none, because the two builds measure in different ways. Main's next run compares with this commit.`,
			...measurementChanges.map((change) => `- ${change}`),
			...(failures.length > 0
				? ['', `Not judged: ${problemsText(failures.length)}.`, ...failures.map((f) => `- ${f}`)]
				: []),
		];
	return [
		pass
			? `**Passed**: no page is slower than its rule allows without a ${EXPECTED_TRAILER} trailer that names it.`
			: `**Failed**: ${problemsText(failures.length)}.`,
		...failures.map((failure) => `- ${failure}`),
	];
}

/** The comparison as a short Markdown summary: the verdict, the table, GPU time and the runs. */
export function compareReport(
	result: BuildComparison,
	verdict: Verdict,
	context: ReportContext,
): string[] {
	const rules = context.rules ?? RULES;
	const limits = MEASURE_NAMES.map(
		(measure, k) =>
			`its ${MEASURES[measure].name} ${k === 0 ? 'is ' : ''}more than ${ruleText(rules[measure])} slower`,
	).join(', or ');
	const lines = [
		'## Benchmark comparison',
		'',
		`The new build, ${context.new}, against the baseline, ${context.baseline}, in ${context.browser}. Each page ran ${context.runs} times per build, in rounds that run each page once in each build, with ${context.warmupSeconds} s of warm-up and ${context.measureSeconds} s measured.`,
		'',
		...verdictLines(verdict),
		'',
		'| Scene | Page | Measure | Baseline ms, median (lowest to highest run) | New ms | Change | Noise | Result |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
		...result.comparisons.map(
			(c) =>
				`| ${c.scene} | ${c.kind} | ${MEASURES[c.measure].name} | ${spread(c.baseline)} | ${spread(c.new)} | ${percentText(c)} | ${noiseText(c)} | ${resultText(c)} |`,
		),
		'',
		`Each run gives the median CPU time per frame of the busiest thread, and of the engine's own work on it. The change is the median over rounds of the new build's run against the baseline's. Its noise is the standard error of that median, from the spread of the rounds. A page fails when ${limits}, and the change is more than ${NOISE_TIMES} times its noise.`,
	];
	const gpu = result.gpu.filter((g) => g.baselineMs !== null || g.newMs !== null);
	if (gpu.length > 0)
		lines.push(
			'',
			`GPU time per frame, reported and not judged: ${gpu.map((g) => `${pageName(g)} ${ms3(g.baselineMs)} ms to ${ms3(g.newMs)} ms`).join('; ')}.`,
		);
	const notCompared = result.missing.filter((page) => !newBuildShort(page));
	if (notCompared.length > 0)
		lines.push(
			'',
			`Not compared: ${notCompared.map((page) => `${pageName(page)}, as ${missingText(page)}`).join('; ')}.`,
		);
	const { kept, refreshHz, dropped } = context.selection;
	lines.push(...qualityLines(runQualities([...kept, ...dropped.map(({ run }) => run)])));
	const rates = [...new Set(Object.values(refreshHz))];
	const rateText =
		rates.length === 1
			? `${rates[0] === null ? 'not measured' : `${rates[0]} Hz`} on every page`
			: Object.entries(refreshHz)
					.map(([page, hz]) => `${page} ${hz === null ? 'not measured' : `${hz} Hz`}`)
					.join('; ');
	lines.push(
		'',
		`Refresh rate: ${rateText}. ${dropped.length === 0 ? 'No run was dropped.' : `Dropped runs: ${dropped.map(({ run, reason }) => `${run.build} ${pageName(run)} round ${run.round} (${reason})`).join('; ')}.`}`,
	);
	const { changes, problems } = context.trailers;
	if (changes.length > 0)
		lines.push('', 'Expected changes:', ...changes.map((change) => `- \`${change.line}\``));
	if (problems.length > 0)
		lines.push('', 'Trailers that do not count:', ...problems.map((problem) => `- ${problem}`));
	return lines;
}

// A comparison's record: what its runs measured, from which a report can be made without a
// browser. CI splits a comparison's pages between machines, each running both builds of its
// share, and then merges the shards' records into one report and one verdict.

/** One page of a comparison's plan: a scene on a page kind. */
export interface PlanPage {
	scene: string;
	kind: string;
}

/** Everything a comparison measured, for the whole plan or for one shard of it. */
export interface ComparisonRecord {
	/** The shard of the plan that the runs cover, or null for the whole plan. */
	shard: Shard | null;
	/** Every page of the plan, in the order the report lists them. */
	plan: PlanPage[];
	/** The pages of the plan that this record covers, whether their runs ran or not. */
	pages: PlanPage[];
	/** Each build's commit, such as its short hash and subject. */
	commits: Record<Build, string>;
	/** The messages of the commits that the new build adds to the baseline, where trailers are. */
	messages: string[];
	/** Why the two builds measure in different ways, or none: see `measurementChanges`. */
	measurementChanges: string[];
	/** The browser, the machine and the pages, in a few words. */
	browser: string;
	runs: number;
	warmupSeconds: number;
	measureSeconds: number;
	results: BuildRun[];
}

/**
 * The pages of one shard of a plan: every count-th page, from the shard's place in the plan. The
 * shards' shares then differ by one page at most.
 */
export function shardPages<T extends PlanPage>(plan: readonly T[], { index, count }: Shard): T[] {
	return plan.filter((_, k) => k % count === index - 1);
}

/** The fields that every record of a merge must share, and what an error calls each. */
const SHARED_FIELDS = {
	plan: 'plan of pages',
	commits: 'commits',
	measurementChanges: 'measurement changes',
	runs: 'number of rounds',
	warmupSeconds: 'warm-up',
	measureSeconds: 'measured time',
} as const satisfies Partial<Record<keyof ComparisonRecord, string>>;

/**
 * Merges the records of a plan's shards into the record of the whole plan. Each page of the plan
 * must be in exactly one record, and the records must agree on the plan, the commits and the
 * protocol. The runs keep their order within each page, and the pages take the plan's order.
 */
export function mergeRecords(records: readonly ComparisonRecord[]): ComparisonRecord {
	const [first] = records;
	if (!first) throw new Error('there are no shard records to merge');
	for (const field of Object.keys(SHARED_FIELDS) as (keyof typeof SHARED_FIELDS)[])
		if (records.some((r) => JSON.stringify(r[field]) !== JSON.stringify(first[field])))
			throw new Error(`the shard records differ in their ${SHARED_FIELDS[field]}`);
	const order = new Map(first.plan.map((page, k) => [pageName(page), k]));
	const held = new Set<string>();
	for (const record of records)
		for (const page of record.pages) {
			const name = pageName(page);
			if (!order.has(name)) throw new Error(`${name} is not in the plan`);
			if (held.has(name)) throw new Error(`two shard records hold ${name}`);
			held.add(name);
		}
	const missing = first.plan.filter((page) => !held.has(pageName(page)));
	if (missing.length > 0)
		throw new Error(
			`no shard record holds ${missing.map(pageName).join(', ')}: rerun the shards that failed`,
		);
	const place = (run: BuildRun) => order.get(pageName(run)) ?? 0;
	const browsers = [...new Set(records.map((r) => r.browser))].join('; ');
	return {
		...first,
		shard: null,
		pages: first.plan,
		browser:
			records.length > 1
				? `${browsers}, in ${records.length} shards of the pages, each on a machine of its own`
				: browsers,
		results: records.flatMap((r) => r.results).sort((a, b) => place(a) - place(b)),
	};
}

/** A judged comparison: the report's lines, the verdict, and the summary that goes to a file. */
export interface JudgedComparison {
	report: string[];
	verdict: Verdict;
	summary: object;
}

/**
 * Judges a record: reads its trailers, selects its runs, compares the builds, and writes the
 * report. The summary holds each build's medians of each page, the runs dropped, the comparisons
 * and the verdict.
 */
export function judgeRecord(record: ComparisonRecord, known: KnownNames): JudgedComparison {
	const trailers = readExpectedChanges(record.messages, known);
	const selection = selectRuns(record.results);
	const comparison = compareBuilds(selection, trailers.changes);
	const verdict = judge(comparison, record.measurementChanges);
	const report = compareReport(comparison, verdict, {
		baseline: record.commits.baseline,
		new: record.commits.new,
		runs: record.runs,
		warmupSeconds: record.warmupSeconds,
		measureSeconds: record.measureSeconds,
		browser: record.browser,
		selection,
		trailers,
	});
	const summaries = BUILDS.flatMap((build) =>
		record.pages.flatMap(({ scene, kind }) => {
			const kept = selection.kept.filter(
				(r) => r.build === build && r.scene === scene && r.kind === kind,
			);
			return kept.length > 0
				? [{ build, scene, kind, summary: summarizeRuns(kept.map((r) => r.result)) }]
				: [];
		}),
	);
	const dropped = selection.dropped.map(({ run: { build, scene, kind, round }, reason }) => ({
		build,
		scene,
		kind,
		round,
		reason,
	}));
	const summary = {
		commits: record.commits,
		shard: record.shard,
		refreshHz: selection.refreshHz,
		dropped,
		quality: runQualities(record.results),
		summaries,
		...comparison,
		verdict,
	};
	return { report, verdict, summary };
}
