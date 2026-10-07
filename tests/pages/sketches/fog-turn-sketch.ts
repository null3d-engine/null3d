// A white box in black fog, for the test that fog stays still as the camera turns. The camera
// stands at the origin, and ?yaw= turns it by that many degrees about the world's up, from looking
// straight at the box. The box then moves from the middle of the frame toward its edge, at the
// same distance from the camera, so it must keep its color.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
/** The camera's turn in degrees, from the sketch module's ?yaw switch. */
const YAW = (Number(params.get('yaw') ?? 0) * Math.PI) / 180;

export default defineSketch(({ scene, materials, geometry, post }) => {
	post.set({ toneMapping: 'none' });
	scene.setBackground('#000000');
	scene.setFog({ color: '#000000', density: 0.03 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 60,
			position: [0, 0, 0],
			target: [Math.sin(YAW), 0, -Math.cos(YAW)],
			far: 100,
		}),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 0.5, height: 0.5, depth: 0.5 }),
		material: materials.unlit({ color: '#ffffff' }),
		position: [0, 0, -30],
	});
	return {};
});
