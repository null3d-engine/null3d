// Boxes whose render scale the page moves during play. On the page's 'scales' message, the sketch
// fixes the render scale at each of the given scales in turn, one per frame, then posts the scale
// that the engine drew each of those frames at. ?bloom turns bloom on, with every pixel glowing.
import { defineSketch } from '@null3d/engine';

const BLOOM = new URL(import.meta.url).searchParams.has('bloom');

export default defineSketch(({ scene, materials, geometry, page, quality, post }) => {
	if (BLOOM) post.set({ bloom: { threshold: 0 } });
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 100,
		position: [0, 3, 8],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	const box = geometry.box();
	const red = materials.standard({ color: '#e8554e' });
	for (let x = -3; x <= 3; x += 1.5)
		scene.createMesh({ mesh: box, material: red, position: [x, 0, 0] });

	const queue: number[] = [];
	const drawn: number[] = [];
	page.onMessage((name, data) => {
		if (name === 'scales') queue.push(...(data as number[]));
	});
	return {
		onUpdate() {
			const next = queue.shift();
			if (next === undefined) return;
			// A new range applies to the frame being drawn.
			quality.set({ minRenderScale: next, maxRenderScale: next });
			drawn.push(quality.renderScale);
			if (queue.length === 0) page.post('drawn', drawn.splice(0));
		},
	};
});
