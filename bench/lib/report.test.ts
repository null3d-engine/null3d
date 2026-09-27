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
} from './report';

function result(cpu: number, stats = false): BenchResult {
	return {
		ok: true,
		scene: 's1',
		renderer: 'sokko3d',
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
					threads: {
						'game-worker': { busyMs: { median: cpu }, phases: { update: { median: cpu / 2 } } },
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
		expect(summary.phases).toEqual({ 'game-worker.update': 1.5 });
		expect(summary.threadsMs).toEqual({ 'game-worker': 3 });
		expect(summarizeRuns([result(5)]).allThreadsMs).toBeUndefined();
	});

	test("compare sokko3d with three.js's faster renderer", () => {
		const sokko3d = summarizeRuns([result(1)]);
		const share = shareOfThree(sokko3d, [summarizeRuns([result(4)]), summarizeRuns([result(2)])]);
		expect(share).toEqual({ share: 0.5, sokko3dMs: 1, threeMs: 2 });
		expect(shareOfThree(undefined, [sokko3d])).toBeNull();
	});

	/**
	 * A sokko3d run summary with these median times per thread, and the game's update phase on the
	 * thread named first; the busiest thread sets the frame time.
	 */
	const sokko3dRun = (threadsMs: Record<string, number>, updateMs: number): RunSummary => {
		const busiest = Math.max(...Object.values(threadsMs));
		const gameThread = Object.keys(threadsMs)[0] as string;
		return {
			...summarizeRuns([result(busiest)]),
			threadsMs,
			phases: { [`${gameThread}.update`]: updateMs },
		};
	};

	test("take the game's code away from each engine's busiest thread", () => {
		// three.js: its frame time less the scene code, timed alone.
		expect(ownWorkMs(summarizeRuns([result(3.2)]), 2.4)).toBeCloseTo(0.8);
		expect(ownWorkMs(summarizeRuns([result(1)]), 2)).toBe(0);
		// sokko3d: each thread less the update phase on it, whatever the scene-code page measured.
		const sokko3d = sokko3dRun({ 'game-worker': 2.5, 'render-worker': 0.15, 'job-0': 0.05 }, 2.3);
		expect(ownWorkMs(sokko3d, 2.6)).toBeCloseTo(0.2);
		expect(ownWorkMs(sokko3dRun({ 'game-worker': 2.5, 'render-worker': 0.3 }, 2.4), 0)).toBeCloseTo(
			0.3,
		);
		// In single-threaded mode the main thread runs the game, the engine and the drawing.
		expect(ownWorkMs(sokko3dRun({ main: 3 }, 2.4), 2.6)).toBeCloseTo(0.6);
	});

	test("compare sokko3d's own work with three.js's", () => {
		const sokko3d = sokko3dRun({ 'game-worker': 2.54, 'render-worker': 0.12 }, 2.38);
		const threejs = [summarizeRuns([result(3.6)]), summarizeRuns([result(3.2)])];
		const sceneCode = summarizeRuns([result(2.4)]);
		const own = ownShareOfThree(sokko3d, threejs, sceneCode);
		expect(own?.sokko3dMs).toBeCloseTo(0.16);
		expect(own?.threeMs).toBeCloseTo(0.8);
		expect(own?.share).toBeCloseTo(0.2);
		expect(own?.sceneCodeMs).toBe(2.4);
		expect(ownShareOfThree(sokko3d, threejs, undefined)).toBeNull();

		const rows: SummaryRow[] = [
			{ scene: 's1', kind: 'sokko3d-webgpu', summary: sokko3d },
			{ scene: 's1', kind: 'threejs-webgpu', summary: threejs[0] as RunSummary },
			{ scene: 's1', kind: 'threejs-webgl', summary: threejs[1] as RunSummary },
			{ scene: 's1', kind: 'scene-code', summary: sceneCode },
		];
		expect(comparisonLines(rows)).toEqual([
			"s1: sokko3d on WebGPU takes 79% of the CPU time per frame of three.js's faster renderer (2.54 ms against 3.20 ms).",
			"s1: sokko3d's own work on its busiest thread, apart from the game's code, is 20% of three.js's (0.16 ms against 0.80 ms); three.js's is its frame less the scene code timed alone (2.40 ms).",
		]);
		const table = summaryTable(rows).split('\n');
		expect(table[0]).toContain('| Own work, busiest thread |');
		expect(table[2]).toContain('| 0.16 |');
		expect(table[5]).toContain('| scene-code | 1 | 2.40 (2.40 to 2.40) | 2.88 | n/a |');
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
