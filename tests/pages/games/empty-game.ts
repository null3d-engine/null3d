// A game with no scene: it counts its updates and reports them when the page asks.
import { defineGame } from '@null3d/engine';

export default defineGame(({ page, time }) => {
	let updates = 0;
	page.onMessage((name) => {
		if (name === 'count') page.post('count', { updates, frame: time.frame, now: time.now });
	});
	return {
		onUpdate() {
			updates++;
		},
	};
});
