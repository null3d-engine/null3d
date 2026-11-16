// The facades material for its cost page: a wall of windows fills the view, so every pixel draws
// the wall page, the window grid and the rooms behind it. On the page's 'facade' message the wall
// takes the facade, which builds its shader and uploads the two wall pages, and the sketch posts
// 'settled' once they are built. 'facade-off' puts back a plain material of the same color. ?scale=
// draws at that render scale, and ?fixed holds it with the governor off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createFacade } from '../../../examples/addons/facades/index';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch((ctx) => {
	const { scene, materials, geometry, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#080a10');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			near: 0.1,
			far: 60,
			position: [0, 2.6, 4.2],
			target: [0, 2.6, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.4, -0.7, -0.6],
		color: '#a8bcff',
		intensity: 2.2,
	});
	scene.createAmbientLight({ color: '#3c486e', intensity: 0.7 });
	// The plain side: the same wall in one flat color, with the same light.
	const plain = materials.standard({ color: '#5a4a3c', roughness: 0.9 });
	// The facade fills the view: the wall pages draw at their sharpest and every pixel runs the
	// room's ray, its code lookup and its pattern.
	const facade = createFacade(ctx, {
		kind: 'brick',
		window: { width: 1.7, height: 1.5, spacing: 0.9, floorHeight: 3.4, frame: 0.13, sill: 0.8 },
		room: { depth: 2.4, light: 1.5, litShare: 0.6 },
	});
	facade.start(-1);
	const wall = scene.createMesh({
		mesh: geometry.box({ width: 14, height: 10, depth: 0.6 }),
		material: plain,
		position: [0, 2.6, 0],
	});
	page.onMessage((message) => {
		if (message === 'facade-off') {
			wall.setMaterial(plain);
			return;
		}
		if (message !== 'facade') return;
		wall.setMaterial(facade.material);
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
