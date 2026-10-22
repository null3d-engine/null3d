// A draw that makes its vertices from a vertex count: how many bytes a frame uploads with 1,000
// copies, and with 50,000. The two figures must be the same apart from the frame's own records, so
// a draw whose shader makes every streak costs no upload per copy.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { run } from './lib/result';

/** The copies that the first measurement draws. */
const FEW = 1_000;
/** The copies that the second measurement draws. */
const MANY = 50_000;

/** The figures that the test reads. */
const figures = (metrics: FrameMetrics) => ({
	uploadBytes: metrics.uploadBytes.median,
	uploadP99: metrics.uploadBytes.p99,
	drawCalls: metrics.drawCalls.median,
});

run('vertex-draw', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/vertex-draw-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	let settle: (data: unknown) => void = () => {};
	const accepted = new Promise<unknown>((resolve) => {
		settle = resolve;
	});
	engine.onSketchMessage((name, data) => {
		if (name === 'counts-set') settle(data);
	});
	// The first measurement downloads the code that reads the frame records, so the second one
	// gives the steady figure.
	await engine.measure(1);
	const before = await engine.measure(1);
	engine.postToSketch('counts', { vertices: 6, instances: MANY });
	const taken = await accepted;
	// A frame or two with the new counts, before the measurement.
	await new Promise((resolve) => setTimeout(resolve, 250));
	const after = await engine.measure(2);
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	await engine.destroy();
	return {
		tier,
		mode,
		few: FEW,
		many: MANY,
		accepted: taken,
		before: figures(before),
		after: figures(after),
	};
});
