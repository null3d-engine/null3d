// The vignette's cost: lit boxes over a plain background color, for the effect cost page. With
// ?fill=covered a wall of boxes covers the whole view; otherwise one small box stands in the
// middle, and the background color covers almost all of it. On the 8-bit path the vignette darkens
// the boxes in their shaders and draws the background color as a background, and on the HDR path
// the final pass darkens every pixel. With ?background=none the sketch sets no background color,
// so the clear stays black and nothing draws behind the boxes. ?scale= draws at that render scale,
// and with ?fixed the range holds that scale alone, and the governor is off, for timing. On the
// page's 'vignette' message it turns the vignette on, waits until its pipelines are built, and
// posts 'settled'. The 'vignette-off' message turns it off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const COVERED = params.get('fill') === 'covered';
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
const BACKGROUND = params.get('background') !== 'none';
/** Boxes along each side of the wall that covers the view. */
const WALL = 24;

export default defineSketch(({ scene, materials, geometry, post, quality, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	if (BACKGROUND) scene.setBackground('#8aa4c0');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.1,
			far: 100,
			position: [0, 0, 10],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({ direction: [-1, -1.5, -2], color: '#ffffff', intensity: 2.5 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const material = materials.standard({ color: '#c09070', roughness: 0.5, metalness: 0 });
	if (COVERED) {
		// The view is about 9.3 units high at the wall's distance, and wider: the wall reaches past it.
		const step = 16 / WALL;
		for (let i = 0; i < WALL; i++)
			for (let j = 0; j < WALL; j++)
				scene.createMesh({
					mesh: box,
					material,
					position: [(i - (WALL - 1) / 2) * step, (j - (WALL - 1) / 2) * step, 0],
					scale: [step, step, step],
				});
	} else scene.createMesh({ mesh: box, material, position: [0, 0, 0] });
	page.onMessage((message) => {
		if (message === 'vignette-off') post.set({ vignette: false });
		if (message !== 'vignette') return;
		post.set({ vignette: { intensity: 1, size: 1.2, falloff: 3 } });
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
