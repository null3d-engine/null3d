// The null3D side of three.js's CSS3D sandbox example (examples/css3d_sandbox.html, r186): each
// square is a world label on an object, and a wireframe plane draws over the same place with the
// same turn and scale, so the element and the drawn outline must coincide on both GPU paths.
import { defineSketch } from '@null3d/engine';
import { CAMERA, SIZE, SQUARES_LAYOUT } from '../lib/css3d-sandbox';

export default defineSketch(({ scene, geometry, materials, ui }) => {
	scene.setBackground('#f0f0f0');
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const plane = geometry.plane({ width: SIZE, height: SIZE });
	const outline = materials.unlit({ color: '#000000', wireframe: true, doubleSided: true });
	SQUARES_LAYOUT.forEach((square, index) => {
		const object = scene.createGroup({
			position: square.position,
			rotation: square.rotation,
			scale: square.scale,
		});
		ui.trackLabel(object, `square-${index}`, { transform: 'world' });
		scene.createMesh({
			mesh: plane,
			material: outline,
			position: square.position,
			rotation: square.rotation,
			scale: square.scale,
		});
	});
	return {};
});
