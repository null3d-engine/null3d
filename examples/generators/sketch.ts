// Geometry generators: the nine shapes that geometry makes, with the parameters of three.js's
// geometry classes. Each shape turns back and forth, or toward the pointer while it points. The flat
// shapes face +Z and draw only their front faces, so none turns far enough to show its back.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#15191f');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 0.8, 8.5],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane in front of the shapes.
	const view = interact(ctx, camera, { target: [0, 0, 0], planeZ: 3 });
	scene.createDirectionalLight({ direction: [-1, -1.5, -2], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });

	// In reading order: the solids, then the round solids, then the flat shapes.
	const shapes = [
		geometry.box({ width: 1.2, height: 1.2, depth: 1.2 }),
		geometry.sphere({ radius: 0.75 }),
		geometry.torus({ radius: 0.55, tube: 0.22 }),
		geometry.cylinder({ radiusTop: 0.5, radiusBottom: 0.6, height: 1.4 }),
		geometry.cone({ radius: 0.7, height: 1.5 }),
		geometry.capsule({ radius: 0.4, height: 0.8 }),
		geometry.plane({ width: 1.4, height: 1.4 }),
		geometry.circle({ radius: 0.75 }),
		geometry.ring({ innerRadius: 0.35, outerRadius: 0.75 }),
	];
	const colors = [
		'#e8554e',
		'#f2a93b',
		'#f2c14e',
		'#5bc27a',
		'#3fb8af',
		'#4a8cff',
		'#7c6cf2',
		'#c77dff',
		'#e86fae',
	];
	const meshes = shapes.map((mesh, i) =>
		scene.createMesh({
			mesh,
			material: materials.standard({ color: colors[i] }),
			position: [((i % 3) - 1) * 2.6, (1 - Math.floor(i / 3)) * 2.2, 0],
			dynamic: true,
		}),
	);

	return {
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			for (let i = 0; i < meshes.length; i++) {
				// From the shape's place to the pointed point: the turns that face its front there.
				const dx = point[0] - ((i % 3) - 1) * 2.6;
				const dy = point[1] - (1 - Math.floor(i / 3)) * 2.2;
				const tilt = math.lerp(0.35, -Math.atan2(dy, Math.hypot(dx, point[2])), steering);
				const turn = math.lerp(Math.sin(time.now + i * 0.7), Math.atan2(dx, point[2]), steering);
				meshes[i].setRotationEuler(tilt, turn, 0);
			}
		},
	};
});
