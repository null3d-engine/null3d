// A mirror sphere and a rough white sphere, lit by the sky's environment, under a sky with no
// clouds and a sun high in the sky. The page's 'move' message moves the sun low behind the camera,
// where the mirror's middle and the rough sphere's front face it. Four small squares in the bottom left corner count the frames since the
// move, from 0 to 15 in binary, white for 1 and black for 0, and stay at 15 after. Before the move,
// a fifth square stays black; from the move's frame on it is white. So each captured frame tells
// how many frames have passed since the move, and the test reads the spheres' light in it.
import { defineSketch } from '@null3d/engine';

const NOON: [number, number, number] = [0, 1, -0.3];
const SUNSET: [number, number, number] = [0, 0.05, 1];

export default defineSketch(async ({ scene, assets, geometry, materials, post, page, quality }) => {
	quality.set({ minRenderScale: 1 });
	post.set({ toneMapping: 'none' });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 0, 6], target: [0, 0, 0] }),
	);
	const sky = { sunPosition: NOON, cloudCoverage: 0, showSunDisc: false };
	const background = { sky };
	scene.setBackground(background);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.2 });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 64, heightSegments: 32 });
	const mirror = materials.standard({ color: '#ffffff', metalness: 1, roughness: 0 });
	const rough = materials.standard({ color: '#ffffff', metalness: 0, roughness: 1 });
	scene.createMesh({ mesh: sphere, material: mirror, position: [-1.2, 0, 0] });
	scene.createMesh({ mesh: sphere, material: rough, position: [1.2, 0, 0] });
	// The squares, in the bottom left corner, black or white.
	const square = geometry.plane({ width: 0.12, height: 0.12 });
	const black = materials.unlit({ color: '#000000' });
	const white = materials.unlit({ color: '#ffffff' });
	const bits = [0, 1, 2, 3, 4].map((k) =>
		scene.createMesh({ mesh: square, material: black, position: [-1.6 + 0.16 * k, -1.3, 2] }),
	);
	let since = -1;
	page.onMessage((name) => {
		if (name === 'move' && since < 0) since = 0;
	});
	return {
		onUpdate() {
			if (since < 0) return;
			if (since === 0) {
				sky.sunPosition = SUNSET;
				scene.setBackground(background);
			}
			const count = Math.min(since, 15);
			for (let k = 0; k < 4; k++) bits[k]?.setMaterial((count >> k) & 1 ? white : black);
			bits[4]?.setMaterial(white);
			since++;
		},
	};
});
