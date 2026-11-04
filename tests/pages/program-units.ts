// Drives the WebGL2 texture-unit allocator through the engine's public API: a page builds a lit
// material with six textures of its own, as any page builds one, and draws it. Its fragment stage
// reads twelve texture units beside the engine's lighting, and a WebGL2 device promises at least
// sixteen, so a compliant device never refuses it. The page therefore makes its own context report
// ten units, as a reduced driver would, and the engine must throw E1209 with both numbers. The
// count that the device reports without the page's change stays in the result, so the test also
// shows that the device's hardware had room for the material's shader.
import { createEngine, type Engine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** The fragment units that the page's context reports, fewer than its material's shader reads. */
const REPORTED_UNITS = 10;
/** How long the page waits for a failure after a start that finished. */
const FAILURE_MS = 10_000;

run('program-units', async () => {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	document.body.append(canvas);
	// The device's own numbers, read before the page changes what its context reports.
	const real = { vertex: 0, fragment: 0 };
	const prototype = WebGL2RenderingContext.prototype;
	const getParameter = prototype.getParameter;
	prototype.getParameter = function (this: WebGL2RenderingContext, parameter: number) {
		const units = getParameter.call(this, parameter) as number;
		if (parameter === this.MAX_VERTEX_TEXTURE_IMAGE_UNITS) {
			real.vertex = units;
			return units;
		}
		if (parameter !== this.MAX_TEXTURE_IMAGE_UNITS) return units;
		real.fragment = units;
		return Math.min(units, REPORTED_UNITS);
	};
	let engine: Engine | undefined;
	let failure: { code?: string; message: string } | undefined;
	try {
		engine = await createEngine({
			canvas,
			sketch: new URL('./sketches/unit-limit-sketch.ts', import.meta.url),
		});
	} catch (error) {
		failure = error as EngineError;
	}
	if (engine) {
		// The drawing thread reports a failure after the start through the engine, and stops drawing.
		engine.onFailure((error) => {
			failure ??= error;
		});
		const deadline = performance.now() + FAILURE_MS;
		while (!failure && performance.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 50));
		await engine.destroy();
	}
	// The device's own numbers, the numbers that the page's context reports, and the engine's refusal.
	return {
		real,
		reported: { vertex: real.vertex, fragment: Math.min(real.fragment, REPORTED_UNITS) },
		code: failure?.code ?? null,
		message: failure?.message ?? null,
	};
});
