// A game with no scene: it counts its updates and its largest step, and reports them when the page
// asks. It also sends a message during setup, before the page listens.
import { defineGame } from '@null3d/engine';

export default defineGame(({ page, time }) => {
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
