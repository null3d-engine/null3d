import { describe, expect, test } from 'bun:test';
import type { Comparison } from './compare';
import { gpuCheckPasses, gpuCheckResult, type PresetComparison } from './gpu-check';

/** A GPU time comparison of one page, with each build's median and the comparison's result. */
function gpu(
	scene: string,
	baselineMs: number,
	newMs: number,
	result: Comparison['result'] = 'same',
	expected: Comparison['expected'] = null,
): Comparison {
	const values = (median: number) => ({ runs: 3, median, min: median, max: median });
	return {
		scene,
		kind: 'null3d-webgpu',
		measure: 'gpu-time',
		baseline: values(baselineMs),
		new: values(newMs),
		rounds: 3,
		change: newMs / baselineMs - 1,
		noise: 0,
		deltaMs: newMs - baselineMs,
		allowedMs: 0.3,
		result,
		expected,
	};
}

const preset = (
	name: string,
	comparisons: Comparison[],
	measurementChanges: string[] = [],
): PresetComparison => ({ preset: name, comparisons, measurementChanges });

describe('the GPU check', () => {
	test('passes, and gives each page its GPU times in the trailer line', () => {
		const result = gpuCheckResult(
			[
				preset('medium', [gpu('s4', 1.86, 1.9), gpu('s6', 3.82, 3.93)]),
				preset('high', [gpu('s4', 1.82, 1.8), gpu('s6', 6.17, 6.3)]),
			],
			'061177262..a0a7c1777',
		);
		expect(result.status).toBe('passed');
		expect(result.line).toBe(
			'GPU-Checked: 061177262..a0a7c1777 passed: s4 medium 1.86 to 1.90 ms (+2.2%); s6 medium 3.82 to 3.93 ms (+2.9%); s4 high 1.82 to 1.80 ms (-1.1%); s6 high 6.17 to 6.30 ms (+2.1%)',
		);
		expect(gpuCheckPasses(result)).toBe(true);
	});

	test("fails on a page whose GPU time is slower than the rule allows, as #389's map switch was", () => {
		const result = gpuCheckResult(
			[
				preset('medium', [gpu('s4', 1.9, 30.8, 'slower'), gpu('s6', 3.8, 28.4, 'slower')]),
				preset('high', [gpu('s4', 1.8, 40, 'slower'), gpu('s6', 6.2, 32.5, 'slower')]),
			],
			'a..b',
		);
		expect(result.status).toBe('failed');
		expect(result.line).toContain('s4 medium 1.90 to 30.80 ms (+1521.1%, slower)');
		expect(gpuCheckPasses(result)).toBe(false);
	});

	test('passes a slower page that a Bench-Expected trailer names', () => {
		const expected = { selectors: [], reason: 'a second shadow pass', line: 'Bench-Expected: x' };
		const result = gpuCheckResult(
			[
				preset('medium', [gpu('s4', 2, 3, 'slower', expected), gpu('s6', 4, 4)]),
				preset('high', [gpu('s4', 2, 2), gpu('s6', 4, 4)]),
			],
			'a..b',
		);
		expect(result.status).toBe('passed');
		expect(result.line).toContain('s4 medium 2.00 to 3.00 ms (+50.0%, slower, expected)');
	});

	test('is not measured where a page has no GPU time from both builds', () => {
		// CI's Mac machine, or any browser without a GPU timer, gives no GPU time.
		const result = gpuCheckResult(
			[preset('medium', [gpu('s4', 2, 2)]), preset('high', [])],
			'a..b',
		);
		expect(result.status).toBe('not measured');
		expect(result.line).toBe(
			'GPU-Checked: a..b not measured: s4 medium 2.00 to 2.00 ms (+0.0%); no GPU time from both builds on s6 medium, s4 high, s6 high',
		);
		expect(gpuCheckPasses(result)).toBe(false);
	});

	test('is not judged when the benchmark pages changed between the commits', () => {
		const result = gpuCheckResult(
			[
				preset('medium', [gpu('s4', 2, 4, 'slower'), gpu('s6', 4, 4)], ['the pages changed']),
				preset('high', [gpu('s4', 2, 2), gpu('s6', 4, 4)], ['the pages changed']),
			],
			'a..b',
		);
		expect(result.status).toBe('not judged');
		expect(result.line).toEndWith('; the benchmark pages changed between the commits');
		expect(gpuCheckPasses(result)).toBe(true);
	});
});
