// The WebGL2 context of the canvas the engine draws on, and what every WebGL2 renderer does with it:
// act out a loss, wait for the GPU, and give the context up.

import type { PowerPreference } from '../../page/capabilities';

/** How long a simulated loss keeps the context away. */
const SIMULATED_RESTORE_MS = 50;

/**
 * The canvas's WebGL2 context. The engine draws into its own multisampled targets and resolves them
 * into the canvas, so the canvas needs no antialiasing, depth or stencil. It has no alpha, because
 * the page shows it opaque. A lost and restored canvas gives back the same context.
 */
export function webgl2Context(
	canvas: OffscreenCanvas | HTMLCanvasElement,
	powerPreference: PowerPreference | undefined,
): WebGL2RenderingContext {
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
		powerPreference,
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('the canvas has no WebGL2 context');
	return gl;
}

/** Loses the context as a driver reset would, and gives it back after a moment, as drivers do. */
export function simulateContextLoss(gl: WebGL2RenderingContext): void {
	const lose = gl.getExtension('WEBGL_lose_context');
	lose?.loseContext();
	setTimeout(() => lose?.restoreContext(), SIMULATED_RESTORE_MS);
}

/** Resolves when the GPU has finished every command given so far. */
export function contextFinished(gl: WebGL2RenderingContext): Promise<void> {
	const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
	gl.flush();
	return new Promise((resolve) => {
		// Checked on a timer, never waited on, so the thread stays free (hard rule 4).
		const check = () => {
			if (
				fence &&
				!gl.isContextLost() &&
				gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED
			) {
				setTimeout(check, 1);
				return;
			}
			if (fence && !gl.isContextLost()) gl.deleteSync(fence);
			resolve();
		};
		check();
	});
}

/** Gives the context up, unless the browser already took it. */
export function releaseContext(gl: WebGL2RenderingContext): void {
	if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
}
