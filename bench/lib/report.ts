// Benchmark results: the summary of repeated runs of one page, the comparison of null3d with
// three.js's faster renderer, and a line chart as SVG. Everything here is pure, so the benchmark
// command and the runner's results share it.
//
// A frame's CPU time includes the game's code, which moves the scene alike in every engine's version
// of a scene. A report also compares each engine's own work: the CPU time its own code takes on its
// busiest thread. null3d times the game's update itself. three.js calls its own code from inside
// the game's loop, so its own work is its frame time less the scene code, which the scene-code page
// times alone.
import { SCENE_CODE } from './parity';

/** What a timed benchmark page publishes. null3d pages add the engine's full frame metrics. */
export interface BenchResult {
	ok: boolean;
	error?: string;
	scene: string;
	renderer: string;
	n: number;
	frames: number;
	/** CPU time per frame: the main thread for three.js, the busiest thread for null3d. */
	cpuMs: { median: number; p95: number; p99: number; mean: number };
	/** three.js pages: the part of each frame that the scene update took. */
	updateMs?: { median: number };
	intervalMs: { median: number };
	stats?: {
		cpuMsAllThreads: { median: number };
		gpuMs: { median: number } | null;
		uploadBytes: { median: number };
		drawCalls: { median: number };
		threads: Record<
			string,
			{ busyMs: { median: number }; phases: Record<string, { median: number }> }
		>;
	};
}

/** Repeated runs of one page, summarized. */
export interface RunSummary {
	runs: number;
	/** The median of the runs' median CPU times, and their lowest and highest. */
	cpuMs: { median: number; min: number; max: number };
	cpuP95Ms: number;
	/** The scene update's share of a frame: the game's update phase for null3d. */
	updateMs?: number;
	intervalMs: number;
	/** null3d only: CPU time summed over threads, GPU time, and the median time of each phase. */
	allThreadsMs?: number;
	/** null3d only: the median CPU time per frame of each thread, by name. */
	threadsMs?: Record<string, number>;
	gpuMs?: number | null;
	phases?: Record<string, number>;
	uploadBytes?: number;
	drawCalls?: number;
}

/** The middle value, or the mean of the two middle values. */
export function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	if (sorted.length === 0) return 0;
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Summarizes runs of one page; failed runs must be left out first. */
export function summarizeRuns(results: readonly BenchResult[]): RunSummary {
	const cpu = results.map((r) => r.cpuMs.median);
	const summary: RunSummary = {
		runs: results.length,
		cpuMs: { median: median(cpu), min: Math.min(...cpu), max: Math.max(...cpu) },
		cpuP95Ms: median(results.map((r) => r.cpuMs.p95)),
		intervalMs: median(results.map((r) => r.intervalMs.median)),
	};
	const updates = results.map((r) => r.updateMs?.median).filter((v) => v !== undefined);
	if (updates.length === results.length) summary.updateMs = median(updates);
	const stats = results.map((r) => r.stats).filter((s) => s !== undefined);
	if (stats.length === results.length && stats.length > 0) {
		summary.allThreadsMs = median(stats.map((s) => s.cpuMsAllThreads.median));
		const gpu = stats.map((s) => s.gpuMs?.median).filter((v) => v !== undefined);
		summary.gpuMs = gpu.length > 0 ? median(gpu) : null;
		summary.uploadBytes = median(stats.map((s) => s.uploadBytes.median));
		summary.drawCalls = median(stats.map((s) => s.drawCalls.median));
		const phases: Record<string, number[]> = {};
		const threads: Record<string, number[]> = {};
		for (const s of stats) {
			for (const [thread, { busyMs, phases: byPhase }] of Object.entries(s.threads)) {
				threads[thread] = [...(threads[thread] ?? []), busyMs.median];
				for (const [phase, { median: value }] of Object.entries(byPhase)) {
					const key = `${thread}.${phase}`;
					phases[key] = [...(phases[key] ?? []), value];
				}
			}
		}
		const medians = (lists: Record<string, number[]>) =>
			Object.fromEntries(Object.entries(lists).map(([key, values]) => [key, median(values)]));
		summary.phases = medians(phases);
		summary.threadsMs = medians(threads);
		const update = summary.phases['game-worker.update'] ?? summary.phases['main.update'];
		if (update !== undefined) summary.updateMs = update;
	}
	return summary;
}

/** null3d's value of a measure against three.js's lowest value of it over its renderers. */
export interface Share {
	share: number;
	null3dMs: number;
	threeMs: number;
}

