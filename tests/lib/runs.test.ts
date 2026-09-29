import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../real-browsers.ts';
import {
	benchPlan,
	benchSummary,
	checksPlan,
	judge,
	MEMORY_MAXIMUMS_MIB,
	memoryPlan,
	memorySummary,
	NO_RESULT,
	NONE_MISSING,
	PLANS,
	parityPlan,
} from './plans.ts';

/** A browser may lack WebGPU, and must have WebGL2. */
const NO_WEBGPU = { webgpu: true, webgl2: false };

import { RUNS_DIR } from './report-collector.ts';
import {
	batchTimeoutMs,
	type ItemResult,
	quietLimitMs,
	runName,
	turnBatches,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './runs.ts';

describe('turnBatches', () => {
	it('lets one browser per device run at a time, in the order given', () => {
		const runners = [
			{ name: 'mac-safari', device: 'mac' },
			{ name: 'mac-brave-browser', device: 'mac' },
			{ name: 'sm-s926b-chrome', device: 'sm-s926b' },
			{ name: 'sm-s926b-chrome-beta', device: 'sm-s926b' },
			{ name: 'ipad-safari', device: 'ipad' },
		];
		expect(turnBatches(runners)).toEqual([
			['mac-safari', 'sm-s926b-chrome', 'ipad-safari'],
			['mac-brave-browser', 'sm-s926b-chrome-beta'],
		]);
	});
});

describe('waitForRunners', () => {
	it('gives up on a runner page that started and then went quiet, as when its tab closed', async () => {
		const run = `${runName('test')}-wait-${process.pid}`;
		const plan = writePlan(run, [{ id: 'a', path: '/a', timeoutSeconds: 1, check: {} }]);
		try {
			writeRunnerFile(run, 'quiet-phone', 'device', {});
			writeRunnerFile(run, 'done-phone', 'device', {});
			writeRunnerFile(run, 'done-phone', 'done', {});
			const quiet: string[] = [];
			const finished = await waitForRunners(plan, ['quiet-phone', 'done-phone'], {
				quietMs: 50,
				onQuiet: (runner) => quiet.push(runner),
			});
			expect(finished).toEqual(['done-phone']);
			expect(quiet).toEqual(['quiet-phone']);
		} finally {
			rmSync(join(RUNS_DIR, run), { recursive: true, force: true });
		}
	});

	it('allows the slowest page its timeout, and time to load the next page', () => {
		const item = (timeoutSeconds: number) => ({ id: 'a', path: '/a', timeoutSeconds, check: {} });
		expect(quietLimitMs({ run: 'r', createdAt: '', items: [item(95), item(30)] })).toBe(125_000);
	});
});

describe('runName', () => {
	it('sorts by time and is safe as a folder name', () => {
		expect(runName('checks', new Date('2026-09-27T10:15:30.123Z'))).toBe('20260927-101530-checks');
	});
});

describe('the checks plan', () => {
	const items = checksPlan();

	it('has unique item names and pages on the test pages path', () => {
		expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
		for (const item of items) expect(item.path.startsWith('/tests/pages/')).toBe(true);
		expect(items.find((item) => item.id === 'engine-webgl2-single-threaded')?.path).toBe(
			'/tests/pages/engine.html?gpu=webgl2&threads=off&seconds=2',
		);
		expect(batchTimeoutMs({ run: 'r', createdAt: '', items })).toBeGreaterThan(
			items.length * 30_000,
		);
	});

	it('skips a WebGPU page on a browser without WebGPU only when allowed', () => {
		const webgpu = items.find((item) => item.id === 'clear-webgpu');
		const webgl2 = items.find((item) => item.id === 'clear-webgl2');
		if (!webgpu || !webgl2) throw new Error('the plan lacks the clear pages');
		const missing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgpu in this browser.',
		};
		expect(judge(webgpu.check, missing, NO_WEBGPU)).toBe('skip');
		expect(judge(webgpu.check, missing, NONE_MISSING)).toEqual([missing.error]);
		expect(judge(webgl2.check, { ok: false, error: 'no WebGPU adapter' }, NO_WEBGPU)).toEqual([
			'no WebGPU adapter',
		]);
	});

	it('skips a WebGL2 page, and the shaders page, on a browser without WebGL2 only when allowed', () => {
		const webgl2 = items.find((item) => item.id === 'engine-webgl2-pipelined');
		const shaders = items.find((item) => item.id === 'shaders');
		const webgpu = items.find((item) => item.id === 'clear-webgpu');
		if (!webgl2 || !shaders || !webgpu) throw new Error('the plan lacks the pages');
		const noWebGL2 = { webgpu: false, webgl2: true };
		const engineMissing = {
			ok: false,
			error: 'E1301: no usable GPU path for ?gpu=webgl2 in this browser.',
		};
		expect(judge(webgl2.check, engineMissing, noWebGL2)).toBe('skip');
		expect(judge(webgl2.check, engineMissing, NONE_MISSING)).toEqual([engineMissing.error]);
		const pageMissing = { ok: false, error: 'no WebGL2 context' };
		expect(judge(shaders.check, pageMissing, noWebGL2)).toBe('skip');
		expect(judge(shaders.check, pageMissing, NO_WEBGPU)).toEqual([pageMissing.error]);
		expect(judge(webgpu.check, pageMissing, noWebGL2)).toEqual([pageMissing.error]);
	});

	it('judges isolation from the page result', () => {
		const isolation = items.find((item) => item.id === 'isolation');
		if (!isolation) throw new Error('the plan lacks the isolation page');
		expect(
			judge(isolation.check, { ok: true, crossOriginIsolated: true, threaded: true }, NONE_MISSING),
		).toEqual([]);
		expect(
			judge(
				isolation.check,
				{ ok: true, crossOriginIsolated: false, threaded: false },
				NONE_MISSING,
			),
		).toEqual(['the page is not cross-origin isolated', 'the threaded build did not load']);
	});
});

