// Measures how a scene's shadows look, and captures frames of it for people to look at. Every frame
// comes from the engine's hold mode, so it draws the same on every run. ?scene= names the scene's
// sketch module from the server's root, with its own query; ?n= and ?shadows= go into that query,
// as the benchmark pages pass them. ?at= is the sketch time to hold at, 2 s by default, and ?size=
// the canvas in pixels. The engine reads its own switches, such as ?gpu= and ?preset=.
//
// The page draws the scene through the shadow check sketch (lib/shadow-check.ts): the frames of the
// stability check, the reference for the edge and acne checks, then the normals view for the
// contact and acne checks.
// ?edge=x0,y0,x1,y1 names a box of the frame that one long shadow edge crosses from top to bottom,
// whose stair steps and seam jump the page measures in the frame, and its stair steps in the
// reference. With ?images, it also
// captures PNG files of the first and last shadows frames, the reference, the normals view, and
// consecutive frames of the moving scene as it draws them, 4 unless ?moving= gives another count,
// and publishes them in base64.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';
import {
	acneFigures,
	contactFigures,
	edgeOffset,
	MOVING_FRAMES,
	type PixelBox,
	type ShadowCheck,
	STABILITY_FRAMES,
	seamJump,
	shadowFactors,
	stabilityFigures,
	stairSteps,
} from './lib/shadow-check';

const params = new URLSearchParams(location.search);
const CHECK_SKETCH = '/tests/pages/sketches/shadow-check-sketch.ts';

/** The numbers of a switch such as ?size=480x270 or ?edge=1,2,3,4, or undefined without it. */
function numbers(name: string, separator: string, count: number): number[] | undefined {
	const text = params.get(name);
	if (text === null) return undefined;
	const values = text.split(separator).map(Number);
	if (values.length !== count || !values.every(Number.isFinite))
		throw new Error(`?${name}=${text} needs ${count} numbers, separated by "${separator}".`);
	return values;
}

/** The scene's sketch module, with the switches of the page that its query takes. */
function scenePath(): string {
	const path = params.get('scene');
	if (!path?.startsWith('/'))
		throw new Error('Add ?scene= with the path of a sketch module from the server root.');
	const url = new URL(path, location.origin);
	for (const name of ['n', 'shadows']) {
		const value = params.get(name);
		if (value !== null) url.searchParams.set(name, value);
	}
	return `${url.pathname}${url.search}`;
}

run('visual', async () => {
	const [width = 480, height = 270] = numbers('size', 'x', 2) ?? [];
	const at = Number(params.get('at') ?? 2);
	const edge = numbers('edge', ',', 4) as PixelBox | undefined;
	const withImages = params.has('images');
	const moving = Number(params.get('moving') ?? MOVING_FRAMES);
	const scene = scenePath();
	let facts: Record<string, unknown> = {};
	const images: Record<string, string> = {};

	/** Draws `sketch` held at `time`, and returns its pixels, with a PNG file of it when named. */
	const draw = async (sketch: string, time: number, image?: string): Promise<Uint8Array> => {
		// A canvas that an engine drew on belongs to that engine's worker, so each engine gets its own.
		document.querySelector('canvas')?.remove();
		const canvas = document.createElement('canvas');
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
		document.body.prepend(canvas);
		const engine = await createEngine({
			canvas,
			sketch: new URL(sketch, location.origin),
			maxPixelRatio: 1,
			hold: time,
		});
		try {
			facts = { tier: engine.capabilities.tier, mode: engine.mode };
			const frame = await engine.captureFrame();
			if (frame.width !== width || frame.height !== height)
				throw new Error(`the frame is ${frame.width} x ${frame.height}, not ${width} x ${height}`);
			if (image && withImages)
				images[image] = toBase64(new Uint8Array(await (await engine.capture()).arrayBuffer()));
			return frame.pixels;
		} finally {
			await engine.destroy();
		}
	};
	const checked = (check: ShadowCheck) =>
		`${CHECK_SKETCH}?${new URLSearchParams({ scene, at: String(at), check })}`;

	const stability: Float32Array[] = [];
	for (let k = 0; k < STABILITY_FRAMES; k++) {
		const image = k === 0 ? 'shadows' : k === STABILITY_FRAMES - 1 ? 'shadows-moved' : undefined;
		stability.push(shadowFactors(await draw(checked('stability'), at + k / 60, image)));
	}
	const first = stability[0] as Float32Array;
	const reference = shadowFactors(await draw(checked('reference'), at, 'shadows-reference'));
	const normals = await draw(checked('normals'), at, 'normals');
	if (withImages)
		for (let k = 0; k < moving; k++) await draw(scene, at + k / 60, `moving-${k + 1}`);
	return {
		...facts,
		scene,
		width,
		height,
		stability: stabilityFigures(stability),
		edges: {
			offsetPixels: edgeOffset(first, reference, width),
			...(edge && {
				steps: stairSteps(first, width, edge),
				referenceSteps: stairSteps(reference, width, edge),
				seamPixels: seamJump(first, width, edge),
			}),
		},
		contact: contactFigures(first, normals, width),
		acne: acneFigures(first, reference, normals, width),
		...(withImages && { images }),
	};
});
