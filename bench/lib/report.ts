// Benchmark results: the comparison of null3d with three.js's faster renderer, the table of a sweep
// of job worker counts, the phone scene's traces of each second, the WebGL call times of the -timed
// pages, and a line chart as SVG. The median and spread of repeated runs of one page
// come from the benchmark protocol in the command-line tool's package, which its bench command
// shares. Everything here is pure, so the benchmark command and the runner's results share it.
//
// A frame's CPU time includes the sketch's code, which moves the scene alike in every engine's version
// of a scene. A report also compares each engine's own work: the CPU time its own code takes on its
// busiest thread. null3d times the sketch's update itself. three.js calls its own code from inside
// the sketch's loop, so its own work is its frame time less the scene code, which the scene-code page
// times alone.
import {
	ms,
	type RunSummary,
	summarizeRuns,
	type TimedRun,
} from '../../packages/cli/src/protocol.js';
import { type GlTiming, sumGlTiming } from '../pages/lib/gl-timing';
import { summarizeTrace, type TraceSecond, type TraceSummary } from '../pages/lib/trace';
import { SCENE_CODE } from './parity';

export { median, ms, summarizeRuns } from '../../packages/cli/src/protocol.js';
export type { RunSummary };

/** What a timed benchmark page publishes. null3d pages add the engine's full frame metrics. */
export interface BenchResult extends TimedRun {
	ok: boolean;
	error?: string;
	scene: string;
	renderer: string;
	n: number;
	/**
	 * null3d pages: how the engine ran, such as how many job workers it started and the quality
	 * preset it drew with.
	 */
	mode?: { jobWorkers: number; preset?: string };
	/** Pages that record one: the trace of each measured second. */
	trace?: TraceSecond[];
	/** The -timed pages: the time of each WebGL call on the thread that draws. */
	glTiming?: GlTiming;
}

/** null3d's value of a measure against three.js's lowest value of it over its renderers. */
export interface Share {
	share: number;
	null3dMs: number;
	threeMs: number;
}

/**
 * An engine's own CPU work per frame on its busiest thread, apart from the sketch's code.
 *
 * null3d times the sketch's update itself, so each thread's own work is its time less the update
 * phase on it: exact, from the same frames. The update holds the scene code and the sketch's writes
 * into the engine's arrays, which run no engine code.
 *
 * three.js runs on its main thread, and its own code (matrix composition, the instance buffer and
 * drawing) runs from inside the sketch's loop, so its own work is its frame time less `sceneCodeMs`,
 * the scene code's time from the scene-code page. A loop there can compile to slower code than the
 * same code inside an engine's loop, which makes this estimate of three.js's own work low.
 *
 * Both come from medians, so they estimate the per-frame values closely rather than exactly.
 */
export function ownWorkMs(summary: RunSummary, sceneCodeMs: number): number {
	const threads = summary.threadsMs;
	if (!threads) return Math.max(0, summary.cpuMs.median - sceneCodeMs);
	let busiest = 0;
	for (const thread of Object.keys(threads))
		busiest = Math.max(busiest, threadOwnWorkMs(summary, thread) ?? 0);
	return busiest;
}

/**
 * A null3d thread's own work per frame: its median CPU time less the sketch's update phase on it.
 * Null when the run has no thread of that name.
 */
export function threadOwnWorkMs(summary: RunSummary, thread: string): number | null {
	const time = summary.threadsMs?.[thread];
	return time === undefined ? null : time - (summary.phases?.[`${thread}.update`] ?? 0);
}

/**
 * The thread with the most CPU time per frame, by its median over the runs, and that time. The
 * engine reports each thread's time with every role that ran on it, so in low-latency mode the
 * sketch worker's time includes the drawing. A page without per-thread times, such as three.js's,
 * runs on the page's main thread.
 */
export function busiestThread(summary: RunSummary): { thread: string; ms: number } {
	const threads = Object.entries(summary.threadsMs ?? {});
	if (threads.length === 0) return { thread: 'main', ms: summary.cpuMs.median };
	const [thread, ms] = threads.reduce((busiest, next) => (next[1] > busiest[1] ? next : busiest));
	return { thread, ms };
}

