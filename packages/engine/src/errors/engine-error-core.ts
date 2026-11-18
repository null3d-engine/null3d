// The parts of an engine error that need no text of the fixes: the docs address, the message's form
// and the mark that makes instanceof accept an error. engine-error.ts builds EngineError on them and
// loads the fixes at a thread's first error. Code that a deterministic simulation bundles, such as
// the maths entry's `createMath`, throws an EngineErrorWithFix from here instead, with its fix
// given, so the bundle holds neither the table of fixes nor the dynamic import that loads it.
//
// Every class that puts the mark on its errors makes errors that `instanceof EngineError` accepts,
// as the errors of a second copy of engine-error.ts in a thread are.

import type { ErrorCode } from './fixes';

/** The address of the folder that holds each code's docs page. */
export const DOCS_BASE = 'https://github.com/null3d-engine/null3d/blob/generated/docs/errors/';

/** The mark that every engine error carries, which every copy of EngineError reads. */
export const ENGINE_ERROR = Symbol.for('null3d.engineError');

/** Texts an error's message: its code and detail, the code's fix once loaded, and its docs page. */
export function messageFor(code: ErrorCode, detail: string, fix: string | undefined): string {
	// A message that came from another thread may hold its fix already.
	const text = fix !== undefined && !detail.endsWith(` ${fix}`) ? `${detail} ${fix}` : detail;
	return `${code}: ${text} See ${DOCS_BASE}${code}.md`;
}

/**
 * An engine error whose maker gives its fix, for code that may not load the table of fixes. It
 * carries the code, the message and the docs page as EngineError does, and `instanceof EngineError`
 * accepts it by the mark.
 */
export class EngineErrorWithFix extends Error {
	/** The error's code, such as `E1213`. */
	readonly code: ErrorCode;
	/** The docs page for this code. */
	readonly docs: string;

	constructor(code: ErrorCode, detail: string, fix: string) {
		super(messageFor(code, detail, fix));
		this.name = 'EngineError';
		this.code = code;
		this.docs = `${DOCS_BASE}${code}.md`;
	}

	/** Marks the error as an engine error. */
	get [ENGINE_ERROR](): true {
		return true;
	}
}
