// EngineError: every error the engine throws carries a code, what failed, how to fix it, and a link
// to the code's docs page. Each thread sets the table of fixes that ends the messages before it can
// raise an error: createEngine sets the page's own table, and each worker sets the copy that the
// page hands it, so no worker's file carries the text.

import type { ErrorCode, ErrorFixes } from './fixes';

const DOCS_BASE = 'https://github.com/null3d-engine/null3d/blob/main/docs/errors/';

/** Each code's fix on this thread. A thread sets it before it can raise an error. */
let fixes: ErrorFixes | undefined;

/** Gives this thread the fix of each code: the page's own table, or a worker's copy of it. */
export function setErrorFixes(table: ErrorFixes): void {
	fixes = table;
}

/** True for a code in the engine's error table. */
export function isErrorCode(code: string): code is ErrorCode {
	return fixes !== undefined && Object.hasOwn(fixes, code);
}

/**
 * An error the engine throws. Its message says what failed and how to fix it, and links to the
 * code's docs page.
 *
 * @category api/engine
 */
export class EngineError extends Error {
	/** The error's code, such as `E1108`. */
	readonly code: ErrorCode;
	/** The docs page for this code. */
	readonly docs: string;

	constructor(code: ErrorCode, detail: string) {
		const docs = `${DOCS_BASE}${code}.md`;
		super(`${code}: ${detail} ${fixes?.[code]} See ${docs}`);
		this.name = 'EngineError';
		this.code = code;
		this.docs = docs;
	}
}
