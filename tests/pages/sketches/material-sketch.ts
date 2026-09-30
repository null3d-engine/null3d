// An unlit box that fills the view, so every pixel shows its material's color. When the page sends
// options, the sketch passes them to the material's set call, then answers.
import { defineSketch, type MaterialOptions } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 0, 3], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const paint = materials.unlit({ color: '#ff0000' });
	scene.createMesh({ mesh: geometry.box({ width: 20, height: 20, depth: 0.1 }), material: paint });
	page.onMessage((name, data) => {
		if (name !== 'set') return;
		paint.set(data as MaterialOptions);
		page.post('set');
	});
	return {};
});
