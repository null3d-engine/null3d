import { describe, expect, test } from 'bun:test';
import {
	type BenchResult,
	benchReport,
	busiestThread,
	comparisonLines,
	jobsTable,
	lineChartSvg,
	loadTable,
	median,
	niceStep,
	ownShareOfThree,
	ownWorkMs,
	type RunSummary,
	type SummaryRow,
	shareOfThree,
	summarizeRuns,
	summaryRow,
	summaryTable,
	sweepReport,
	threadOwnWorkMs,
	traceTable,
	uploadPerVisibleEntry,
} from './report';

function result(cpu: number, stats = false): BenchResult {
	return {
		ok: true,
		scene: 's1',
		renderer: 'null3d',
		n: 1000,
		frames: 100,
		cpuMs: { median: cpu, p95: cpu * 1.2, p99: cpu * 1.5, mean: cpu },
		intervalMs: { median: 16.7, p95: 20, p99: 33.4 },
		stats: stats
			? {
					cpuMsAllThreads: { median: cpu * 2 },
					gpuMs: { median: 1 },
					uploadBytes: { median: 4800 },
					drawCalls: { median: 1 },
					presentedFps: 60,
					completedFps: 58,
					gpuLatencyMs: { median: cpu },
					refreshHz: 120,
					threads: {
						'sketch-worker': { busyMs: { median: cpu }, phases: { update: { median: cpu / 2 } } },
					},
				}
			: undefined,
	};
}

