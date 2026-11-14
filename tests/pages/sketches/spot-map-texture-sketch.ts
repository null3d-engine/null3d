// The spot-map-probe scene with the same picture given as an engine texture instead of pixels:
// a 256 pixel grid of squares, made in a canvas and decoded into a texture. The frame copies the
// texture into the light's image once its texels are on the GPU, so the picture must draw as the
// pixel form does: the reference is the `spot-map-probe` picture. A wrong corner, a wrong row
// order or a missing copy shows at once. The probe arrives after the picture, as in that test, so
// the copy must follow the picture to its new layer.

import type { Textures } from '@null3d/engine';
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ scene, materials, geometry, textures }) => {
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
		map: await gridTexture(textures),
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
	// The probe arrives once the picture is set, so the layers that follow the probes' move, and
	// the engine must move the picture's copy and its light's record with them.
	await scene.imagesSettled();
	scene.createReflectionProbe({
		box: { min: [-6, 0, -3], max: [6, 6, 6] },
		position: [0, 1.5, 0],
		blend: 1,
	});
});

/**
 * A texture of the 256 x 256 grid that `spot-map-probe-sketch.ts` draws as pixels: white with dark
 * lines, a red square in the upper left quarter and a blue one in the lower right. The rows turn
 * over as they decode, so the picture stands upright on the light as the pixel form does.
 */
async function gridTexture(textures: Textures) {
	const size = 256;
	const step = 32;
	const canvas = new OffscreenCanvas(size, size);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the picture canvas has no 2D context');
	const image = context.createImageData(size, size);
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
			image.data.set([...color, 255], (y * size + x) * 4);
		}
	}
	context.putImageData(image, 0, 0);
	const bitmap = await createImageBitmap(canvas, { imageOrientation: 'flipY' });
	return textures.fromImageBitmap(bitmap);
}
