// The add-on's ocean page: an open sea under the sun, with the camera circling slowly, because the
// engine rests a still view and the check's cost gate measures the frames that a running page draws.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createOcean } from '../src/index.ts';

export default defineSketch((ctx) => {
	const { scene, post, time } = ctx;
	const day = timeOfDay(15, { heading: -2 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.0012, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, vignette: {} });
	scene.createAmbientLight({ color: '#cfe0ee', intensity: 0.4 });
	scene.createDirectionalLight({ ...day.light });
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 4000,
		position: [0, 12, 48],
		target: [0, 2, 0],
	});
	scene.setActiveCamera(camera);
	const ocean = createOcean(ctx, { camera });
	return {
		onUpdate() {
			const angle = time.now * 0.12;
			camera.setPosition(Math.cos(angle) * 52, 11, Math.sin(angle) * 52);
			camera.lookAt(0, 1, 0);
			ocean.update();
		},
	};
});
