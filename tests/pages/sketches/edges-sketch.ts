// High-contrast edges for the anti-aliasing tests: thin white bars at shallow angles on a black
// background, where a frame without anti-aliasing shows stair steps, and a lit box whose sunlit
// faces are far brighter than white, where the HDR path matters.
import { defineSketch, type Quat } from '@null3d/engine';

/** A turn of `angle` radians about the view axis. */
const turn = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 100,
		position: [0, 0, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -0.5, -1], intensity: 12 });

	const bar = geometry.box({ width: 6, height: 0.08, depth: 0.08 });
	const white = materials.unlit({ color: '#ffffff' });
	for (let k = 0; k < 6; k++)
		scene.createMesh({
			mesh: bar,
			material: white,
			position: [-1.4, 2.2 - k * 0.8, 0],
			rotation: turn(0.02 + k * 0.1),
		});
	const half = Math.PI / 8;
	scene.createMesh({
		mesh: geometry.box({ width: 1.6, height: 1.6, depth: 1.6 }),
		material: materials.standard({ color: '#ff9a50' }),
		position: [3.6, 0, 0],
		rotation: [Math.sin(half) * 0.6, Math.sin(half) * 0.8, 0, Math.cos(half)],
	});
	return {};
});
