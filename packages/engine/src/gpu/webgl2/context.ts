// The WebGL2 context of the canvas the engine draws on, and what every WebGL2 renderer does with it:
// act out a loss, wait for the GPU, give the context up, and take back a context that an earlier
// engine gave up.

import type { PowerPreference } from '../../page/capabilities';

/** How long a simulated loss keeps the context away. */
const SIMULATED_RESTORE_MS = 50;

/** Both names of each context event: an offscreen canvas and a canvas element name them apart. */
export const LOST_EVENTS = ['contextlost', 'webglcontextlost'];
export const RESTORED_EVENTS = ['contextrestored', 'webglcontextrestored'];

type ContextCanvas = OffscreenCanvas | HTMLCanvasElement;

/** The key of the thread's canvas contexts on its global object. */
const CONTEXTS = Symbol.for('null3d.canvasContexts');
/** A canvas's own WebGL2 context, as the engine made it on this thread. */
interface CanvasContext {
	readonly gl: WebGL2RenderingContext;
	/**
	 * Set while an engine has given the context up. It gives the extension that brings the context
	 * back, once the browser has run the loss event: a restore before that event fails.
	 */
	givenUp?: Promise<WEBGL_lose_context>;
}
/** The thread's global object, which holds the contexts for every copy of this module. */
const thread = globalThis as { [CONTEXTS]?: WeakMap<ContextCanvas, CanvasContext> };
/**
 * Each canvas's context, from the engine's first request for it on this thread. Later engines on
 * the canvas and the release take it from here and never ask the canvas again: Firefox's offscreen
 * canvas in a worker throws on every `getContext` call after the first ("Cannot update created
 * context to different thread"). The entry holds only the canvas's own context, never an engine's
 * renderer, memory or workers, and goes with the canvas.
 */
const contexts = thread[CONTEXTS] ?? new WeakMap<ContextCanvas, CanvasContext>();
thread[CONTEXTS] = contexts;

/**
 * The canvas's WebGL2 context. The engine draws into its own multisampled targets and resolves or
 * tone maps them into the canvas, so the canvas needs no antialiasing, depth or stencil. It has
 * alpha only when it is `transparent`, and then holds premultiplied color, as the engine writes it.
 * A canvas keeps the settings of its first request, so a later engine on the canvas gets the same
 * context, as it does after a loss and a restore.
 */
export function webgl2Context(
	canvas: OffscreenCanvas | HTMLCanvasElement,
	powerPreference: PowerPreference | undefined,
	transparent = false,
): WebGL2RenderingContext {
	const known = contexts.get(canvas);
	if (known) return known.gl;
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: transparent,
		premultipliedAlpha: true,
		depth: false,
		stencil: false,
		powerPreference,
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('the canvas has no WebGL2 context');
	contexts.set(canvas, { gl });
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

/**
 * Gives the context up, unless the browser already took it, so the GPU frees its memory at once. A
 * canvas keeps its context for good, so the next engine on the canvas gets this one, lost, and
 * `reclaimContext` brings it back. The browser offers a context back only when the loss event was
 * cancelled, so this cancels it. `gl` may wrap the canvas's context, as call timing does, so the
 * canvas's own context is the one given up.
 */
export function releaseContext(gl: WebGL2RenderingContext): void {
	const canvas = gl.canvas as ContextCanvas;
	const own = contexts.get(canvas);
	if (!own || own.gl.isContextLost()) return;
	// A lost context has no extensions, so the extension is kept from before the loss.
	const lose = own.gl.getExtension('WEBGL_lose_context');
	if (!lose) return;
	own.givenUp = new Promise((resolve) => {
		const heard = new AbortController();
		const onLost = (event: Event) => {
			event.preventDefault();
			heard.abort();
			resolve(lose);
		};
		for (const name of LOST_EVENTS) canvas.addEventListener(name, onLost, { signal: heard.signal });
	});
	lose.loseContext();
}

/**
 * Asks the browser for the canvas's context back when an earlier engine gave it up. The context
 * then comes back as after any loss, with the restore event.
 */
export async function reclaimContext(canvas: ContextCanvas): Promise<void> {
	const own = contexts.get(canvas);
	const givenBack = own?.givenUp;
	if (!own || !givenBack) return;
	own.givenUp = undefined;
	(await givenBack).restoreContext();
}