/**
 * An engine's own CPU work per frame on its busiest thread, apart from the game's code.
 *
 * null3d times the game's update itself, so each thread's own work is its time less the update
 * phase on it: exact, from the same frames. The update holds the scene code and the game's writes
 * into the engine's arrays, which run no engine code.
 *
 * three.js runs on its main thread, and its own code (matrix composition, the instance buffer and
 * drawing) runs from inside the game's loop, so its own work is its frame time less `sceneCodeMs`,
 * the scene code's time from the scene-code page. A loop there can compile to slower code than the
 * same code inside an engine's loop, which makes this estimate of three.js's own work low.
 *
 * Both come from medians, so they estimate the per-frame values closely rather than exactly.
 */
export function ownWorkMs(summary: RunSummary, sceneCodeMs: number): number {
	const threads = summary.threadsMs;
	if (!threads) return Math.max(0, summary.cpuMs.median - sceneCodeMs);
	let busiest = 0;
	for (const [thread, time] of Object.entries(threads))
		busiest = Math.max(busiest, time - (summary.phases?.[`${thread}.update`] ?? 0));
	return busiest;
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
 * null3d's own work on its busiest thread as a share of three.js's, both apart from the game's
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
	summary: RunSummary;
}

/** Milliseconds for a report: two decimals, or n/a. */
export const ms = (value: number | null | undefined) => (value == null ? 'n/a' : value.toFixed(2));

/** The summary of one scene's page of one kind in a run's rows. */
const summaryOf = (rows: readonly SummaryRow[], scene: string, kind: string) =>
	rows.find((r) => r.scene === scene && r.kind === kind)?.summary;

/** The run's summaries as a Markdown table. */
export function summaryTable(rows: readonly SummaryRow[]): string {
	const lines = [
		'| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | Own work, busiest thread | Scene update | All threads | GPU ms | Frame interval | Upload per frame | Draw calls |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const { scene, kind, summary: s } of rows) {
		const upload = s.uploadBytes === undefined ? 'n/a' : `${(s.uploadBytes / 1e6).toFixed(2)} MB`;
		const sceneCode = summaryOf(rows, scene, SCENE_CODE);
		const own = kind === SCENE_CODE || !sceneCode ? null : ownWorkMs(s, sceneCode.cpuMs.median);
		lines.push(
			`| ${scene} | ${kind} | ${s.runs} | ${ms(s.cpuMs.median)} (${ms(s.cpuMs.min)} to ${ms(s.cpuMs.max)}) | ${ms(s.cpuP95Ms)} | ${ms(own)} | ${ms(s.updateMs)} | ${ms(s.allThreadsMs)} | ${ms(s.gpuMs)} | ${ms(s.intervalMs)} | ${upload} | ${s.drawCalls ?? 'n/a'} |`,
		);
	}
	return lines.join('\n');
}

/**
 * Sentences for each scene: null3d's CPU time per frame as a share of three.js's faster renderer,
 * and, with the scene-code page's run, its own work as a share of three.js's.
 */
export function comparisonLines(rows: readonly SummaryRow[]): string[] {
	const percent = (share: number) => `${(share * 100).toFixed(0)}%`;
	const scenes = [...new Set(rows.map((r) => r.scene))];
	return scenes.flatMap((scene) => {
		const of = (kind: string) => summaryOf(rows, scene, kind);
		const null3d = of('null3d-webgpu');
		const threejs = [of('threejs-webgpu'), of('threejs-webgl')];
		const whole = shareOfThree(null3d, threejs);
		const own = ownShareOfThree(null3d, threejs, of(SCENE_CODE));
		return [
			...(whole
				? [
						`${scene}: null3d on WebGPU takes ${percent(whole.share)} of the CPU time per frame of three.js's faster renderer (${ms(whole.null3dMs)} ms against ${ms(whole.threeMs)} ms).`,
					]
				: []),
			...(own
				? [
						`${scene}: null3d's own work on its busiest thread, apart from the game's code, is ${percent(own.share)} of three.js's (${ms(own.null3dMs)} ms against ${ms(own.threeMs)} ms); three.js's is its frame less the scene code timed alone (${ms(own.sceneCodeMs)} ms).`,
					]
				: []),
		];
	});
}

export interface ChartSeries {
	name: string;
	color: string;
	/** Draw the line dashed, as for a part of another series in the same color. */
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
