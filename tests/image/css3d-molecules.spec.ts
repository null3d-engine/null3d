// The port of three.js's CSS3D molecules example (examples/css3d_molecules.html, r186) against
// three.js's own draw: both stages show the same caffeine molecule, camera and turn, so the
// elements of one must sit and draw where the elements of the other do. The example's atoms are
// CSS3DSprite objects, which null3D draws as billboard labels, and its bonds are CSS3DObjects,
// which it draws as world labels.
import { expect, test } from '@playwright/test';
import { expectSameElements, GPU_PATHS } from '../lib/css3d-compare.ts';

for (const gpu of GPU_PATHS)
	test(`the ported CSS3D molecules draw where three.js draws them, ${gpu}`, async ({ page }) => {
		const result = await expectSameElements(page, 'css3d-molecules', gpu);
		// The example's default molecule is caffeine: 24 atoms and 25 bonds, each bond two bars.
		expect(result.mine).toBe(24 + 25 * 2);
		// Every atom and bond of this molecule stands in front of the camera.
		expect(result.shown.mine.every(Boolean)).toBe(true);
		expect(result.mode.hold).toBe(2);
	});
