// Queues a sort on the job workers in each round, through the task-probe add-on's public task. The
// sketch fills a shared buffer, awaits the answer, and puts a white marker at the slot of the
// smallest value that the answer gives, so the drawn frame shows where the last answer landed. It
// reports each round's queue frame, the frame that draws its answer, and the worker that ran it.
import { defineSketch } from '@null3d/engine';
import { sortRound } from '../addons/task-probe/index';

/** The rounds that the sketch sorts, each one after the answer of the round before it. */
const ROUNDS = 4;
/** The values of a round: 0 to 4 in a different order, so the smallest value names a slot. */
const COUNT = 5;
/** A round's values spread across this many slots, which stand a metre apart. */
const SLOTS = 5;

export default defineSketch(({ scene, geometry, materials, post, time, page }) => {
	scene.setBackground('#000000');
	// No tone curve, so the marker draws at its own white whatever the display's curve is.
	post.set({ toneMapping: 'none' });
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 20,
		position: [0, 0, 4],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const marker = scene.createMesh({
		mesh: geometry.box({ width: 0.6, height: 0.6, depth: 0.1 }),
		material: materials.unlit({ color: '#ffffff' }),
		dynamic: true,
		name: 'marker',
	});
	// The count, the round's values, and room for the sorted values, all in one shared buffer that
	// the worker writes into rather than a copy of it.
	const view = new Int32Array(new SharedArrayBuffer((1 + 2 * COUNT) * 4));
	let round = 0;
	/** True while a task waits for its answer. */
	let waiting = false;
	/** True when the next round starts in the next frame. */
	let next = false;

	const startRound = () => {
		Atomics.store(view, 0, COUNT);
		// A descending run of values from the round, so the sort has work to do and the smallest
		// value follows the round number: 0, 1, 2 and then 3.
		for (let i = 0; i < COUNT; i++)
			Atomics.store(view, 1 + i, Math.min(SLOTS - 1, SLOTS - 1 - i + round));
		const queued = time.frame;
		waiting = true;
		sortRound(view, round)
			.then((answer) => {
				waiting = false;
				// The engine hands a task's answer to this thread between frames, so the frame after
				// this callback is the first that can draw what it wrote.
				marker.setPosition((answer.order[0] as number) - (SLOTS - 1) / 2, 0, 0);
				page.post('round', {
					round: answer.round,
					queued,
					applied: time.frame + 1,
					worker: answer.worker,
					order: answer.order,
				});
				round++;
				if (round === ROUNDS) page.post('done', { rounds: ROUNDS });
				else next = true;
			})
			.catch((error: unknown) => {
				waiting = false;
				page.post('failed', { message: String(error) });
			});
	};

	return {
		onUpdate() {
			if (waiting) return;
			if (round === 0 || next) {
				next = false;
				startRound();
			}
		},
	};
});
