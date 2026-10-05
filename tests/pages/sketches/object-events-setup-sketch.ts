// A click on an earlier frame of the setup, for the object events test. The setup draws a frame of
// a box. Once that frame is on screen, it says so on a broadcast channel and waits for the page's
// answer there: the engine's start waits for the setup, so the page cannot message the sketch yet.
// The test clicks the box during the wait. Then the setup turns its camera away from the box and draws more frames, and
// the preset check may draw many more. The click must still reach what its own frame showed: the
// box's click handler writes a line, and the first update writes the object that a ray from
// `camera.screenToRay` through the click hits. Each message from the page asks for the lines.
import { defineSketch, type ObjectPointerEvent, type RaycastHit } from '@null3d/engine';
import { presentedFrame } from '../lib/shown-frame';

/** The channel on which the setup and the page meet, which the page's script names too. */
const CHANNEL = 'object-events-setup';

const nameOf = (object: ObjectPointerEvent['object']) =>
	object === null ? 'nothing' : ((object as { name?: string }).name ?? 'a batch');

export default defineSketch(async ({ scene, geometry, materials, input, page }) => {
	const camera = scene.createPerspectiveCamera({ fov: 50, position: [0, 0, 8], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -3], intensity: 3 });
	const right = scene.createMesh({
		name: 'right',
		mesh: geometry.box({ width: 1.5, height: 1.5, depth: 1.5 }),
		material: materials.standard({ color: '#4a8cff' }),
		position: [2.5, 0, 0],
	});
	const lines: string[] = [];
	right.on('click', (event) => lines.push(`click ${nameOf(event.object)}`));
	page.onMessage(() => page.post('reply', { lines }));
	const channel = new BroadcastChannel(CHANNEL);
	const started = new Promise<void>((resolve) => {
		channel.onmessage = () => resolve();
	});
	await scene.warmUp();
	// The warm-up ends once the frame's pipelines are built, which the thread that draws reports
	// just before it draws the frame. Where that thread is not the sketch's, a click could still
	// come while the canvas shows no frame, whose ray takes the camera as it stands. Every frame
	// before the turn shows the box.
	while (presentedFrame(input) < 1) await new Promise((resolve) => setTimeout(resolve, 1));
	channel.postMessage('waiting');
	await started;
	channel.close();
	// The frames from here look away from the box, so their camera would miss it.
	camera.setPosition(0, 0, -8);
	camera.lookAt(0, 0, -16);
	await scene.warmUp();
	await scene.warmUp();
	const ray = { origin: [0, 0, 0], direction: [0, 0, 0] };
	const hit: RaycastHit = {
		object: null,
		instance: -1,
		point: [0, 0, 0],
		normal: [0, 0, 0],
		distance: 0,
		triangle: 0,
	};
	return {
		onUpdate() {
			if (!input.wasReleased('Mouse0')) return;
			camera.screenToRay(input.pointer.x, input.pointer.y, ray);
			const found = scene.raycast(ray.origin, ray.direction, undefined, hit);
			lines.push(`ray ${found ? nameOf(hit.object) : 'nothing'}`);
		},
	};
});
