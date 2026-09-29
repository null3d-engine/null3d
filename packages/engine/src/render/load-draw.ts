// Loads the renderer on a thread that draws only in some modes: the page and the sketch worker. The
// bundler puts the renderer and the GPU layer in a file of their own, which a thread downloads only
// when it draws.

export type DrawModule = typeof import('./draw');

/**
 * Starts loading the renderer, so the download overlaps the thread's other startup work. A failed
 * load is reported where the thread awaits the module, not as an unhandled rejection.
 */
export function loadDrawModule(): Promise<DrawModule> {
	const loading = import('./draw');
	loading.catch(() => {});
	return loading;
}