describe('the parity plan', () => {
	const items = parityPlan();
	const item = (id: string) => {
		const found = items.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`the plan lacks ${id}`);
		return found;
	};
	/** A hold page's result: a small frame of one color, as the benchmark pages publish it. */
	const holdResult = (rgb: number[], extra: Record<string, unknown> = {}): ItemResult => {
		const size = 16;
		const pixels = new Uint8Array(size * size * 4);
		for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
		return {
			ok: true,
			scene: 's1',
			n: 1000,
			width: size,
			height: size,
			pixels: Buffer.from(pixels).toString('base64'),
			...extra,
		};
	};
	const THREE_WEBGPU = 'parity-s1-threejs-webgpu';
	const NULL3D_WEBGPU = 'parity-s1-null3d-webgpu';

	it('opens every hold page once and pairs each null3d page with three.js on its tier', () => {
		expect(PLANS.parity).toBe(parityPlan);
		// Per scene: two three.js pages and three null3D pages, one per GPU tier.
		expect(items).toHaveLength(15);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		// Compatibility mode needs WebGPU, and it is compared with three.js's WebGPU page.
		expect(item('parity-s1-null3d-compat').check).toEqual({
			kind: 'parity',
			tier: 'webgpu',
			scene: 's1',
			pair: { candidate: 'null3d-compat', reference: 'threejs-webgpu' },
		});
		for (const { path } of items) expect(path).toMatch(/^\/bench\/pages\/.+\.html\?.+&hold$/);
		const pairs = items.flatMap(({ id, check }) =>
			check.kind === 'parity' ? [`${id} ${check.pair.reference}`] : [],
		);
		expect(pairs).toEqual(
			['s1', 's1-static', 's2'].flatMap((scene) => [
				`parity-${scene}-null3d-webgpu threejs-webgpu`,
				`parity-${scene}-null3d-compat threejs-webgpu`,
				`parity-${scene}-null3d-webgl2 threejs-webgl`,
			]),
		);
		expect(item('parity-s2-null3d-webgl2').path).toBe(
			'/bench/pages/null3d/s2.html?gpu=webgl2&hold',
		);
	});

	it('passes a three.js page with a frame, and skips it without WebGPU only when allowed', () => {
		const { check } = item(THREE_WEBGPU);
		expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING)).toEqual([]);
		expect(judge(check, holdResult([10, 20, 30], { pixels: 'AAAA' }), NONE_MISSING)).toEqual([
			'the frame holds 3 bytes, not the 1024 that 16 x 16 RGBA8 pixels need',
		]);
		const fellBack = {
			ok: false,
			error: 'three.js could not start WebGPU and switched to WebGL 2. See the console.',
		};
		expect(judge(check, fellBack, NO_WEBGPU)).toBe('skip');
		expect(judge(check, fellBack, NONE_MISSING)).toEqual([fellBack.error]);
		const noGpu = { ok: false, error: 'This browser has no WebGPU. Use ?renderer=webgl.' };
		expect(judge(item('parity-s1-threejs-webgl').check, noGpu, NO_WEBGPU)).toEqual([noGpu.error]);
	});

	it('compares a null3d frame with the three.js frame of its tier from the same run', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const results: Record<string, ItemResult> = { [THREE_WEBGPU]: holdResult([10, 20, 30]) };
			const context = { resultOf: (id: string) => results[id], imageDir };
			const { check } = item(NULL3D_WEBGPU);
			expect(judge(check, holdResult([10, 20, 30]), NONE_MISSING, context)).toEqual([]);
			const name = 's1-null3d-webgpu-vs-threejs-webgpu';
			const images = [`${name}-inputs.png`, `${name}-diff.png`];
			expect(readdirSync(imageDir).sort()).toEqual([...images].sort());
			expect(judge(check, holdResult([200, 20, 30]), NONE_MISSING, context)).toEqual([
				`against ${THREE_WEBGPU}, 100.000% of pixels differ; three.js's rule allows under 0.1%. Images: ${images.map((file) => join(imageDir, file)).join(', ')}`,
			]);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('falls back to the stored baseline where three.js cannot draw with both renderers', () => {
		const imageDir = mkdtempSync(join(tmpdir(), 'null3d-parity-'));
		try {
			const THREE_WEBGL = 'parity-s1-threejs-webgl';
			// Only the WebGL page drew: the device has no WebGPU.
			const results: Record<string, ItemResult> = {
				[THREE_WEBGL]: holdResult([10, 20, 30]),
				[THREE_WEBGPU]: { ok: false, error: 'This browser has no WebGPU' },
			};
			const { check } = item('parity-s1-null3d-webgl2');
			// A quarter of the frame differs: over three.js's rule, under a stored 30%.
			const quarter = holdResult([10, 20, 30]);
			const pixels = Buffer.from(quarter.pixels as string, 'base64');
			for (let i = 0; i < pixels.length / 4; i += 4) pixels[i] = 200;
			const frame = { ...quarter, pixels: pixels.toString('base64') };
			const resultOf = (id: string) => results[id];
			expect(judge(check, frame, NO_WEBGPU, { resultOf, imageDir })).toHaveLength(1);
			expect(
				judge(check, frame, NO_WEBGPU, { resultOf, imageDir, storedBaselines: { s1: 0.3 } }),
			).toEqual([]);
			const [problem] = judge(check, frame, NO_WEBGPU, {
				resultOf,
				imageDir,
				storedBaselines: { s1: 0.1 },
			}) as string[];
			expect(problem).toContain(
				"25.000% of pixels differ; three.js's rule allows under 0.1%, and three.js's two renderers differ by 10.000%, in bench/parity-baselines.json from a device that draws with both",
			);
		} finally {
			rmSync(imageDir, { recursive: true, force: true });
		}
	});

	it('says what is missing when a frame cannot be compared', () => {
		const { check } = item(NULL3D_WEBGPU);
		const frame = holdResult([10, 20, 30]);
		const withReference = (reference: ItemResult | undefined) => ({
			resultOf: (id: string) => (id === THREE_WEBGPU ? reference : undefined),
			imageDir: join(tmpdir(), 'null3d-parity-unused'),
		});
		const noReference = [`no result from ${THREE_WEBGPU} to compare with`];
		expect(judge(check, frame, NONE_MISSING)).toEqual(noReference);
		expect(judge(check, frame, NONE_MISSING, withReference(undefined))).toEqual(noReference);
		expect(
			judge(
				check,
				frame,
				NONE_MISSING,
				withReference({ ok: false, error: 'no result within 60 s' }),
			),
		).toEqual([`${THREE_WEBGPU} has no frame to compare with: no result within 60 s`]);
		expect(
			judge(check, holdResult([10, 20, 30], { n: 10 }), NONE_MISSING, withReference(frame)),
		).toEqual(['the pages drew different object counts: 10 and 1000']);
		expect(judge(check, { ok: false, error: 'no result within 60 s' }, NONE_MISSING)).toEqual([
			'no result within 60 s',
		]);
	});
});

