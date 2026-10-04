// The text of a thrown value, which may be an Error or anything else. A module of its own, so a
// worker that reports failures does not load the error table with it.

/** The message of `error` when it is an Error, or its text otherwise. */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The message of `error` without its closing period, to quote inside a sentence. */
export function reasonOf(error: unknown): string {
	return messageOf(error).replace(/\.$/, '');
}
