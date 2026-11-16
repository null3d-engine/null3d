// The port of three.js's CSS3D sprites example (examples/css3d_sprites.html, r186) against three.js's
// own draw: 512 billboarded images, at the same place and scale in both engines, three seconds into
// the move from the example's scatter to its plane. The engine hides the sprites behind the camera,
// as D-208 rules, and the twin hides the same ones.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D sprites draw where three.js draws them, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-sprites', gpu);
		expect(result.mine).toBe(512);
		// The camera sits inside the scatter, so some sprites stand behind it and show in neither.
		const shown = result.shown.mine.filter(Boolean).length;
		expect(shown).toBeGreaterThan(200);
		expect(shown).toBeLessThan(512);
		expect(result.mode.hold).toBe(3);
	});
