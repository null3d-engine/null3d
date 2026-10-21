// EngineError: every error the engine throws carries a code, what failed, how to fix it, and a link
// to the code's docs page. The text of the fixes is large and a page raises no error on most runs,
// so a thread loads it in a file of its own at the first error. Until the file arrives the error
// carries its code and detail alone; the fix then replaces the message, which the error report
// holds. A page that throws no error downloads none of that text.
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

/**
 * Every code, joined, so an error keeps its code before the file of fixes arrives. A test keeps it
 * equal to the keys of the table.
 */
const CODES =
	'E1101E1102E1103E1104E1105E1106E1107E1108E1109E1110E1111E1203E1204E1205E1206E1207E1208E1213E1214E1215E1216E1217E1218E1219E1220E1221E1222E1223E1301E1302E1303E1304E1305E1306E1401E1402E1403E1404E1405E1406E1407E1408E1409E1410E1411E1412E1413E1414E1415E1416E1417E1418E1419E1420E1421E1422E1423E1424E1425E1430E1431E1501E1502E1503E1504E1505';

/** An error whose message waits for the file of fixes, and the detail that the message holds. */
interface Waiting {
	error: EngineError;
	code: ErrorCode;
	detail: string;
	/** The message that the constructor gave the error, which a later writer may replace. */
	made: string;
}

const waiting: Waiting[] = [];
/** The load of the fixes, which one thread starts once. */
let loading: Promise<void> | undefined;

/** Texts an error's message: its code and detail, the code's fix once loaded, and its docs page. */
function messageFor(code: ErrorCode, detail: string, fix: string | undefined): string {
	// A message that came from another thread may hold its fix already.
	const text = fix !== undefined && !detail.endsWith(` ${fix}`) ? `${detail} ${fix}` : detail;
	return `${code}: ${text} See ${DOCS_BASE}${code}.md`;
}

/** Tells each waiting error the fix, unless its message holds other text by now. */
function settle(fixes: ErrorFixes): void {
	for (const { error, code, detail, made } of waiting.splice(0)) {
		if (error.message === made) error.message = messageFor(code, detail, fixes[code]);
	}
}

/** Loads the thread's file of fixes, once, and gives each error that waits its fix. */
function loadFixes(): Promise<void> {
	if (thread[FIXES] !== undefined) return Promise.resolve();
	loading ??= import('./fixes').then(
		({ ERROR_FIXES }) => {
			thread[FIXES] ??= ERROR_FIXES;
			settle(thread[FIXES]);
		},
		() => {
			// The text is a hint: an error keeps its code and detail when the file does not arrive.
			loading = undefined;
		},
	);
	return loading;
}

/** Gives this thread the fix of each code, where a host loads the table itself. */
export function setErrorFixes(table: ErrorFixes): void {
	thread[FIXES] = table;
	settle(table);
}

/**
 * Resolves once the thread has the fixes. A caller that reports an error after an `await` waits on
 * it, so the report carries the same fix text as a thread that loaded the table at its start.
 */
export function errorFixesReady(): Promise<void> {
	return loadFixes();
}

/** True for a code in the engine's error table. */
export function isErrorCode(code: string): code is ErrorCode {
	return code.length === 5 && CODES.includes(code);
}

/**
 * An error the engine throws. Its message says what failed and how to fix it, and links to the
 * code's docs page. A thread's first error loads the text of the fixes; until it arrives the
 * message holds the code and the detail alone, and the fix then replaces it.
 *
 * @category api/engine
 */
export class EngineError extends Error {
	/** The error's code, such as `E1108`. */
	readonly code: ErrorCode;
	/** The docs page for this code. */
	readonly docs: string;

	constructor(code: ErrorCode, detail: string) {
		const fix = thread[FIXES]?.[code];
		super(messageFor(code, detail, fix));
		this.name = 'EngineError';
		this.code = code;
		this.docs = `${DOCS_BASE}${code}.md`;
		// A message without the text of the fixes waits for the file, which loads now.
		if (thread[FIXES] === undefined) {
			waiting.push({ error: this, code, detail, made: this.message });
			void loadFixes();
		}
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
	const docs = `See ${DOCS_BASE}${code}.md`;
	// A whole message from another thread holds its detail and, if that thread had them, its fix.
	// The error reads both from the text, so a fix that the other thread lacked comes from this one.
	if (!message.endsWith(docs)) return new EngineError(code, detail);
	const body = message.slice(code.length + 2, -docs.length).trimEnd();
	return new EngineError(code, body);
}
