import { describe, expect, it } from 'bun:test';
import { NONE_MISSING } from './gpu-paths.ts';
import {
	type Growth,
	type ObjectGrowthResult,
	objectGrowthPlan,
	objectGrowthProblems,
	objectGrowthSummary,
} from './object-growth.ts';
import { gpuPathOf, judge, PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';

/** Growths from the default start to room for 65,535 objects, each taking `ms` times its step. */
const growths = (ms: number): Growth[] =>
	[1024, 2048, 4096, 8192, 16384, 32768].map((objects, k) => ({ objects, ms: ms * (k + 1) }));

const result = (fields: Partial<ObjectGrowthResult> = {}): ItemResult & ObjectGrowthResult => ({
	ok: true,
	memory: { default: 23_000_000, '16383': 29_400_000 },
	timing: { growths: growths(0.1), medianMs: [0.0012, 0.0011] },
	failures: [],
	...fields,
});

describe('the object growth plan', () => {
	const items = objectGrowthPlan({ runs: 2 });

	it('loads the timing mode on each GPU path in turns, once per run', () => {
		expect(PLANS['object-growth']).toBe(objectGrowthPlan);
		expect(items.map((item) => item.id)).toEqual([
			'object-growth-webgpu-1',
			'object-growth-webgl2-1',
			'object-growth-webgpu-2',
			'object-growth-webgl2-2',
		]);
		expect(items[1]?.path).toBe('/tests/pages/object-growth.html?gpu=webgl2&timing');
		expect(items[1]?.check).toEqual({ kind: 'object-growth', tier: 'webgl2' });
		expect(objectGrowthPlan()).toHaveLength(6);
	});

	it('forces each GPU path, so a device without WebGPU skips those loads', () => {
		expect(items.map(gpuPathOf)).toEqual(['webgpu', 'webgl2', 'webgpu', 'webgl2']);
		const check = items[0]!.check;
		const noWebGpu = { ok: false, error: 'E1301: no WebGPU adapter' };
		expect(judge(check, noWebGpu, { ...NONE_MISSING, webgpu: true })).toBe('skip');
		expect(judge(check, noWebGpu, NONE_MISSING)).not.toBe('skip');
	});

	it('passes a load that timed each doubling and saved memory with the default start', () => {
		expect(judge(items[0]!.check, result(), NONE_MISSING)).toEqual([]);
	});

	it('fails a load with failures, no growths, odd growths, no times or no saving', () => {
		expect(
			objectGrowthProblems(
				result({ failures: ['E1109: out of memory'], timing: { growths: [], medianMs: [] } }),
			),
		).toEqual(['the engine failed: E1109: out of memory', 'the page timed no growth']);
		const odd = growths(0.1).filter(({ objects }) => objects !== 4096);
		expect(objectGrowthProblems(result({ timing: { growths: odd, medianMs: [] } }))).toEqual([
			'the tables grew at 1024, 2048, 8192, 16384, 32768 objects, not at 1024 and each doubling after it',
		]);
		const untimed = growths(0.1).map((growth) => ({ ...growth, ms: Number.NaN }));
		expect(objectGrowthProblems(result({ timing: { growths: untimed, medianMs: [] } }))).toEqual([
			'a growth has no time',
		]);
		expect(objectGrowthProblems(result({ memory: { default: null, '16383': 1 } }))).toEqual([
			'the page measured no engine memory',
		]);
		expect(objectGrowthProblems(result({ memory: { default: 2, '16383': 1 } }))).toEqual([
			'the default start took no less memory than room for 16,383 objects',
		]);
	});

	it("tables each growth's lowest to highest time on each GPU path, and leaves failed loads out", () => {
		const results = new Map<string, ItemResult>([
			['object-growth-webgpu-1', result()],
			[
				'object-growth-webgpu-2',
				result({
					memory: { default: 23_200_000, '16383': 29_300_000 },
					timing: { growths: growths(0.12), medianMs: [0.0013] },
				}),
			],
			['object-growth-webgl2-1', result({ failures: ['E1501: too many objects'] })],
		]);
		const table = objectGrowthSummary(items, (id) => results.get(id))?.split('\n');
		expect(table?.slice(2)).toEqual([
			'| Growth | webgpu | webgl2 |',
			'| --- | --- | --- |',
			'| 1,023 to 2,047 | 0.10 to 0.12 | - |',
			'| 2,047 to 4,095 | 0.20 to 0.24 | - |',
			'| 4,095 to 8,191 | 0.30 to 0.36 | - |',
			'| 8,191 to 16,383 | 0.40 to 0.48 | - |',
			'| 16,383 to 32,767 | 0.50 to 0.60 | - |',
			'| 32,767 to 65,535 | 0.60 to 0.72 | - |',
			'| Memory, default start | 23.0 to 23.2 | - |',
			'| Memory, room for 16,383 | 29.3 to 29.4 | - |',
			'| Loads that passed | 2 of 2 | 0 of 2 |',
			'',
			'Loads that failed their check and stay out:',
			'object-growth-webgl2-1: the engine failed: E1501: too many objects',
			'object-growth-webgl2-2: no result',
		]);
		expect(objectGrowthSummary(PLANS.checks!(), () => undefined)).toBeUndefined();
	});
});
