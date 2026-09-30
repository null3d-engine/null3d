import { describe, expect, it } from 'bun:test';
import { UsageError } from './args.js';
import {
	type BenchOptions,
	type BenchReport,
	type BenchRun,
	benchSummary,
	parseBenchArgs,
	pathReports,
} from './bench.js';
import { type EngineFigures, timedRun } from './protocol.js';

const DEFAULTS: BenchOptions = {
	page: '/',
	runs: 5,
	warmupSeconds: 5,
	measureSeconds: 30,
	size: [1280, 720],
	out: 'bench.json',
	timeoutMs: 60_000,
	help: false,
};

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseBenchArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseBenchArgs', () => {
	it("runs the protocol on the main page with the engine's own GPU path by default", () => {
		expect(parseBenchArgs([])).toEqual(DEFAULTS);
	});

	it('reads every option', () => {
		const args = ['--page', '/harbor.html?view=dock', '--gpu', 'webgpu,webgl2', '--runs', '3'];
		args.push('--seconds', '10', '--warmup', '0', '--size', '640x360', '--out', 'out/b.JSON');
		expect(parseBenchArgs([...args, '--timeout', '5'])).toEqual({
			page: '/harbor.html?view=dock',
			gpu: ['webgpu', 'webgl2'],
			runs: 3,
			warmupSeconds: 0,
			measureSeconds: 10,
			size: [640, 360],
			out: 'out/b.JSON',
			timeoutMs: 5000,
			help: false,
		});
		expect(parseBenchArgs(['-h']).help).toBe(true);
	});

	it('says what is wrong with each bad option', () => {
		expect(mistake(['--out', 'bench.txt'])).toBe('--out must name a .json file, not "bench.txt"');
		for (const gpu of ['vulkan', 'webgpu,webgpu', 'webgpu,', ''])
			expect(mistake(['--gpu', gpu])).toBe(
				`--gpu takes tiers from webgpu, compat, webgl2, joined by commas, such as webgpu,webgl2, not "${gpu}"`,
			);
		for (const runs of ['0', '1.5', 'many', ''])
			expect(mistake(['--runs', runs])).toBe(
				`--runs takes a whole number from 1, such as 5, not "${runs}"`,
			);
		expect(mistake(['--seconds', '0'])).toContain('--seconds takes a number of seconds above 0');
		expect(mistake(['--warmup=-1'])).toContain('--warmup takes a number of seconds from 0');
		expect(mistake(['--page', 'http://localhost/'])).toContain(
			"--page takes a path on the project's server",
		);
		expect(mistake(['--size', '0x10'])).toContain('--size takes a width and a height');
	});
});

/** A run that measured the engine, at `cpu` milliseconds per frame on the busiest thread. */
function measured(tier: string, cpu: number): BenchRun {
	const stats: EngineFigures = {
		cpuMsAllThreads: { median: cpu * 1.5 },
		gpuMs: tier === 'webgpu' ? { median: 0.5 } : null,
		presentedFps: 60,
		completedFps: 59.5,
		refreshHz: 60,
		uploadBytes: { median: 256 },
		drawCalls: { median: 3 },
		threads: {
			'sketch-worker': { busyMs: { median: cpu }, phases: { update: { median: cpu / 4 } } },
			'render-worker': { busyMs: { median: cpu / 2 }, phases: { replay: { median: cpu / 2 } } },
			'job-0': { busyMs: { median: 0.02 }, phases: {} },
			'job-1': { busyMs: { median: 0.04 }, phases: {} },
		},
	};
	const mode = { build: 'threaded', latency: 'pipelined', renderThread: 'render-worker' };
	return {
		ok: true,
		tier,
		mode: { ...mode, jobWorkers: 2 },
		frames: 1800,
		cpuMs: { median: cpu, p95: cpu * 2, p99: cpu * 3, mean: cpu },
		intervalMs: { median: 16.7, p95: 17, p99: 18 },
		stats,
	};
}

const FAILED: BenchRun = { ok: false, code: null, error: 'the browser tab crashed' };

