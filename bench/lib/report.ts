// Benchmark results: the summary of repeated runs of one page, the comparison of sokko3d with
// three.js's faster renderer, and a line chart as SVG. Everything here is pure, so the benchmark
// command and the runner's results share it.

/** What a timed benchmark page publishes. sokko3d pages add the engine's full frame metrics. */
export interface BenchResult {
	ok: boolean;
	error?: string;
	scene: string;
	renderer: string;
	n: number;
	frames: number;
	/** CPU time per frame: the main thread for three.js, the busiest thread for sokko3d. */
	cpuMs: { median: number; p95: number; p99: number; mean: number };
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
	intervalMs: number;
	/** sokko3d only: CPU time summed over threads, GPU time, and the median time of each phase. */
	allThreadsMs?: number;
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
	const stats = results.map((r) => r.stats).filter((s) => s !== undefined);
	if (stats.length === results.length && stats.length > 0) {
		summary.allThreadsMs = median(stats.map((s) => s.cpuMsAllThreads.median));
		const gpu = stats.map((s) => s.gpuMs?.median).filter((v) => v !== undefined);
		summary.gpuMs = gpu.length > 0 ? median(gpu) : null;
		summary.uploadBytes = median(stats.map((s) => s.uploadBytes.median));
		summary.drawCalls = median(stats.map((s) => s.drawCalls.median));
		const phases: Record<string, number[]> = {};
		for (const s of stats) {
			for (const [thread, { phases: byPhase }] of Object.entries(s.threads)) {
				for (const [phase, { median: value }] of Object.entries(byPhase)) {
					const key = `${thread}.${phase}`;
					phases[key] = [...(phases[key] ?? []), value];
				}
			}
		}
		summary.phases = Object.fromEntries(
			Object.entries(phases).map(([key, values]) => [key, median(values)]),
		);
	}
	return summary;
}

/**
 * sokko3d's CPU time as a share of three.js's faster renderer, which the benchmark rules compare
 * against. Null when either side has no summary.
 */
export function shareOfThree(
	sokko3d: RunSummary | undefined,
	threejs: readonly (RunSummary | undefined)[],
): { share: number; threeMs: number } | null {
	const best = threejs
		.filter((s) => s !== undefined)
		.reduce<number | null>(
			(min, s) => (min === null ? s.cpuMs.median : Math.min(min, s.cpuMs.median)),
			null,
		);
	if (!sokko3d || best === null || best === 0) return null;
	return { share: sokko3d.cpuMs.median / best, threeMs: best };
}

/** One page's summary in a benchmark run. */
export interface SummaryRow {
	scene: string;
	/** The page kind, such as sokko3d-webgpu. */
	kind: string;
	summary: RunSummary;
}

/** Milliseconds for a report: two decimals, or n/a. */
export const ms = (value: number | null | undefined) => (value == null ? 'n/a' : value.toFixed(2));

/** The run's summaries as a Markdown table. */
export function summaryTable(rows: readonly SummaryRow[]): string {
	const lines = [
		'| Scene | Page | Runs | CPU ms per frame, median (lowest to highest run) | p95 | All threads | GPU ms | Frame interval | Upload per frame | Draw calls |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const { scene, kind, summary: s } of rows) {
		const upload = s.uploadBytes === undefined ? 'n/a' : `${(s.uploadBytes / 1e6).toFixed(2)} MB`;
		lines.push(
			`| ${scene} | ${kind} | ${s.runs} | ${ms(s.cpuMs.median)} (${ms(s.cpuMs.min)} to ${ms(s.cpuMs.max)}) | ${ms(s.cpuP95Ms)} | ${ms(s.allThreadsMs)} | ${ms(s.gpuMs)} | ${ms(s.intervalMs)} | ${upload} | ${s.drawCalls ?? 'n/a'} |`,
		);
	}
	return lines.join('\n');
}

/** One sentence per scene: sokko3d's CPU time as a share of three.js's faster renderer. */
export function comparisonLines(rows: readonly SummaryRow[]): string[] {
	const scenes = [...new Set(rows.map((r) => r.scene))];
	return scenes.flatMap((scene) => {
		const of = (kind: string) => rows.find((r) => r.scene === scene && r.kind === kind)?.summary;
		const sokko3d = of('sokko3d-webgpu');
		const share = shareOfThree(sokko3d, [of('threejs-webgpu'), of('threejs-webgl')]);
		return share
			? [
					`${scene}: sokko3d on WebGPU takes ${(share.share * 100).toFixed(0)}% of the CPU time of three.js's faster renderer (${ms(sokko3d?.cpuMs.median)} ms against ${ms(share.threeMs)} ms).`,
				]
			: [];
	});
}

export interface ChartSeries {
	name: string;
	color: string;
	points: readonly { x: number; y: number }[];
}

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

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
	const width = 760;
	const height = 440;
	const left = 70;
	const right = 190;
	const top = 50;
	const bottom = 60;
	const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
	const yMax = Math.max(...series.flatMap((s) => s.points.map((p) => p.y)), 0) * 1.1 || 1;
	const [xMin, xMax] = [Math.log10(xs[0] ?? 1), Math.log10(xs[xs.length - 1] ?? 10)];
	const px = (x: number) =>
		left + ((Math.log10(x) - xMin) / (xMax - xMin || 1)) * (width - left - right);
	const py = (y: number) => top + (1 - y / yMax) * (height - top - bottom);
	const yTicks = Array.from({ length: 6 }, (_, i) => (yMax / 1.1) * (i / 5));
	const lines = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="system-ui, sans-serif" font-size="12">`,
		`<rect width="${width}" height="${height}" fill="#ffffff"/>`,
		`<text x="${left}" y="28" font-size="16" font-weight="600">${escapeXml(title)}</text>`,
		`<text x="${(left + width - right) / 2}" y="${height - 16}" text-anchor="middle">${escapeXml(xLabel)}</text>`,
		`<text transform="translate(18 ${(top + height - bottom) / 2}) rotate(-90)" text-anchor="middle">${escapeXml(yLabel)}</text>`,
		...yTicks.map(
			(y) =>
				`<line x1="${left}" x2="${width - right}" y1="${py(y)}" y2="${py(y)}" stroke="#e4e4e4"/><text x="${left - 8}" y="${py(y) + 4}" text-anchor="end">${y.toFixed(y < 1 ? 2 : 1)}</text>`,
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
		lines.push(
			`<polyline points="${path}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`,
			...s.points.map(
				(p) =>
					`<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5" fill="${s.color}"/>`,
			),
			`<rect x="${width - right + 16}" y="${top + i * 24 - 9}" width="14" height="4" fill="${s.color}"/>`,
			`<text x="${width - right + 36}" y="${top + i * 24 - 3}">${escapeXml(s.name)}</text>`,
		);
	});
	lines.push('</svg>');
	return `${lines.join('\n')}\n`;
}