describe('the bench plan', () => {
	it('runs each page five times by default, and the pages take turns run by run', () => {
		const items = benchPlan();
		expect(items).toHaveLength(35);
		expect(items.slice(0, 7).map((item) => item.id)).toEqual([
			'bench-s1-null3d-webgpu-1',
			'bench-s1-null3d-webgl2-1',
			'bench-s1-null3d-webgpu-low-1',
			'bench-s1-null3d-webgl2-low-1',
			'bench-s1-threejs-webgpu-1',
			'bench-s1-threejs-webgl-1',
			'bench-s1-scene-code-1',
		]);
		expect(items.at(-1)?.id).toBe('bench-s1-scene-code-5');
		// Both latency modes run, so a device's results compare them.
		expect(items[2]).toEqual({
			id: 'bench-s1-null3d-webgpu-low-1',
			path: '/bench/pages/null3d/s1.html?gpu=webgpu&latency=low',
			timeoutSeconds: 95,
			check: { kind: 'bench', tier: 'webgpu', scene: 's1', page: 'null3d-webgpu-low' },
		});
	});

	it('takes the number of runs and the instance count', () => {
		const items = benchPlan({ runs: 2, count: 1000 });
		expect(items).toHaveLength(14);
		expect(items.every((item) => item.path.endsWith('n=1000'))).toBe(true);
	});

	it("runs null3D's two GPU paths at each job worker count, every count in each run", () => {
		const items = benchPlan({ runs: 2, count: 300_000, jobs: [2, 4] });
		expect(PLANS.bench).toBe(benchPlan);
		expect(items.map((item) => item.id)).toEqual([
			'bench-s1-null3d-webgpu-jobs2-1',
			'bench-s1-null3d-webgl2-jobs2-1',
			'bench-s1-null3d-webgpu-jobs4-1',
			'bench-s1-null3d-webgl2-jobs4-1',
			'bench-s1-null3d-webgpu-jobs2-2',
			'bench-s1-null3d-webgl2-jobs2-2',
			'bench-s1-null3d-webgpu-jobs4-2',
			'bench-s1-null3d-webgl2-jobs4-2',
		]);
		expect(items[3]).toEqual({
			id: 'bench-s1-null3d-webgl2-jobs4-1',
			path: '/bench/pages/null3d/s1.html?gpu=webgl2&n=300000&jobs=4',
			timeoutSeconds: 95,
			check: { kind: 'bench', tier: 'webgl2', scene: 's1', page: 'null3d-webgl2', jobs: 4 },
		});
	});

	it('fails a run whose engine started another number of job workers than it asked for', () => {
		const [item] = benchPlan({ runs: 1, jobs: [4] });
		if (!item) throw new Error('the plan has no items');
		const run = (jobWorkers: number) => ({
			ok: true,
			frames: 300,
			cpuMs: { median: 2.1 },
			mode: { build: 'threaded', jobWorkers },
		});
		expect(judge(item.check, run(4), NONE_MISSING)).toEqual([]);
		expect(judge(item.check, run(8), NONE_MISSING)).toEqual([
			'started 8 job workers, not the 4 that ?jobs= asked for',
		]);
		// Without the switch, any count passes.
		const [plain] = benchPlan({ runs: 1 });
		if (!plain) throw new Error('the plan has no items');
		expect(judge(plain.check, run(8), NONE_MISSING)).toEqual([]);
	});

	it("summarizes a device's runs apart for each job worker count", () => {
		const items = benchPlan({ runs: 2, jobs: [2, 4] });
		/** A null3D run whose sketch worker takes less time with more job workers. */
		const result = (id: string): ItemResult => {
			const sketchMs = id.includes('-jobs2-') ? 3 : 2.5;
			const at = { median: sketchMs, p95: sketchMs, p99: sketchMs };
			return {
				ok: true,
				frames: 300,
				cpuMs: { ...at, mean: sketchMs },
				intervalMs: { median: 16.7, p95: 17, p99: 18 },
				stats: {
					cpuMsAllThreads: { median: sketchMs + 1 },
					gpuMs: null,
					uploadBytes: { median: 0 },
					drawCalls: { median: 1 },
					threads: {
						'sketch-worker': { busyMs: at, phases: { update: { median: 2 } } },
						'job-0': { busyMs: { median: 0.5 }, phases: {} },
					},
				},
			};
		};
		const lines = benchSummary(items, result)?.split('\n') ?? [];
		expect(lines[0]).toContain('| Scene | Job workers | Page |');
		expect(lines.slice(2)).toEqual([
			'| s1 | 2 | null3d-webgpu | 2 | 3.00 (3.00 to 3.00) | sketch-worker 3.00 | 1.00 | 1.00 |',
			'| s1 | 2 | null3d-webgl2 | 2 | 3.00 (3.00 to 3.00) | sketch-worker 3.00 | 1.00 | 1.00 |',
			'| s1 | 4 | null3d-webgpu | 2 | 2.50 (2.50 to 2.50) | sketch-worker 2.50 | 0.50 | 0.50 |',
			'| s1 | 4 | null3d-webgl2 | 2 | 2.50 (2.50 to 2.50) | sketch-worker 2.50 | 0.50 | 0.50 |',
		]);
		// Without job worker counts, the summary compares the pages as the protocol does: a row per
		// page, then how null3D compares with three.js.
		const plain = benchSummary(benchPlan({ runs: 1 }), result)?.split('\n') ?? [];
		expect(plain[0]).toContain('| Scene | Page | Runs |');
		expect(plain.slice(2, 10).map((line) => line.split(' | ')[1])).toEqual([
			'null3d-webgpu',
			'null3d-webgl2',
			'null3d-webgpu-low',
			'null3d-webgl2-low',
			'threejs-webgpu',
			'threejs-webgl',
			'scene-code',
			undefined,
		]);
		expect(plain[10]).toStartWith('s1: null3d on WebGPU takes');
		expect(benchSummary(memoryPlan({ runs: 1 }), result)).toBeUndefined();
	});
});