/** null3d's value of `measure` as a share of three.js's lowest; null when a side is missing or zero. */
function shareBy(
	null3d: RunSummary | undefined,
	threejs: readonly (RunSummary | undefined)[],
	measure: (summary: RunSummary) => number,
): Share | null {
	const three = threejs.filter((s) => s !== undefined).map(measure);
	if (!null3d || three.length === 0) return null;
	const threeMs = Math.min(...three);
	if (!(threeMs > 0)) return null;
	const null3dMs = measure(null3d);
	return { share: null3dMs / threeMs, null3dMs, threeMs };
}

/**
 * null3d's CPU time per frame as a share of three.js's faster renderer, each engine's whole
 * frame. Null when either side has no summary.
 */
export function shareOfThree(
	null3d: RunSummary | undefined,
	threejs: readonly (RunSummary | undefined)[],
): Share | null {
	return shareBy(null3d, threejs, (s) => s.cpuMs.median);
}

/**
 * null3d's own work on its busiest thread as a share of three.js's, both apart from the sketch's
 * code: the measure of the desktop speed target. Null without the scene code's time, which
 * three.js's side needs.
 */
export function ownShareOfThree(
	null3d: RunSummary | undefined,
	threejs: readonly (RunSummary | undefined)[],
	sceneCode: RunSummary | undefined,
): (Share & { sceneCodeMs: number }) | null {
	if (!sceneCode) return null;
	const sceneCodeMs = sceneCode.cpuMs.median;
	const share = shareBy(null3d, threejs, (s) => ownWorkMs(s, sceneCodeMs));
	return share && { ...share, sceneCodeMs };
}

/** One page's summary in a benchmark run. */
export interface SummaryRow {
	scene: string;
	/** The page kind, such as null3d-webgpu. */
	kind: string;
	/** The job workers that the page asked for with `?jobs=`, or undefined for the engine's own count. */
	jobs?: number;
	summary: RunSummary;
	/** Pages that record a trace: every run's seconds, summed up. */
	trace?: TraceSummary;
	/** The visual check of the row's scene on the row's GPU path, for a null3D page. */
	visual?: VisualFigures;
	/** The -timed pages: every run's WebGL call times, summed up. */
	glTiming?: GlTiming;
}

/**
 * A scene's shadow figures on one GPU path, from its visual check, with the limits of the scene
 * where it has them (tests/lib/visual-checks.ts).
 */
export interface VisualFigures {
	/** The largest share of pixels, in percent, whose shadow changed between two frames. */
	changedPercent: number;
	changedLimit?: number;
	/** How far shadow edges stray from the reference's, in pixels. */
	edgeOffsetPixels: number;
	edgeOffsetLimit?: number;
	/** The mean light between casters' feet and their shadows, in pixels. */
	contactGapPixels?: number;
	contactGapLimit?: number;
	/** The mean shadow on flat surfaces that the reference lights, in percent. */
	acnePercent?: number;
	acneLimit?: number;
}

/** A visual figure for the summary, marked when it is over its limit. */
function visualText(value: number | undefined, limit: number | undefined): string {
	if (value === undefined) return 'n/a';
	const text = value.toFixed(3);
	return limit !== undefined && value > limit ? `${text} OVER ${limit}` : text;
}

/**
 * One page's row of a report from its successful runs: their summary, and the summary of their
 * traces' seconds when the page records traces.
 */
export function summaryRow(
	row: Omit<SummaryRow, 'summary' | 'trace' | 'glTiming'>,
	results: readonly BenchResult[],
): SummaryRow {
	const traced = results.filter((result) => result.trace);
	const glTiming = sumGlTiming(results.map((result) => result.glTiming));
	const refreshHz = results.find((result) => result.stats?.refreshHz)?.stats?.refreshHz ?? null;
	return {
		...row,
		summary: summarizeRuns(results),
		...(traced.length > 0 && {
			trace: summarizeTrace(
				traced.flatMap((result) => result.trace ?? []),
				refreshHz,
			),
		}),
		...(glTiming && { glTiming }),
	};
}

/**
 * The traces of a run's pages as a Markdown table: the measured seconds, the target frame rate,
 * the seconds that held it, the lowest rate of any second, the lowest render scale and the
 * quality steps.
 */
