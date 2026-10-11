// A custom effect with a loop beside bloom and the vignette, on the GPU path that the switches ask
// for. The effect reads only its own pixel and the depth, so the engine folds it into the final
// pass once nothing reads the image between them. Bloom reads it, so the page first plays with
// bloom on, where the fold builds nothing. It then turns bloom off, waits while the fold's shader
// builds in the background and the effect draws a pass of its own (D-71), measures play, and
// reports the joined shaders that built, failed or stayed unbuilt. A failed fold leaves the effect
// in a pass of its own, so the image alone cannot tell.
import { createEngine } from '@null3d/engine';
import type { JoinTimingReport } from '../../packages/engine/src/gpu/effect-join';
import { requestJoinTiming } from './lib/join-timing';
import { progress, run } from './lib/result';

/** How long the page waits for the fold's build. */
const BUILD_WAIT_MS = 30_000;

/** How long the page plays with bloom on, longer than a fold's build takes. */
const BLOOM_PLAY_SECONDS = 2;

run('effect-fold', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/effect-fold-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	progress('first frame');
	await engine.measure(BLOOM_PLAY_SECONDS);
	const withBloom = await requestJoinTiming();
	engine.postToSketch('bloom-off', null);
	await settledJoins();
	progress('the fold settled without bloom');
	await engine.measure(0.5);
	const play = await engine.measure(0.5);
	const withoutBloom = await requestJoinTiming();
	await engine.destroy();
	const kinds = (report: JoinTimingReport | undefined) => report?.builds.map((b) => b.kind) ?? [];
	return {
		tier: engine.capabilities.tier,
		builtWithBloom: kinds(withBloom),
		built: kinds(withoutBloom),
		failed: withoutBloom?.failed ?? null,
		keptApart: withoutBloom?.keptApart ?? null,
		skippedDraws: play.skippedDraws,
		pipelines: play.pipelines,
		failures,
	};
});

/** Waits until a joined shader has built, failed or stayed unbuilt, or until the wait ends. */
async function settledJoins(): Promise<void> {
	const end = performance.now() + BUILD_WAIT_MS;
	while (performance.now() < end) {
		const report = await requestJoinTiming();
		if (report && report.builds.length + report.failed.length + report.keptApart.length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}
