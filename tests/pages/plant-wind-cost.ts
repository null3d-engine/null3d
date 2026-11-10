// What the plant material's wind offset costs at one preset: the plant review page's one hawthorn
// in its batch view, the turntable sheet's 30 cells, under the wind add-on's field. Each cell draws
// the plant once, so the material's vertex work scales with the cell count while the scene keeps one
// plant. The material's sway distance is the preset's value on the on side and one millimeter on
// the off side, so the plant stands past the fade and the material's offset is skipped. The field
// runs on both sides, so its cost is common and the difference is the material's own cost: the
// vertex offset and the far shadow redraws that the moving vertices force. One side per page load,
// because a material's sway distance is fixed when the engine makes it; the spec pairs two loads
// with the same page, view, size, wind and time.
import { createEngine, type QualityPreset } from '@null3d/engine';
import type { SideCost } from '../lib/cost-runs';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The preset of the engine and of the plant's mesh detail. */
const PRESET = (params.get('preset') ?? 'high') as QualityPreset;
/** Which side of the pair this load measures. */
const SIDE = params.get('side') === 'off' ? 'off' : 'on';
/** Rounds of each side, and the seconds of each round. */
const ROUNDS = Math.max(1, Number(params.get('rounds') ?? 5));
const SECONDS = Math.max(1, Number(params.get('seconds') ?? 2));
/** The frame's size, which the sketch's camera framing takes. */
const SIZE = '960x540';
/** The review page's batch view: its turntable sheet, one cell for each turn of the plant. */
const VIEW = 'turntable';
/** The cells in the sheet, each drawing the plant once, so the material's vertex work scales. */
const TURNS = 30;
/** The wind's strength, which both sides share. */
const WIND = 2;

run('plant-wind-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/plant-review-sketch.ts', import.meta.url);
	sketch.searchParams.set('species', 'hawthorn-shrub');
	sketch.searchParams.set('view', VIEW);
	sketch.searchParams.set('turns', String(TURNS));
	sketch.searchParams.set('size', SIZE);
	sketch.searchParams.set('preset', PRESET);
	sketch.searchParams.set('wind', String(WIND));
	// The off side keeps the field and fades the material's offset out at a millimetre.
	if (SIDE === 'off') sketch.searchParams.set('sway', '0.001');
	// Vite takes a module's language from the last dot of its address, and the off address ends in
	// a decimal, so the language marker goes last.
	if (sketch.search) sketch.search += '&lang.ts';
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, preset: PRESET });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	const messages: Record<string, unknown> = {};
	engine.onSketchMessage((name, data) => {
		messages[name] = data;
	});
	await engine.firstFrame;
	// The turn does nothing: one side per load. featureCost warms up, then measures this side alone.
	const cost = await featureCost(engine, async () => {}, undefined, {
		sides: [SIDE],
		rounds: ROUNDS,
		seconds: SECONDS,
	});
	const side: SideCost = cost[SIDE];
	const built = messages['plant-review'] ?? null;
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		preset: engine.mode.preset,
		side: SIDE,
		sway: SIDE === 'off' ? 0.001 : null,
		wind: WIND,
		cost: side,
		built,
		failures,
	};
});
