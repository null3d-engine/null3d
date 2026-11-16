// Near grass shadows at a low sun: the hill of tufts casts into the near cascades, and its shadow
// follows the count that the blade list writes. The page draws the same hill as the still picture,
// with the sun low and the air still, so two runs draw the same frame.
import { defineSketch } from '@null3d/engine';
import { createGrass } from '@null3d/vegetation';
import { createWind } from '@null3d/wind';
import { GRASS, ground, SIZE } from './vegetation-grass-sketch';

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials } = ctx;
	scene.setBackground('#b7cde0');
	scene.createAmbientLight({ intensity: 0.35, color: '#cfe0ff' });
	// A sun low over the shoulder of the hill, so every tuft throws a long shadow toward the camera.
	scene.createDirectionalLight({
		direction: [-0.9, -0.34, -0.2],
		intensity: 3.2,
		color: '#ffe6bd',
		castShadows: true,
	});
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 200,
		position: [6, 3.4, 16],
	});
	camera.lookAt(0, 1.2, 0);
	scene.setActiveCamera(camera);
	scene.createMesh({
		mesh: geometry.fromArrays(ground(SIZE, 48)),
		material: materials.standard({ color: '#6f7f45', roughness: 0.95 }),
		castShadows: false,
		receiveShadows: true,
	});
	// The same still field as the other picture: the blades do not move, so the shadows are still.
	const wind = createWind(ctx, {
		camera,
		box: 128,
		grid: 64,
		air: { speed: 0, gustStrength: 0, swirl: 0 },
	});
	const grass = await createGrass(ctx, {
		...GRASS,
		wind: wind.field,
		camera,
		// The near cascades hold the hill; the blades past this distance stand still.
		swayDistance: 32,
	});
	ctx.quality.onChange(() => grass.fit(ctx.quality.preset));
	return {
		onUpdate() {
			wind.update();
			grass.setWindLayer(wind.field);
		},
	};
});
