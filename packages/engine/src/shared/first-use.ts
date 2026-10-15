// Code and files that the engine loads on their first use, such as a decoder, a feature's code or a
// file of shader builds (D-54). Every such load goes through this one helper, so each fails the same
// way: the load runs once while it is under way and its result serves every later use. A failed
// load does not stay failed. After a wait, the next use loads again, so a dropped connection or a
// deploy that replaced the file costs the feature a few seconds, not the page. The wait doubles
// with each failure in a row, so a feature that asks in every frame does not ask the network in
// every frame. The callers report the failure: a call that returns a promise rejects, and other
// uses report through the frame loop.

/** The wait after a first failed load before the next use loads again, in ms. */
export const FIRST_RETRY_MS = 1000;
/** The longest wait between two loads after failures in a row, in ms. */
export const LONGEST_RETRY_MS = 32_000;

/** Code or a file that loads on its first use, and loads again after a wait when it failed. */
export class FirstUse<T> {
	/** What the load gave, once it has loaded. */
	value: T | undefined;
	/** Why the last load failed, until the next load starts. */
	error: unknown;
	private loading: Promise<T> | undefined;
	private failed = false;
	/** The time from which a use loads again after a failure, in ms of `performance.now()`. */
	private retryAt = 0;
	private wait = FIRST_RETRY_MS;

	/**
	 * `load` starts the load. `onFailure` hears why each failed load failed, once per load, for a
	 * use that cannot reject, such as a frame that waits for a file.
	 */
	constructor(
		private readonly load: () => Promise<T>,
		private readonly onFailure?: (error: unknown) => void,
	) {}

	/** Settles when the load under way ends, whatever its end, or at once when none started. */
	settled(): Promise<unknown> {
		return this.loading?.catch(() => undefined) ?? Promise.resolve();
	}

	/** Resolves once a use may load again after the last failure: at once when none failed. */
	untilRetry(): Promise<void> {
		const wait = this.failed ? this.retryAt - performance.now() : 0;
		return new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
	}

	/**
	 * The load: the one under way, or the one that finished. The first call starts it. After a
	 * failure, a call before the wait ends gets that failure again, and the first call after it
	 * loads again.
	 */
	get(): Promise<T> {
		const { loading } = this;
		if (loading && !(this.failed && performance.now() >= this.retryAt)) return loading;
		this.failed = false;
		this.error = undefined;
		const next = new Promise<T>((resolve) => resolve(this.load())).then(
			(value) => {
				this.value = value;
				return value;
			},
			(error: unknown) => {
				this.failed = true;
				this.error = error;
				this.retryAt = performance.now() + this.wait;
				this.wait = Math.min(2 * this.wait, LONGEST_RETRY_MS);
				this.onFailure?.(error);
				throw error;
			},
		);
		// A use that only starts the load, as a frame that checks for it does, leaves the failure to
		// `onFailure` or a later call: the browser does not report it as unhandled.
		next.catch(() => {});
		this.loading = next;
		return next;
	}
}
