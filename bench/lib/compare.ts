// A comparison of two builds of the engine: the baseline, such as the previous commit on main, and
// the new build. Both run the same benchmark pages on one machine, taking turns page by page, so a
// change in the machine's speed during the job reaches both builds alike. Everything here is pure,
// so the benchmark command and its tests share it.
//
// The comparison judges CPU time only: the busiest thread's time per frame, and the engine's own
// work on its busiest thread. Machines without a real GPU, or with a shared one, time the GPU
// poorly, so GPU time is reported and never judged.
import { isBareAck } from '../../tools/hooks/commit-ack.ts';
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
 * median, and at least a fixed time. The browser's timer counts in steps of 5 microseconds, so a
 * small time can move by a whole step from run to run.
 */
export interface Rule {
	share: number;
	floorMs: number;
}

/** More than 3% slower, and more than two steps of the browser's timer. */
export const RULE: Rule = { share: 0.03, floorMs: 0.01 };

/** The most that the new build may add to a baseline median of `baselineMs` under the rule. */
export function allowedMs(baselineMs: number, rule: Rule = RULE): number {
	return Math.max(baselineMs * rule.share, rule.floorMs);
}

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
	/** The change in milliseconds: the change times the baseline's median. */
	deltaMs: number;
	/** The most the change may add under the rule, in milliseconds. */
	allowedMs: number;
	/** Slower or faster by more than the rule allows, or the same within it. */
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
 * a round alike. A page with too few rounds in which both builds have a kept run is named instead.
 */
export function compareBuilds(
	{ kept, dropped }: Pick<RunSelection, 'kept' | 'dropped'>,
	expected: readonly ExpectedChange[] = [],
	rule: Rule = RULE,
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
			const deltaMs = change * before.median;
			const allowed = allowedMs(before.median, rule);
			const slower = deltaMs > allowed;
			const named = (entry: ExpectedChange) => names(entry, { scene, kind, measure });
			out.comparisons.push({
				scene,
				kind,
				measure,
				baseline: before,
				new: after,
				rounds: pairs.length,
				change,
				deltaMs,
				allowedMs: allowed,
				result: slower ? 'slower' : deltaMs < -allowed ? 'faster' : 'same',
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
	/** The trailer's line as the commit wrote it. */
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

const TRAILER_LINE = new RegExp(`^${EXPECTED_TRAILER}:[ \\t]*(.*)$`, 'gim');

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
		for (const match of message.matchAll(TRAILER_LINE)) {
			const line = match[0].trim();
			const value = (match[1] ?? '').trim();
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

// The verdict and the report.

/** Whether the new build passes, and why it fails when it does not. */
export interface Verdict {
	pass: boolean;
	failures: string[];
}

const runsText = (count: number) => `${count} ${count === 1 ? 'run' : 'runs'}`;

/** Why a page was not compared: how many runs of each build it kept, and how many rounds pair up. */
const missingText = ({ kept, runs, rounds }: MissingPage) =>
	`the new build kept ${runsText(kept.new)} of ${runs.new} and the baseline ${runsText(kept.baseline)} of ${runs.baseline}, so ${rounds} ${rounds === 1 ? 'round has' : 'rounds have'} a run of each, and a comparison needs ${MIN_ROUNDS}`;

/** True when the new build's own runs, not the baseline's, keep a page from its comparison. */
const newBuildShort = (page: MissingPage) => page.kept.new < MIN_ROUNDS;

/**
 * The new build fails when a page gets slower than the rule allows and no trailer names it, and
 * when it kept too few runs of a page to compare. A page that the baseline's runs keep from its
 * comparison is left out without failing, so a commit that mends a broken page can pass.
 */
export function judge({ comparisons, missing }: BuildComparison): Verdict {
	const failures = [
		...missing.filter(newBuildShort).map((page) => `${pageName(page)}: ${missingText(page)}`),
		...comparisons
			.filter((c) => c.result === 'slower' && c.expected === null)
			.map(
				(c) =>
					`${pageName(c)}, ${MEASURES[c.measure].name}: ${percentText(c)} slower (medians ${ms3(c.baseline.median)} ms and ${ms3(c.new.median)} ms)`,
			),
	];
	return { pass: failures.length === 0, failures };
}

/** Milliseconds with three decimals, as a comparison needs for the timer's 5-microsecond steps. */
export const ms3 = (value: number | null) => (value === null ? 'n/a' : value.toFixed(3));

/** The change as a signed percentage. */
function percentText({ change }: Pick<Comparison, 'change'>): string {
	const percent = change * 100;
	return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

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
	rule?: Rule;
}

/** The comparison as a short Markdown summary: the verdict, the table, GPU time and the runs. */
export function compareReport(
	result: BuildComparison,
	verdict: Verdict,
	context: ReportContext,
): string[] {
	const rule = context.rule ?? RULE;
	const limit = `${(rule.share * 100).toFixed(0)}% and ${rule.floorMs} ms`;
	const lines = [
		'## Benchmark comparison',
		'',
		`The new build, ${context.new}, against the baseline, ${context.baseline}, in ${context.browser}. Each page ran ${context.runs} times per build, in rounds that run each page once in each build, with ${context.warmupSeconds} s of warm-up and ${context.measureSeconds} s measured.`,
		'',
		verdict.pass
			? `**Passed**: no page is more than ${limit} slower without a ${EXPECTED_TRAILER} trailer that names it.`
			: `**Failed**: ${verdict.failures.length === 1 ? 'one problem' : `${verdict.failures.length} problems`}.`,
		...verdict.failures.map((failure) => `- ${failure}`),
		'',
		'| Scene | Page | Measure | Baseline ms, median (lowest to highest run) | New ms | Change | Result |',
		'| --- | --- | --- | --- | --- | --- | --- |',
		...result.comparisons.map(
			(c) =>
				`| ${c.scene} | ${c.kind} | ${MEASURES[c.measure].name} | ${spread(c.baseline)} | ${spread(c.new)} | ${percentText(c)} | ${resultText(c)} |`,
		),
		'',
		`The change is the median of the rounds' changes from the baseline's run to the new build's, and it fails when it is more than ${limit} slower. Each run gives the median CPU time per frame: the busiest thread's time, and the engine's own work on its busiest thread.`,
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
	const { refreshHz, dropped } = context.selection;
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
