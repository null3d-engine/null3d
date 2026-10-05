import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	archivedKind,
	archiveFolder,
	commitAt,
	compact,
	NoResultsError,
	PLAYWRIGHT,
	parseResultName,
	parseRunName,
	resultRows,
	resultTable,
	round,
	slimResult,
} from './archive';

const host = { name: 'Apple M5 Max, 18 cores, 128 GB' };

/** A measure's figures as `engine.measure` gives them, all near one median. */
const figures = (median: number) => ({
	count: 100,
	median,
	p95: median * 1.1,
	p99: median * 1.2,
	mean: median,
});

/** A null3D page's result: the sketch worker busy `busy` ms per frame, `update` of it the scene. */
function null3dResult(busy: number, update: number) {
	return {
		ok: true,
		userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36',
		scene: 's1',
		renderer: 'null3d',
		n: 300000,
		frames: 100,
		mode: { jobWorkers: 8, preset: 'low' },
		cpuMs: figures(busy),
		intervalMs: figures(33.3),
		frame: 'a captured frame, which records leave out',
		stats: {
			cpuMsAllThreads: figures(busy + 1),
			gpuMs: figures(2),
			presentedFps: 30,
			completedFps: 30,
			gpuLatencyMs: figures(5),
			refreshHz: 60,
			uploadBytes: figures(1000),
			drawCalls: figures(2),
			visibleEntries: null,
			threads: {
				'sketch-worker': { busyMs: figures(busy), phases: { update: figures(update) } },
				'render-worker': { busyMs: figures(0.2), phases: { replay: figures(0.2) } },
			},
		},
	};
}

/** A page that times its own frames, as three.js's pages and the scene-code page do. */
function ownTimedResult(cpu: number) {
	return {
		ok: true,
		userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36',
		scene: 's1',
		renderer: 'webgl',
		n: 300000,
		frames: 100,
		cpuMs: figures(cpu),
		intervalMs: figures(25),
		presentedFps: 40,
	};
}

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'null3d-archive-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeJson = (path: string, value: unknown) => {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
};

/** A checkout under the test's folder whose HEAD reflog checked out one commit, then another. */
function checkout(): string {
	const dir = join(root, 'checkout');
	const line = (from: string, to: string, at: number) =>
		`${from} ${to} Someone <someone@example.com> ${at} +0800\tcheckout: moving`;
	mkdirSync(join(dir, '.git/logs'), { recursive: true });
	writeFileSync(
		join(dir, '.git/logs/HEAD'),
		[
			line('0'.repeat(40), 'a'.repeat(40), Date.UTC(2026, 9, 4, 10) / 1000),
			line('a'.repeat(40), 'b'.repeat(40), Date.UTC(2026, 9, 4, 13) / 1000),
			'',
		].join('\n'),
	);
	return dir;
}

/** A device runner's bench run of S1 at phone scale on one runner. */
function deviceBenchRun(): string {
	const folder = join(checkout(), 'target/runs/20261004-125547-bench');
	const pages = [
		['null3d-webgpu', 'webgpu', null3dResult(16, 14)],
		['threejs-webgpu', 'compat', ownTimedResult(31)],
		['threejs-webgl', 'webgl2', ownTimedResult(32)],
		['scene-code', 'webgl2', ownTimedResult(14)],
	] as const;
	writeJson(join(folder, 'plan.json'), {
		run: '20261004-125547-bench',
		createdAt: '2026-10-04T12:55:47.040Z',
		items: pages.flatMap(([page, tier]) =>
			[1, 2].map((run) => ({
				id: `bench-s1-${page}-${run}`,
				path: `/__null3d/load/warm/{run}.{runner}.bench/bench/pages/${page}/s1.html?n=300000`,
				timeoutSeconds: 95,
				check: { kind: 'bench', tier, scene: 's1', page },
			})),
		),
	});
	writeJson(join(folder, 'summary.json'), {
		'ipad-safari': { pass: 8, skip: 0, fail: 0, browser: 'Safari 26.6.2' },
	});
	writeJson(join(folder, 'ipad-safari/device.json'), {
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/26.6.2 Safari/605.1.15',
		browser: { name: 'Safari', version: '26.6.2' },
		maxTouchPoints: 5,
		screen: { width: 834, height: 1194 },
		devicePixelRatio: 2,
		hardwareConcurrency: 8,
		refreshRateHz: 60,
	});
	for (const [page, , result] of pages)
		for (const run of [1, 2])
			writeJson(join(folder, `ipad-safari/bench-s1-${page}-${run}.json`), result);
	return folder;
}

describe('round and compact', () => {
	it('keeps whole numbers and four significant digits of a fraction', () => {
		expect(round(12288436)).toBe(12288436);
		expect(round(16.459999084472656)).toBe(16.46);
		expect(round(0.0001234567)).toBe(0.0001235);
	});

	it('rounds every number and leaves out undefined fields, keeping nulls', () => {
		const value: Record<string, unknown> = { a: 1.23456, b: undefined, c: null, d: [0.333333] };
		expect(compact(value)).toEqual({
			a: 1.235,
			c: null,
			d: [0.3333],
		});
	});
});

