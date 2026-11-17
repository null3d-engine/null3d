// Runs one demo of examples/ live, as the examples page starts it, through the probe sketch, which
// reports where the demo's camera and its moving objects are. ?demo= names the demo. Once the
// engine draws, the page publishes its result and offers `demoProbe()` on the window, which
// resolves to the sketch's report. The page shows a demo's choices, and a page part's buttons, below
// the canvas. `stopDemo('signal')` aborts the demo's signal, `stopDemo('destroy')` destroys its
// engine, and `stopDemo('fail')` makes the engine fail with E1404. With ?pagePart, the page asks
// for a page part that the demo may not have. With ?hud, it gives the demo a HUD element, which
// shows until the demo hides it.
import { DEMOS } from '../../examples/demos';
import { startDemo } from '../../examples/lib/run';
import type { DemoProbe } from './lib/demo-probe';
import { run } from './lib/result';

declare global {
	interface Window {
		demoProbe?: () => Promise<DemoProbe>;
		stopDemo?: (how: 'signal' | 'destroy' | 'fail') => Promise<void>;
	}
}

run('demo-probe', async () => {
	const params = new URLSearchParams(location.search);
	const name = params.get('demo');
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (!demo) throw new Error(`Add ?demo= with the name of a demo, not ${name}.`);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The plugin reads the sketch's address as a literal, so the query goes on after.
	const sketch = new URL('./sketches/demo-probe-sketch.ts', import.meta.url);
	sketch.searchParams.set('demo', new URL(demo.sketch).pathname);
	// The bar of a demo's choices, where a demo with a page part shows its buttons too.
	const choices = document.createElement('div');
	document.body.append(choices);
	const hud = params.has('hud') ? document.createElement('div') : undefined;
	if (hud) {
		hud.className = 'hud';
		document.body.append(hud);
	}
	const stop = new AbortController();
	const engine = await startDemo({
		canvas,
		demo: { ...demo, sketch, ...(params.has('pagePart') && { pagePart: true }) },
		choices,
		...(hud && { hud }),
		signal: stop.signal,
	});
	window.stopDemo = async (how) => {
		if (how === 'signal') stop.abort();
		else if (how === 'destroy') await engine.destroy();
		else engine.postToSketch('fault');
	};
	await engine.firstFrame;
	window.demoProbe = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((message, data) => {
				if (message !== 'probe') return;
				off();
				resolve(data as DemoProbe);
			});
			engine.postToSketch('probe');
		});
	return { mode: engine.mode };
});
