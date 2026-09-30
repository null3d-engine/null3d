// The depth precision scene: two surfaces 1 cm apart at each distance from 1 m to 10 km, one pair
// to a tile. `lib/depth-precision.ts` places them and says how the tests read the frame.
import { defineSketch } from '@null3d/engine';
import { PRECISION, precisionSurfaces } from '../lib/depth-precision';

export default defineSketch(({ scene, materials, geometry, post }) => {
	// The page finds fighting pixels by their red channel. A tone mapping curve such as ACES mixes
	// the channels, which would give the nearer surface some red, so the colors pass through as
	// they are.
	post.set({ toneMapping: 'none' });
	scene.setBackground(PRECISION.background);
	const camera = scene.createPerspectiveCamera({
		fov: PRECISION.fovDegrees,
		near: PRECISION.near,
		far: PRECISION.far,
		position: [0, 0, 0],
		target: [0, 0, -1],
	});
	scene.setActiveCamera(camera);
	const surface = geometry.box({ width: 1, height: 1, depth: 0 });
	// Objects draw in the order of their materials, so the farther surfaces, whose material comes
	// first, draw first and win every depth tie.
	const back = materials.unlit({ color: PRECISION.back });
	const front = materials.unlit({ color: PRECISION.front });
	for (const { back: farther, position, rotation, scale } of precisionSurfaces())
		scene.createMesh({
			mesh: surface,
			material: farther ? back : front,
			position,
			rotation,
			scale,
		});
	return {};
});