describe('the memory plan', () => {
	/** An engine page's result: started with shared memory, or with the single-threaded build. */
	const loaded = (build = 'threaded'): ItemResult => ({ ok: true, mode: { build, jobWorkers: 8 } });
	const ALLOCATION_ERROR = 'WebAssembly.Memory(): could not allocate memory';
	const allocationFailed: ItemResult = { ok: false, error: ALLOCATION_ERROR };

	it('loads the engine page 20 times at each maximum, from low to high', () => {
		const items = memoryPlan();
		expect(PLANS.memory).toBe(memoryPlan);
		expect(MEMORY_MAXIMUMS_MIB).toEqual([256, 512, 1024, 2048, 4096]);
		expect(items).toHaveLength(100);
		expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
		expect(items[0]).toEqual({
			id: 'memory-256-1',
			path: '/tests/pages/engine.html?memory=256&seconds=2',
			timeoutSeconds: 45,
			check: { kind: 'memory', maximumMiB: 256 },
		});
		expect(items[20]?.id).toBe('memory-512-1');
		expect(items.at(-1)?.id).toBe('memory-4096-20');
		expect(memoryPlan({ runs: 2 }).map(({ id }) => id)).toEqual(
			MEMORY_MAXIMUMS_MIB.flatMap((maximum) => [`memory-${maximum}-1`, `memory-${maximum}-2`]),
		);
	});

	it('passes a load only when the engine started with shared memory', () => {
		const [item] = memoryPlan({ runs: 1 });
		if (!item) throw new Error('the plan has no items');
		expect(judge(item.check, loaded(), NONE_MISSING)).toEqual([]);
		expect(judge(item.check, loaded('single'), NONE_MISSING)).toEqual([
			'the engine started without shared memory, so the load tested no maximum',
		]);
		expect(judge(item.check, allocationFailed, NO_WEBGPU)).toEqual([ALLOCATION_ERROR]);
	});

	it('counts the loads that started the engine at each maximum, and names the largest that always did', () => {
		const items = memoryPlan({ runs: 3 });
		const results: Record<string, ItemResult> = {};
		for (const { id } of items) results[id] = loaded();
		results['memory-2048-2'] = allocationFailed;
		results['memory-4096-1'] = allocationFailed;
		results['memory-4096-2'] = allocationFailed;
		// The browser closed the runner's tab during the last load.
		delete results['memory-4096-3'];
		expect(memorySummary(items, (id) => results[id])?.split('\n')).toEqual([
			'| Memory maximum | Loads that started the engine | Why the others failed |',
			'| --- | --- | --- |',
			'| 256 MiB | 3 of 3 | none |',
			'| 512 MiB | 3 of 3 | none |',
			'| 1024 MiB | 3 of 3 | none |',
			`| 2048 MiB | 2 of 3 | 1 load: ${ALLOCATION_ERROR} |`,
			`| 4096 MiB | 0 of 3 | 2 loads: ${ALLOCATION_ERROR}; 1 load: ${NO_RESULT} |`,
			'',
			'The largest maximum that loaded 3 of 3 times: 1024 MiB.',
		]);
		const nothing = memorySummary(items, () => allocationFailed);
		expect(nothing?.split('\n').at(-1)).toBe('No maximum loaded every time.');
		expect(memorySummary(benchPlan({ runs: 1 }), () => loaded())).toBeUndefined();
	});
});

