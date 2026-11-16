// The add-on's page: it starts the engine on its canvas with the add-on's sketch. The listing
// check's gates read the frames that the page draws, so the page needs no test code of its own.
//
// `?capture=<seconds>` gives the page one job: it waits until the sketch reaches that time, asks for
// the frame through the engine, and publishes it on `window.__null3dResult` as the image tests read
// a page's result. A picture of a solved field needs the frames before it, which hold mode does not
// draw.
import { createEngine } from '@null3d/engine';

/** The sketch, with the page's own switches, so a page address can ask the sketch for a mode. */
const sketch = new URL('./sketch.ts', import.meta.url);
// The switches come after the module is named, because the bundler resolves a module's address
// from the literal that `new URL` is given. It cannot resolve one that a template builds.
sketch.search = location.search;
const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const capture = new URL(location.href).searchParams.has('capture');
/** Asks the page to capture the frame that the sketch has just drawn. */
let captureNow: ((data: unknown) => void) | undefined;
const engine = await createEngine({
	canvas,
	sketch,
	onSketchMessage: (name, data) => {
		if (name === 'capture') captureNow?.(data);
	},
});
if (capture) {
	/** The frame that the engine read back, once the sketch has reached the capture time. */
	type Frame = Awaited<ReturnType<typeof engine.captureFrame>>;
	/** What the sketch said about the picture it asked for, such as whether it holds a grid. */
	let debug: unknown;
	const frame = await new Promise<Frame>((resolve) => {
		captureNow = (data) => {
			debug = data;
			void engine.captureFrame().then(resolve);
		};
	});
	// The bytes go to the test as one base64 string, as every test page's image does.
	let binary = '';
	for (let i = 0; i < frame.pixels.length; i += 0x8000)
		binary += String.fromCharCode(...frame.pixels.subarray(i, i + 0x8000));
	(window as { __null3dResult?: unknown }).__null3dResult = {
		width: frame.width,
		height: frame.height,
		pixels: btoa(binary),
		debug,
	};
}
