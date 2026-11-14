import { describe, expect, test } from 'bun:test';
import {
	otherWork,
	otherWorkProblem,
	parseCpuTime,
	parseProcessList,
	processTree,
} from './other-work';

const LIST = `  408     1  16.1 377:32.99 /System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer
  900     1   0.0   0:00.10 /usr/bin/bun
  901   900  50.0   0:10.00 /path/Google Chrome for Testing
  902   901 120.0   1:00.00 /path/Google Chrome for Testing Helper (GPU)
  950     1   1.0   0:05.00 /usr/bin/indexer
 4000     1 2.5 1-00:00:01.50 /usr/sbin/long running`;

describe('other work', () => {
	test('reads the CPU time that ps prints', () => {
		expect(parseCpuTime('0:01.50')).toBe(1.5);
		expect(parseCpuTime('377:32.99')).toBeCloseTo(22_652.99, 2);
		expect(parseCpuTime('1:02:03.00')).toBe(3723);
		expect(parseCpuTime('1-00:00:01.50')).toBe(86_401.5);
	});

	test('reads a list of processes, names with spaces included', () => {
		const processes = parseProcessList(LIST);
		expect(processes).toHaveLength(6);
		expect(processes[3]?.name).toBe('/path/Google Chrome for Testing Helper (GPU)');
		expect(processes[3]?.ppid).toBe(901);
		expect(processes[5]?.cpuSeconds).toBe(86_401.5);
	});

	test('finds every process under the runner', () => {
		expect([...processTree(parseProcessList(LIST), 900)].sort()).toEqual([900, 901, 902]);
	});

	test('measures the cores that other processes used during a page', () => {
		const start = { atMs: 0, processes: parseProcessList(LIST) };
		const end = {
			atMs: 10_000,
			processes: start.processes.map((p) =>
				p.pid === 950
					? { ...p, cpuSeconds: p.cpuSeconds + 15, cpuPercent: 150 }
					: { ...p, cpuSeconds: p.cpuSeconds + 2 },
			),
		};
		const work = otherWork(start, end, 900);
		expect(work.during[0]).toEqual({ pid: 950, name: 'indexer', cores: 1.5 });
		expect(work.during.map((use) => use.pid)).not.toContain(902);
		expect(work.start[0]?.name).toBe('WindowServer');
		expect(work.end[0]?.name).toBe('indexer');
		expect(otherWorkProblem(work)).toContain('indexer (950) 1.50 cores');
	});

	test('passes a page where no other process used a whole core', () => {
		const list = { atMs: 0, processes: parseProcessList(LIST) };
		expect(otherWorkProblem(otherWork(list, { ...list, atMs: 5000 }, 900))).toBeUndefined();
		expect(otherWorkProblem(undefined)).toBeUndefined();
	});
});
