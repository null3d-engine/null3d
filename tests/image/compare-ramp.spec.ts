// The comparison ramps on null3D judge the rate at which the scene updates, not the rate at which
// frames present: a frame whose sketch update threw still presents, so a frozen scene once reported
// a false "held" figure. Battle froze past 1,024 units when its animation table filled. These tests
// run the ramp and check that the scene keeps moving at every step, through the camera signature
// that each sketch answers, and that no step reports a failed update.
import { expect, test } from '@playwright/test';
import type { SceneSignature } from '../../examples/compare/scene-signature.ts';
import { FLOOR_FPS, type RampResult } from '../../examples/lib/ramp.ts';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ timeout: 240_000 });

/** True on CI's software GPU, which draws the heavy scenes too slowly for the movement probe. */
const softwareGpu = () => test.info().project.name.startsWith('chromium-swiftshader');

/** Switches that keep a null3D ramp short on the software GPU, where no frame rate is checked. */
const quick = () => (softwareGpu() ? 'max=400&warmup=0&step=0.5' : '');

/** Reads a run's ramp and the scene signatures it took at each step. */
interface RampProbe {
	error?: string;
	ramp: RampResult;
	signatures: (SceneSignature | null)[];
}

for (const compare of ['battle', 'factory', 'night-town'] as const)
	for (const gpu of ['webgpu', 'webgl2'] as const)
		test(`${compare}'s ramp on null3D keeps the scene updating at each step on ${gpu}`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
					errors.push(message.text());
			});
			await page.goto(
				`compare.html?compare=${compare}&engine=null3d&gpu=${gpu}&mode=scene-graph&probe=1&${quick()}`,
			);
			const result = await pageResult<RampProbe>(page, 200_000);
			expect(result.error).toBeUndefined();
			const { ramp, signatures } = result;
			expect(ramp).toBeDefined();
			expect(ramp.floorFps).toBe(FLOOR_FPS);
			// The sketch answered a signature for each step.
			expect(signatures).toHaveLength(ramp.steps.length);
			expect(signatures.length).toBeGreaterThanOrEqual(1);
			// No step's scene update failed: the engine counts completed updates, so a frozen scene
			// would report one and stop the ramp.
			for (const step of ramp.steps) expect(step.error).toBeUndefined();
			expect(ramp.stopReason).not.toBe('scene-error');
			// On a real GPU the camera moves between steps, so each signature differs from the last.
			// The software GPU draws too few frames in a step to prove it.
			if (!softwareGpu())
				for (let i = 1; i < signatures.length; i++)
					expect(signatures[i]?.camera).not.toEqual(signatures[i - 1]?.camera);
			expect(errors).toEqual([]);
		});

// The regression: Battle's animation table once held at most 1,024 objects, so a step past 1,024
// failed in every frame and the scene froze while the ramp kept reporting frames. The table grows
// now, so the ramp passes 1,024 with every update complete and the camera still moving.
test("Battle's ramp on null3D passes 1,024 units with the scene still moving", async ({ page }) => {
	test.skip(softwareGpu(), 'posing over 1,000 soldiers takes too long on the software GPU');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
			errors.push(message.text());
	});
	await page.goto(
		'compare.html?compare=battle&engine=null3d&gpu=webgpu&mode=scene-graph&ramp=full&max=1300&probe=1&effects=&warmup=1&step=0.5',
	);
	const result = await pageResult<RampProbe>(page, 200_000);
	expect(result.error).toBeUndefined();
	const { ramp, signatures } = result;
	expect(Math.max(...ramp.steps.map((step) => step.count))).toBeGreaterThan(1_024);
	for (const step of ramp.steps) expect(step.error).toBeUndefined();
	expect(ramp.stopReason).not.toBe('scene-error');
	for (let i = 1; i < signatures.length; i++)
		expect(signatures[i]?.camera).not.toEqual(signatures[i - 1]?.camera);
	expect(errors).toEqual([]);
});
