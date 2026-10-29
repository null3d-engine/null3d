// Draws one sketch of the image test manifest in the engine's hold mode and publishes the held
// frame, with the depth mode that the engine drew. ?sketch= names the sketch module from the
// server's root, with the sketch's own query after it, and ?size= gives the canvas in pixels, such
// as 320x180. ?transparent starts the engine with a transparent canvas, ?antialias= with an
// anti-aliasing mode, ?shadowTileSize= with a size of the shadow atlas's tiles, and
// ?pointLightShadows with point light shadows on. The engine reads its own switches: ?hold= the
// sketch time, ?gpu= the tier, ?depth= the WebGL2 depth mode, ?hdr=off, ?half=, and the thread
// mode's switches.
import { createEngine, type EngineOptions } from '@null3d/engine';
import { depthFacts } from './lib/depth';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);

/** The canvas size that ?size= gives, in pixels. */
function readSize(text: string | null): [number, number] {
	const [width = 0, height = 0] = (text ?? '').split('x').map(Number);
	if (!(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0))
		throw new Error(
			`?size=${text ?? ''} is not a size in pixels: use a size such as ?size=320x180.`,
		);
	return [width, height];
}

/**
 * A sketch module's address from the server root. When it has a query, Vite's marker of the file's
 * extension goes last. Vite takes the language from the last dot of an address, so a query that
 * ends in a decimal, such as ?scale=0.5, would make the module JavaScript.
 */
function sketchUrl(path: string): URL {
	const url = new URL(path, location.origin);
	if (url.search) url.search += '&lang.ts';
	return url;
}

run('image', async () => {
	const sketch = params.get('sketch');
	if (!sketch?.startsWith('/'))
		throw new Error('Add ?sketch= with the path of a sketch module from the server root.');
	if (!params.has('hold')) throw new Error('Add ?hold= with the sketch time to hold at.');
	const [width, height] = readSize(params.get('size'));
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const engine = await createEngine({
		canvas,
		sketch: sketchUrl(sketch),
		maxPixelRatio: 1,
		transparent: params.has('transparent'),
		antialias: (params.get('antialias') ?? undefined) as EngineOptions['antialias'],
		shadowTileSize: params.has('shadowTileSize') ? Number(params.get('shadowTileSize')) : undefined,
		pointLightShadows: params.has('pointLightShadows') || undefined,
		morphTargets: params.has('morphTargets') ? Number(params.get('morphTargets')) : undefined,
		largeWorld: params.has('largeWorld'),
	});
	const frame = await engine.captureFrame();
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		halfPrecision: engine.capabilities.halfPrecision,
		// Whether the engine probed the extension that draws many ranges in one call, which a
		// picture of the whole-level fallback expects it to lack.
		multiDraw: engine.capabilities.features.includes('WEBGL_multi_draw'),
		mode: engine.mode,
		...depthFacts(engine),
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
		// The line that the two-step probe printed for the held frame, for the plan that asks for it,
		// which keeps it in the run's result to read beside the other browsers' lines.
		twoStep: (globalThis as { __null3dTwoStep?: string }).__null3dTwoStep ?? null,
	};
});
