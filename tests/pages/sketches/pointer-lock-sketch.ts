// A scene for the pointer lock: first-person controls on a camera that the keys do not walk, as a
// port of three.js's PointerLockControls sets them. The sketch answers the page's 'pose' message with
// the camera's rotation, whether it sees the lock, and its frame.
import { createFirstPersonControls } from '@null3d/controls';
import { defineSketch } from '@null3d/engine';
import { CONTROLS_VIEW } from '../lib/controls-view';

export default defineSketch((ctx) => {
	const { scene, geometry, materials, page, input, time } = ctx;
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: CONTROLS_VIEW.fov,
		near: 0.1,
		far: 100,
		position: [...CONTROLS_VIEW.position],
	});
	camera.lookAt(...CONTROLS_VIEW.target);
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ intensity: 1 });
	scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#e8554e' }) });
	const controls = createFirstPersonControls(ctx, camera, { movementSpeed: 0 });

	const rotation = [0, 0, 0, 1];
	page.onMessage((type) => {
		if (type !== 'pose') return;
		camera.getRotation(rotation);
		page.post('pose', { rotation, locked: input.pointer.locked, frame: time.frame });
	});
	return {
		onUpdate(dt) {
			controls.update(dt);
		},
	};
});