describe('run names', () => {
	it('reads the start in UTC, the date and the kind', () => {
		expect(parseRunName('20261004-125547-bench')).toEqual({
			startMs: Date.UTC(2026, 9, 4, 12, 55, 47),
			date: '2026-10-04',
			kind: 'bench',
		});
		expect(parseRunName('results')).toBeUndefined();
	});

	it('keeps benchmark kinds and leaves out checks and the scale search steps', () => {
		expect(archivedKind('20261003-172734-gate')).toBe('gate');
		expect(archivedKind('20261003-002947-checks')).toBeUndefined();
		expect(archivedKind('20261003-135854-scale-sm-s926b-chrome-1')).toBeUndefined();
	});
});

describe('commitAt', () => {
	const reflog = [
		`${'0'.repeat(40)} ${'a'.repeat(40)} A <a@example.com> 1000 +0000\tclone`,
		`${'a'.repeat(40)} ${'b'.repeat(40)} A <a@example.com> 2000 +0800\tcheckout: moving`,
	].join('\n');

	it('takes the newest entry at or before the time', () => {
		expect(commitAt(reflog, 1_500_000)).toBe('a'.repeat(40));
		expect(commitAt(reflog, 2_000_000)).toBe('b'.repeat(40));
	});

	it('gives null before the reflog starts', () => {
		expect(commitAt(reflog, 999_000)).toBeNull();
	});
});

describe('parseResultName', () => {
	it('reads scenes with dashes, page variants, job counts and runs', () => {
		expect(parseResultName('s1-static-null3d-webgl2-low-3.json')).toEqual({
			scene: 's1-static',
			page: 'null3d-webgl2-low',
			run: 3,
		});
		expect(parseResultName('s1-cells-scene-code-5.json')).toEqual({
			scene: 's1-cells',
			page: 'scene-code',
			run: 5,
		});
		expect(parseResultName('s1-null3d-webgpu-jobs4-2.json')).toEqual({
			scene: 's1',
			page: 'null3d-webgpu',
			jobs: 4,
			run: 2,
		});
	});

	it("gives pages from before the engine's rename its present name", () => {
		expect(parseResultName('s1-sokko3d-webgpu-1.json')?.page).toBe('null3d-webgpu');
	});

	it('reads no summary file', () => {
		expect(parseResultName('summary.json')).toBeUndefined();
	});
});

describe('slimResult', () => {
	it('leaves out pictures, browser facts and long lists, and cuts each measure', () => {
		expect(
			slimResult({
				ok: true,
				userAgent: 'Safari',
				images: { shadows: 'iVBOR' },
				perSecond: Array.from({ length: 600 }, () => 60),
				minutes: [1, 2, 3],
				cpuMs: { count: 10, median: 1, p95: 2, p99: 3, mean: 1 },
				downloads: { requests: 3, bytes: 100, files: [{ path: 'a.js' }] },
			}),
		).toEqual({
			ok: true,
			minutes: [1, 2, 3],
			cpuMs: { median: 1, p95: 2, p99: 3 },
			downloads: { requests: 3, bytes: 100 },
		});
	});
});

