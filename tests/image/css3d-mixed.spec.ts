// The port of three.js's CSS3D mixed example (examples/css3d_mixed.html, r186) against three.js's
// own draw: the embedded page sits in the frame's opening, turned by the same camera, and the
// engine's room and frame draw beneath it. The example embeds a second three.js example; the port
// embeds a page made in code, so the picture repeats without a network.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D mixed scene draws where three.js draws it, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-mixed', gpu);
		expect(result.mine).toBe(1);
		expect(result.shown.mine).toEqual([true]);
		// The room's edges and the blue frame are the engine's own pixels.
		expect(result.webglPixels).toBeGreaterThan(1_000);
	});