export function traceTable(rows: readonly SummaryRow[]): string {
	const lines = [
		'| Scene | Page | Seconds | Target fps | Seconds at the target | Lowest fps | Lowest render scale | Quality steps |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const { scene, kind, trace } of rows) {
		if (!trace) continue;
		const held =
			trace.heldSeconds === null
				? 'n/a'
				: `${trace.heldSeconds} (${Math.round((100 * trace.heldSeconds) / Math.max(1, trace.seconds))}%)`;
		lines.push(
			`| ${scene} | ${kind} | ${trace.seconds} | ${trace.targetFps ?? 'n/a'} | ${held} | ${trace.lowestFps} | ${trace.lowestRenderScale} | ${trace.steps} |`,
		);
	}
	return lines.join('\n');
}

/** The WebGL calls of each -timed page that its table lists: those with the most time. */
const GL_TIMING_ROWS = 16;
/** The calls of a page's slowest frame that its table lists: those that took this long or more. */
const SLOW_CALL_MS = 0.5;

/**
 * The WebGL call times of a run's -timed and -synced pages as two Markdown tables. The first gives,
 * for each page, the calls that took the most time on the thread that draws, with their time and
 * count per measured frame and their longest single call. A call that waits for the browser's GPU
 * process shows here. The second gives the slow calls of each page's slowest frame, with their
 * place among the frame's calls.
 */
export function glTimingTable(rows: readonly SummaryRow[]): string {
	const lines = [
		'| Scene | Page | WebGL call | ms per frame | Calls per frame | Longest call, ms |',
		'| --- | --- | --- | --- | --- | --- |',
	];
	for (const { scene, kind, glTiming } of rows) {
		if (!glTiming) continue;
		const frames = Math.max(1, glTiming.frames);
		for (const call of glTiming.calls.slice(0, GL_TIMING_ROWS))
			lines.push(
				`| ${scene} | ${kind} | ${call.name} | ${(call.ms / frames).toFixed(3)} | ${(call.calls / frames).toFixed(1)} | ${call.longestMs.toFixed(2)} |`,
			);
	}
	lines.push(
		'',
		"| Scene | Page | Slowest frame's call | Place in the frame's calls | ms |",
		'| --- | --- | --- | --- | --- |',
	);
	for (const { scene, kind, glTiming } of rows) {
		const frame = glTiming?.slowestFrame ?? [];
		frame.forEach((call, k) => {
			if (call.ms >= SLOW_CALL_MS)
				lines.push(
					`| ${scene} | ${kind} | ${call.name} | ${k + 1} of ${frame.length} | ${call.ms.toFixed(2)} |`,
				);
		});
	}
	return lines.join('\n');
}

/**
 * Bytes uploaded per visible entry: the median upload per frame over the median count of visible
 * entries. On WebGL2 it is about 4, each entry's index, when only the camera moves. Null without a
 * count.
 */
export function uploadPerVisibleEntry({ uploadBytes, visibleEntries }: RunSummary): number | null {
	return uploadBytes !== undefined && visibleEntries ? uploadBytes / visibleEntries : null;
}

/** The summary of one scene's page of one kind in a run's rows. */
const summaryOf = (rows: readonly SummaryRow[], scene: string, kind: string) =>
	rows.find((r) => r.scene === scene && r.kind === kind)?.summary;

/** The median CPU time per frame, with the lowest and highest run's in parentheses. */
const cpuSpread = ({ cpuMs }: RunSummary) =>
	`${ms(cpuMs.median)} (${ms(cpuMs.min)} to ${ms(cpuMs.max)})`;

/** The busiest thread's name and its CPU time per frame. */
const busiestText = (summary: RunSummary) => {
	const { thread, ms: time } = busiestThread(summary);
	return `${thread} ${ms(time)}`;
};

