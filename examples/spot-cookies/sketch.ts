// Spot-light cookies: two lamps throw pictures over their cones in a dark stone hall. One projects
// a rose window of stained glass across the back wall, its lead lines fine because the picture
// keeps its detail up to 512 texels a side. The other throws a lit window frame across the floor.
// The plinths and spheres stand in the beam, so the picture wraps over them. The polished floor
// shows the pictures back, and the haze catches the light in the air.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';
import { roseWindow, windowFrame } from './pictures';

/** Where the camera looks. */
const TARGET = [0, 3.2, -6] as const;

export default defineSketch((ctx) => {
	const { scene, materials, geometry, post } = ctx;
	scene.setBackground('#05060a');
	scene.setFog({
		color: '#0a0c12',
		density: 0.02,
		volumetric: { intensity: 0.35, anisotropy: 0.35, distance: 40 },
	});
	post.set({ exposure: 1, bloom: { intensity: 0.25, threshold: 1 }, ao: { radius: 0.6 } });
	const camera = scene.createPerspectiveCamera({ fov: 45, position: [0, 2.4, 6], near: 0.1 });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	interact(ctx, camera, { target: TARGET, groundY: 0 });

	// The hall: a polished stone floor, a tall back wall and a side wall, in warm greys.
	const floorStone = materials.standard({ color: '#6a655f', roughness: 0.15, metalness: 0.15 });
	const plaster = materials.standard({ color: '#9a948a', roughness: 0.95 });
	const floor = scene.createMesh({
		mesh: geometry.plane({ width: 44, height: 44 }),
		material: floorStone,
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	scene.createMesh({
		mesh: geometry.plane({ width: 24, height: 14 }),
		material: plaster,
		position: [0, 7, -6],
	});
	const side = scene.createMesh({
		mesh: geometry.plane({ width: 28, height: 16 }),
		material: plaster,
		position: [-10, 8, 4],
	});
	side.setRotationEuler(0, Math.PI / 2, 0);

	// Three plinths with pale busts stand in the beam, so the picture climbs over them.
	const bust = materials.standard({ color: '#d6cfc2', roughness: 0.35, metalness: 0.1 });
	const pedestal = materials.standard({ color: '#6b665f', roughness: 0.8 });
	for (const [x, height, radius] of [
		[-2.6, 0.9, 0.7],
		[0, 1.4, 0.9],
		[2.6, 0.9, 0.7],
	] as const) {
		scene.createMesh({
			mesh: geometry.box({ width: 1.3, height, depth: 1.3 }),
			material: pedestal,
			position: [x, height / 2, -2],
		});
		scene.createMesh({
			mesh: geometry.sphere({ radius, widthSegments: 48, heightSegments: 32 }),
			material: bust,
			position: [x, height + radius * 0.8, -2],
		});
	}

	// The cookies: the rose window on the wall, and the window frame across the floor.
	scene.createSpotLight({
		position: [0, 7.5, 1],
		target: [0, 3.2, -6],
		color: '#ffffff',
		intensity: 900,
		range: 40,
		angle: 0.5,
		penumbra: 0.05,
		castShadows: true,
		map: roseWindow(512),
	});
	scene.createSpotLight({
		position: [-7, 5, 3],
		target: [-2, 0, -1],
		color: '#ffe6c4',
		intensity: 200,
		range: 24,
		angle: 0.36,
		penumbra: 0.3,
		map: windowFrame(128),
	});
	scene.createAmbientLight({ intensity: 0.02, color: '#7d8ba8' });
	// The floor's probe makes the polished stone show the pictures back. It comes after the lights,
	// so the engine moves their pictures to the layers that the probe's map leaves them.
	scene.createReflectionProbe({
		box: { min: [-10, 0, -6], max: [10, 9, 9] },
		position: [0, 1.6, 0],
		blend: 1.5,
	});
});
