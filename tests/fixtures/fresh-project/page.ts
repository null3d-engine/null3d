// The fresh project's page: it starts the engine on its canvas with the project's sketch.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const root = document.documentElement;
// The fresh-project test reads how the start ended from the page's root element: the build that
// started, or the error.
try {
	const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });
	root.dataset.start = engine.capabilities.threaded ? 'threaded' : 'single-threaded';
} catch (e) {
	root.dataset.start = String(e);
	throw e;
}
