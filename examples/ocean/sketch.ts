// Ocean: an open sea whose waves come from three bands of spectra, transformed on the GPU and read
// by one surface material. The camera circles above the swell, so the long waves, the chop that the
// transform adds and the sky's mirror in the slopes all move through the picture.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createOcean } from '@null3d/water';
import { interact } from '../lib/interact';

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time } = ctx;
	const day = timeOfDay(15.4, { heading: -2 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.0012, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, vignette: {} });
	scene.createDirectionalLight({ ...day.light });
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 4000,
		position: [0, 14, 52],
		target: [0, 2, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 2, 0] });
	const ocean = createOcean(ctx, { camera });
	return {
		onUpdate(dt) {
			const angle = time.now * 0.06;
			if (!view.userCamera) {
				camera.setPosition(
					Math.cos(angle) * 56,
					12 + 4 * Math.sin(time.now * 0.21),
					Math.sin(angle) * 56,
				);
				camera.lookAt(0, 2, 0);
			}
			view.update(dt);
			ocean.update();
		},
	};
});
