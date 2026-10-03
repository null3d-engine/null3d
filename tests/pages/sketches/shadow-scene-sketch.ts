// A still scene for the shadow checks: a camera 6 m up over a ground with a long wall, posts
// and boxes in the sun. The wall runs away from the camera, and the sun throws its shadow to the
// side, so the shadow's far edge is one long straight line through the near and middle distance,
// at a slant to the cascades' texels. The edge check measures its steps. The posts and boxes give
// shorter edges.
import { defineSketch } from '@null3d/engine';
import { SHADOW_SCENE } from '../lib/shadow-check';

export default defineSketch(({ scene, materials, geometry, quality }) => {
	quality.set({ shadowFilter: 3, farCascadeInterval: 1 });
	scene.setBackground('#101418');
	const { position, target, fov } = SHADOW_SCENE.camera;
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov, near: 0.1, far: 300, position, target }),
	);
	scene.createDirectionalLight({
		direction: SHADOW_SCENE.sun,
		intensity: 3,
		castShadows: true,
		shadow: SHADOW_SCENE.shadow,
	});
	scene.createAmbientLight({ intensity: 0.5 });
	const both = { castShadows: true, receiveShadows: true };
	scene.createMesh({
		mesh: geometry.box({ width: 200, height: 0.2, depth: 200 }),
		material: materials.standard({ color: '#9aa0a8' }),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	const { center, length, height, yawDegrees } = SHADOW_SCENE.wall;
	const yaw = (yawDegrees * Math.PI) / 360;
	scene.createMesh({
		mesh: geometry.box({ width: 0.3, height, depth: length }),
		material: materials.standard({ color: '#c9b79c' }),
		position: [center[0], height / 2, center[1]],
		rotation: [0, Math.sin(yaw), 0, Math.cos(yaw)],
		...both,
	});
	const post = geometry.box({ width: 0.4, height: 3, depth: 0.4 });
	const box = geometry.box({ width: 1.2, height: 1.2, depth: 1.2 });
	const blue = materials.standard({ color: '#4a8cff' });
	const red = materials.standard({ color: '#e8554e' });
	for (let k = 0; k < 6; k++) {
		const across = -13 + k * 1.8;
		const ahead = -4 - (k % 3) * 9;
		scene.createMesh({ mesh: post, material: blue, position: [across, 1.5, ahead], ...both });
		scene.createMesh({
			mesh: box,
			material: red,
			position: [across + 1, 0.6, ahead + 2.5],
			...both,
		});
	}
});
