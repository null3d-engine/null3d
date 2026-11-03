// The error that a stage of the plant core throws while it is not built yet. Every grower, every
// foliage builder and every stage function exists from the start and throws this error until its
// own work lands, so each part of the core fills only the files it owns. A run that asks for
// stand-ins (`placeholders` in the kit options) catches it and grows the stage's stand-in instead.

/**
 * A stage of the plant core that is not built yet.
 *
 * @category api/vegetation
 */
export class NotBuiltError extends Error {
	/** What the stage makes, such as "self-organizing growth". */
	readonly what: string;

	/**
	 * @param what What the stage makes.
	 */
	constructor(what: string) {
		super(`@null3d/vegetation: ${what} is not built yet.`);
		this.name = 'NotBuiltError';
		this.what = what;
	}
}

/**
 * The error a stage throws until it is built.
 *
 * @param what What the stage makes, such as "self-organizing growth".
 * @returns The error, for the stage to throw.
 * @category api/vegetation
 */
export function notBuilt(what: string): NotBuiltError {
	return new NotBuiltError(what);
}
