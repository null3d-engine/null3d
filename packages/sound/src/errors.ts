// The add-on's errors: each has its own code in the add-on's range and says how to fix the problem.

/** The first code that the add-on's own errors use. */
export const SOUND_CODES = 2500;

/** An error that the add-on raises, with its own code and a message that says how to fix it. */
export function soundError(code: number, detail: string): Error {
	return new Error(`sound E${code}: ${detail}`);
}
