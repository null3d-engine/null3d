// Decals: flat planes that lie exactly on a wall and on the floor, split into other triangles than
// the surfaces under them. Without a bias their depths differ by rounding alone, so they would
// fight with the surfaces pixel by pixel. A depth bias toward the camera, as three.js's negative
// polygon offset gives, makes every decal pixel win. The floor decal is seen at a grazing angle,
// where the slope scale does most of the work.
import { defineSketch } from '@null3d/engine';

const DECAL_BIAS = { constant: -4, slopeScale: -4 } as const;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#101418');
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [3, 1.2, 5], target: [0, 0.8, -1] }),
	);

	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.2, depth: 8 }),
		material: materials.standard({ color: '#8a8f99' }),
		position: [0, -0.1, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 6, height: 3, depth: 0.2 }),
		material: materials.standard({ color: '#4a8cff' }),
		position: [0, 1.5, -1],
	});

	const decal = (color: string, lit: boolean) =>
		lit
			? materials.standard({ color, depthBias: DECAL_BIAS })
			: materials.unlit({ color, depthBias: DECAL_BIAS });
	// On the wall's front face, which lies at z = -0.9.
	scene.createMesh({
		mesh: geometry.plane({ width: 2, height: 1.2, widthSegments: 3, heightSegments: 2 }),
		material: decal('#e8554e', true),
		position: [-1, 1.4, -0.9],
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 0.8, height: 0.8 }),
		material: decal('#f2c14e', false),
		position: [1.4, 2, -0.9],
	});
	// On the floor's top face, which lies at y = 0, seen almost edge on.
	const floorDecal = scene.createMesh({
		mesh: geometry.plane({ width: 3, height: 2, widthSegments: 5, heightSegments: 3 }),
		material: decal('#5bc27a', true),
		position: [0.5, 0, 1.2],
	});
	floorDecal.setRotationEuler(-Math.PI / 2, 0, 0);
	return {};
});
