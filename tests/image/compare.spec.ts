// The comparisons with three.js start each engine through the shared shell, in each mode, and the
// ramp runs. A short ramp of three steps checks that the shell raises the count, measures each step
// and reports what it found. The held frames of both engines are image tests in the manifest.
import { expect, test } from '@playwright/test';
import type { RampResult } from '../../examples/lib/ramp.ts';
import { pageResult } from '../lib/page-result.ts';

// CI's software GPU draws a few frames a second, and the scene builds its surfaces in code. The
// tests draw no effects, since the image tests hold each engine's look.
test.describe.configure({ timeout: 120_000 });

/**
 * True on CI's software GPU. Under a busy shard it can draw under two frames in a step of a second,
 * too few for a frame rate, so the tests check the frame rates on a real GPU only.
 */
const softwareGpu = () => test.info().project.name.startsWith('chromium-swiftshader');

/**
 * The switches that keep a run short on the software GPU, where the tests check no frame rate: room
 * for the short ramp's top count alone, no warmup, and quarter-second steps.
 */
const quick = () => (softwareGpu() ? '&max=400&warmup=0&step=0.25' : '');

for (const mode of ['scene-graph', 'instanced'] as const)
	for (const engine of ['null3d', 'threejs'] as const)
		for (const gpu of ['webgpu', 'webgl2'] as const)
			test(`Factory starts and draws with ${engine} on ${gpu} in the ${mode} mode, and the ramp runs`, async ({
				page,
			}) => {
				// The image tests start each engine on each GPU path in each mode. So the software GPU
				// runs the ramp once for each engine in each mode, on the two GPU paths in turn.
				test.skip(
					softwareGpu() &&
						(gpu === 'webgpu') !== ((mode === 'scene-graph') === (engine === 'null3d')),
					'the software GPU runs the ramp of this engine and mode on the other GPU path',
				);
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
						errors.push(message.text());
				});
				await page.goto(
					`compare.html?compare=factory&engine=${engine}&gpu=${gpu}&mode=${mode}&effects=${quick()}`,
				);
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
				if (!softwareGpu()) for (const step of ramp.steps) expect(step.fps).toBeGreaterThan(0);
				expect(ramp.held).toBeLessThanOrEqual(400);
				expect(errors).toEqual([]);
			});

for (const engine of ['null3d', 'threejs'] as const)
	test(`Factory measures ${engine}'s frames and the whole page's memory at a fixed count`, async ({
		page,
	}) => {
		const seconds = softwareGpu() ? 0.5 : 3;
		await page.goto(
			`compare.html?compare=factory&engine=${engine}&gpu=webgpu&effects=&measure=400&seconds=${seconds}${quick()}`,
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
		// The test pages are cross-origin isolated, so Chrome measures the whole page's memory.
		// Chromium's headless shell, CI's browser, refuses the measurement, and the page then
		// reports no memory and no error.
		if (softwareGpu()) {
			expect(measured.memory).toBeNull();
			return;
		}
		expect(measured.fps).toBeGreaterThan(0);
		expect(measured.memory?.bytes).toBeGreaterThan(0);
		expect(measured.memory?.bytes).toBeLessThanOrEqual(measured.memory?.browserBytes ?? 0);
	});

// Battle loads two models and draws thousands of skinned triangles per unit, so on the software GPU
// the page runs the scene graph mode alone, each engine on one GPU path. The image tests hold both
// engines on both GPU paths in both modes.
for (const mode of ['scene-graph', 'instanced'] as const)
	for (const engine of ['null3d', 'threejs'] as const)
		for (const gpu of ['webgpu', 'webgl2'] as const)
			test(`Battle starts and draws with ${engine} on ${gpu} in the ${mode} mode, and the ramp runs`, async ({
				page,
			}) => {
				test.skip(
					softwareGpu() && (mode === 'instanced' || (gpu === 'webgpu') !== (engine === 'threejs')),
					'the software GPU runs one ramp per engine, in the scene graph mode',
				);
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
						errors.push(message.text());
				});
				await page.goto(
					`compare.html?compare=battle&engine=${engine}&gpu=${gpu}&mode=${mode}&effects=${quick()}`,
				);
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
				// The instanced mode draws three.js's crowd with WebGPURenderer on both GPU paths.
				if (engine === 'threejs' && mode === 'instanced')
					expect(result.label).toContain('WebGPURenderer');
				const { ramp } = result;
				expect(ramp.steps.length).toBeGreaterThanOrEqual(2);
				expect(ramp.steps.map((step) => step.count)).toEqual(
					[100, 200, 400].slice(0, ramp.steps.length),
				);
				if (!softwareGpu()) for (const step of ramp.steps) expect(step.fps).toBeGreaterThan(0);
				expect(errors).toEqual([]);
			});

for (const engine of ['null3d', 'threejs'] as const)
	test(`Battle measures ${engine}'s frames and the whole page's memory at a fixed count`, async ({
		page,
	}) => {
		test.skip(softwareGpu(), "the software GPU's browser measures no memory");
		await page.goto(
			`compare.html?compare=battle&engine=${engine}&gpu=webgpu&effects=&measure=400&seconds=3`,
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
		expect(result.measured.count).toBe(400);
		expect(result.measured.fps).toBeGreaterThan(0);
		expect(result.measured.memory?.bytes).toBeGreaterThan(0);
	});
