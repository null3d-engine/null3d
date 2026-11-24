// `engine.firstFrame`: resolves once the GPU has finished the first frame after the setup, and
// rejects when the engine stops drawing first, so a page that waits only for the first frame
// hears why it never came. The engine starts its frames once the setup has run, and the preset
// check measures them during play, so a failure of the thread that draws at its first frame comes
// after `createEngine` has resolved.

import { EngineError } from '../errors/engine-error';

/** The first frame's promise, which the start settles once. */
export class FirstFrame {
	readonly promise: Promise<void>;
	private resolve: () => void = () => {};
	private reject: (error: EngineError) => void = () => {};

	constructor() {
		this.promise = new Promise<void>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
		// A page that never waits for the first frame hears nothing of a rejection.
		this.promise.catch(() => {});
	}

	/** The GPU has finished the first frame. */
	drawn(): void {
		this.resolve();
	}

	/**
	 * The engine draws no more frames. `drawn` says whether the GPU finished the first frame first,
	 * which resolves the promise. Otherwise it rejects with `failure`, the failure that ended the
	 * frames, or with E1420 for a stop that no failure caused.
	 */
	stopped(drawn: boolean, failure?: EngineError): void {
		if (drawn) this.resolve();
		else
			this.reject(
				failure ?? new EngineError('E1420', 'the engine stopped before it drew its first frame.'),
			);
	}
}
