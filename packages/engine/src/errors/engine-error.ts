// EngineError: every error the engine throws carries a code, what failed, how to fix it, and a link
// to the code's docs page. Each thread sets the table of fixes that ends the messages before it can
// raise an error: createEngine sets the page's own table, and each worker sets the copy that the
// page hands it, so no worker's file carries the text.
//
// A thread can hold two copies of this module: in a production build, the sketch worker runs the
// engine's worker code, and the sketch's bundle imports the engine again from the page's file. So
// the table of fixes and the mark on each error live under registered symbols, which every copy in
// the thread shares. Each copy then reads the same table, and instanceof accepts the errors of both.

import type { ErrorCode, ErrorFixes } from './fixes';

const DOCS_BASE = 'https://github.com/null3d-engine/null3d/blob/generated/docs/errors/';

/** The key of the thread's table of fixes on its global object. */
const FIXES = Symbol.for('null3d.errorFixes');
/** The mark that every copy of EngineError puts on its errors. */
const ENGINE_ERROR = Symbol.for('null3d.engineError');

/** The thread's global object, which holds the table of fixes for every copy of this module. */
const thread = globalThis as { [FIXES]?: ErrorFixes };

/** Gives this thread the fix of each code: the page's own table, or a worker's copy of it. */
export function setErrorFixes(table: ErrorFixes): void {
	thread[FIXES] = table;
}

/** True for a code in the engine's error table. */
export function isErrorCode(code: string): code is ErrorCode {
	const fixes = thread[FIXES];
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
		// A thread without a table, such as the page before createEngine, leaves the fix out.
		const fix = thread[FIXES]?.[code];
		super(`${code}: ${detail} ${fix === undefined ? '' : `${fix} `}See ${docs}`);
		this.name = 'EngineError';
		this.code = code;
		this.docs = docs;
	}

	/**
	 * True for an error from any copy of this class in the thread, by the mark that each copy puts
	 * on its errors. A subclass keeps the usual check of the prototype chain.
	 */
	static [Symbol.hasInstance](value: unknown): value is EngineError {
		// biome-ignore lint/complexity/noThisInStatic: this is the class that instanceof names
		if (this !== EngineError) return Function.prototype[Symbol.hasInstance].call(this, value);
		return typeof value === 'object' && value !== null && ENGINE_ERROR in value;
	}

	/** Marks every error of this class as an engine error. */
	get [ENGINE_ERROR](): true {
		return true;
	}
}

/**
 * The engine error that a message from another thread names by the code at its start, or
 * undefined when it names none. A message that holds a whole engine error's text keeps it. A bare
 * coded message, which code that does not load this module sends, gets its fix and link here.
 */
export function errorOfMessage(message: string): EngineError | undefined {
	const [, code, detail = ''] = /^(E\d{4}): ([\s\S]*)$/.exec(message) ?? [];
	if (!code || !isErrorCode(code)) return undefined;
	if (!message.endsWith(`See ${DOCS_BASE}${code}.md`)) return new EngineError(code, detail);
	const error = new EngineError(code, '');
	error.message = message;
	return error;
}
