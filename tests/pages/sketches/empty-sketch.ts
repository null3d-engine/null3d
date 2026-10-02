// A sketch with no scene: it counts its updates and its largest step, and reports them when the page
// asks. It also sends a message during setup, before the page listens. It keeps the whole canvas,
// so the frames that the engine tests count show the engine's threads, not dynamic resolution.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ page, time, quality }) => {
	quality.set({ minRenderScale: 1 });
	let updates = 0;
	let largestStep = 0;
	page.post('setup');
	page.onMessage((name) => {
		if (name === 'count')
			page.post('count', { updates, largestStep, frame: time.frame, now: time.now });
	});
	return {
		onUpdate(dt) {
			updates++;
			largestStep = Math.max(largestStep, dt);
		},
	};
});
