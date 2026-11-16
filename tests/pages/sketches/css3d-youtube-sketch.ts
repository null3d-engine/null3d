// The null3D side of three.js's CSS3D youtube example (examples/css3d_youtube.html, r186): each
// embedded page is a world label turned to face out of the ring, so the camera sees every screen at
// an angle, as CSS3DObject objects see them.
import { defineSketch, quat } from '@null3d/engine';
import { CAMERA, SCREENS } from '../lib/css3d-youtube';

export default defineSketch(({ scene, ui }) => {
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: CAMERA.position,
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	SCREENS.forEach((screen, index) => {
		const object = scene.createGroup({
			position: screen.position,
			rotation: quat.fromEuler(quat.create(), 0, screen.turn, 0),
		});
		ui.trackLabel(object, `screen-${index}`, { transform: 'world' });
	});
	return {};
});
