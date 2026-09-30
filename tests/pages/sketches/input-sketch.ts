// Records what ctx.input reports each frame: how often each name was pressed and released, the names
// pressed and released in one frame, the sums of the pointer's movement and wheel, the fingers, and
// the gamepad's values. It answers the page's 'state' message with all of it. Its setup tells the
// page when it starts and waits a moment, so the page can send input before the first frame.
import { defineSketch } from '@null3d/engine';

const NAMES = [
	'KeyW',
	'KeyD',
	'Space',
	'Mouse0',
	'Mouse2',
	'GamepadA',
	'GamepadLeftStickRight',
	'jump',
] as const;
/** How long the setup waits after it tells the page it started. */
const SETUP_WAIT_MS = 250;

const counts = () => Object.fromEntries(NAMES.map((name) => [name, 0])) as Record<string, number>;

export default defineSketch(async ({ input, page }) => {
	input.actions.define({ jump: ['Space', 'GamepadA'] });
	page.post('setup');
	await new Promise((resolve) => setTimeout(resolve, SETUP_WAIT_MS));
	let frames = 0;
	const pressed = counts();
	const released = counts();
	const together: string[] = [];
	const moved = { dx: 0, dy: 0, wheel: 0, touchDx: 0 };
	let mostTouches = 0;
	page.onMessage((name) => {
		if (name !== 'state') return;
		page.post('state', {
			frames,
			pressed,
			released,
			together,
			down: Object.fromEntries(NAMES.map((n) => [n, input.isDown(n)])),
			pointer: { ...input.pointer },
			moved,
			touches: input.touches.map((touch) => ({ ...touch })),
			mostTouches,
			stick: input.value('GamepadLeftStickRight'),
			trigger: input.value('GamepadRT'),
		});
	});
	return {
		onUpdate() {
			frames++;
			for (const name of NAMES) {
				const press = input.wasPressed(name);
				const release = input.wasReleased(name);
				if (press) pressed[name] = (pressed[name] ?? 0) + 1;
				if (release) released[name] = (released[name] ?? 0) + 1;
				if (press && release) together.push(name);
			}
			moved.dx += input.pointer.dx;
			moved.dy += input.pointer.dy;
			moved.wheel += input.pointer.wheel;
			for (const touch of input.touches) moved.touchDx += touch.dx;
			mostTouches = Math.max(mostTouches, input.touches.length);
		},
	};
});
