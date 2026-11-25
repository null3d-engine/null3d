// The sketch module, in the sketch worker: a product viewer. A vase and an ornament stand on a
// turntable, lit by a soft studio room and one shadow-casting light. The user orbits the camera,
// which turns by itself until the first drag.
import { createOrbitControls } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';
import { lathe, torusKnot } from '@null3d/geometry';

/** The vase's profile: points (distance from the axis, height), from the foot to the lip. */
const VASE: [number, number][] = [
	[0, 0],
	[0.28, 0],
	[0.3, 0.04],
	[0.42, 0.3],
	[0.45, 0.55],
	[0.34, 0.85],
	[0.2, 1.05],
	[0.19, 1.2],
	[0.24, 1.26],
	[0.21, 1.27],
	[0.16, 1.2],
	[0, 1.2],
];

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, assets, post } = ctx;

	// Product shots keep base colors true to the material, so the Neutral tone curve.
	post.set({ toneMapping: 'neutral', exposure: 1 });
	scene.setBackground('#1c1e22');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.9 });
	scene.createDirectionalLight({
		direction: [-0.6, -2, -0.8],
		intensity: 2.5,
		castShadows: true,
		shadow: { distance: 6 },
	});

	const camera = scene.createPerspectiveCamera({ fov: 35, position: [2.6, 1.6, 3.4] });
	scene.setActiveCamera(camera);
	const controls = createOrbitControls(ctx, camera, {
		target: [0, 0.7, 0],
		enableDamping: true,
		minDistance: 2,
		maxDistance: 7,
		maxPolarAngle: Math.PI * 0.47,
		enablePan: false,
		autoRotate: true,
		autoRotateSpeed: 0.6,
	});

	// Glazed ceramic: a colored base under a glossy clear coat.
	const glaze = materials.standard({
		color: '#2f6f8f',
		roughness: 0.55,
		clearcoat: 1,
		clearcoatRoughness: 0.08,
	});
	// Polished gold: a metal takes its color from the reflections.
	const gold = materials.standard({ color: '#e2b552', metalness: 1, roughness: 0.22 });
	// Oiled wood and a soft felt top for the turntable.
	const wood = materials.standard({ color: '#5a3a24', roughness: 0.6, clearcoat: 0.3 });
	const felt = materials.standard({ color: '#3a3d44', roughness: 1, sheenColor: '#8a8f99' });

	scene.createMesh({
		mesh: geometry.fromArrays(lathe({ points: VASE, segments: 96 })),
		material: glaze,
		position: [-0.35, 0.08, 0],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.fromArrays(torusKnot({ radius: 0.22, tube: 0.06, tubularSegments: 160 })),
		material: gold,
		position: [0.55, 0.42, 0.15],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 1.1,
			radiusBottom: 1.15,
			height: 0.06,
			radialSegments: 96,
		}),
		material: wood,
		position: [0, 0.03, 0],
		castShadows: true,
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.cylinder({
			radiusTop: 1.02,
			radiusBottom: 1.02,
			height: 0.02,
			radialSegments: 96,
		}),
		material: felt,
		position: [0, 0.07, 0],
		receiveShadows: true,
	});
	// The floor shows only the shadows that fall on it, so the product seems to float in the room.
	scene.createMesh({
		mesh: geometry.circle({ radius: 4, segments: 64 }),
		material: materials.shadowCatcher({ opacity: 0.5 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	return {
		onUpdate(dt) {
			controls.update(dt);
		},
	};
});
