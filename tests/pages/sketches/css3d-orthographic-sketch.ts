// The null3D side of three.js's CSS3D orthographic example (examples/css3d_orthographic.html, r186):
// each plane is a world label beside a wireframe plane at the same place, seen through an
// orthographic camera. The labels take the same orthographic view of the scene that the meshes do.
import { defineSketch } from '@null3d/engine';
import { CAMERA, PLATES } from '../lib/css3d-orthographic';

export default defineSketch(({ scene, geometry, materials, ui }) => {
	scene.setBackground('#f0f0f0');
	const camera = scene.createOrthographicCamera({
		height: CAMERA.frustum,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const outline = materials.unlit({ color: '#000000', wireframe: true, doubleSided: true });
	PLATES.forEach((plate, index) => {
		const object = scene.createGroup({ position: plate.position, rotation: plate.rotation });
		ui.trackLabel(object, `plate-${index}`, { transform: 'world' });
		scene.createMesh({
			mesh: geometry.plane({ width: plate.width, height: plate.height }),
			material: outline,
			position: plate.position,
			rotation: plate.rotation,
		});
	});
	return {};
});
