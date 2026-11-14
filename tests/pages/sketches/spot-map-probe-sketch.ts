// A spot light that projects a large picture over its cone, over a polished floor and a back
// wall, with a reflection probe made after the picture is in the light tables. The probe's map
// takes the layers before the pictures', so the probe moves every picture along the array: the
// light's record and the picture's texels must move with it. A picture that stays behind reads a
// probe's map, or an empty layer, and the picture breaks. The picture is a 256 pixel grid of
// squares, so a wrong layer shows at once. `imagesSettled` puts the picture in the tables before
// the probe arrives, which a run that made the probe first would not do.
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, materials, geometry }) => {
	scene.setBackground('#0b0e12');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 3.4, 8],
		target: [0, 3.4, -3],
		far: 60,
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 0.06 });
	scene.createSpotLight({
		position: [0, 6.5, 2],
		target: [0, 3.4, -3],
		color: '#ffffff',
		intensity: 260,
		range: 26,
		angle: 0.5,
		penumbra: 0.1,
		map: grid(),
	});

	const floor = materials.standard({ color: '#b9bec6', roughness: 0.5 });
	const wall = materials.standard({ color: '#a8adb5', roughness: 0.9 });
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 24, height: 24 }),
		material: floor,
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	scene.createMesh({
		mesh: geometry.plane({ width: 20, height: 12 }),
		material: wall,
		position: [0, 6, -3],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.9 }),
		material: materials.standard({ color: '#d9dde3', roughness: 0.5 }),
		position: [0.5, 0.9, 0.5],
	});
	// The probe arrives once the picture is in the tables, so the layers that follow the probes'
	// move, and the engine must move the picture and its light's record with them.
	await scene.imagesSettled();
	scene.createReflectionProbe({
		box: { min: [-6, 0, -3], max: [6, 6, 6] },
		position: [0, 1.5, 0],
		blend: 1,
	});
});

/**
 * A picture of 256 x 256 pixels: a white grid of dark lines, with a red square in the upper left
 * quarter and a blue square in the lower right one.
 */
function grid() {
	const size = 256;
	const step = 32;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const line = x % step === 0 || y % step === 0;
			const red = x > 40 && x < 100 && y > 40 && y < 100;
			const blue = x > 156 && x < 216 && y > 156 && y < 216;
			const color: [number, number, number] = red
				? [236, 70, 58]
				: blue
					? [64, 116, 236]
					: line
						? [24, 24, 28]
						: [250, 250, 250];
			data.set([...color, 255], (y * size + x) * 4);
		}
	}
	return { width: size, height: size, data };
}