describe('pathReports', () => {
	it("summarizes each GPU path's runs that measured, and keeps the failed ones", () => {
		const [webgpu, webgl2] = pathReports(
			['webgpu', 'webgl2'],
			[
				[measured('webgpu', 1), measured('webgpu', 3), measured('webgpu', 2)],
				[FAILED, measured('webgl2', 4)],
			],
		);
		expect(webgpu).toMatchObject({ gpu: 'webgpu', tier: 'webgpu' });
		expect(webgpu?.summary?.cpuMs).toEqual({ median: 2, min: 1, max: 3 });
		expect(webgpu?.summary?.threadsMs).toEqual({
			'sketch-worker': 2,
			'render-worker': 1,
			'job-0': 0.02,
			'job-1': 0.04,
		});
		expect(webgl2).toMatchObject({ gpu: 'webgl2', tier: 'webgl2', runs: [FAILED, {}] });
		expect(webgl2?.summary?.runs).toBe(1);
	});

	it('names the path that the engine picked, and gives no summary when every run failed', () => {
		expect(pathReports([undefined], [[measured('webgpu-compat', 1)]])[0]).toMatchObject({
			gpu: null,
			tier: 'webgpu-compat',
		});
		expect(pathReports(['webgl2'], [[FAILED]])[0]).toMatchObject({ tier: null, summary: null });
	});
});

describe('benchSummary', () => {
	const report = (paths: BenchReport['paths'], extra: Partial<BenchReport> = {}): BenchReport => ({
		ok: true,
		page: '/',
		warmupSeconds: 5,
		measureSeconds: 30,
		paths,
		errors: [],
		warnings: [],
		...extra,
	});

	it('gives CPU time per frame by thread with the spread of the runs, GPU time and frame rates', () => {
		const paths = pathReports(['webgpu'], [[measured('webgpu', 1), measured('webgpu', 3)]]);
		expect(benchSummary(report(paths), 'bench.json')).toBe(
			[
				'/ on webgpu: 2 runs of 30 s, each after 5 s of warm-up.',
				'CPU time per frame, the median of the runs:',
				'  the busiest thread in each frame: 2.00 ms (runs from 1.00 to 3.00 ms)',
				"  sketch-worker: 2.00 ms, of which the sketch's update 0.50 ms",
				'  render-worker: 1.00 ms',
				'  2 job workers: 0.06 ms together, at most 0.04 ms on one',
				'  all threads: 3.00 ms',
				'GPU time per frame: 0.50 ms.',
				'Frames per second: 60.0 presented, 59.5 finished by the GPU, on a display of 60.0 Hz.',
				'',
				"Saved every run's figures and what the page logged in bench.json.",
				'The page logged no errors or warnings.',
			].join('\n'),
		);
	});

	it('says how many runs measured, why the others failed, and what the page logged', () => {
		const paths = pathReports(['webgl2', 'compat'], [[FAILED, measured('webgl2', 1)], [FAILED]]);
		const text = benchSummary(report(paths, { ok: false, errors: ['page error: boom'] }), 'b.json');
		expect(text).toStartWith('/ on webgl2: 1 of 2 runs of 30 s, each after 5 s of warm-up.\n');
		expect(text).toContain('GPU time per frame: n/a, the browser does not time the GPU here.');
		expect(text).toContain(
			'\n\n/ on compat: 0 of 1 run of 30 s, each after 5 s of warm-up.\nRun 1 failed: the browser tab crashed\n',
		);
		expect(text).toEndWith('1 error:\n  page error: boom');
	});

	it('says what stopped the command before its runs', () => {
		const failed = report([], { ok: false, error: 'the production build of the project failed' });
		expect(benchSummary(failed, 'bench.json')).toStartWith(
			'Measured nothing on /: the production build of the project failed\n',
		);
	});
});

describe('timedRun', () => {
	it("measures the engine after the warm-up, and gives the run's frame times with its figures", async () => {
		const run = measured('webgpu', 2);
		if (!run.ok || !run.stats) throw new Error('the run has no figures');
		const figures = { ...run.stats, frames: 90, cpuMs: run.cpuMs, intervalMs: run.intervalMs };
		const asked: number[] = [];
		const engine = {
			measure: async (seconds: number) => {
				asked.push(seconds);
				return figures;
			},
		};
		const timed = await timedRun({ engine, warmupSeconds: 0, measureSeconds: 3 });
		expect(asked).toEqual([3]);
		expect(timed).toEqual({
			frames: 90,
			cpuMs: run.cpuMs,
			intervalMs: run.intervalMs,
			stats: figures,
		});
	});
});
