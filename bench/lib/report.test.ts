import { describe, expect, test } from 'bun:test';
import { type BenchResult, lineChartSvg, median, shareOfThree, summarizeRuns } from './report';

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
		expect(summarizeRuns([result(5)]).allThreadsMs).toBeUndefined();
	});

	test("compare sokko3d with three.js's faster renderer", () => {
		const sokko3d = summarizeRuns([result(1)]);
		const share = shareOfThree(sokko3d, [summarizeRuns([result(4)]), summarizeRuns([result(2)])]);
		expect(share).toEqual({ share: 0.5, threeMs: 2 });
		expect(shareOfThree(undefined, [sokko3d])).toBeNull();
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
		expect(svg).toContain('10,000');
	});
});
