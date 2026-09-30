// A page that the dev server of a tool serves beside the project's own pages: it draws one sketch
// module of the project on a canvas of a set size, with the engine's default options. Tests of a
// sketch then need no page of their own. The page lives in memory, so the project's folder stays as
// it was.

/** @import { Plugin } from 'vite' */

/** The page's address on the dev server. It has no `.html` ending, so no file of the project can hide it. */
const PAGE = '/@null3d/sketch';
/** The address of the page's script, which Vite serves as a module of the project. */
const SCRIPT = '/@null3d/sketch.js';
/** The script's module ID inside Vite. The leading null character keeps other plugins off it. */
const SCRIPT_ID = '\0null3d-sketch-page';

const HTML = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>null3D sketch</title>
		<style>
			html, body { margin: 0; }
			canvas { display: block; }
		</style>
	</head>
	<body>
		<canvas></canvas>
		<script type="module" src="${SCRIPT}"></script>
	</body>
</html>
`;

// The page starts the engine on a canvas of the size that ?size= gives, at one pixel per CSS pixel.
// The engine reads its own switches from the address, such as ?hold= and ?gpu=. Hold mode publishes
// a failed start itself, so the page does not log it again as an uncaught error.
const SCRIPT_CODE = `import { createEngine } from '@null3d/engine';

const params = new URLSearchParams(location.search);
const [width, height] = (params.get('size') ?? '').split('x');
const canvas = document.querySelector('canvas');
canvas.style.width = width + 'px';
canvas.style.height = height + 'px';
createEngine({
	canvas,
	sketch: new URL(params.get('sketch') ?? '', location.origin),
	maxPixelRatio: 1,
}).catch(() => {});
`;

/**
 * The page's path for a sketch module and a canvas size.
 *
 * @param {string} sketch The sketch module, from the project's folder, with any query of its own.
 * @param {readonly [number, number]} size The canvas's width and height in pixels.
 */
export function sketchPagePath(sketch, [width, height]) {
	const params = new URLSearchParams({
		sketch: `/${sketch.replace(/^\.?\//, '')}`,
		size: `${width}x${height}`,
	});
	return `${PAGE}?${params}`;
}

/**
 * The Vite plugin that serves the page and its script.
 *
 * @returns {Plugin}
 */
export function sketchPagePlugin() {
	return {
		name: 'null3d-sketch-page',
		// Before Vite's own resolver, which would look for the script in the project's folder.
		enforce: 'pre',
		resolveId: (id) => (id === SCRIPT ? SCRIPT_ID : undefined),
		load: (id) => (id === SCRIPT_ID ? SCRIPT_CODE : undefined),
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url?.split('?')[0] !== PAGE) return next();
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				res.end(HTML);
			});
		},
	};
}
