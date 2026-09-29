// Starts work now that a thread awaits later, such as a download that overlaps its other startup
// work.

/**
 * Returns `promise`, marked as handled: a failure reaches the code that awaits the promise later,
 * and the browser does not also report it as an unhandled rejection in the meantime.
 */
export function awaitLater<T>(promise: Promise<T>): Promise<T> {
	promise.catch(() => {});
	return promise;
}
