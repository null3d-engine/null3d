// Runs one demo of examples/ live, as the examples page starts it, through the probe sketch, which
// reports where the demo's camera and its moving objects are. ?demo= names the demo. Once the
// engine draws, the page publishes its result and offers `demoProbe()` on the window, which
// resolves to the sketch's report. The page shows a demo's choices, and a page part's buttons, below
// the canvas. `stopDemo('signal')` aborts the demo's signal, `stopDemo('destroy')` destroys its
// engine, and `stopDemo('fail')` makes the engine fail with E1404. With ?pagePart, the page asks
// for a page part that the demo may not have. With ?hud, it gives the demo a HUD element, which
// shows until the demo hides it.
//
// With ?switchTo=, the page does not wait for the demo's start, and the demo runs the empty sketch.
// `switchDemo()` aborts the demo and starts the one that ?switchTo= names on a second canvas, with
// the same choices and HUD, as a page that moves from one demo to the next does. `firstDemo`
// settles once the first demo's start ends, and the page then destroys its engine.
// `startAbortedPart()` starts the demo's page part on a signal that is already aborted, and
// resolves to how many elements it left in the choices.
import { DEMOS, type Demo } from '../../examples/demos';
import { type DemoPage, startDemo } from '../../examples/lib/run';
import type { DemoProbe } from './lib/demo-probe';
import { run } from './lib/result';

declare global {
	interface Window {
		demoProbe?: () => Promise<DemoProbe>;
		stopDemo?: (how: 'signal' | 'destroy' | 'fail') => Promise<void>;
		switchDemo?: () => Promise<void>;
		firstDemo?: Promise<string>;
		startAbortedPart?: () => Promise<number>;
	}
}

/** The demo that `name` names, or a failure that says to name one. */
function namedDemo(name: string | null): Demo {
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (!demo) throw new Error(`Add ?demo= with the name of a demo, not ${name}.`);
	return demo;
}

/** The probe sketch for `demo`, which runs the demo's own sketch and reports on it. */
function probeSketch(demo: Demo): URL {
	// The plugin reads the sketch's address as a literal, so the query goes on after.
	const sketch = new URL('./sketches/demo-probe-sketch.ts', import.meta.url);
	sketch.searchParams.set('demo', new URL(demo.sketch).pathname);
	return sketch;
}

run('demo-probe', async () => {
	const params = new URLSearchParams(location.search);
	const demo = namedDemo(params.get('demo'));
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// A demo that the page leaves while its part loads draws nothing, since its part never starts.
	const sketch = params.has('switchTo')
		? new URL('./sketches/empty-sketch.ts', import.meta.url)
		: probeSketch(demo);
	// The bar of a demo's choices, where a demo with a page part shows its buttons too.
	const choices = document.createElement('div');
	document.body.append(choices);
	const hud = params.has('hud') ? document.createElement('div') : undefined;
	if (hud) {
		hud.className = 'hud';
		document.body.append(hud);
	}
	const stop = new AbortController();
	const starting = startDemo({
		canvas,
		demo: { ...demo, sketch, ...(params.has('pagePart') && { pagePart: true }) },
		choices,
		...(hud && { hud }),
		signal: stop.signal,
	});
	if (params.has('switchTo')) {
		const next = namedDemo(params.get('switchTo'));
		window.firstDemo = starting.then(
			async (engine) => {
				await engine.destroy();
				return 'started';
			},
			(error: unknown) => `failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		window.switchDemo = async () => {
			stop.abort();
			const second = document.createElement('canvas');
			canvas.after(second);
			// The second demo's choices and HUD are on the page once its start resolves. Its engine
			// draws no frame while the first demo's engine runs, so the switch waits for no frame.
			await startDemo({
				canvas: second,
				demo: { ...next, sketch: probeSketch(next) },
				choices,
				...(hud && { hud }),
			});
		};
		return { switching: true };
	}
	const engine = await starting;
	window.stopDemo = async (how) => {
		if (how === 'signal') stop.abort();
		else if (how === 'destroy') await engine.destroy();
		else engine.postToSketch('fault');
	};
	await engine.firstFrame;
	if (demo.pagePart)
		window.startAbortedPart = async () => {
			const part = (await import(`../../examples/${demo.name}/page.ts`)) as DemoPage;
			const element = document.createElement('div');
			const ended = new AbortController();
			ended.abort();
			part.start(engine, canvas, element, ended.signal);
			return element.childElementCount;
		};
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
