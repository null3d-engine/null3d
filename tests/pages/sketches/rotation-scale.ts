// The aurora's camera, a 4000-unit ice plane and the sixteen snow cones that seed 11 draws with no
// pines: the reproduction of M3-R33. A cone's rotation quaternion is not unit length, and a
// rotation may only turn a mesh. When it does, the cone stands small and far and the plane's own
// color fills the lower part of the picture.
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ scene, materials, geometry }) => {
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.5,
		far: 4000,
		position: [0, 2.4, 30],
	});
	camera.lookAt(0, 16, -140);
	scene.setActiveCamera(camera);
	scene.setBackground('#000000');

	scene.createMesh({
		mesh: geometry.plane({ width: 4000, height: 4000 }),
		material: materials.unlit({ color: '#ff00ff' }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	math.seed(11);
	const snow = materials.unlit({ color: '#00ffff' });
	for (let k = 0; k < 16; k++) {
		const x = math.randFloat(-320, 320);
		const z = math.randFloat(-190, -120);
		const height = math.randFloat(14, 46);
		scene.createMesh({
			mesh: geometry.cone({ radius: height * 1.7, height, radialSegments: 6 }),
			material: snow,
			position: [x, height * 0.5 - 3, z],
			rotation: [0, math.randFloat(0, Math.PI), 0, 1],
		});
	}
});
