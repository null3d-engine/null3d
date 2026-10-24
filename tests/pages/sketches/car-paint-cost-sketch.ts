// The car paint's cost, for its cost page: a wall of painted panels covers the view, so every
// pixel draws the paint. On the page's 'paint' message the panels take the paint, which loads the
// clear coat's and the stretched lobe's shaders, and the sketch posts 'settled' once they are
// built. 'paint-off' puts back a plain clear-coated metal with the same values. ?scale= draws at
// that render scale, and ?fixed holds that scale alone with the governor off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import { createCarPaint } from '../../../examples/addons/car-paint';

const params = new URL(import.meta.url).searchParams;
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, assets, quality, page } = ctx;
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground('#0e1116');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.8 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 100,
			position: [0, 0, 6],
			target: [0, 0, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-1, -1.4, -2],
		color: '#fff3e0',
		intensity: 2.6,
	});
	scene.createPointLight({
		position: [2.5, 2, 2.5],
		color: '#9fc4ff',
		intensity: 20,
		range: 20,
	});
	// The plain side: the same clear-coated metal, without the flakes, the seams and the weave.
	const plain = materials.standard({
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
	const paint = createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		// The panel fills the view, so these densities draw flakes, seams and tows at the size that a
		// car's panels show. The cost is for each pixel, whatever the size.
		flakes: { cells: [1600, 2400], tilt: 0.28 },
		seams: { spacing: [0.1, 0], width: 0.0024, shade: 0.85 },
		weave: { cells: [400, 600], shine: 0.9 },
		clearcoat: 1,
		clearcoatRoughness: 0.02,
	});
	// One plane fills the view, so every pixel draws the paint at the whole render size.
	const panel = scene.createMesh({
		mesh: geometry.plane({ width: 14, height: 9 }),
		material: plain,
	});
	page.onMessage((message) => {
		if (message === 'paint-off') {
			panel.setMaterial(plain);
			return;
		}
		if (message !== 'paint') return;
		panel.setMaterial(paint);
		void scene.warmUp().then(() => page.post('settled', {}));
	});
});
