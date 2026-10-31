// Times each of Creek's shadow cascade passes on one view, with and without the parts of the scene
// that move every frame (tests/pages/creek-cascade-share.html). The sketch holds its route at the
// opening shot and draws every cascade in every frame, so a pass that rests in the schedule still
// reports. ?without=grass leaves the swaying tufts out, and the grass's floating leaves too, so the
// cascade passes then draw only the casters that stand still. The difference between the two sides
// is the movers' share of each pass, which no cache can take. It publishes the frame's GPU time and
// every pass's median on window.__null3dResult, and prints them.
import { createEngine, type FrameMetrics } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);
/** The seconds that the engine measures once the scene has settled. */
const SECONDS = Number(params.get('seconds') ?? 8);
/** The seconds between the first frame and the measurement, so the scene's loads finish. */
const SETTLE_SECONDS = Number(params.get('settle') ?? 4);

/** A pass's name, its median in ms and its 95th percentile. */
interface PassFigure {
	name: string;
	median: number;
	p95: number;
}

/** A page result for the driver: the frame's GPU time and each pass's. */
interface ShareResult {
	gpuMs: number | null;
	gpuP95: number | null;
	gpuStepMs: number | null;
	passes: PassFigure[];
	drawCalls: number;
	presentedFps: number;
	frames: number;
	width: number;
	height: number;
	css: [number, number];
	dpr: number;
	tier: string;
	mode: string;
}

run('creek-cascade-share', async (): Promise<Record<string, unknown>> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The Creek sketch takes the page's switches, such as ?without=grass, ?mood=Midday and
	// ?cascade-probe. The URL keeps no hash, so the sketch's own module address carries the search.
	const sketch = new URL('../../examples/showcase/creek/sketch.ts', import.meta.url);
	sketch.search = location.search;
	// One pixel per device pixel at the page's own fixed size, so the frame figure has a size.
	const engine = await createEngine({ canvas, sketch, stats: false, maxPixelRatio: 1 });
	progress('the engine started');
	await engine.firstFrame;
	progress('the first frame drew');
	await new Promise((resolve) => setTimeout(resolve, SETTLE_SECONDS * 1000));
	const measure: FrameMetrics = await engine.measure(SECONDS);
	progress(`measured ${measure.frames} frames`);
	const result: ShareResult = {
		gpuMs: measure.gpuMs?.median ?? null,
		gpuP95: measure.gpuMs?.p95 ?? null,
		gpuStepMs: measure.gpuStepMs,
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
		css: [canvas.clientWidth, canvas.clientHeight],
		dpr: devicePixelRatio,
		tier: engine.capabilities.tier,
		mode: JSON.stringify(engine.mode),
	};
	const line =
		`frame ${result.gpuMs ?? 'none'} ms at ${result.width}x${result.height} ` +
		`(css ${result.css[0]}x${result.css[1]}, ${result.dpr}x), ` +
		`${result.drawCalls.toFixed(1)} calls, ${result.frames} frames, ${result.tier}`;
	const passes = result.passes.map(
		(pass) => `  ${pass.name}: ${pass.median.toFixed(4)} ms (p95 ${pass.p95.toFixed(4)})`,
	);
	const status = document.querySelector('#status');
	if (status) status.textContent = [line, ...passes].join('\n');
	progress(`gpu ${result.gpuMs ?? 'none'} ms, ${result.passes.length} passes`);
	await engine.destroy();
	return { ...result };
});
