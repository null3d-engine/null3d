// The device checks of the tab memory test, the soak and recovery test, and the warm-up time test:
// their plans, how the runner tool judges each page, and the run's tables. Also the smoke plan's
// choice of pages from the checks plan.
import { describe, expect, it } from 'bun:test';
import type { SoakMinute, SoakReport } from '../../bench/pages/lib/device-soak.ts';
import { DEMOS } from '../../examples/demos.ts';
import { IMAGE_RUNS } from '../image/manifest.ts';
import { readGrowthSwitches, WASM_MOST_MIB } from '../pages/lib/tab-memory.ts';
import { parseArgs, planItems } from '../real-browsers.ts';
import { ENGINE_MODES } from './engine-checks.ts';
import {
	checksPlan,
	judge,
	NONE_MISSING,
	SMOKE_IMAGE_TESTS,
	smokePlan,
	soakPlan,
	soakSummary,
	tabMemoryPlan,
	tabMemorySummary,
	warmUpTimePlan,
	warmUpTimeSummary,
} from './plans.ts';
import type { ItemResult } from './runs.ts';
import { tabEndedResult } from './tab-end.ts';
import type { WarmUpTimeResult } from './warm-up-time.ts';

const switches = (query: string) => readGrowthSwitches(new URLSearchParams(query));

describe('the smoke plan', () => {
	const smoke = smokePlan();
	const ids = smoke.map(({ id }) => id);

	it('keeps pages of the checks plan, in its order', () => {
		const checks = checksPlan().map(({ id }) => id);
		expect(ids).toEqual(checks.filter((id) => ids.includes(id)));
		expect(ids.length).toBeLessThan(checks.length / 5);
	});

	it("runs each of its image tests on every tier the test draws on, in the test's first mode", () => {
		const images = smoke.flatMap(({ check }) => (check.kind === 'image' ? [check.run] : []));
		for (const test of SMOKE_IMAGE_TESTS) {
			const firstRuns = IMAGE_RUNS.filter((run) => run.test === test && run.sameAs === undefined);
			expect(firstRuns.length).toBeGreaterThan(0);
			expect(images.filter((run) => run.test === test)).toEqual(firstRuns);
		}
		expect(images.every(({ test }) => SMOKE_IMAGE_TESTS.has(test))).toBe(true);
	});

	it('restarts the engine once in each build, and keeps the capability, shader and path pages', () => {
		const restarts = smoke.flatMap(({ check }) => (check.kind === 'restarts' ? [check.mode] : []));
		expect(restarts.map(({ build }) => build)).toEqual(['threaded', 'single']);
		expect(restarts.map(({ name }) => name)).toEqual([ENGINE_MODES[0]?.name, 'single-threaded']);
		for (const id of [
			'capabilities',
			'isolation',
			'shaders',
			'uploads',
			'shader-library-webgpu',
			'shader-library-webgl2',
			'preset-change-webgl2',
			'warm-up-webgpu',
			'warm-up-webgl2',
			'stats-webgl2',
		])
			expect(ids).toContain(id);
		expect(ids).not.toContain('warm-up-webgl2-compile-wait');
		expect(ids).not.toContain('capabilities-reload');
	});

	it('is a plan that the runner takes by name', () => {
		expect(parseArgs(['--plan', 'smoke', '--lan', 'tb-android']).plan).toBe('smoke');
		expect(planItems(parseArgs(['--plan', 'smoke']))?.map(({ id }) => id)).toEqual(ids);
	});
});

describe("the tab memory page's switches", () => {
	it('grow GPU memory on a GPU path, and WebAssembly memory up to its maximum', () => {
		expect(switches('kind=texture&gpu=webgl2&progress=/p')).toEqual({
			kind: 'texture',
			gpu: 'webgl2',
			stepMiB: 32,
			mostMiB: 8192,
			progress: '/p',
		});
		expect(switches('kind=wasm&gpu=webgpu&step=64')).toMatchObject({
			gpu: null,
			stepMiB: 64,
			mostMiB: WASM_MOST_MIB,
		});
	});

	it('say how to fix a wrong address', () => {
		expect(() => switches('gpu=webgpu')).toThrow('?kind=');
		expect(() => switches('kind=buffer')).toThrow('?gpu=webgpu or ?gpu=webgl2');
		expect(() => switches('kind=texture&gpu=webgpu&step=20')).toThrow('multiples of 16');
	});
});