/** The run's summaries as a Markdown table. */
export function summaryTable(rows: readonly SummaryRow[]): string {
	const lines = [
		'| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Busiest thread, ms | Own work, busiest thread | Scene update | All threads | GPU ms | Shadow pixels changed, % | Shadow edge offset, px | Contact gap, px | Flat-surface acne, % | Presented / finished fps | Frame interval p95 / p99 ms | GPU delay ms | Refresh Hz | Upload per frame | Visible entries | Upload per visible entry | Draw calls |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const { scene, kind, summary: s, visual: v } of rows) {
		const changed = visualText(v?.changedPercent, v?.changedLimit);
		const edges = visualText(v?.edgeOffsetPixels, v?.edgeOffsetLimit);
		const feet = visualText(v?.contactGapPixels, v?.contactGapLimit);
		const acne = visualText(v?.acnePercent, v?.acneLimit);
		const upload = s.uploadBytes === undefined ? 'n/a' : `${(s.uploadBytes / 1e6).toFixed(2)} MB`;
		const visible =
			s.visibleEntries == null ? 'n/a' : Math.round(s.visibleEntries).toLocaleString('en-US');
		const perEntry = uploadPerVisibleEntry(s);
		const uploadPerEntry = perEntry === null ? 'n/a' : `${perEntry.toFixed(1)} bytes`;
		const sceneCode = summaryOf(rows, scene, SCENE_CODE);
		const own = kind === SCENE_CODE || !sceneCode ? null : ownWorkMs(s, sceneCode.cpuMs.median);
		const fps = (value: number | null | undefined) => (value == null ? 'n/a' : value.toFixed(1));
		const rates =
			s.presentedFps === undefined ? 'n/a' : `${fps(s.presentedFps)} / ${fps(s.completedFps)}`;
		const pacing = `${ms(s.intervalP95Ms)} / ${ms(s.intervalP99Ms)}`;
		lines.push(
			`| ${scene} | ${kind} | ${s.runs} | ${cpuSpread(s)} | ${ms(s.cpuP95Ms)} | ${busiestText(s)} | ${ms(own)} | ${ms(s.updateMs)} | ${ms(s.allThreadsMs)} | ${ms(s.gpuMs)} | ${changed} | ${edges} | ${feet} | ${acne} | ${rates} | ${pacing} | ${ms(s.gpuLatencyMs)} | ${s.refreshHz ?? 'n/a'} | ${upload} | ${visible} | ${uploadPerEntry} | ${s.drawCalls ?? 'n/a'} |`,
		);
	}
	return lines.join('\n');
}

/**
 * A sweep of job worker counts as a Markdown table: for each scene, count and page, the CPU time
 * per frame, the busiest thread, the own work on the busiest thread and the sketch worker's own
 * work. The job workers take over the sketch worker's parallel loops, so its own work shows what
 * each count saves.
 */