describe('benchmark reports', () => {
	test('take the median of runs, with the lowest and highest', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 2, 3])).toBe(2.5);
		const summary = summarizeRuns([result(2, true), result(4, true), result(3, true)]);
		expect(summary.cpuMs).toEqual({ median: 3, min: 2, max: 4 });
		expect(summary.allThreadsMs).toBe(6);
		expect(summary.phases).toEqual({ 'sketch-worker.update': 1.5 });
		expect(summary.threadsMs).toEqual({ 'sketch-worker': 3 });
		expect(summary).toMatchObject({
			presentedFps: 60,
			completedFps: 58,
			gpuLatencyMs: 3,
			refreshHz: 120,
		});
		expect(summarizeRuns([result(5)]).allThreadsMs).toBeUndefined();
	});

	test('report the frames a page drew per second, and the pacing of its frame intervals', () => {
		// Late frames keep the display's beat in their timestamps: the median interval says 60 fps.
		const intervals = [
			{ median: 16.7, p95: 18, p99: 40 },
			{ median: 16.7, p95: 25, p99: 33.4 },
			{ median: 16.7, p95: 20, p99: 30 },
		];
		const drawn = [43.7, 40.6, 38.9].map((fps, run) => ({
			...result(25),
			presentedFps: fps,
			intervalMs: intervals[run] as BenchResult['intervalMs'],
		}));
		const summary = summarizeRuns(drawn);
		expect(summary.presentedFps).toBe(40.6);
		expect([summary.intervalP95Ms, summary.intervalP99Ms]).toEqual([20, 33.4]);
		const table = summaryTable([{ scene: 's1', kind: 'threejs-webgl', summary }]).split('\n');
		expect(table[0]).toContain('| Presented / finished fps | Frame interval p95 / p99 ms |');
		expect(table[0]).not.toContain('median interval');
		expect(table[2]).toContain('| 40.6 / n/a | 20.00 / 33.40 |');
	});

	test('name the busiest thread in each latency mode, and the main thread for three.js', () => {
		const withThreads = (threadsMs: Record<string, number>): RunSummary => ({
			...summarizeRuns([result(Math.max(...Object.values(threadsMs)))]),
			threadsMs,
		});
		// Pipelined, a heavy draw: the render worker limits the frame.
		const pipelined = withThreads({ 'sketch-worker': 1.2, 'render-worker': 2.1, 'job-0': 0.3 });
		expect(busiestThread(pipelined)).toEqual({ thread: 'render-worker', ms: 2.1 });
		// Low latency: the sketch worker draws too, and no render worker exists.
		const low = withThreads({ 'sketch-worker': 3.1, 'job-0': 0.3 });
		expect(busiestThread(low)).toEqual({ thread: 'sketch-worker', ms: 3.1 });
		expect(busiestThread(summarizeRuns([result(4.2)]))).toEqual({ thread: 'main', ms: 4.2 });
		const table = summaryTable([
			{ scene: 's1', kind: 'null3d-webgpu', summary: pipelined },
			{ scene: 's1', kind: 'null3d-webgpu-low', summary: low },
		]).split('\n');
		expect(table[0]).toContain('| p95 | Busiest thread, ms | Own work, busiest thread |');
		expect(table[2]).toContain('| render-worker 2.10 |');
		expect(table[3]).toContain('| null3d-webgpu-low |');
		expect(table[3]).toContain('| sketch-worker 3.10 |');
	});

	test('give the upload per visible entry where the job workers cull, and n/a where the GPU culls', () => {
		/** A null3d run that uploads `uploadBytes` per frame and lists `visibleEntries`. */
		const run = (uploadBytes: number, visibleEntries: number | null): BenchResult => {
			const drawn = result(2, true);
			const stats = drawn.stats as NonNullable<BenchResult['stats']>;
			return {
				...drawn,
				stats: {
					...stats,
					uploadBytes: { median: uploadBytes },
					visibleEntries: visibleEntries === null ? null : { median: visibleEntries },
				},
			};
		};
		// A static scene on WebGL2 uploads each entry's 4-byte index, and a little more.
		const webgl2 = summarizeRuns([run(6112, 1500), run(6512, 1600), run(5712, 1400)]);
		expect(webgl2.visibleEntries).toBe(1500);
		expect(uploadPerVisibleEntry(webgl2)).toBeCloseTo(6112 / 1500);
		const webgpu = summarizeRuns([run(0, null)]);
		expect(webgpu.visibleEntries).toBeNull();
		expect(uploadPerVisibleEntry(webgpu)).toBeNull();
		expect(uploadPerVisibleEntry(summarizeRuns([result(2)]))).toBeNull();
		const table = summaryTable([
			{ scene: 's1-static', kind: 'null3d-webgl2', summary: webgl2 },
			{ scene: 's1-static', kind: 'null3d-webgpu', summary: webgpu },
		]).split('\n');
		expect(table[0]).toContain(
			'| Upload per frame | Visible entries | Upload per visible entry | Draw calls |',
		);
		expect(table[2]).toContain('| 0.01 MB | 1,500 | 4.1 bytes | 1 |');
		expect(table[3]).toContain('| 0.00 MB | n/a | n/a | 1 |');
	});

	test("compare null3d with three.js's faster renderer", () => {
		const null3d = summarizeRuns([result(1)]);
		const share = shareOfThree(null3d, [summarizeRuns([result(4)]), summarizeRuns([result(2)])]);
		expect(share).toEqual({ share: 0.5, null3dMs: 1, threeMs: 2 });
		expect(shareOfThree(undefined, [null3d])).toBeNull();
	});

	/**
	 * A null3d run summary with these median times per thread, and the sketch's update phase on the
	 * thread named first; the busiest thread sets the frame time.
	 */
	const null3dRun = (threadsMs: Record<string, number>, updateMs: number): RunSummary => {
		const busiest = Math.max(...Object.values(threadsMs));
		const sketchThread = Object.keys(threadsMs)[0] as string;
		return {
			...summarizeRuns([result(busiest)]),
			threadsMs,
			phases: { [`${sketchThread}.update`]: updateMs },
		};
	};

	test("take the sketch's code away from each engine's busiest thread", () => {
		// three.js: its frame time less the scene code, timed alone.
		expect(ownWorkMs(summarizeRuns([result(3.2)]), 2.4)).toBeCloseTo(0.8);
		expect(ownWorkMs(summarizeRuns([result(1)]), 2)).toBe(0);
		// null3d: each thread less the update phase on it, whatever the scene-code page measured.
		const null3d = null3dRun({ 'sketch-worker': 2.5, 'render-worker': 0.15, 'job-0': 0.05 }, 2.3);
		expect(ownWorkMs(null3d, 2.6)).toBeCloseTo(0.2);
		expect(
			ownWorkMs(null3dRun({ 'sketch-worker': 2.5, 'render-worker': 0.3 }, 2.4), 0),
		).toBeCloseTo(0.3);
		// In single-threaded mode the main thread runs the sketch, the engine and the drawing.
		expect(ownWorkMs(null3dRun({ main: 3 }, 2.4), 2.6)).toBeCloseTo(0.6);
	});

	test("compare null3d's own work with three.js's", () => {
		const null3d = null3dRun({ 'sketch-worker': 2.54, 'render-worker': 0.12 }, 2.38);
		const threejs = [summarizeRuns([result(3.6)]), summarizeRuns([result(3.2)])];
		const sceneCode = summarizeRuns([result(2.4)]);
		const own = ownShareOfThree(null3d, threejs, sceneCode);
		expect(own?.null3dMs).toBeCloseTo(0.16);
		expect(own?.threeMs).toBeCloseTo(0.8);
		expect(own?.share).toBeCloseTo(0.2);
		expect(own?.sceneCodeMs).toBe(2.4);
		expect(ownShareOfThree(null3d, threejs, undefined)).toBeNull();

		const rows: SummaryRow[] = [
			{ scene: 's1', kind: 'null3d-webgpu', summary: null3d },
			{ scene: 's1', kind: 'threejs-webgpu', summary: threejs[0] as RunSummary },
			{ scene: 's1', kind: 'threejs-webgl', summary: threejs[1] as RunSummary },
			{ scene: 's1', kind: 'scene-code', summary: sceneCode },
		];
		// WebGPU compares with three.js's faster renderer, WebGL, and with three.js on WebGPU.
		expect(comparisonLines(rows)).toEqual([
			"s1: null3d on WebGPU takes 79% of the CPU time per frame of three.js's faster renderer, WebGL (2.54 ms against 3.20 ms), and 71% of that of three.js's WebGPU renderer (2.54 ms against 3.60 ms).",
			"s1: null3d's own work on WebGPU, on its busiest thread and apart from the sketch's code, is 20% of that of three.js's faster renderer, WebGL (0.16 ms against 0.80 ms), and 13% of that of three.js's WebGPU renderer (0.16 ms against 1.20 ms); three.js's is its frame less the scene code timed alone (2.40 ms).",
		]);
		// A run with both null3d paths compares each of them; on WebGL2 the same API is the faster
		// renderer. Here the render worker's 0.30 ms is the busiest thread's own work, more than the
		// sketch worker's 0.18 ms after its update.
		const webgl2 = null3dRun({ 'sketch-worker': 2.56, 'render-worker': 0.3 }, 2.38);
		const both = [...rows, { scene: 's1', kind: 'null3d-webgl2', summary: webgl2 }];
		expect(comparisonLines(both).slice(2)).toEqual([
			"s1: null3d on WebGL2 takes 80% of the CPU time per frame of three.js's faster renderer, WebGL (2.56 ms against 3.20 ms).",
			"s1: null3d's own work on WebGL2, on its busiest thread and apart from the sketch's code, is 37% of that of three.js's faster renderer, WebGL (0.30 ms against 0.80 ms); three.js's is its frame less the scene code timed alone (2.40 ms).",
		]);
		const table = summaryTable(rows).split('\n');
		expect(table[0]).toContain('| Own work, busiest thread |');
		expect(table[2]).toContain('| sketch-worker 2.54 | 0.16 |');
		expect(table[5]).toContain('| scene-code | 1 | 2.40 (2.40 to 2.40) | 2.88 | main 2.40 | n/a |');
		expect(benchReport(rows)).toEqual([summaryTable(rows), '', ...comparisonLines(rows)]);
	});

	test('compare the low-latency pages with three.js like the pipelined ones', () => {
		const low = null3dRun({ 'sketch-worker': 2.7, 'job-0': 0.1 }, 2.38);
		const rows: SummaryRow[] = [
			{ scene: 's1', kind: 'null3d-webgl2-low', summary: low },
			{ scene: 's1', kind: 'threejs-webgl', summary: summarizeRuns([result(3.2)]) },
			{ scene: 's1', kind: 'scene-code', summary: summarizeRuns([result(2.4)]) },
		];
		expect(comparisonLines(rows)).toEqual([
			"s1: null3d on WebGL2 with low latency takes 84% of the CPU time per frame of three.js's faster renderer, WebGL (2.70 ms against 3.20 ms).",
			"s1: null3d's own work on WebGL2 with low latency, on its busiest thread and apart from the sketch's code, is 40% of that of three.js's faster renderer, WebGL (0.32 ms against 0.80 ms); three.js's is its frame less the scene code timed alone (2.40 ms).",
		]);
	});

	test('report each job worker count: the whole frame, the busiest thread and the own work', () => {
		// More job workers take the parallel loops off the sketch worker.
		const counts: [number, Record<string, number>][] = [
			[1, { 'sketch-worker': 3.1, 'render-worker': 0.4, 'job-0': 0.9 }],
			[2, { 'sketch-worker': 2.8, 'render-worker': 0.4, 'job-0': 0.6, 'job-1': 0.6 }],
		];
		const rows: SummaryRow[] = counts.map(([jobs, threads]) => ({
			scene: 's1',
			kind: 'null3d-webgl2',
			jobs,
			summary: null3dRun(threads, 2.3),
		}));
		expect(threadOwnWorkMs(rows[0]?.summary as RunSummary, 'sketch-worker')).toBeCloseTo(0.8);
		expect(threadOwnWorkMs(rows[0]?.summary as RunSummary, 'main')).toBeNull();
		const table = jobsTable(rows).split('\n');
		expect(table[0]).toBe(
			"| Scene | Job workers | Page | Runs | CPU ms per frame, median (lowest to highest run) | Busiest thread, ms | Own work, busiest thread | Sketch worker's own work |",
		);
		expect(table.slice(2)).toEqual([
			'| s1 | 1 | null3d-webgl2 | 1 | 3.10 (3.10 to 3.10) | sketch-worker 3.10 | 0.90 | 0.80 |',
			'| s1 | 2 | null3d-webgl2 | 1 | 2.80 (2.80 to 2.80) | sketch-worker 2.80 | 0.60 | 0.50 |',
		]);
		// A run with job worker counts reports them instead of comparing engines.
		expect(benchReport(rows)).toEqual([jobsTable(rows)]);
	});

	test('sweep a scene with tables of both measures and verdicts that name slower counts', () => {
		const point = (
			n: number,
			webgpu: number,
			webgl2: number,
			threeGpu: number,
			threeGl: number,
		) => ({
			n,
			summaries: {
				'null3d-webgpu': null3dRun({ 'render-worker': webgpu }, 0),
				'null3d-webgl2': null3dRun({ 'render-worker': webgl2 }, 0),
				'threejs-webgpu': summarizeRuns([result(threeGpu)]),
				'threejs-webgl': summarizeRuns([result(threeGl)]),
				'scene-code': summarizeRuns([result(0.01)]),
			},
		});
		const lines = sweepReport('s1-static', [
			point(1, 0.1, 0.04, 0.27, 0.05),
			point(100_000, 0.12, 0.08, 0.3, 0.12),
		]);
		expect(lines[0]).toBe('### s1-static: CPU time per frame on the busiest thread, ms');
		expect(lines[4]).toBe('| 1 | 0.10 | 0.04 | 0.27 | 0.05 | 200% | 37% | 80% | 80% |');
		expect(lines[5]).toBe('| 100,000 | 0.12 | 0.08 | 0.30 | 0.12 | 100% | 40% | 67% | 67% |');
		expect(lines.slice(7, 11)).toEqual([
			"s1-static, whole frame: null3d on WebGPU is not faster than three.js's faster renderer at these object counts: 1 (200%), 100,000 (100%).",
			"s1-static, whole frame: null3d on WebGPU is faster than three.js's WebGPU renderer at every count.",
			"s1-static, whole frame: null3d on WebGL2 is faster than three.js's faster renderer at every count.",
			"s1-static, whole frame: null3d on WebGL2 is faster than three.js's WebGL renderer at every count.",
		]);
		expect(lines).toContain(
			'### s1-static: own work on the busiest thread, apart from the scene code, ms',
		);
		// Only the null3d paths that ran get columns and verdicts: here WebGPU in low-latency mode.
		const low = sweepReport('s1', [
			{
				n: 1,
				summaries: {
					'null3d-webgpu-low': null3dRun({ 'sketch-worker': 0.2 }, 0),
					'threejs-webgpu': summarizeRuns([result(0.27)]),
					'threejs-webgl': summarizeRuns([result(0.05)]),
				},
			},
		]);
		expect(low[2]).toBe(
			"| Objects | null3d-webgpu-low | threejs-webgpu | threejs-webgl | WebGPU with low latency against three.js's faster | WebGPU with low latency against three.js WebGPU |",
		);
		expect(low[4]).toBe('| 1 | 0.20 | 0.27 | 0.05 | 400% | 74% |');
		expect(low.slice(6, 8)).toEqual([
			"s1, whole frame: null3d on WebGPU with low latency is not faster than three.js's faster renderer at these object counts: 1 (400%).",
			"s1, whole frame: null3d on WebGPU with low latency is faster than three.js's WebGPU renderer at every count.",
		]);
		expect(low.join('\n')).not.toContain('WebGL2');
	});

	test('draw a chart with one line per series and escaped labels', () => {
		const svg = lineChartSvg('A & B', 'x', 'y', [
			{
				name: 'one',
				color: '#000',
				points: [
					{ x: 1000, y: 1 },
					{ x: 10000, y: 2 },
				],
			},
		]);
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('A &amp; B');
		expect(svg.match(/<polyline/g)?.length).toBe(1);
		expect(svg).not.toContain('stroke-dasharray');
		const dashed = lineChartSvg('t', 'x', 'y', [
			{ name: 'own', color: '#000', dashed: true, points: [{ x: 1, y: 1 }] },
		]);
		// The line and its legend sample are both dashed.
		expect(dashed.match(/stroke-dasharray/g)?.length).toBe(2);
		expect(svg).toContain('10,000');
	});

	test('chart gridlines fall on round values above the highest point', () => {
		expect(niceStep(3.62)).toBe(1);
		expect(niceStep(1.16)).toBe(0.25);
		expect(niceStep(0.3)).toBe(0.1);
		expect(niceStep(48)).toBe(10);
		expect(niceStep(0)).toBe(1);
		const svg = lineChartSvg('t', 'x', 'y', [
			{ name: 'a long series name', color: '#000', points: [{ x: 1, y: 3.62 }] },
		]);
		for (const label of ['>0<', '>1<', '>2<', '>3<', '>4<']) expect(svg).toContain(label);
		expect(svg).not.toContain('>5<');
	});
});

