// Starts the engine with a sketch that watches the user's motion preference, then keeps it running
// and offers `motionState()` on the window, so a test can change the preference and ask again.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

interface MotionState {
	atSetup: boolean;
	reducedMotion: boolean;
	notices: boolean[];
}

declare global {
	interface Window {
		motionState?: () => Promise<MotionState>;
	}
}

run('motion', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/motion-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.motionState = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'state') return;
				off();
				resolve(data as MotionState);
			});
			engine.postToSketch('state');
		});
	return { mode: engine.mode };
});
