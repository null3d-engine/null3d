// Grows the engine's memory in many steps after it sets up parts of the scene that it then leaves
// alone, for the test of views of the shared memory. A static instance batch, the sky, the sky's
// environment and the effects are set once. Each later step adds an instance batch big enough to
// grow the memory, writes its rows once, draws a frame, posts 'step' and waits for the page's
// 'go', so the page can read the memory's size. After the last step it posts 'grown' and keeps
// drawing while the test measures.
import { defineSketch } from '@null3d/engine';
import { SKY } from '../../../bench/scenes/backgrounds';

/** The steps that add a batch, and the rows of each batch. */
const STEPS = 24;
const ROWS = 16_384;

export default defineSketch(async ({ scene, materials, geometry, assets, post, page }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 6, 18], target: [0, 0, 0], far: 400 }),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.setBackground({ sky: SKY });
	scene.setEnvironment(await assets.skyEnvironment());
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, vignette: { intensity: 0.4 } });
	const box = geometry.box({ width: 0.2, height: 0.2, depth: 0.2 });
	const material = materials.standard({ color: '#8aa4c8' });
	const placed = scene.createInstances(box, 64, { material });
	for (let k = 0; k < 64; k++) placed.positions.set([(k % 8) - 4, 0, Math.floor(k / 8) - 4], k * 3);

	let frameWaiters: (() => void)[] = [];
	const frame = () => new Promise<void>((resolve) => frameWaiters.push(resolve));
	let go: (() => void) | undefined;
	page.onMessage((name) => {
		if (name === 'go') go?.();
	});
	(async () => {
		for (let step = 1; step <= STEPS; step++) {
			// The growth batches stay off the camera's layers. They still exist, and the memory
			// still grows with each one, which is what the test checks. Drawing hundreds of
			// thousands of boxes on the CI software GPU cost minutes and made the run time out.
			const rows = scene.createInstances(box, ROWS, { material, layers: 1 << 1 });
			for (let k = 0; k < ROWS; k++)
				rows.positions.set([(k % 128) * 0.3 - 19, step * 0.3, Math.floor(k / 128) * -0.3], k * 3);
			await frame();
			await new Promise<void>((resolve) => {
				go = resolve;
				page.post('step', { step });
			});
		}
		page.post('grown', { steps: STEPS });
	})();

	return {
		onUpdate() {
			const waiting = frameWaiters;
			frameWaiters = [];
			for (const resolve of waiting) resolve();
		},
	};
});
