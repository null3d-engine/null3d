// A page for the recording and replay test. Its sketch sends each frame's numbers to the page, and
// the page keeps them for the test. A recording seeds the sketch thread's random numbers, so the
// replay's scene starts the same and its frames compare line for line with the session's.
import { createEngine, type Engine } from '@null3d/engine';

/** What each frame gave the sketch, for the test to compare across a recording and its replay. */
const log: string[] = [];

/** What the test reads: the frame log, the engine, and whether the start ended. */
const scope = globalThis as {
	recordingLog?: string[];
	null3dEngine?: Engine;
	recordingReady?: boolean;
	recordingError?: string;
};
scope.recordingLog = log;

const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('the page has no canvas');

createEngine({
	canvas,
	sketch: new URL('./sketches/recording-sketch.ts', import.meta.url),
	maxPixelRatio: 1,
	onSketchMessage: (name, data) => {
		if (name === 'frame' && typeof data === 'string') log.push(data);
	},
})
	.then((engine) => {
		scope.null3dEngine = engine;
		scope.recordingReady = true;
	})
	.catch((error: unknown) => {
		scope.recordingError = error instanceof Error ? error.message : String(error);
	});
