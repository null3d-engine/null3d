// Reads the frame figures in every frame, as a sketch that logs them would. The page shows the stats
// overlay. The message `figures` posts the latest figures as JSON gives them, and `show` shows or
// hides the overlay from the sketch. The message `instances` adds a batch of that many instance
// rows and turns on the shadows of the first directional light, the one that casts them, and of
// the box, then posts the shadow map's size and cascades.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, debug, page, quality }) => {
	const sun = scene.createDirectionalLight({ direction: [-1, -2, -1] });
	const box = scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#4e8ae8' }),
	});
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [2, 2, 3], target: [0, 0, 0] }));
	page.onMessage((name, data) => {
		if (name === 'show') debug.stats(data as boolean);
		if (name === 'figures') page.post('figures', JSON.parse(JSON.stringify(debug.frameStats())));
		if (name === 'instances') {
			sun.setCastShadows(true);
			box.setCastShadows(true);
			scene.createInstances(
				geometry.box({ width: 0.05, height: 0.05, depth: 0.05 }),
				data as number,
				{
					material: materials.standard({ color: '#e8a54e' }),
				},
			);
			const { shadowMapSize, shadowCascades } = quality.settings;
			page.post('instances', { shadowMapSize, shadowCascades });
		}
	});
	return {
		onUpdate() {
			debug.frameStats();
		},
	};
});
