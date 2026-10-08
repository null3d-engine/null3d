// Environment light: rows of spheres, from rough to smooth, in plastic and in metal, lit only by an
// environment map. Every 4 seconds the scene takes the next of three environments: a sunset from a
// Radiance .hdr file and a studio from an OpenEXR file, both filtered on the GPU as they load, and the
// built-in room, which the GPU makes with no file. The background shows each environment, blurred,
// and both turn slowly together. setEnvironment and setBackground allocate nothing, so they can
// change every frame.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** Seconds that each environment shows. */
const STEP = 4;
/** Spheres in each row, from roughness 0 to 1. */
const COLUMNS = 6;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, time } = ctx;
	const [sunset, studio, room] = await Promise.all([
		assets.loadEnvironment(sampleUrl('sources/hdri/polyhaven/venice_sunset/venice_sunset_2k.hdr')),
		assets.loadEnvironment(
			sampleUrl('sources/hdri/polyhaven/studio_small_09/studio_small_09_1k.exr'),
		),
		assets.builtinEnvironment('room'),
	]);
	const environments = [sunset, studio, room];
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		position: [0, 0.4, 6.8],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, 0], minDistance: 4, maxDistance: 16 });

	const sphere = geometry.sphere({ radius: 0.42, widthSegments: 48, heightSegments: 24 });
	const rows = [
		{ color: '#d8d8d8', metalness: 0, y: 0.55 },
		{ color: '#e8c06a', metalness: 1, y: -0.55 },
	];
	for (const { color, metalness, y } of rows) {
		for (let k = 0; k < COLUMNS; k++) {
			scene.createMesh({
				mesh: sphere,
				material: materials.standard({ color, metalness, roughness: k / (COLUMNS - 1) }),
				position: [(k - (COLUMNS - 1) / 2) * 1.05, y, 0],
			});
		}
	}

	// One options object for both calls, changed in place each frame.
	const rotation: [number, number, number] = [0, 0, 0];
	const display = { blur: 0.1, rotation };
	return {
		onUpdate(dt) {
			rotation[1] = time.now * 0.15;
			const environment = environments[Math.floor(time.now / STEP) % environments.length] ?? room;
			scene.setEnvironment(environment, display);
			scene.setBackground(environment, display);
			view.update(dt);
		},
	};
});
