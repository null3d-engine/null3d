// A page that gives its sketch start data from its own address, as a scroll-driven page passes the
// section that the address names. ?color= gives the background color, and ?level= a number. The
// sketch posts the data that its setup read, and the page keeps it for the test. With ?hold=, the
// engine publishes the held frame; a live page keeps the engine for a test that saves a recording.
import { createEngine, type Engine } from '@null3d/engine';
import type { StartData } from './sketches/sketch-data-sketch';

/** What the test reads: the data that the setup saw, the engine, and how the start ended. */
const scope = globalThis as {
	sketchDataSeen?: unknown;
	null3dEngine?: Engine;
	sketchDataReady?: boolean;
	sketchDataError?: string;
};

const params = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
if (canvas === null) throw new Error('the page has no canvas');
const sketchData: StartData = {
	color: params.get('color') ?? '#000000',
	level: Number(params.get('level') ?? 0),
};

createEngine({
	canvas,
	sketch: new URL('./sketches/sketch-data-sketch.ts', import.meta.url),
	sketchData,
	maxPixelRatio: 1,
	onSketchMessage: (name, data) => {
		if (name === 'data') scope.sketchDataSeen = data;
	},
})
	.then(async (engine) => {
		scope.null3dEngine = engine;
		await engine.firstFrame;
		scope.sketchDataReady = true;
	})
	.catch((error: unknown) => {
		scope.sketchDataError = error instanceof Error ? error.message : String(error);
	});
