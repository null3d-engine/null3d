// A glTF model: the Khronos BoomBox, with its base color, normal, occlusion, roughness, metalness and
// emissive maps, lit by the built-in room environment, as three.js's glTF viewer examples light
// their models. assets.loadGltf reads the file into a prefab, and scene.instantiate places a copy
// of it in one batch of changes. The prefab's bounds scale the 2 cm model up to a size the camera
// frames. The camera circles the model by itself until the user's first drag, scroll or pinch.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { sampleUrl } from '../lib/samples';

/** The model's radius after scaling, in meters. */
const RADIUS = 1;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials } = ctx;
	scene.setBackground('#2b2f36');
	const [room, boombox] = await Promise.all([
		assets.builtinEnvironment('room'),
		assets.loadGltf(sampleUrl('sources/khronos/BoomBox/glTF-Binary/BoomBox.glb')),
	]);
	scene.setEnvironment(room);

	// Scale the model about its center, and stand it on a plinth at the origin.
	const { center, radius, min } = boombox.bounds;
	const size = RADIUS / radius;
	const lift = (center[1] - min[1]) * size;
	scene.instantiate(boombox, {
		position: [-center[0] * size, -min[1] * size, -center[2] * size],
		scale: [size, size, size],
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 1.4, radiusBottom: 1.5, height: 0.2, radialSegments: 64 }),
		material: materials.standard({ color: '#6d6a66', roughness: 0.4 }),
		position: [0, -0.1, 0],
	});

	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.05,
		far: 50,
		position: [1.6, lift + 0.7, 2.3],
		target: [0, lift, 0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, {
		target: [0, lift, 0],
		autoRotate: true,
		autoRotateSpeed: 1.5,
		minDistance: 1.2,
		maxDistance: 8,
	});
	return {
		onUpdate(dt) {
			view.update(dt);
		},
	};
});
