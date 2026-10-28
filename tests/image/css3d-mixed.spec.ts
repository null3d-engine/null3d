// The port of three.js's CSS3D mixed example (examples/css3d_mixed.html, r186) against three.js's
// own draw: the embedded page sits in the frame's opening, turned by the same camera, and the
// engine's room and frame draw beneath it. The example embeds a second three.js example; the port
// embeds a page made in code, so the picture repeats without a network. The twin draws the same
// WebGL scene with three.js's WebGLRenderer, so the test compares the drawn frames too, as each
// engine reads them, and catches a surface that the engine draws over the page.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

/**
 * The most of the drawn scene that may differ: three.js's own rule. The correct port drew no
 * differing pixel on this Mac, and a port without the example's cut-out plane differs in 0.243%, so
 * the rule catches a plane that goes missing.
 */
const MAX_SCENE_DIFFERENCE = 0.001;

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D mixed scene draws where three.js draws it, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-mixed', gpu, {
			scene: MAX_SCENE_DIFFERENCE,
		});
		expect(result.mine).toBe(1);
		expect(result.shown.mine).toEqual([true]);
		// The room's edges and the blue frame are the engine's own pixels.
		expect(result.webglPixels).toBeGreaterThan(1_000);
	});
