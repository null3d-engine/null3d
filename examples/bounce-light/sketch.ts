// Screen-space bounce light: a room open at the front and the top, with a red wall at the left, a
// green wall at the right and a white back wall and floor, lit by the built-in room environment.
// Each wall's light lands on the floor beside it and on the white wall: red at the left, green at
// the right, which the environment's uniform light cannot show. Every 4 seconds the bounce light
// turns off and on again, so the difference shows. The pointer turns the camera around the room.
import { defineSketch } from '@null3d/engine';
import { enableBounce } from '../lib/bounce';
import { interact } from '../lib/interact';

/** The seconds of each half of the on-and-off cycle. */
const CYCLE = 4;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, quality, time } = ctx;
	enableBounce(ctx);
	const environment = await assets.builtinEnvironment('room');
	scene.setEnvironment(environment);
	scene.setBackground('#1a1d24');
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		position: [0, 2.1, 6.2],
		target: [0, 0.9, -0.4],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 1, 0], groundY: 0 });

	const surface = (
		color: string,
		size: [number, number, number],
		position: [number, number, number],
	) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color, roughness: 0.9 }),
			position,
		});
	surface('#cccccc', [6, 0.2, 6], [0, -0.1, 0]);
	surface('#cccccc', [6, 3, 0.2], [0, 1.5, -3.1]);
	surface('#d9160e', [0.2, 3, 6], [-3.1, 1.5, 0]);
	surface('#14b81a', [0.2, 3, 6], [3.1, 1.5, 0]);

	let shown = quality.settings.bounceRays > 0;
	return {
		onUpdate(dt: number) {
			view.update(dt);
			// On for the first half of each cycle, off for the second.
			const half = Math.floor(time.now / CYCLE) % 2 === 0;
			if (half !== shown) {
				shown = half;
				quality.set({ bounceRays: half ? 8 : 0 });
			}
		},
	};
});
