// The comparisons with three.js start each engine through the shared shell, in each mode, and the
// ramp runs. A short ramp of three steps checks that the shell raises the count, measures each step
// and reports what it found. The held frames of both engines are image tests in the manifest.
import { expect, test } from '@playwright/test';
import { NIGHT_HOLD } from '../../examples/compare/night-town/scene.ts';
import { FLOOR_FPS, type RampResult } from '../../examples/lib/ramp.ts';
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
const quickTown = () =>
	softwareGpu() ? `&max=${NIGHT_HOLD.softwareCount}&warmup=0&step=0.25` : '';

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
				expect(ramp.floorFps).toBe(FLOOR_FPS);
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

for (const engine of ['null3d', 'threejs'] as const)
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`Night town starts and draws with ${engine} on ${gpu}, and the ramp runs`, async ({
			page,
		}) => {
			// The image tests hold each engine's look. These runs draw no effects, and each engine and
			// GPU path builds the town in one mode: the scene graph on WebGPU, batches on WebGL2.
			const mode = gpu === 'webgpu' ? 'scene-graph' : 'instanced';
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
					errors.push(message.text());
			});
			// On the software GPU, three.js takes about a minute to build the shaders of each new
			// count of lights, so the ramp holds the image tests' count there.
			await page.goto(
				`compare.html?compare=night-town&engine=${engine}&gpu=${gpu}&mode=${mode}&effects=${quickTown()}`,
			);
			const result = await pageResult<{
				error?: string;
				label: string;
				tier: string;
				build: string;
				limit: { count: number; reason: string } | null;
				ramp: RampResult;
			}>(page, 100_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(gpu);
			expect(result.build).toBe(mode);
			const { ramp } = result;
			expect(ramp.steps.length).toBeGreaterThanOrEqual(1);
			// The ramp counts lights, and stops at three.js's limit where WebGLRenderer finds one.
			const top = Math.min(400, result.limit?.count ?? 400);
			for (const step of ramp.steps) expect(step.count).toBeLessThanOrEqual(top);
			// three.js builds new shaders when lights join the scene, and WebGPURenderer can show no
			// frame for a whole step while it does. The first step's lights were built at the start.
			if (!softwareGpu())
				for (const step of engine === 'null3d' ? ramp.steps : ramp.steps.slice(0, 1))
					expect(step.fps).toBeGreaterThan(0);
			if (result.limit) {
				expect(engine).toBe('threejs');
				expect(gpu).toBe('webgl2');
				expect(result.limit.count % 12).toBe(0);
				expect(result.limit.reason).toContain('WebGLRenderer');
			}
			expect(errors).toEqual([]);
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
				// On the software GPU, three.js's WebGPURenderer builds Battle's skinned pipelines on the
				// CPU, and its page took 96 s and 101 s in CI. The limit leaves room for a slower runner.
				const limit = softwareGpu() ? 160_000 : 100_000;
				test.setTimeout(limit + 20_000);
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
				}>(page, limit);
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
		// Chrome answers each measurement of Battle's whole page after about a minute on the Mac, and
		// the page measures twice: the memory, and its parts.
		test.setTimeout(300_000);
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
		}>(page, 280_000);
		expect(result.error).toBeUndefined();
		expect(result.measured.count).toBe(400);
		expect(result.measured.fps).toBeGreaterThan(0);
		expect(result.measured.memory?.bytes).toBeGreaterThan(0);
	});
