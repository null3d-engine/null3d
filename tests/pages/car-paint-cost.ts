// Measures what the car paint costs on this device: the panel of tests/pages/sketches/
// car-paint-cost-sketch.ts, timed with a plain clear-coated metal and with the paint in turns. The
// sides take the opposite order on alternate rounds, so a clock or a cache that changes during the
// run moves both alike. ?scale= draws at that render scale, held with the frame-budget governor off:
// a governor that moved the scale would change the pixel count as the sides were timed, which hides
// the work being measured. ?governor lets it run instead. ?rounds= and ?seconds= set the
// measurement, and ?paint= picks the painted side's parts: full, flakes, body, loop or loop-0, as
// tests/pages/sketches/car-paint-cost-sketch.ts describes. It runs only in a quiet window on a
// computer with a GPU of its own:
// NULL3D_PAINT_COST=1 bun run test:browser -- car-paint-cost.spec.ts.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const fixed = !params.has('governor');
const paint = params.get('paint') ?? 'full';
if (!['full', 'flakes', 'body', 'loop', 'loop-0'].includes(paint))
	throw new Error(`the page takes no paint ${paint}`);
const rounds = params.get('rounds');
if (rounds !== null && !(Number.isSafeInteger(Number(rounds)) && Number(rounds) >= 1))
	throw new Error(`the page takes no round count ${rounds}`);
const seconds = params.get('seconds');
if (seconds !== null && !(Number(seconds) > 0))
	throw new Error(`the page takes no seconds ${seconds}`);
const warmUp = params.get('warm-up');
if (warmUp !== null && !(Number(warmUp) > 0))
	throw new Error(`the page takes no warm-up ${warmUp}`);

run('car-paint-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/car-paint-cost-sketch.ts', import.meta.url);
	sketch.search = `?scale=${scale}${fixed ? '&fixed' : ''}&paint=${paint}`;
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			// A message that the sketch sent before this handler waited is handed over as this call
			// registers it, so the stop call must already exist when the handler first runs.
			let stop: () => void = () => {};
			stop = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				stop();
				resolve();
			});
		});
	const { off, on } = await featureCost(
		engine,
		async (drawn) => {
			if (!drawn) {
				engine.postToSketch('paint-off', null);
				return;
			}
			const built = settled();
			engine.postToSketch('paint', null);
			await built;
		},
		undefined,
		{
			alternate: true,
			...(rounds === null ? {} : { rounds: Number(rounds) }),
			...(seconds === null ? {} : { seconds: Number(seconds) }),
			...(warmUp === null ? {} : { warmUpSeconds: Number(warmUp) }),
		},
	);
	// The drawing buffer in device pixels, which the window, the screen's pixel ratio and the
	// render scale together set. Every preset draws at this size, so a cost follows the paint.
	const buffer: [number, number] = [canvas.width, canvas.height];
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		paint,
		buffer,
		// The window in CSS pixels and the screen's pixel ratio: the preset's cap sets the drawing
		// buffer's size from them.
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