describe('the tab memory plan', () => {
	const items = tabMemoryPlan();

	it('grows each kind once, WebGPU first, each page posting its progress beside its result', () => {
		expect(items.map((item) => item.id)).toEqual([
			'tab-memory-texture-webgpu-1',
			'tab-memory-buffer-webgpu-1',
			'tab-memory-texture-webgl2-1',
			'tab-memory-buffer-webgl2-1',
			'tab-memory-wasm-1',
		]);
		const first = items[0];
		expect(first?.path).toBe(
			'/tests/pages/tab-memory.html?kind=texture&gpu=webgpu&progress=/__null3d/runs/{run}/{runner}/{item}.progress',
		);
		expect(items.every((item) => item.endsTab === true && item.quietSeconds === 210)).toBe(true);
		expect(tabMemoryPlan({ runs: 2 }).at(-1)?.id).toBe('tab-memory-wasm-2');
	});

	it('runs on a tablet over the network only while someone can reopen its runner page', () => {
		const lan = ['--plan', 'tab-memory', '--lan', 'ipad-safari'];
		expect(() => planItems(parseArgs(lan))).toThrow('--attended');
		expect(planItems(parseArgs([...lan, '--attended']))).toHaveLength(5);
		expect(planItems(parseArgs(['--plan', 'tab-memory', '--android', 'chrome']))).toHaveLength(5);
		expect(
			planItems(parseArgs(['--plan', 'soak', '--lan', 'ipad-safari']))?.length,
		).toBeGreaterThan(0);
	});

	const [texture, , , , wasm] = items;
	const progress = { livedMiB: 1504, stepMiB: 32, steps: 47, kind: 'texture', gpu: 'webgpu' };
	const context = (stored: Record<string, ItemResult>) => ({
		resultOf: (id: string) => stored[id],
		imageDir: '',
	});

	it('passes every end that tells how far the growth got, the dead tab included', () => {
		if (!texture || !wasm) throw new Error('the plan has no items');
		const dead = tabEndedResult(progress, 'runner page') as ItemResult;
		expect(judge(texture.check, dead, NONE_MISSING)).toEqual([]);
		const refused = {
			ok: true,
			end: 'refused',
			livedMiB: 2048,
			reason: 'WebAssembly: out of memory',
		};
		expect(judge(wasm.check, refused, NONE_MISSING)).toEqual([]);
		// A page that gave no result in time counts as a stall at its last progress.
		const late = { ok: false, error: 'no result within 300 s' };
		const posted = { ...context({}), progress: progress as unknown as ItemResult };
		expect(judge(texture.check, late, NONE_MISSING, posted)).toEqual([]);
		expect(judge(texture.check, late, NONE_MISSING, context({}))).toEqual([
			'no result within 300 s, before it posted any progress',
		]);
	});

	it('skips the WebGPU growths where the browser has no WebGPU', () => {
		if (!texture) throw new Error('the plan has no items');
		const none = { ok: false, error: 'no WebGPU adapter' };
		expect(judge(texture.check, none, { webgpu: true, webgl2: false })).toBe('skip');
	});

	it('tabulates how far each growth got, and the lowest point where each kind failed', () => {
		const results: Record<string, ItemResult> = {
			[items[0]?.id ?? '']: tabEndedResult(progress, 'runner tool') as ItemResult,
			[items[1]?.id ?? '']: { ok: true, end: 'cap', livedMiB: 8192, stepMiB: 32, steps: 256 },
			[`${items[2]?.id}.progress`]: { ok: true, livedMiB: 960, stepMiB: 32, steps: 30 },
			[items[4]?.id ?? '']: {
				ok: true,
				end: 'refused',
				livedMiB: 2016,
				stepMiB: 32,
				steps: 63,
				reason: 'WebAssembly: Out of memory',
			},
		};
		const table = tabMemorySummary(items, (id) => results[id]);
		expect(table?.split('\n')).toEqual([
			'| Growth | GPU path | Round | Last MiB that lived | Steps | How it ended | Message |',
			'| --- | --- | --- | --- | --- | --- | --- |',
			'| texture | webgpu | 1 | 1504 | 47 | the browser closed the tab |  |',
			'| buffer | webgpu | 1 | 8192 | 256 | the page reached its cap |  |',
			'| texture | webgl2 | 1 | 960 | 30 | no result, and the runner page never came back |  |',
			'| buffer | webgl2 | 1 | - | - | no result | |',
			'| wasm | - | 1 | 2016 | 63 | the browser refused an allocation | WebAssembly: Out of memory |',
			'',
			'The lowest failure point of each growth, the step after the last that lived:',
			'- texture on webgpu: failed at 1536 MiB',
			'- texture on webgl2: failed at 992 MiB',
			'- wasm: failed at 2048 MiB',
		]);
	});
});

