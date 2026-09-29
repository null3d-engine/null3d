import { describe, expect, test } from 'bun:test';
import {
	type BenchResult,
	comparisonLines,
	lineChartSvg,
	median,
	niceStep,
	ownShareOfThree,
	ownWorkMs,
	type RunSummary,
	type SummaryRow,
	shareOfThree,
	summarizeRuns,
	summaryTable,
	sweepReport,
} from './report';

function result(cpu: number, stats = false): BenchResult {
	return {
		ok: true,
		scene: 's1',
		renderer: 'null3d',
		n: 1000,
		frames: 100,
		cpuMs: { median: cpu, p95: cpu * 1.2, p99: cpu * 1.5, mean: cpu },
		intervalMs: { median: 16.7 },
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
		expect(table[2]).toContain('| 0.16 |');
		expect(table[5]).toContain('| scene-code | 1 | 2.40 (2.40 to 2.40) | 2.88 | n/a |');
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
