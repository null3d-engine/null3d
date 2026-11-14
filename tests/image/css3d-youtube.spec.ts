// The port of three.js's CSS3D youtube example (examples/css3d_youtube.html, r186) against three.js's
// own draw: four embedded pages in a ring, each turned out of it, so the camera sees every screen at
// an angle. The example embeds YouTube videos; the port embeds pages made in code, so the picture
// repeats without a network.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D youtube scene draws where three.js draws it, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-youtube', gpu);
		expect(result.mine).toBe(4);
		// The camera stands inside the ring, so every screen is in front of it.
		expect(result.shown.mine.every(Boolean)).toBe(true);
	});
