// A scene with enough parallel work for the job workers: a batch of many boxes that all move in
// every frame, so the engine updates every row of the batch in every frame. ?rows= sets the count.
// Like the empty sketch, it counts its updates and its largest step, reports them when the page
// asks, sends a message during setup, and keeps the whole canvas.
import { defineSketch } from '@null3d/engine';

/** The boxes, from the sketch module's ?rows= switch. */
const ROWS = Number(new URL(import.meta.url).searchParams.get('rows') ?? '100000');
/** The side of the square grid that holds the boxes. */
const SIDE = Math.ceil(Math.sqrt(ROWS));

export default defineSketch(({ scene, materials, geometry, page, time, quality }) => {
	quality.set({ minRenderScale: 1 });
	let updates = 0;
	let largestStep = 0;
	page.post('setup');
	page.onMessage((name) => {
		if (name === 'count')
			page.post('count', { updates, largestStep, frame: time.frame, now: time.now });
	});
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 400,
		position: [0, 120, 160],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const batch = scene.createInstances(geometry.box({ width: 0.4, height: 0.4, depth: 0.4 }), ROWS, {
		material: materials.unlit({ color: '#4a8cff' }),
		dynamic: true,
	});
	return {
		onUpdate(dt) {
			updates++;
			largestStep = Math.max(largestStep, dt);
			const positions = batch.positions;
			const t = time.now;
			for (let i = 0; i < ROWS; i++) {
				positions[i * 3] = (i % SIDE) - SIDE / 2;
				positions[i * 3 + 1] = Math.sin(t + i * 0.01);
				positions[i * 3 + 2] = Math.floor(i / SIDE) - SIDE / 2;
			}
		},
	};
});
