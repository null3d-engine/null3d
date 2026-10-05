// A smooth metal sphere with no light on a black background, for the test that no frame draws the
// scene without the built-in room's light. On the page's 'room' message, during play, it asks for
// the room. Once the room resolves, it sets the room as the environment and turns the background
// blue in the same step, then tells the page with a 'set' message. So every frame with the blue
// background uses the room.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, assets, page }) => {
	scene.setBackground('#000000');
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 35, position: [0, 0, 4] }));
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1, widthSegments: 48, heightSegments: 24 }),
		material: materials.standard({ color: '#ffffff', metalness: 1, roughness: 0.3 }),
	});
	page.onMessage((message) => {
		if (message !== 'room') return;
		void assets.builtinEnvironment('room').then((room) => {
			scene.setEnvironment(room);
			scene.setBackground('#2040c0');
			page.post('set');
		});
	});
});
