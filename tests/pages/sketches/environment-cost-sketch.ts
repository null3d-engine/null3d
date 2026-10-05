// The scene that times the environment's lookup: LAYERS planes of the standard material, each over
// the whole view, which draw over one another with no depth test, so every pixel shades each plane
// and the GPU's time grows with the shading's cost. The planes run from smooth to rough. The built-in
// room loads at the start, and lights the planes while the page's 'environment' message last asked
// for it, until an 'environment-off' message. The render scale stays at the `?scale=` value, 1 by
// default, with the governor off, for timing. `?layers=` sets the planes.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SCALE = Number(params.get('scale') ?? '1');
const LAYERS = Number(params.get('layers') ?? '8');

export default defineSketch(async ({ scene, materials, geometry, quality, assets, page }) => {
	quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE, governor: false });
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createOrthographicCamera({ height: 2, near: 0.1, far: 10, position: [0, 0, 5] }),
	);
	scene.createAmbientLight({ intensity: 0.2 });
	const room = await assets.builtinEnvironment('room');
	// Wide enough for any window's shape, at a slant so each pixel reflects another direction.
	const plane = geometry.plane({ width: 8, height: 3 });
	for (let k = 0; k < LAYERS; k++) {
		const material = materials.standard({
			color: '#d8a860',
			metalness: k % 2,
			roughness: (k + 0.5) / LAYERS,
			depthTest: false,
		});
		const layer = scene.createMesh({ mesh: plane, material, position: [0, 0, -k * 0.01] });
		layer.setRotationEuler(0.3, 0.2 * (k - LAYERS / 2), 0);
	}
	page.onMessage((message) => {
		if (message === 'environment') scene.setEnvironment(room);
		if (message === 'environment-off') scene.setEnvironment(null);
	});
});
