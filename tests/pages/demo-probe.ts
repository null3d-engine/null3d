// Runs one demo of examples/ live, as the examples page starts it, through the probe sketch, which
// reports where the demo's camera and its moving objects are. ?demo= names the demo. Once the
// engine draws, the page publishes its result and offers `demoProbe()` on the window, which
// resolves to the sketch's report.
import { DEMOS } from '../../examples/demos';
import { startDemo } from '../../examples/lib/run';
import type { DemoProbe } from './lib/demo-probe';
import { run } from './lib/result';

declare global {
	interface Window {
		demoProbe?: () => Promise<DemoProbe>;
	}
}

run('demo-probe', async () => {
	const name = new URLSearchParams(location.search).get('demo');
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (!demo) throw new Error(`Add ?demo= with the name of a demo, not ${name}.`);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL(
		`./sketches/demo-probe-sketch.ts?demo=${new URL(demo.sketch).pathname}`,
		import.meta.url,
	);
	const engine = await startDemo({ canvas, demo: { ...demo, sketch } });
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
