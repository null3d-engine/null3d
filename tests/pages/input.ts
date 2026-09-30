// Starts the engine with a sketch that records what ctx.input reports, then keeps it running and
// offers `inputState()`, `pauseEngine()` and `tapKey()` on the window, so a test can drive the
// keyboard, the mouse, touch and a stand-in gamepad, and ask what the sketch saw. With ?setupInput, the page
// presses W, the main mouse button and the wheel while the sketch's setup runs, before the first
// frame; the input test runs it in hold mode too, where the sketch must see none of it.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		inputState?: () => Promise<unknown>;
		pauseEngine?: (paused: boolean) => void;
		tapKey?: (code: string) => void;
	}
}

/** Presses and releases a key within one task, as a key tapped faster than a frame. */
window.tapKey = (code) => {
	window.dispatchEvent(new KeyboardEvent('keydown', { code }));
	window.dispatchEvent(new KeyboardEvent('keyup', { code }));
};

/** Input that a user could give during the sketch's setup, sent as the browser would send it. */
function sendSetupInput(canvas: HTMLCanvasElement): void {
	window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
	const at = { clientX: 20, clientY: 20, bubbles: true, pointerId: 1, isPrimary: true };
	canvas.dispatchEvent(
		new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', button: 0, buttons: 1 }),
	);
	canvas.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: 50 }));
}

run('input', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const setupInput = new URLSearchParams(location.search).has('setupInput');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/input-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		onSketchMessage: (name) => {
			if (name === 'setup' && setupInput) sendSetupInput(canvas);
		},
	});
	await engine.firstFrame;
	window.inputState = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'state') return;
				off();
				resolve(data);
			});
			engine.postToSketch('state');
		});
	window.pauseEngine = (paused) => engine.setPaused(paused);
	return { mode: engine.mode };
});
