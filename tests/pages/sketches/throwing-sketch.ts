// A sketch whose update throws once the sketch time reaches half a second, so hold mode's test sees
// the hold stop there.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ time }) => ({
	onUpdate() {
		if (time.now >= 0.5) throw new Error('the throwing sketch threw on purpose');
	},
}));
