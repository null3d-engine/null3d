// The port of three.js's CSS3D orthographic example (examples/css3d_orthographic.html, r186) against
// three.js's own draw: four planes around a point, at the same places and turns, seen through an
// orthographic camera. The null3D labels must take the same orthographic view as the wireframe
// planes that the engine draws beneath them.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D orthographic draws where three.js draws it, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-orthographic', gpu);
		expect(result.mine).toBe(4);
		expect(result.shown.mine.every(Boolean)).toBe(true);
		expect(result.webglPixels).toBeGreaterThan(1_000);
	});