describe('the soak plan', () => {
	const items = soakPlan({ minutes: 20 });

	it('loses the GPU in every thread mode first, then soaks S4 on each path from the production build', () => {
		expect(items).toHaveLength(2 * ENGINE_MODES.length + 2);
		expect(items[0]?.path).toBe('/tests/pages/scene.html?gpu=webgpu&lose-gpu');
		const soaks = items.slice(-2);
		expect(soaks.map((item) => item.id)).toEqual(['soak-s4-webgpu', 'soak-s4-webgl2']);
		expect(soaks[0]?.path).toMatch(
			/^\/__null3d\/load\/warm\/.*\/bench\/pages\/null3d\/s4\.html\?.*soak=20/,
		);
		expect(soaks[0]?.timeoutSeconds).toBe(20 * 60 + 180);
	});

	const minute = (n: number, presentedFps: number, gpuLosses = 0): SoakMinute => ({
		minute: n,
		presentedFps,
		completedFps: presentedFps,
		cpuMs: 1,
		gpuMs: null,
		gpuLosses,
		wasmBytes: 64 * 1024 * 1024,
		pipelines: 0,
	});
	const soak = (report: SoakReport) => ({ ok: true, soak: report });
	const check = items.at(-2)?.check;

	it('passes a soak in which the engine recovered from a GPU loss, and fails one where it stopped', () => {
		if (!check) throw new Error('the plan has no soak');
		const recovered = {
			minutes: 3,
			samples: [minute(1, 60), minute(2, 58, 1), minute(3, 60, 1)],
			failures: [],
		};
		expect(judge(check, soak(recovered), NONE_MISSING)).toEqual([]);
		const failed = {
			minutes: 3,
			samples: [minute(1, 60)],
			failures: ['E1302: the page lost its GPU'],
		};
		expect(judge(check, soak(failed), NONE_MISSING)).toEqual([
			'the engine failed: E1302: the page lost its GPU',
		]);
		const stopped = { minutes: 2, samples: [minute(1, 60), minute(2, 0)], failures: [] };
		expect(judge(check, soak(stopped), NONE_MISSING)).toEqual([
			'the engine drew no frames in minute 2',
		]);
	});

	it('tabulates the losses, the frame rates and the memory of each soak', () => {
		const results: Record<string, ItemResult> = {
			'soak-s4-webgpu': soak({
				minutes: 3,
				samples: [minute(1, 60), minute(2, 52, 1), minute(3, 59, 1)],
				failures: [],
			}),
		};
		expect(
			soakSummary(items, (id) => results[id])
				?.split('\n')
				.slice(2),
		).toEqual([
			'| webgpu | 3 of 3 | 1 (minutes 2) | 59.0 | 52.0 (minute 2) | 0.0 MiB | none |',
			'| webgl2 | no result; the runner stopped before this page | | | | | |',
		]);
	});
});

describe('the warm-up time plan', () => {
	const items = warmUpTimePlan();

	it('loads each scene and demo on each path twice with fresh shaders, then twice as they ship', () => {
		expect(items).toHaveLength(2 * (6 + DEMOS.length) * 4);
		expect(items.slice(0, 4).map((item) => item.id)).toEqual([
			'warm-up-s1-webgpu-fresh-1',
			'warm-up-s1-webgpu-fresh-2',
			'warm-up-s1-webgpu-plain-1',
			'warm-up-s1-webgpu-plain-2',
		]);
		expect(items[0]?.path).toBe(
			'/tests/pages/warm-up-time.html?gpu=webgpu&shaders=fresh&check=fresh&sketch=/bench/pages/null3d/s1-sketch.ts%3Fn%3D100000',
		);
		expect(items.some((item) => item.id === 'warm-up-demo-instances-webgl2-plain-2')).toBe(true);
	});

	const load = (fresh: boolean, warmUpMs: number, firstDrawMs: number): WarmUpTimeResult => ({
		tier: 'webgl2',
		mode: { preset: 'low' },
		backgroundCompile: false,
		freshShaders: fresh,
		engineStartMs: 300,
		firstFrameShownMs: 1000 + warmUpMs + firstDrawMs,
		warmUpMs,
		firstDrawMs,
		pipelines: 6,
		failures: [],
	});
	const result = (value: WarmUpTimeResult) => ({ ok: true, ...value }) as unknown as ItemResult;

	it('fails a load whose shaders were not what the plan asked for, or that built nothing', () => {
		const [fresh] = items;
		if (!fresh) throw new Error('the plan has no items');
		expect(judge(fresh.check, result(load(true, 0, 400)), NONE_MISSING)).toEqual([]);
		expect(judge(fresh.check, result(load(false, 0, 400)), NONE_MISSING)).toEqual([
			'the page loaded without fresh shaders',
		]);
		expect(judge(fresh.check, result({ ...load(true, 0, 1), pipelines: 0 }), NONE_MISSING)).toEqual(
			['the first frame built no pipelines'],
		);
	});

	it('tabulates the median fresh load and the last plain load of each scene', () => {
		const s4 = items.filter((item) => item.id.startsWith('warm-up-s4-webgl2'));
		const loads = [
			load(true, 0, 900),
			load(true, 0, 1100),
			load(false, 0, 700),
			load(false, 0, 40),
		];
		const results = new Map(s4.map((item, k) => [item.id, result(loads[k] as WarmUpTimeResult)]));
		const table = warmUpTimeSummary(s4, (id) => results.get(id))?.split('\n');
		expect(table?.at(-1)).toBe('| s4 | webgl2 | low | no | 6 | 1000 | 2000 | 40 | 1040 |');
	});
});
