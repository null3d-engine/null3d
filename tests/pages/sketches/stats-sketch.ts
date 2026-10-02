// Shows the stats overlay from the setup and reads the frame figures in every frame, as a sketch
// that logs them would. The message `figures` posts the latest figures as JSON gives them, and
// `show` shows or hides the overlay.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, debug, page }) => {
	scene.createDirectionalLight({ direction: [-1, -2, -1] });
	scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#4e8ae8' }) });
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [2, 2, 3], target: [0, 0, 0] }));
	debug.stats(true);
	page.onMessage((name, data) => {
		if (name === 'show') debug.stats(data as boolean);
		if (name === 'figures') page.post('figures', JSON.parse(JSON.stringify(debug.frameStats())));
	});
	return {
		onUpdate() {
			debug.frameStats();
		},
	};
});
