// The port of three.js's CSS3D sandbox example (examples/css3d_sandbox.html, r186) against three.js's
// own draw: ten squares at the same places, turns and scales, half of them see-through, and the
// engine's own wireframe planes must draw beneath them on both GPU paths.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D sandbox draws where three.js draws it, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-sandbox', gpu);
		expect(result.mine).toBe(10);
		expect(result.shown.mine.every(Boolean)).toBe(true);
		// The wireframe planes are the engine's own pixels: a blank canvas would report none.
		expect(result.webglPixels).toBeGreaterThan(1_000);
	});
