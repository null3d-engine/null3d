// The nine geometry generators, for the image test of the generators, in a grid of three by three.
// Each shape draws twice: lit on the left, and with its texture coordinates as colors on the right,
// so a wrong normal shows as wrong shading and a wrong texture coordinate as a wrong color. Some
// shapes take arguments besides their defaults: extra segments, a cone of fewer faces, a circle
// with a slice cut out, and a ring of three rows.
import { defineSketch, type MeshGeometry } from '@null3d/engine';
import { texCoordsMaterial } from '@null3d/engine/internal';

/** The grid's spacing, and how far apart the two copies of a shape sit. */
const COLUMN = 4.4;
const ROW = 2.5;
const PAIR = 1.45;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 50,
		position: [0, 0, 11],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -0.6, -1], color: '#ffffff', intensity: 2 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.5 });
	const lit = materials.standard({ color: '#d0d4dc' });
	const view = texCoordsMaterial(materials);

	const shapes: MeshGeometry[] = [
		geometry.box({ width: 0.9, height: 0.9, depth: 0.9, widthSegments: 2 }),
		geometry.sphere({ radius: 0.6 }),
		geometry.plane({ width: 1.1, height: 1.1, widthSegments: 3, heightSegments: 2 }),
		geometry.cylinder({ radiusTop: 0.35, radiusBottom: 0.5, height: 1.1 }),
		geometry.cone({ radius: 0.55, height: 1.1, radialSegments: 16 }),
		geometry.torus({ radius: 0.45, tube: 0.18 }),
		geometry.capsule({ radius: 0.3, height: 0.6, capSegments: 6, radialSegments: 16 }),
		geometry.circle({ radius: 0.6, thetaLength: Math.PI * 1.5 }),
		geometry.ring({ innerRadius: 0.25, outerRadius: 0.6, phiSegments: 3 }),
	];
	shapes.forEach((mesh, k) => {
		const x = ((k % 3) - 1) * COLUMN;
		const y = (1 - Math.floor(k / 3)) * ROW;
		for (const [side, material] of [
			[-1, lit],
			[1, view],
		] as const) {
			const shape = scene.createMesh({ mesh, material, position: [x + (side * PAIR) / 2, y, 0] });
			shape.setRotationEuler(0.5, -0.6, 0);
		}
	});
});
