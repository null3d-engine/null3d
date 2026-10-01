// The main directional light's shadows: a ground that receives them, and boxes, balls and tall
// posts that cast and receive them, from next to the camera out past 40 m, so each cascade holds
// some. The sun shines low across the scene, so the shadows are long. A box on the left receives
// shadows but casts none, a post on the right casts but receives none, and an unlit box shows no
// shadow on itself. ?cascades=<n> sets the cascade count, from 1 to 4.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The cascade count, from the sketch module's ?cascades switch. */
const CASCADES = Number(params.get('cascades') ?? 3);

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 5, 12],
		target: [0, 0, -4],
		far: 300,
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-1, -1.1, -0.6],
		intensity: 3,
		castShadows: true,
		shadow: { cascades: CASCADES, mapSize: 1024, distance: 60 },
	});
	scene.createAmbientLight({ intensity: 0.4 });

	const ground = materials.standard({ color: '#9aa0a8' });
	const red = materials.standard({ color: '#e8554e' });
	const yellow = materials.standard({ color: '#f2c14e' });
	const green = materials.standard({ color: '#5bc27a' });
	const blue = materials.standard({ color: '#4a8cff' });
	const unlit = materials.unlit({ color: '#b06ce0' });
	const box = geometry.box();
	const ball = geometry.sphere({ radius: 0.7 });
	const post = geometry.box({ width: 0.4, height: 6, depth: 0.4 });
	const both = { castShadows: true, receiveShadows: true };

	scene.createMesh({
		mesh: geometry.box({ width: 120, height: 0.2, depth: 120 }),
		material: ground,
		position: [0, -0.1, -40],
		receiveShadows: true,
	});
	// Near the camera: in the first cascade.
	scene.createMesh({ mesh: box, material: red, position: [1.5, 0.5, 4], ...both });
	scene.createMesh({ mesh: ball, material: yellow, position: [-1, 0.7, 5.5], ...both });
	// A box that receives shadows but casts none, beside the post that shades it.
	scene.createMesh({ mesh: box, material: green, position: [-3.5, 0.5, 1], receiveShadows: true });
	scene.createMesh({ mesh: post, material: blue, position: [-1.8, 3, 1.8], ...both });
	// A post that casts but receives none, and an unlit box in its shadow.
	scene.createMesh({ mesh: post, material: blue, position: [4, 3, -2], castShadows: true });
	scene.createMesh({ mesh: box, material: unlit, position: [2.2, 0.5, -2.6], ...both });
	// Farther out: in the later cascades.
	for (let k = 0; k < 6; k++) {
		const z = -8 - k * 7;
		const x = k % 2 === 0 ? -4 - k : 3 + k;
		scene.createMesh({ mesh: post, material: blue, position: [x, 3, z], ...both });
		scene.createMesh({ mesh: box, material: red, position: [x + 2, 0.5, z + 1], ...both });
	}
});
