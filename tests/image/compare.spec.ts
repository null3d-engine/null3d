// The comparisons with three.js start each engine through the shared shell, and the ramp runs. A
// short ramp of three steps checks that the shell raises the count, measures each step and reports
// what it found. The held frames of both engines are image tests in the manifest.
import { expect, test } from '@playwright/test';
import type { RampResult } from '../../examples/lib/ramp.ts';
import { pageResult } from '../lib/page-result.ts';

// CI's software GPU draws a few frames a second, and the scene builds its surfaces in code.
test.describe.configure({ timeout: 120_000 });

for (const engine of ['null3d', 'threejs'] as const)
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`Factory starts and draws with ${engine} on ${gpu}, and the ramp runs`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
					errors.push(message.text());
			});
			await page.goto(`compare.html?compare=factory&engine=${engine}&gpu=${gpu}`);
			const result = await pageResult<{
				error?: string;
				label: string;
				tier: string;
				ramp: RampResult;
			}>(page, 100_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(gpu);
			expect(result.label).toContain(engine === 'null3d' ? 'null3D' : 'three.js 0.186.1');
			const { ramp } = result;
			expect(ramp.displayHz).toBeGreaterThan(0);
			expect(ramp.steps.length).toBeGreaterThanOrEqual(2);
			expect(ramp.steps.map((step) => step.count)).toEqual(
				[100, 200, 400].slice(0, ramp.steps.length),
			);
			// Each step drew frames: the engine runs and draws Factory at each count.
			for (const step of ramp.steps) expect(step.fps).toBeGreaterThan(0);
			expect(ramp.held).toBeLessThanOrEqual(400);
			expect(errors).toEqual([]);
		});
