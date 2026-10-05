// A smooth metal sphere with no light on a black background, for the test that no frame draws the
// scene without an environment's light. On the page's 'room' message, during play, it asks for the
// built-in room, or with a file's address in the message, loads that HDR file as an environment.
// Once the environment resolves, it sets it and turns the background blue in the same step, then
// tells the page with a 'set' message. So every frame with the blue background uses it.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, assets, page }) => {
	scene.setBackground('#000000');
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 35, position: [0, 0, 4] }));
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1, widthSegments: 48, heightSegments: 24 }),
		material: materials.standard({ color: '#ffffff', metalness: 1, roughness: 0.3 }),
	});
	page.onMessage((message, data) => {
		if (message !== 'room') return;
		const file = typeof data === 'string' ? data : null;
		const loading = file ? assets.loadEnvironment(file) : assets.builtinEnvironment('room');
		void loading.then((environment) => {
			scene.setEnvironment(environment);
			scene.setBackground('#2040c0');
			page.post('set');
		});
	});
});
