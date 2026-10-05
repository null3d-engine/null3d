// Measures what an effect costs on this device: ?effect=bloom (the default), ?effect=ao or
// ?effect=effects names it. The last adds ?count= custom effects, 4 by default, to bloom's scene.
// ?antialias= sets the engine's anti-aliasing mode: with ?gpu=compat, msaa starts on the 8-bit path
// and fxaa on HDR color, so two loads with count=0 give the cost of the move to HDR color. The effect's scene fills the window at the render scale that ?scale= fixes, 1 by default,
// with the governor off. After a warm-up, the page measures play with the effect off and on in
// turns, three times each, and reports the medians of each side's GPU time per frame, where the
// device has a GPU timer, and of its frame interval and CPU time. The device runner's bloom and ao
// plans run it on each GPU path at the scales of 1 and 0.5. With bloom, ?size= sets the quality
// setting bloomSize, the base of its chain, as the bloom-sizes plan does.
import { createEngine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

/**
 * Each effect's sketch, which turns the effect on at the message of the effect's name, posts
 * 'settled' once its pipelines are built, and turns it off at the name followed by '-off'.
 */
const SKETCHES = {
	bloom: './sketches/bloom-sketch.ts',
	ao: './sketches/ao-sketch.ts',
	effects: './sketches/effects-cost-sketch.ts',
} as const;

type Effect = keyof typeof SKETCHES;

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const size = params.get('size');
const count = params.get('count');
const antialias = params.get('antialias');
if (antialias !== null && antialias !== 'msaa' && antialias !== 'fxaa' && antialias !== 'none')
	throw new Error(`the page takes no anti-aliasing mode ${antialias}`);
const asked = params.get('effect') ?? 'bloom';
if (!Object.hasOwn(SKETCHES, asked)) throw new Error(`the page measures no effect ${asked}`);
const effect = asked as Effect;

run('effect-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL(SKETCHES[effect], import.meta.url);
	sketch.search = `?scale=${scale}&fixed${size === null ? '' : `&size=${size}`}${count === null ? '' : `&count=${count}`}`;
	const engine = await createEngine({ canvas, sketch, antialias: antialias ?? undefined });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const settled = () =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name) => {
				if (name !== 'settled') return;
				off();
				resolve();
			});
		});
	const { off, on } = await featureCost(engine, async (drawn) => {
		if (!drawn) {
			engine.postToSketch(`${effect}-off`, null);
			return;
		}
		const built = settled();
		engine.postToSketch(effect, null);
		await built;
	});
	await engine.destroy();
	return {
		effect,
		tier: engine.capabilities.tier,
		hdr: engine.capabilities.hdr,
		scale,
		bloomSize: size === null ? null : Number(size),
		effects: effect === 'effects' ? Number(count ?? '4') : null,
		antialias,
		// The window in CSS pixels and the screen's pixel ratio: the preset's cap on the ratio sets
		// the drawing buffer's size from them.
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		off,
		on,
		failures,
	};
});
