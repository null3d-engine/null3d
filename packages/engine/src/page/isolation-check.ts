// The development check of a page that a service worker answers. A game that plays offline caches
// its page in its own service worker. When the worker answers the page from its cache without the
// page's isolation headers, the page loses cross-origin isolation, and the engine starts its
// single-threaded build with no error. The check names that cause, so the developer need not find
// it from the slower frames.

/** The facts about the page that the check reads. */
export interface PageIsolation {
	/** True when the page is cross-origin isolated, so shared memory is available. */
	isolated: boolean;
	/** True when a service worker controls the page, so it answered the page's request. */
	controlled: boolean;
}

/** The facts of the page that the engine runs on. */
export function pageIsolation(): PageIsolation {
	return {
		isolated: globalThis.crossOriginIsolated === true,
		controlled: Boolean(globalThis.navigator?.serviceWorker?.controller),
	};
}

/**
 * The warning for a page that a service worker controls and that is not cross-origin isolated, or
 * undefined when the page is isolated or no service worker controls it.
 */
export function lostIsolationWarning({ isolated, controlled }: PageIsolation): string | undefined {
	if (isolated || !controlled) return undefined;
	return "null3D: a service worker controls this page, and the page is not cross-origin isolated, so the engine runs single-threaded. When the service worker answers the page from its cache, its response must keep the page's Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. Docs: getting-started/hosting#offline-play.";
}
