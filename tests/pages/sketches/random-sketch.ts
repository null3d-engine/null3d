// A sketch with no scene that draws random numbers in its setup, from the engine's math.random and
// from Math.random in turn, and sends them on the message `state`. In hold mode both come from one
// seeded generator, so the numbers are the same on every run.
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ page }) => {
	const drawn = [math.random(), Math.random(), math.randFloat(2, 4), Math.random()];
	page.onMessage((name) => {
		if (name === 'state') page.post('state', { drawn });
	});
	return {};
});
