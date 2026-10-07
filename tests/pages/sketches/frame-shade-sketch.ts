// A sketch whose background shade follows its frame, in steps that cycle every few frames, so two
// captures of different frames that close together differ in every pixel.
import { defineSketch } from '@null3d/engine';

/** The shades the background cycles through, one per frame. */
const SHADES = 16;

export default defineSketch(({ scene, time, quality }) => {
	quality.set({ minRenderScale: 1 });
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 10 });
	scene.setActiveCamera(camera);
	const shade = () => 0.05 + (0.75 * (time.frame % SHADES)) / SHADES;
	scene.setBackground([shade(), shade(), shade()]);
	return {
		onUpdate() {
			const level = shade();
			scene.setBackground([level, level, level]);
		},
	};
});