describe('traces', () => {
	const second = (completedFps: number, renderScale = 1, steps = 0) => ({
		presentedFps: 60,
		completedFps,
		renderScale,
		steps,
	});

	test("sum up every run's seconds against the display's rate, and add a table to the report", () => {
		const runs = [
			{ ...result(2, true), trace: [second(60), second(50, 0.9, 1)] },
			{ ...result(3, true), trace: [second(59, 0.95, 1), second(60)] },
		];
		const row = summaryRow({ scene: 's4', kind: 'null3d-webgpu' }, runs);
		expect(row.summary).toEqual(summarizeRuns(runs));
		expect(row.trace).toEqual({
			seconds: 4,
			targetFps: 60,
			heldSeconds: 3,
			lowestFps: 50,
			lowestRenderScale: 0.9,
			steps: 2,
		});
		expect(traceTable([row]).split('\n')[2]).toBe(
			'| s4 | null3d-webgpu | 4 | 60 | 3 (75%) | 50 | 0.9 | 2 |',
		);
		expect(benchReport([row]).slice(-2)).toEqual(['', traceTable([row])]);
		expect(
			summaryRow({ scene: 's1', kind: 'null3d-webgpu' }, [result(2, true)]).trace,
		).toBeUndefined();
	});

	test("takes the median of each load figure over a streamed scene's runs, and adds a table", () => {
		const loaded = (firstFrameMs: number, wholeMs: number, bytes: number): BenchResult => ({
			...result(2, true),
			scene: 's6',
			load: {
				firstFrameMs,
				wholeMs,
				sketch: { kit: firstFrameMs / 1000, towers: wholeMs / 1000, whole: 1, objects: 9, bytes },
			},
		});
		const runs = [loaded(1100, 1500, 42e6), loaded(1300, 1900, 42e6), loaded(1200, 1600, 43e6)];
		const row = summaryRow({ scene: 's6', kind: 'null3d-webgpu' }, runs);
		expect(row.load).toEqual({
			runs: 3,
			firstFrameMs: 1200,
			wholeMs: 1600,
			kitSeconds: 1.2,
			towersSeconds: 1.6,
			bytes: 42e6,
		});
		expect(loadTable([row]).split('\n')[2]).toBe(
			'| s6 | null3d-webgpu | 3 | 1200 | 1600 | 1.20 | 1.60 | 42.0 |',
		);
		expect(benchReport([row]).slice(-2)).toEqual(['', loadTable([row])]);
		expect(
			summaryRow({ scene: 's1', kind: 'null3d-webgpu' }, [result(2, true)]).load,
		).toBeUndefined();
	});
});
