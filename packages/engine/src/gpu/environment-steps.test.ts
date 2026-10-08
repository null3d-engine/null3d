import { describe, expect, test } from 'bun:test';
import { levelOffsets, SKY_FILTER, STEP_BYTES, skyRows, skySteps } from './environment-steps';

describe("a sky map's draws", () => {
	test('draw every level of the chain from the sky, one under another, then filter each level', () => {
		const [steps] = skySteps(256, 6, 256);
		const chain = steps.filter((step) => step.pipeline === 'sky');
		expect(chain.map((step) => [step.level, step.size, step.row])).toEqual([
			[0, 256, 0],
			[1, 128, 256],
			[2, 64, 384],
			[3, 32, 448],
			[4, 16, 480],
			[5, 8, 496],
			[6, 4, 504],
			[7, 2, 508],
			[8, 1, 510],
		]);
		// The last level ends on the target's last row.
		expect((chain.at(-1)?.row ?? 0) + 1).toBe(skyRows(256));
		expect(chain.map((step) => step.samples)).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 2]);
		expect(chain[0]?.into).toEqual(['chain', 'target']);
		expect(chain.slice(1).every((step) => step.into.length === 1)).toBe(true);
		const filtered = steps.filter((step) => step.pipeline === 'prefilter');
		expect(filtered.map((step) => [step.level, step.size, step.samples, step.row])).toEqual([
			[1, 128, SKY_FILTER.samples, 0],
			[2, 64, 2 * SKY_FILTER.samples, 0],
			[3, 32, 4 * SKY_FILTER.samples, 0],
			[4, 16, 8 * SKY_FILTER.samples, 0],
			[5, 8, 16 * SKY_FILTER.samples, 0],
		]);
		// Level i of n holds perceptual roughness 1 - sqrt(1 - i / (n - 1)), as a file's map does.
		expect(filtered.at(-1)?.value).toBe(1);
		expect(filtered[0]?.value).toBeCloseTo(1 - Math.sqrt(0.8), 6);
	});

	test("write each draw's size, directions, source size and row into its slot", () => {
		const [steps, values] = skySteps(16, 4, 256);
		const words = new Uint32Array(values);
		const floats = new Float32Array(values);
		expect(values.byteLength).toBe(steps.length * 256);
		steps.forEach((step, k) => {
			const at = (k * 256) / 4;
			expect([...words.subarray(at, at + 4)]).toEqual([step.size, step.samples, 16, step.row]);
			expect(floats[at + 4]).toBeCloseTo(step.value, 6);
			expect(floats[at + 5]).toBe(1);
		});
		expect(STEP_BYTES).toBeLessThanOrEqual(256);
	});

	test('lay each level out after the one before, rows of six faces', () => {
		const tight = (size: number) => 6 * size * 4;
		expect(levelOffsets(8, 4, tight)).toEqual([0, 1536, 1920, 2016, 2040]);
	});

	test('take a finer filter for comparisons', () => {
		const [steps] = skySteps(16, 3, 256, { samples: 1024, chainSamples: 16 });
		expect(steps.map((step) => step.samples)).toEqual([1, 2, 4, 8, 16, 1024, 2048]);
	});
});