export function jobsTable(rows: readonly SummaryRow[]): string {
	const lines = [
		"| Scene | Job workers | Page | Runs | CPU ms per frame, median (lowest to highest run) | Busiest thread, ms | Own work, busiest thread | Sketch worker's own work |",
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	// null3d times the sketch's update itself, so its own work needs no scene-code page.
	const noSceneCode = 0;
	for (const { scene, kind, jobs, summary: s } of rows)
		lines.push(
			`| ${scene} | ${jobs ?? 'default'} | ${kind} | ${s.runs} | ${cpuSpread(s)} | ${busiestText(s)} | ${ms(ownWorkMs(s, noSceneCode))} | ${ms(threadOwnWorkMs(s, 'sketch-worker'))} |`,
		);
	return lines.join('\n');
}

/**
 * A benchmark run's report as Markdown lines: the summary table and the comparisons with three.js,
 * or the table of a sweep of job worker counts.
 */
export function benchReport(rows: readonly SummaryRow[]): string[] {
	if (rows.some((row) => row.jobs !== undefined)) return [jobsTable(rows)];
	const traces = rows.some((row) => row.trace) ? ['', traceTable(rows)] : [];
	const calls = rows.some((row) => row.glTiming) ? ['', glTimingTable(rows)] : [];
	return [summaryTable(rows), '', ...comparisonLines(rows), ...traces, ...calls];
}

/** three.js's pages, and the name of each renderer. */
const THREE_PAGES = [
	['threejs-webgpu', 'WebGPU'],
	['threejs-webgl', 'WebGL'],
] as const;

/**
 * The null3d pages that reports compare with three.js: the GPU path and latency mode each runs,
 * and three.js's page on the same API.
 */
const NULL3D_PAGES = [
	['null3d-webgpu', 'WebGPU', 'threejs-webgpu'],
	['null3d-webgl2', 'WebGL2', 'threejs-webgl'],
	['null3d-webgpu-low', 'WebGPU with low latency', 'threejs-webgpu'],
	['null3d-webgl2-low', 'WebGL2 with low latency', 'threejs-webgl'],
	['null3d-webgpu-cells-off', 'WebGPU without cell culling', 'threejs-webgpu'],
	['null3d-webgl2-cells-off', 'WebGL2 without cell culling', 'threejs-webgl'],
	['null3d-webgpu-half', 'WebGPU at half precision', 'threejs-webgpu'],
	['null3d-webgl2-half', 'WebGL2 at half precision', 'threejs-webgl'],
	['null3d-webgpu-prepass', 'WebGPU with the depth prepass', 'threejs-webgpu'],
	['null3d-webgl2-prepass', 'WebGL2 with the depth prepass', 'threejs-webgl'],
	['null3d-webgpu-index', 'WebGPU with instance data by index', 'threejs-webgpu'],
	['null3d-webgpu-skin-vertex', 'WebGPU skinning in the vertex shader', 'threejs-webgpu'],
	['null3d-webgpu-skin-full', 'WebGPU skinning without its savings', 'threejs-webgpu'],
	['null3d-webgpu-skin-skip', 'WebGPU skinning with the pose skip only', 'threejs-webgpu'],
	['null3d-webgpu-skin-narrow', 'WebGPU skinning with 8-bit normals only', 'threejs-webgpu'],
] as const;

const percent = (share: number) => `${(share * 100).toFixed(0)}%`;

/** The name of the renderer a three.js page kind draws with. */
const rendererName = (kind: string) => THREE_PAGES.find(([page]) => page === kind)?.[1] ?? kind;

/** How null3d on one GPU path compares with three.js on one scene, by one measure. */
interface PathComparison {
	/** Against three.js's faster renderer by the measure, and that renderer's name. */
	faster: Share;
	fasterName: string;
	/** Against three.js on the same API; null when that page did not run. */
	same: Share | null;
}

/**
 * null3d's value of `measure` on one path against three.js's faster renderer and against three.js
 * on the same API, from one scene's summaries by page kind; null without null3d's or three.js's.
 */
function comparePath(
	of: (kind: string) => RunSummary | undefined,
	kind: string,
	same: string,
	measure: (summary: RunSummary) => number,
): PathComparison | null {
	const null3d = of(kind);
	const three = THREE_PAGES.map(([page, name]) => ({ name, summary: of(page) }));
	const faster = shareBy(
		null3d,
		three.map((t) => t.summary),
		measure,
	);
	if (!faster) return null;
	const fasterName =
		three.find((t) => t.summary && measure(t.summary) === faster.threeMs)?.name ?? 'three.js';
	return { faster, fasterName, same: shareBy(null3d, [of(same)], measure) };
}

/**
 * The comparison as words: against the faster renderer, then against three.js on the same API
 * when that is the other renderer. `what` names the first measure, such as "the CPU time per
 * frame of".
 */
function comparedWith(c: PathComparison, what: string, sameName: string): string {
	const against = (share: Share, of: string, whose: string) =>
		`${percent(share.share)} of ${of} ${whose} (${ms(share.null3dMs)} ms against ${ms(share.threeMs)} ms)`;
	const faster = against(c.faster, what, `three.js's faster renderer, ${c.fasterName}`);
	return c.same && c.fasterName !== sameName
		? `${faster}, and ${against(c.same, 'that of', `three.js's ${sameName} renderer`)}`
		: faster;
}

/**
 * Sentences for each scene and each null3d GPU path in the run: null3d's CPU time per frame as a
 * share of three.js's faster renderer and of three.js on the same API, and, with the scene-code
 * page's run, its own work as a share of three.js's.
 */
export function comparisonLines(rows: readonly SummaryRow[]): string[] {
	const scenes = [...new Set(rows.map((r) => r.scene))];
	return scenes.flatMap((scene) => {
		const of = (kind: string) => summaryOf(rows, scene, kind);
		const sceneCode = of(SCENE_CODE);
		return NULL3D_PAGES.flatMap(([kind, path, same]) => {
			const sameName = rendererName(same);
			const whole = comparePath(of, kind, same, (s) => s.cpuMs.median);
			const own =
				sceneCode && comparePath(of, kind, same, (s) => ownWorkMs(s, sceneCode.cpuMs.median));
			return [
				...(whole
					? [
							`${scene}: null3d on ${path} takes ${comparedWith(whole, 'the CPU time per frame of', sameName)}.`,
						]
					: []),
				...(own && sceneCode
					? [
							`${scene}: null3d's own work on ${path}, on its busiest thread and apart from the sketch's code, is ${comparedWith(own, 'that of', sameName)}; three.js's is its frame less the scene code timed alone (${ms(sceneCode.cpuMs.median)} ms).`,
						]
					: []),
			];
		});
	});
}

/** One count of a sweep: the summary of each page kind that ran at it. */
export interface SweepPoint {
	n: number;
	summaries: Partial<Record<string, RunSummary>>;
}

/**
 * A sweep of one scene as Markdown: for the whole frame and for each engine's own work, a table of
 * each page's time at each count and each null3d path's share of three.js's faster renderer and of
 * three.js on the same API, then one line per path and comparison that names the counts where
 * null3d is not faster. Only the null3d paths that the sweep ran get columns and lines.
 */
export function sweepReport(scene: string, points: readonly SweepPoint[]): string[] {
	const measures = [
		['Whole frame', 'CPU time per frame on the busiest thread', null],
		['Own work', 'own work on the busiest thread, apart from the scene code', SCENE_CODE],
	] as const;
	const paths = NULL3D_PAGES.filter(([kind]) => points.some(({ summaries }) => summaries[kind]));
	const pages = [...paths.map(([kind]) => kind), ...THREE_PAGES.map(([kind]) => kind)];
	const lines: string[] = [];
	for (const [title, what, needs] of measures) {
		lines.push(
			`### ${scene}: ${what}, ms`,
			'',
			`| Objects | ${pages.join(' | ')} | ${paths.map(([, path, same]) => `${path} against three.js's faster | ${path} against three.js ${rendererName(same)}`).join(' | ')} |`,
			`| --- |${' --- |'.repeat(pages.length + 2 * paths.length)}`,
		);
		const slower = paths.map(() => ({ faster: [] as string[], same: [] as string[] }));
		for (const { n, summaries } of points) {
			const of = (kind: string) => summaries[kind];
			const sceneCode = of(SCENE_CODE);
			if (needs && !sceneCode) continue;
			const measure = (s: RunSummary) =>
				sceneCode && needs ? ownWorkMs(s, sceneCode.cpuMs.median) : s.cpuMs.median;
			const times = pages.map((kind) => {
				const summary = of(kind);
				return summary ? ms(measure(summary)) : 'n/a';
			});
			const shares = paths.flatMap(([kind, , same], k) => {
				const c = comparePath(of, kind, same, measure);
				const at = n.toLocaleString('en-US');
				if (c && c.faster.share >= 1) slower[k]?.faster.push(`${at} (${percent(c.faster.share)})`);
				if (c?.same && c.same.share >= 1) slower[k]?.same.push(`${at} (${percent(c.same.share)})`);
				return [c ? percent(c.faster.share) : 'n/a', c?.same ? percent(c.same.share) : 'n/a'];
			});
			lines.push(`| ${n.toLocaleString('en-US')} | ${[...times, ...shares].join(' | ')} |`);
		}
		lines.push('');
		paths.forEach(([, path, same], k) => {
			const { faster, same: sameApi } = slower[k] ?? { faster: [], same: [] };
			const verdict = (against: string, counts: string[]) =>
				counts.length === 0
					? `${scene}, ${title.toLowerCase()}: null3d on ${path} is faster than ${against} at every count.`
					: `${scene}, ${title.toLowerCase()}: null3d on ${path} is not faster than ${against} at these object counts: ${counts.join(', ')}.`;
			lines.push(
				verdict("three.js's faster renderer", faster),
				verdict(`three.js's ${rendererName(same)} renderer`, sameApi),
			);
		});
		lines.push('');
	}
	return lines;
}

export interface ChartSeries {
	name: string;
	color: string;
	/** Draw the line dashed, as for a part or a variant of another series in the same color. */
	dashed?: boolean;
	points: readonly { x: number; y: number }[];
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Gridlines a chart aims for on its value axis. */
const VALUE_TICKS = 5;

/**
 * The step between gridlines on a value axis that reaches `max`: 1, 2, 2.5 or 5 times a power of
 * ten, so every gridline has a round label.
 */
export function niceStep(max: number, ticks = VALUE_TICKS): number {
	const raw = max > 0 ? max / ticks : 1;
	const power = 10 ** Math.floor(Math.log10(raw));
	const multiple = [1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10;
	return multiple * power;
}

/**
 * A line chart as SVG, with a logarithmic x axis: for example CPU time per frame against the
 * instance count. Axis ticks sit at the data's x values.
 */
export function lineChartSvg(
	title: string,
	xLabel: string,
	yLabel: string,
	series: readonly ChartSeries[],
): string {
	const plotWidth = 500;
	const height = 440;
	const left = 70;
	// The legend is as wide as its longest name, at about 7 pixels a character.
	const right = 52 + 7 * Math.max(0, ...series.map((s) => s.name.length));
	const width = left + plotWidth + right;
	const top = 50;
	const bottom = 60;
	const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
	const highest = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y)));
	const step = niceStep(highest);
	const yTicks = Array.from(
		{ length: Math.max(1, Math.ceil(highest / step)) + 1 },
		(_, i) => i * step,
	);
	const yMax = yTicks[yTicks.length - 1] as number;
	const [xMin, xMax] = [Math.log10(xs[0] ?? 1), Math.log10(xs[xs.length - 1] ?? 10)];
	const px = (x: number) => left + ((Math.log10(x) - xMin) / (xMax - xMin || 1)) * plotWidth;
	const py = (y: number) => top + (1 - y / yMax) * (height - top - bottom);
	const lines = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="12">`,
		`<rect width="${width}" height="${height}" fill="#ffffff"/>`,
		`<text x="${left}" y="28" font-size="16" font-weight="600">${escapeXml(title)}</text>`,
		`<text x="${(left + width - right) / 2}" y="${height - 16}" text-anchor="middle">${escapeXml(xLabel)}</text>`,
		`<text transform="translate(18 ${(top + height - bottom) / 2}) rotate(-90)" text-anchor="middle">${escapeXml(yLabel)}</text>`,
		...yTicks.map(
			(y) =>
				`<line x1="${left}" x2="${width - right}" y1="${py(y)}" y2="${py(y)}" stroke="#e4e4e4"/><text x="${left - 8}" y="${py(y) + 4}" text-anchor="end">${Number(y.toFixed(3))}</text>`,
		),
		...xs.map(
			(x) =>
				`<text x="${px(x)}" y="${height - bottom + 18}" text-anchor="middle">${x.toLocaleString('en-US')}</text>`,
		),
		`<line x1="${left}" x2="${left}" y1="${top}" y2="${height - bottom}" stroke="#888"/>`,
		`<line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" stroke="#888"/>`,
	];
	series.forEach((s, i) => {
		const path = s.points.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
		const stroke = `stroke="${s.color}" stroke-width="2.5"${s.dashed ? ' stroke-dasharray="6 4"' : ''}`;
		const legendY = top + i * 24 - 7;
		lines.push(
			`<polyline points="${path}" fill="none" ${stroke}/>`,
			...s.points.map(
				(p) =>
					`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5" fill="${s.color}"/>`,
			),
			`<line x1="${width - right + 12}" x2="${width - right + 30}" y1="${legendY}" y2="${legendY}" ${stroke}/>`,
			`<text x="${width - right + 36}" y="${top + i * 24 - 3}">${escapeXml(s.name)}</text>`,
		);
	});
	lines.push('</svg>');
	return `${lines.join('\n')}\n`;
}
