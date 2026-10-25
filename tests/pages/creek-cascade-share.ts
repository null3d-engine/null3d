// A probe for D-264: Creek's own shadow cascades, timed on a page that holds its route at the
// opening pose and its hour at midday, with every cascade drawing in every frame. The page's own
// switches reach the sketch, so ?without=grass leaves the grass out and its shadow pass draws every
// other caster. It publishes the GPU time of each render pass, which the record pairs across the
// two sides. Temporary: it is deleted once the run that it serves is recorded.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the engine measures once the scene has settled. */
const SECONDS = Number(params.get('seconds') ?? 6);
/** The seconds between the first frame and the measurement, so the scene's loads finish. */
const SETTLE_SECONDS = Number(params.get('settle') ?? 3);

/** A pass's name, its median in ms and its 95th percentile. */
interface PassFigure {
	name: string;
	median: number;
	p95: number;
}

/** A page result for the driver: the frame's GPU time and each pass's. */
interface ShareResult {
	frameMs: number | null;
	frameP95: number | null;
	passes: PassFigure[];
	drawCalls: number;
	presentedFps: number;
	frames: number;
	width: number;
	height: number;
}

run('creek-cascade-share', async (): Promise<Record<string, unknown>> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The Creek sketch takes the page's switches, such as ?without=grass and ?mood=Midday. The URL
	// keeps no hash, so the sketch's own module address carries the search.
	const sketch = new URL('../../examples/showcase/creek/sketch.ts', import.meta.url);
	sketch.search = location.search;
	// One pixel per device pixel at a fixed 1,920 by 1,080, so the frame figure has a size.
	const engine = await createEngine({ canvas, sketch, stats: false, maxPixelRatio: 1 });
	progress('the engine started');
	await engine.firstFrame;
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, SETTLE_SECONDS * 1000));
	const measure: FrameMetrics = await engine.measure(SECONDS);
	progress(`measured ${measure.frames} frames`);
	const result: ShareResult = {
		frameMs: measure.gpuMs?.median ?? null,
		frameP95: measure.gpuMs?.p95 ?? null,
		passes: (measure.gpuPassMs ?? []).map((pass) => ({
			name: pass.name,
			median: pass.ms.median,
			p95: pass.ms.p95,
		})),
		drawCalls: measure.drawCalls.median,
		presentedFps: measure.presentedFps,
		frames: measure.frames,
		width: canvas.width,
		height: canvas.height,
	};
	const line =
		`frame ${result.frameMs ?? 'none'} ms at ${result.width}x${result.height}, ` +
		`${result.drawCalls.toFixed(1)} calls, ${result.frames} frames`;
	const passes = result.passes.map((pass) => `  ${pass.name}: ${pass.median.toFixed(3)} ms`);
	const status = document.querySelector('#status');
	if (status) status.textContent = [line, ...passes].join('\n');
	progress(`gpu ${result.frameMs ?? 'none'} ms, ${result.passes.length} passes`);
	return { ...result };
});
