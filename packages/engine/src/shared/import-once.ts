// A module that the engine imports on its first use, shared by every caller. Callers that wait for
// it together then go on in the order they called: separate `import()` calls of one module that is
// still loading resolve in an order the browser picks, and code that makes scene content after
// the import would then make it in another order on each run, which a held frame must not do.

/**
 * Returns a function that starts `load` on its first call and gives every later call the same
 * promise, so the callers' code after it runs in the order they called. A load that fails is
 * forgotten, so the next call tries again.
 */
export function importOnce<T>(load: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | undefined;
	return () => {
		pending ??= load().catch((error: unknown) => {
			pending = undefined;
			throw error;
		});
		return pending;
	};
}
