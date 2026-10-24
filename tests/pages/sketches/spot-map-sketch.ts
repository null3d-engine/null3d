// A spot light that projects a picture over its cone: a white gobo with a dark cross and border,
// a red square above and a blue square below, over a floor and a back wall. A sphere stands in the
// beam, so the picture wraps over it. The light stands above and ahead of the camera's target and
// points down and away, so the map's top row runs up the wall. A dim ambient light keeps the rest
// of the scene just visible.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#0b0e12');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 4.2, 9],
		target: [0, 1.2, 0],
		far: 60,
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 0.06 });
	scene.createSpotLight({
		position: [0, 7, 2],
		target: [0, 0, -2],
		color: '#ffffff',
		intensity: 120,
		range: 26,
		angle: 0.6,
		penumbra: 0.15,
		map: gobo(),
	});

	const floor = materials.standard({ color: '#b9bec6', roughness: 0.85 });
	const wall = materials.standard({ color: '#a8adb5', roughness: 0.9 });
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 24, height: 24 }),
		material: floor,
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	scene.createMesh({
		mesh: geometry.plane({ width: 24, height: 12 }),
		material: wall,
		position: [0, 6, -4],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1.1 }),
		material: materials.standard({ color: '#d9dde3', roughness: 0.5 }),
		position: [0.6, 1.1, 0.6],
	});
});

/**
 * A gobo of 32 x 32 pixels: white, with a dark cross through the middle and a dark border, a red
 * square in the upper left quarter and a blue square in the lower right one.
 */
function gobo() {
	const size = 32;
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < size * size; i++) {
		const [x, y] = [i % size, i >> 5];
		const border = x < 2 || y < 2 || x > size - 3 || y > size - 3;
		const cross = Math.abs(x - size / 2) < 1.5 || Math.abs(y - size / 2) < 1.5;
		const red = !border && !cross && x > 4 && x < size / 2 - 2 && y > 4 && y < size / 2 - 2;
		const blue =
			!border && !cross && x > size / 2 + 2 && x < size - 5 && y > size / 2 + 2 && y < size - 5;
		const color: [number, number, number] = red
			? [240, 60, 50]
			: blue
				? [60, 110, 240]
				: border || cross
					? [8, 8, 8]
					: [255, 255, 255];
		data.set([...color, 255], i * 4);
	}
	return { width: size, height: size, data };
}
