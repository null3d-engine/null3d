// EngineError: every error the engine throws carries a code, what failed, how to fix it, and a link
// to the code's docs page.

import { ERRORS, type ErrorCode } from './codes';

const DOCS_BASE = 'https://github.com/sokko3d/sokko3d/blob/main/docs/errors/';

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
		super(`${code}: ${detail} ${ERRORS[code].fix} See ${docs}`);
		this.name = 'EngineError';
		this.code = code;
		this.docs = docs;
	}
}
