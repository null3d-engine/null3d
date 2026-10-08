// Times growths of the scene's object tables, for the object growth page's timing mode. The scene
// starts with the default room. On the page's 'grow', it creates groups in two frames, and times
// every create call. Each create that finds the tables full grows them, so with the default start
// the creates that make 1,024, 2,048 and each later power of two objects, the scene's camera included, grow them. The second frame
// starts less than three quarters full, so no growth comes at a frame's start. The sketch posts
// 'timing' with the time of each create that grew the tables, and the median create.
import { defineSketch } from '@null3d/engine';

/** Groups that each frame creates. */
const COUNTS = [20_000, 30_000];

export default defineSketch(({ scene, page, time }) => {
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 0, 5] }));
	let asked = false;
	let start = -1;
	const times = new Float64Array(Math.max(...COUNTS));
	const growths: { objects: number; ms: number }[] = [];
	const medians: number[] = [];
	let created = 0;
	page.onMessage((message) => {
		if (message === 'grow') asked = true;
	});
	return {
		onUpdate() {
			if (!asked) return;
			if (start < 0) start = time.frame;
			const count = COUNTS[time.frame - start];
			if (count === undefined) return;
			for (let k = 0; k < count; k++) {
				const before = performance.now();
				scene.createGroup();
				times[k] = performance.now() - before;
			}
			// The scene's camera takes a place too, so the create of group n makes n + 1 objects.
			for (let k = 0; k < count; k++) {
				const objects = created + k + 2;
				if ((objects & (objects - 1)) === 0 && objects >= 1024)
					growths.push({ objects, ms: times[k] as number });
			}
			medians.push(times.slice(0, count).sort()[count >> 1] as number);
			created += count;
			if (medians.length === COUNTS.length) page.post('timing', { growths, medianMs: medians });
		},
	};
});
