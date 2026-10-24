// The trap sketch: a light scene whose frames are cheap for each pixel, so the two-step pass's
// upscale dominates them below the whole render scale, as on a software renderer (D-237). It starts
// with the governor off and one step of render scale allowed. On 'governor' it turns the governor
// on or off. It posts each change of the render scale with its own frame count, so the page can
// tell how many frames came between the step down and its return.
import { defineSketch } from '@null3d/engine';
import { TRAP } from '../lib/governor-trap';

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	quality.set({ minRenderScale: TRAP.minScale, maxRenderScale: 1, governor: false });
	scene.setBackground('#a8c0d8');
	scene.createAmbientLight({ intensity: 0.6 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const looks = ['#d04030', '#30a050', '#3050d0', '#e0b020'].map((color) =>
		materials.unlit({ color }),
	);
	// A few boxes that cover part of the view: the scene draws, and its per-pixel work stays small.
	for (let k = 0; k < 4; k++)
		scene.createMesh({
			mesh: box,
			material: looks[k] as (typeof looks)[number],
			position: [k * 1.2 - 1.8, 0, -3],
		});
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			position: [0, 0.5, 0],
			target: [0, 0, -3],
			near: 0.1,
			far: 50,
		}),
	);

	let frame = 0;
	const post = () => page.post('governor-scale', { renderScale: quality.renderScale, frame });
	let scale = quality.renderScale;
	quality.onChange(() => {
		if (quality.renderScale === scale) return;
		scale = quality.renderScale;
		post();
	});
	page.onMessage((name, data) => {
		if (name === 'governor') quality.set({ governor: data as boolean });
	});
	return {
		onUpdate() {
			frame++;
			if (quality.renderScale !== scale) {
				scale = quality.renderScale;
				post();
			}
		},
	};
});
