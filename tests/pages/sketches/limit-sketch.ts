// Creates instance batches of the size the page asks for and reports what happened. Every row sits
// out of view except the last, so a box on screen shows that the last row draws. Also makes a mesh
// of as many vertices as the page asks for, with normals to compute, and reports what happened.
import { defineSketch, type EngineError, type InstanceBatch } from '@null3d/engine';

/** Where rows go to stay out of view. */
const AWAY = 1000;

export default defineSketch(({ scene, materials, geometry, page }) => {
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({ position: [0, 0, 4], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const box = geometry.box();
	const white = materials.unlit({ color: '#ffffff' });
	let batch: InstanceBatch | undefined;

	page.onMessage((name, data) => {
		if (name === 'destroy') {
			batch?.destroy();
			batch = undefined;
			page.post('destroyed');
		}
		if (name === 'mesh') {
			try {
				geometry.fromArrays({
					positions: new Float32Array((data as number) * 3),
					computeNormals: true,
				});
				page.post('mesh', { ok: true });
			} catch (e) {
				const error = e as EngineError;
				page.post('mesh', { ok: false, code: error.code, message: error.message });
			}
			return;
		}
		if (name !== 'batch') return;
		const count = data as number;
		try {
			batch = scene.createInstances(box, count, { material: white });
			const positions = batch.positions;
			for (let row = 0; row < count - 1; row++) positions[row * 3] = AWAY;
			batch.markDirty();
			page.post('batch', { ok: true });
		} catch (e) {
			const error = e as EngineError;
			page.post('batch', { ok: false, code: error.code, message: error.message });
		}
	});
	return {};
});
