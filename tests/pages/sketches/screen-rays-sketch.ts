// A fast pan: the camera turns a fixed step about the vertical axis in every frame, so each frame
// on screen has a turn of its own. Each press of the main button casts a ray through the pointer,
// which must come from the frame on screen at the press, and another through a point beside it,
// which comes from the camera as it stands. The sketch answers the page's 'clicks' message with
// each click's frame, the frame on screen at its event, and the turns of both rays.
import { defineSketch } from '@null3d/engine';
import { shownFrame } from '../lib/shown-frame';

/** The camera's turn per frame, in radians. */
const STEP = 0.05;

/** The turn about the vertical axis of a direction, in radians, as `setRotationEuler` sets it. */
const turnOf = (direction: number[]) =>
	Math.atan2(-(direction[0] as number), -(direction[2] as number));

export default defineSketch(({ scene, geometry, materials, input, page, time }) => {
	const camera = scene.createPerspectiveCamera({ fov: 60 });
	scene.setActiveCamera(camera);
	const box = geometry.box();
	const paint = materials.standard({ color: '#4a8cff' });
	for (let k = 0; k < 8; k++) {
		const angle = (k / 8) * Math.PI * 2;
		scene.createMesh({
			mesh: box,
			material: paint,
			position: [Math.sin(angle) * 6, 0, Math.cos(angle) * 6],
		});
	}
	const ray = { origin: [0, 0, 0], direction: [0, 0, 0] };
	const beside = { origin: [0, 0, 0], direction: [0, 0, 0] };
	const clicks: { frame: number; shown: number; turn: number; besideTurn: number }[] = [];
	page.onMessage((name) => {
		if (name === 'clicks') page.post('clicks', { step: STEP, clicks });
	});
	return {
		onUpdate() {
			if (input.wasPressed('Mouse0')) {
				const { x, y } = input.pointer;
				camera.screenToRay(x, y, ray);
				camera.screenToRay(x + 0.5, y, beside);
				clicks.push({
					frame: time.frame,
					shown: shownFrame(input),
					turn: turnOf(ray.direction),
					besideTurn: turnOf(beside.direction),
				});
			}
			camera.setRotationEuler(0, time.frame * STEP, 0);
		},
	};
});