describe('parseArgs', () => {
	it('reads the plan, the flags, the device lists and the macOS apps', () => {
		expect(
			parseArgs([
				'--allow-no-webgpu',
				'--android',
				'chrome,brave',
				'--lan',
				'ipad-safari',
				'Safari',
			]),
		).toEqual({
			plan: 'checks',
			missing: { webgpu: true, webgl2: false },
			mac: ['Safari'],
			android: ['chrome', 'brave'],
			lan: ['ipad-safari'],
		});
		expect(parseArgs(['--allow-no-webgl2', 'Firefox']).missing).toEqual({
			webgpu: false,
			webgl2: true,
		});
		expect(parseArgs(['--plan', 'bench', '--n', '30000', 'Safari']).count).toBe(30000);
		expect(parseArgs(['--plan', 'bench', '--runs', '3', 'Safari']).runs).toBe(3);
		expect(parseArgs(['--plan', 'scale', '--android', 'chrome']).plan).toBe('scale');
		expect(parseArgs(['--plan', 'memory', 'Safari']).plan).toBe('memory');
		expect(parseArgs(['--plan', 'bench', '--jobs', '2,4,6,8', 'Safari']).jobs).toEqual([
			2, 4, 6, 8,
		]);
		expect(() => parseArgs(['--n', 'many'])).toThrow('--n: use a whole number above 0');
		expect(() => parseArgs(['--runs', '0'])).toThrow('--runs: use a whole number above 0');
		expect(() => parseArgs(['--plan', 'bench', '--jobs', '0'])).toThrow(
			'--jobs: use a comma-separated list of whole numbers above 0',
		);
		expect(() => parseArgs(['--plan', 'memory', '--jobs', '2'])).toThrow(
			'--jobs works with --plan bench only',
		);
		expect(() => parseArgs(['--plan', 'nothing'])).toThrow('no plan named nothing');
		expect(() => parseArgs(['--fast'])).toThrow('unknown option --fast');
	});
});
