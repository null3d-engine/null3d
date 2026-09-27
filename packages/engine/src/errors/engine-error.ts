// EngineError: every error the engine throws carries a code, what failed, how to fix it, and a link
// to the code's docs page.

import { ERRORS, type ErrorCode } from './codes';

const DOCS_BASE = 'https://github.com/sokko3d/sokko3d/blob/main/docs/errors/';

export class EngineError extends Error {
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
