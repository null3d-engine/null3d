// Screen-space bounce light: a room open at the front and the top, with a red wall at the left, a
// green wall at the right and a grey back wall and floor, lit by the built-in room environment.
// Each wall's light lands on the floor and the back wall beside it: red at the left, green at the
// right, which the environment's uniform light cannot show. The walls take the environment's light
// strongly and the grey surfaces take it dimly, so the color that the walls throw reads at a
// glance. Every 4 seconds the bounce light turns off and on again. Press B to take it over and
// switch it yourself; the cycle does not run it again. The pointer turns the camera around the room.
import { defineSketch } from '@null3d/engine';
import { type BounceState, showBounce, toggledBounce } from '../lib/bounce';
import { interact } from '../lib/interact';

/** The point that the controls orbit, and that the camera looks at first. */
const TARGET = [0, 0.8, -1.4] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, time, input } = ctx;
	const environment = await assets.builtinEnvironment('room');
	scene.setEnvironment(environment);
	scene.setBackground('#1a1d24');
	const camera = scene.createPerspectiveCamera({
		fov: 58,
		position: [0, 1.4, 3.6],
		target: TARGET,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: TARGET, groundY: 0 });

	// Each surface's share of the environment's light, through its material's `envIntensity`.
	const surface = (
		color: string,
		size: [number, number, number],
		position: [number, number, number],
		envIntensity: number,
	) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color, roughness: 0.9, envIntensity }),
			position,
		});
	// The grey surfaces take little of the environment's light, so the color that the walls throw
	// shows against a dim floor and back wall.
	surface('#cccccc', [6, 0.2, 6], [0, -0.1, 0], 0.3);
	surface('#cccccc', [6, 3, 0.2], [0, 1.5, -3.1], 0.3);
	// The walls take four times the grey surfaces' light, so each throws a strong color into the
	// room.
	surface('#f22214', [0.2, 3, 6], [-3.1, 1.5, 0], 4);
	surface('#1ad61c', [0.2, 3, 6], [3.1, 1.5, 0], 4);

	let manual: BounceState | null = null;
	return {
		onUpdate(dt: number) {
			view.update(dt);
			if (!time.held && input.wasPressed('KeyB')) manual = toggledBounce(time.now, manual);
			// A held frame shows the light from the cycle's first half, and no input reaches it.
			showBounce(ctx, time.held ? 0 : time.now, manual);
		},
	};
});
