// The sharpening's cost, for the effect cost page: a wall of small boxes fills the view, so the
// sharpening works on edges across the whole canvas. On the page's 'sharpen' message it sharpens
// with the strength from ?strength=, 0.6 by default, waits until its pipelines are built, and posts
// 'settled'. The 'sharpen-off' message turns it off. ?scale= draws at that render scale, where the
// upscale sharpens instead, and ?fixed holds that scale alone with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const STRENGTH = Number(params.get('strength') ?? '0.6');
const SCALE = params.get('scale');
const FIXED = params.has('fixed');
/** Boxes along each side of the wall that covers the view. */
const WALL = 32;

export default defineSketch(({ scene, materials, geometry, post, quality, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#8aa4c0');
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
	const light = materials.standard({ color: '#c09070', roughness: 0.5, metalness: 0 });
	const dark = materials.standard({ color: '#3a4c66', roughness: 0.5, metalness: 0 });
	// The view is about 9.3 units high at the wall's distance, and wider: the wall reaches past it.
	const step = 16 / WALL;
	for (let i = 0; i < WALL; i++)
		for (let j = 0; j < WALL; j++)
			scene.createMesh({
				mesh: box,
				material: (i + j) % 2 === 0 ? light : dark,
				position: [(i - (WALL - 1) / 2) * step, (j - (WALL - 1) / 2) * step, 0],
				scale: [step, step, step],
			});
	page.onMessage((message) => {
		if (message === 'sharpen-off') post.set({ sharpen: false });
		if (message !== 'sharpen') return;
		post.set({ sharpen: STRENGTH });
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
