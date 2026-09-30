// A small static scene: lit and unlit meshes, a hierarchy, and an instance batch, lit by a sun
// and ambient light. The scene test captures it and compares it with a reference image. ?scale=
// draws it at that render scale, with a range that reaches down to 0.5, so the final pass scales the
// image up on every GPU path, even the 8-bit one.
import { defineSketch } from '@null3d/engine';

/** The render scale, from the sketch module's ?scale= switch, or none to keep the preset's range. */
const SCALE = new URL(import.meta.url).searchParams.get('scale');

export default defineSketch(({ scene, materials, geometry, page, quality, time }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: Math.min(scale, 0.5), maxRenderScale: scale });
	}
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 100,
		position: [0, 4, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const ball = geometry.sphere({ radius: 0.6 });
	const red = materials.standard({ color: '#e8554e' });
	const blue = materials.unlit({ color: '#4a8cff' });
	const green = materials.standard({ color: '#5bc27a' });

	const group = scene.createGroup({ position: [-3, 0, 0], name: 'left' });
	scene.createMesh({ mesh: box, material: red, parent: group, name: 'box' });
	scene.createMesh({ mesh: ball, material: red, parent: group, position: [0, 1.5, 0] });
	scene.createMesh({ mesh: box, material: blue, position: [3, 0, 0], name: 'unlit' });

	const floor = scene.createInstances(box, 25, { material: green });
	for (let i = 0; i < 25; i++) {
		floor.positions.set([((i % 5) - 2) * 1.2, -1.5, (Math.floor(i / 5) - 2) * 1.2], i * 3);
		floor.scales.set([1, 0.2, 1], i * 3);
	}
	floor.markDirty();

	page.onMessage((name) => {
		if (name === 'frame') page.post('frame', time.frame);
	});
	return {};
});
