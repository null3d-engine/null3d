// Takes the GPU away from a running engine and reports what the page hears. By default it draws with
// WebGL2 on the page's thread (with ?threads=off or ?render=main) and takes the context away for
// good, so the engine gives up and reports E1302. With ?simulate, it calls engine.simulateGpuLoss
// in any mode, so the GPU comes back and the engine must carry on drawing without a failure.
// With ?mid-frame, which needs WebGL2 on the page's thread, the context goes away in the middle of
// a frame that makes new render targets, and comes back after a moment. The engine must carry on
// drawing without a failure then too.
import { createEngine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** How long the engine draws before the loss, and how long the page waits for a report. */
const DRAW_MS = 300;
const REPORT_MS = 10_000;
/** How long a simulated loss has to recover before the page measures the frames drawn after it. */
const RECOVERY_MS = 1000;
/** How long a context lost in the middle of a frame stays away, as a driver reset takes. */
const RESTORE_MS = 50;

const params = new URLSearchParams(location.search);

/**
 * Makes the next framebuffer check after `arm` lose the context first, as a GPU reset during the
 * frame would, and gives the context back a moment later. `fired` says whether a check came.
 */
function loseInNextFramebufferCheck(): { arm(): void; fired(): boolean } {
	const prototype = WebGL2RenderingContext.prototype;
	const check = prototype.checkFramebufferStatus;
	let armed = false;
	let fired = false;
	prototype.checkFramebufferStatus = function (this: WebGL2RenderingContext, target: number) {
		if (armed) {
			armed = false;
			fired = true;
			const lose = this.getExtension('WEBGL_lose_context');
			lose?.loseContext();
			setTimeout(() => lose?.restoreContext(), RESTORE_MS);
		}
		return check.call(this, target);
	};
	return {
		arm: () => {
			armed = true;
		},
		fired: () => fired,
	};
}

run('gpu-loss', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const midFrame = params.has('mid-frame') ? loseInNextFramebufferCheck() : undefined;
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
	});
	let failure: EngineError | null = null;
	engine.onFailure((error) => {
		failure = error;
	});
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	if (midFrame) {
		midFrame.arm();
		// A new size makes the frame's render targets again, with new framebuffers.
		canvas.style.width = '400px';
		await new Promise((resolve) => setTimeout(resolve, RECOVERY_MS));
		const after = await engine.measure(0.5);
		await engine.destroy();
		return {
			mode: engine.mode,
			tier: engine.capabilities.tier,
			code: (failure as EngineError | null)?.code ?? null,
			lostMidFrame: midFrame.fired(),
			framesAfter: after.frames,
		};
	}
	if (params.has('simulate')) {
		engine.simulateGpuLoss();
		await new Promise((resolve) => setTimeout(resolve, RECOVERY_MS));
		const after = await engine.measure(0.5);
		await engine.destroy();
		return {
			mode: engine.mode,
			tier: engine.capabilities.tier,
			code: failure,
			framesAfter: after.frames,
		};
	}
	canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
	const deadline = performance.now() + REPORT_MS;
	while (!failure && performance.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 100));
	await engine.destroy();
	const code = (failure as EngineError | null)?.code ?? null;
	return { mode: engine.mode, tier: engine.capabilities.tier, code };
});
