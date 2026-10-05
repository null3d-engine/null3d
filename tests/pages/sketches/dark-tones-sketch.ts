// Dark tones, where an 8-bit canvas shows bands first. With ?vignette, a strong vignette over a flat
// dark background: its corners fall smoothly to black, and the dither must stay one step deep
// there, after the vignette. With ?gradient, one point light over a dark floor, with no other
// light: its falloff is a long dark gradient, where a scene color of few mantissa bits would band.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** The flat background under the vignette: a dark slate blue. */
const DARK_BACKGROUND = '#28323c';
/** A vignette that darkens the corners to black, in a circle. */
const DARK_VIGNETTE = { intensity: 1, size: 1.6, roundness: 1 } as const;

export default defineSketch(({ scene, materials, geometry, post }) => {
	const vignette = params.has('vignette');
	scene.setBackground(vignette ? DARK_BACKGROUND : '#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 6, 6],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	if (vignette) {
		post.set({ vignette: DARK_VIGNETTE });
		return;
	}
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 40, height: 40 }),
		material: materials.standard({ color: '#808080', roughness: 1 }),
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	scene.createPointLight({
		position: [0, 2.5, 0],
		color: '#ffffff',
		intensity: 4,
		range: 30,
		decay: 2,
	});
});