describe('archiveFolder', () => {
	it("keeps a device runner's pages, runs, device and the commit that the checkout had out", () => {
		const record = archiveFolder(deviceBenchRun(), host);
		expect(record).toMatchObject({
			format: 1,
			run: '20261004-125547-bench',
			kind: 'bench',
			tool: 'device runner',
			commit: 'a'.repeat(40),
			commitFrom: 'reflog',
		});
		expect(record.plan).toContain('/bench/pages/null3d-webgpu/s1.html?n=300000');
		const runner = record.runners?.['ipad-safari'];
		expect(runner?.device).toMatchObject({
			name: 'iPad, 834 x 1194 at 2x, 8 cores',
			browser: 'Safari 26.6.2',
			refreshHz: 60,
		});
		expect(runner?.counts).toEqual({ pass: 8, skip: 0, fail: 0 });
		const page = runner?.pages?.find((p) => p.page === 'null3d-webgpu');
		expect(page).toMatchObject({ n: 300000, presets: ['low'], runs: 2, ownWorkMs: 2 });
		expect(page?.againstThree).toEqual({
			wholeFrame: { page: 'threejs-webgpu', threeMs: 31, share: 0.5161 },
			ownWork: { page: 'threejs-webgpu', threeMs: 17, share: 0.1176 },
		});
		expect(runner?.runs).toHaveLength(8);
		expect(runner?.runs?.[0]).toMatchObject({
			id: 'bench-s1-null3d-webgpu-1',
			ok: true,
			cpuMs: { median: 16, p95: 17.6, p99: 19.2 },
			ownWorkMs: 2,
			busiest: 'sketch-worker',
		});
		expect(JSON.stringify(record)).not.toContain('captured frame');
	});

	it("gives the results page a row for each null3D page that ran beside three.js's", () => {
		const rows = resultRows(archiveFolder(deviceBenchRun(), host));
		expect(rows).toEqual([
			{
				table: 'S1 at phone scale',
				date: '2026-10-04',
				cells: [
					'2026-10-04',
					'ipad-safari, Safari 26.6.2',
					'WebGPU',
					'300,000',
					'16.00 / 31.00 (WebGPU)',
					'52%',
					'2.00 / 17.00 (WebGPU)',
					'12%',
					'30.0 / 40.0',
					'2.00',
					'aaaaaaaa',
					'20261004-125547-bench',
				],
			},
		]);
	});

	it("marks three.js's side failed when none of its pages drew the scene", () => {
		const folder = deviceBenchRun();
		const failed = { ok: false, error: 'FRAGMENT shader uniforms count exceeds' };
		for (const page of ['threejs-webgpu', 'threejs-webgl'])
			for (const run of [1, 2])
				writeJson(join(folder, `ipad-safari/bench-s1-${page}-${run}.json`), failed);
		const cells = resultRows(archiveFolder(folder, host))[0]?.cells;
		expect(cells?.slice(4, 9)).toEqual([
			'16.00 / failed',
			'n/a',
			'2.00 / failed',
			'n/a',
			'30.0 / failed',
		]);
	});

	it("keeps a benchmark command's run as this machine's runner", () => {
		const folder = join(root, 'target/bench/20261003-173411-bench');
		writeJson(join(folder, 's1-null3d-webgl2-1.json'), null3dResult(2, 1.8));
		writeJson(join(folder, 's1-threejs-webgl-1.json'), ownTimedResult(3));
		writeJson(join(folder, 's1-scene-code-1.json'), ownTimedResult(2));
		writeJson(join(folder, 's1-threejs-webgpu-1.json'), { ok: false, error: 'no adapter' });
		writeJson(join(folder, 'summary.json'), []);
		const record = archiveFolder(folder, host);
		expect(record).toMatchObject({ tool: 'bench:run', commit: null, commitFrom: null });
		const runner = record.runners?.[PLAYWRIGHT];
		expect(runner?.device).toMatchObject({ name: host.name, browser: 'Chrome 154' });
		expect(runner?.runs?.find((run) => run.page === 'threejs-webgpu')).toEqual({
			id: 's1-threejs-webgpu-1',
			scene: 's1',
			page: 'threejs-webgpu',
			ok: false,
			error: 'no adapter',
		});
		const row = resultRows(record)[0];
		expect(row?.cells.slice(1, 8)).toEqual([
			'Apple M5 Max, Chrome 154',
			'WebGL2',
			'300,000',
			'2.00 / 3.00 (WebGL)',
			'67%',
			'0.20 / 1.00 (WebGL)',
			'20%',
		]);
	});

	it('keeps a gate run with its commit and the benchmark runs of its steps', () => {
		const folder = join(root, 'target/gate/20261003-172734-gate');
		writeJson(join(folder, 'gate.json'), {
			commit: 'c'.repeat(40),
			onMain: true,
			dirty: false,
			quick: false,
			steps: [
				{ id: 'desktop-target', figure: '14.0% of three.js', verdict: 'pass', log: 'd.log' },
				{ id: 'docs', figure: 'no problems', verdict: 'pass', log: 'docs.log' },
			],
		});
		writeFileSync(join(folder, 'd.log'), 'runs\nresults: target/bench/20261003-173411-bench\n');
		const record = archiveFolder(folder, host);
		expect(record).toMatchObject({ kind: 'gate', commit: 'c'.repeat(40), commitFrom: 'record' });
		expect(record.gate?.benchRuns).toEqual({ 'desktop-target': '20261003-173411-bench' });
		expect(record.gate?.steps[0]).toEqual({
			id: 'desktop-target',
			figure: '14.0% of three.js',
			verdict: 'pass',
		});
	});

	it('refuses a folder without results, and a run of a kind it does not keep', () => {
		const empty = join(root, 'target/runs/20261003-150328-bench');
		writeJson(join(empty, 'plan.json'), { run: 'x', createdAt: '', items: [] });
		expect(() => archiveFolder(empty, host)).toThrow(NoResultsError);
		const checks = join(root, 'target/runs/20261003-002947-checks');
		mkdirSync(checks, { recursive: true });
		expect(() => archiveFolder(checks, host)).toThrow('the archive keeps runs');
	});
});

describe('resultTable', () => {
	it('puts S1 above the desktop count in a table of its own', () => {
		expect(resultTable('s1', 100000)).toBe('S1');
		expect(resultTable('s1', 256000)).toBe('S1 at phone scale');
		expect(resultTable('s1-cells', 100000)).toBe('S1-cells');
	});
});
