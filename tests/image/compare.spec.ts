// The comparisons with three.js start each engine through the shared shell, in each mode, and the
// ramp runs. A short ramp of three steps checks that the shell raises the count, measures each step
// and reports what it found. The held frames of both engines are image tests in the manifest.
import { expect, test } from '@playwright/test';
import type { RampResult } from '../../examples/lib/ramp.ts';
import { pageResult } from '../lib/page-result.ts';

// CI's software GPU draws a few frames a second, and the scene builds its surfaces in code.
test.describe.configure({ timeout: 120_000 });

for (const mode of ['scene-graph', 'instanced'] as const)
	for (const engine of ['null3d', 'threejs'] as const)
		for (const gpu of ['webgpu', 'webgl2'] as const)
			test(`Factory starts and draws with ${engine} on ${gpu} in the ${mode} mode, and the ramp runs`, async ({
				page,
			}) => {
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
						errors.push(message.text());
				});
				await page.goto(`compare.html?compare=factory&engine=${engine}&gpu=${gpu}&mode=${mode}`);
				const result = await pageResult<{
					error?: string;
					label: string;
					tier: string;
					build: string;
					ramp: RampResult;
				}>(page, 100_000);
				expect(result.error).toBeUndefined();
				expect(result.tier).toBe(gpu);
				expect(result.build).toBe(mode);
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

for (const engine of ['null3d', 'threejs'] as const)
	test(`Factory measures ${engine}'s frames and the whole page's memory at a fixed count`, async ({
		page,
	}) => {
		await page.goto(
			`compare.html?compare=factory&engine=${engine}&gpu=webgpu&measure=400&seconds=1`,
		);
		const result = await pageResult<{
			error?: string;
			measured: {
				count: number;
				fps: number;
				memory: { bytes: number | null; browserBytes: number | null } | null;
			};
		}>(page, 100_000);
		expect(result.error).toBeUndefined();
		const { measured } = result;
		expect(measured.count).toBe(400);
		expect(measured.fps).toBeGreaterThan(0);
		// The test pages are cross-origin isolated, so Chrome measures the whole page's memory.
		// Chromium's headless shell, CI's browser, refuses the measurement, and the page then
		// reports no memory and no error.
		if (test.info().project.name.startsWith('chromium-swiftshader')) {
			expect(measured.memory).toBeNull();
			return;
		}
		expect(measured.memory?.bytes).toBeGreaterThan(0);
		expect(measured.memory?.bytes).toBeLessThanOrEqual(measured.memory?.browserBytes ?? 0);
	});
