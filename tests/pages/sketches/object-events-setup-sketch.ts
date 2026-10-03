// A click while a frame of the setup is on screen, for the object events test. The setup draws a
// frame of a box through one camera, then makes another camera active, which looks away from the
// box. It says so on a broadcast channel and waits for the page's answer there: the engine's start
// waits for the setup, so the page cannot message the sketch yet. The test clicks the box during
// the wait, so the click names the setup's frame. The box's handler writes a line with the object
// hit and the frame that the click named, and each message from the page asks for the lines.
import { defineSketch, type ObjectPointerEvent } from '@null3d/engine';

/** The channel on which the setup and the page meet, which the page's script names too. */
const CHANNEL = 'object-events-setup';

const nameOf = (object: ObjectPointerEvent['object']) =>
	object === null ? 'nothing' : ((object as { name?: string }).name ?? 'a batch');

export default defineSketch(async ({ scene, geometry, materials, input, page }) => {
	const shown = scene.createPerspectiveCamera({ fov: 50, position: [0, 0, 8], target: [0, 0, 0] });
	scene.setActiveCamera(shown);
	scene.createDirectionalLight({ direction: [-1, -2, -3], intensity: 3 });
	const right = scene.createMesh({
		name: 'right',
		mesh: geometry.box({ width: 1.5, height: 1.5, depth: 1.5 }),
		material: materials.standard({ color: '#4a8cff' }),
		position: [2.5, 0, 0],
	});
	const lines: string[] = [];
	right.on('click', (event) => {
		// The frame on screen at the click, which the public API leaves out.
		const frame = (input.pointer as unknown as { frame: number }).frame;
		lines.push(`click ${nameOf(event.object)} ${frame}`);
	});
	page.onMessage(() => page.post('reply', { lines }));
	const channel = new BroadcastChannel(CHANNEL);
	const started = new Promise<void>((resolve) => {
		channel.onmessage = () => resolve();
	});
	await scene.warmUp();
	// The frames after the setup look away from the box, so the camera as it stands would miss.
	const away = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 0, -8],
		target: [0, 0, -16],
	});
	scene.setActiveCamera(away);
	channel.postMessage('waiting');
	await started;
	channel.close();
	return {};
});
