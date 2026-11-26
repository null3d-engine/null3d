// A small lit scene, as a plain page starts: a sun that casts shadows, a ground and a few boxes,
// at the quality preset's own range of render scales. Its first frame builds the pipelines of such
// a page, which the start timings count. Like the empty sketch, it counts its updates and its
// largest step, reports them when the page asks, and sends a message during setup.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry, page, time }) => {
	let updates = 0;
	let largestStep = 0;
	page.post('setup');
	page.onMessage((name) => {
		if (name === 'count')
			page.post('count', { updates, largestStep, frame: time.frame, now: time.now });
	});
	scene.setBackground('#8fb4d8');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [6, 4, 8],
		target: [0, 0.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.3 });
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 2, castShadows: true });
	const shadowed = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#9a958c', roughness: 0.85 }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const paint = materials.standard({ color: '#4a8cff', roughness: 0.5 });
	for (const [x, z] of [
		[-2, 0],
		[0, 1],
		[2, -1],
	] as const)
		scene.createMesh({ mesh: box, material: paint, position: [x, 0.5, z], ...shadowed });
	return {
		onUpdate(dt) {
			updates++;
			largestStep = Math.max(largestStep, dt);
		},
	};
});
