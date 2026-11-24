// Downloads WebAssembly files and compiles them as they arrive: the engine core, and the modules
// that the on-demand loader (shared/tasks.ts) loads on first use. The browser compiles the response
// that it downloaded, so Chrome can keep the compiled code and a later visit skips the compile.
// A failure names the file by its role and gives its cause: a download that failed, a file that is
// not WebAssembly, or a Content-Security-Policy that blocks WebAssembly. A file from another origin,
// such as a CDN, can also fail because the policy does not allow its origin, or because it came
// without CORS.

import type { EngineError } from '../errors/engine-error';
import { isCrossOrigin, violationFor, watchPolicy } from './policy';
import { type MemoryLimits, memoryImportLimits } from './wasm-limits';

export { type MemoryLimits, memoryImportLimits } from './wasm-limits';

/** Makes one of the engine's coded errors, as the calling thread makes them. */
export type WasmError = (
	code: 'E1405' | 'E1406' | 'E1418' | 'E1422' | 'E1423',
	message: string,
) => EngineError;

/** The smallest valid WebAssembly module: the magic number and the version. */
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/**
 * True when this thread may compile WebAssembly. A Content-Security-Policy whose `script-src`
 * lacks `'wasm-unsafe-eval'` blocks every compile, even of the smallest module, which no damaged
 * download can explain.
 */
function wasmAllowed(): boolean {
	try {
		new WebAssembly.Module(EMPTY_MODULE);
		return true;
	} catch {
		return false;
	}
}

/**
 * A file's address as a message shows it: its path, or the kind of an inline address, whose text
 * tells a reader nothing.
 */
export function shownAddress(url: URL): string {
	return url.protocol === 'data:' || url.protocol === 'blob:'
		? `an inline ${url.protocol} address`
		: url.pathname;
}

const reason = (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown));

/** The headers that let the browser compile a response as WebAssembly. */
const WASM_HEADERS = { 'Content-Type': 'application/wasm' };

/**
 * True when the browser compiles `response` as it came: its Content-Type is `application/wasm`
 * alone. Chrome refuses the type with any parameter.
 */
function compilesAsSent(response: Response): boolean {
	return response.headers.get('content-type')?.toLowerCase() === 'application/wasm';
}

/**
 * Reads `body` to its end and calls `report` as each byte range arrives, with the bytes that have
 * arrived and the bytes that the response announced: 0 when it gave no length. A broken download
 * or `stop` ends the reading quietly, as the compile reports the download's fault.
 */
function countBytes(
	body: ReadableStream<Uint8Array>,
	total: number,
	report: (loaded: number, total: number) => void,
	stop: AbortSignal,
): Promise<void> {
	let loaded = 0;
	const counter = new WritableStream<Uint8Array>({
		write(chunk) {
			loaded += chunk.byteLength;
			report(loaded, total);
		},
	});
	return body.pipeTo(counter, { signal: stop }).catch(() => {});
}

/**
 * Downloads a WebAssembly file and compiles it as it arrives. `name` says what the file is, for
 * errors. `started` is a download of the file that the page has already begun. `readHead` reads a
 * copy of the download, such as the start of the module, while the browser compiles.
 * `onDownload` hears the bytes as they arrive, with the length that the response announced, or 0
 * when it gave none, and hears the last of them before the compile's result returns. Fails with
 * E1406 when the file does not download whole or is not WebAssembly, and with E1418 when the
 * page's Content-Security-Policy blocks WebAssembly.
 *
 * The browser compiles the downloaded response itself whenever its type allows. Chrome keeps the
 * code that it compiles from a response that it downloaded, and a later visit that takes the file
 * from the HTTP cache reads that code rather than compiling again. A file that a host sends with
 * another type compiles through a response that the engine makes with the right type: it still
 * compiles as it arrives, but afresh on every visit.
 */
export async function compileWasm<T>(
	url: URL,
	name: string,
	error: WasmError,
	readHead?: (stream: ReadableStream<Uint8Array>) => Promise<T>,
	started?: Promise<Response>,
	onDownload?: (loaded: number, total: number) => void,
): Promise<{ module: WebAssembly.Module; head: T | undefined }> {
	const where = shownAddress(url);
	const crossOrigin = isCrossOrigin(url);
	if (crossOrigin) watchPolicy();
	let response: Response;
	try {
		response = await (started ?? fetch(url));
	} catch (thrown) {
		if (!crossOrigin)
			throw error('E1406', `${name} did not download from ${where}: ${reason(thrown)}.`);
		const violation = await violationFor(url);
		throw violation
			? error(
					'E1422',
					`the page's Content-Security-Policy blocks ${name} from ${url.origin}: its ${violation.directive} does not allow it.`,
				)
			: error(
					'E1423',
					`${name} from ${url.origin} came without a CORS header, or did not download: ${reason(thrown)}.`,
				);
	}
	if (!response.ok || !response.body)
		throw error('E1406', `${name} did not download from ${where}: HTTP ${response.status}.`);
	const compiled = compilesAsSent(response)
		? response
		: new Response(response.body, { headers: WASM_HEADERS });
	// The readers each take a copy of the download. A copy keeps the browser's cache of the compiled
	// code, and the browser hands every copy each byte range as it arrives, without waiting for the
	// slowest reader, so no reader holds up the compile.
	const copy = () => compiled.clone().body as ReadableStream<Uint8Array>;
	const stop = new AbortController();
	let counting: Promise<void> | undefined;
	if (onDownload) {
		const length = Number(response.headers.get('content-length'));
		const total = Number.isFinite(length) && length > 0 ? length : 0;
		onDownload(0, total);
		counting = countBytes(copy(), total, onDownload, stop.signal);
	}
	// A broken download also fails the compile, which reports it.
	const head = readHead?.(copy()).catch(() => undefined);
	let module: WebAssembly.Module;
	try {
		module = await WebAssembly.compileStreaming(compiled);
	} catch (thrown) {
		stop.abort();
		if (!wasmAllowed())
			throw error(
				'E1418',
				`the page's Content-Security-Policy does not let ${name} compile: ${reason(thrown)}.`,
			);
		if (thrown instanceof WebAssembly.CompileError)
			throw error('E1406', `${name} from ${where} is not a WebAssembly module: ${reason(thrown)}.`);
		throw error('E1406', `${name} did not download whole from ${where}: ${reason(thrown)}.`);
	}
	await counting;
	return { module, head: await head };
}

/**
 * Reads a module's stream until its import section has arrived, then stops reading: the limits of
 * the memory it imports, or null when it imports none.
 */
export async function readMemoryLimits(
	stream: ReadableStream<Uint8Array>,
): Promise<MemoryLimits | null> {
	const reader = stream.getReader();
	let bytes = new Uint8Array(0);
	try {
		for (;;) {
			const limits = memoryImportLimits(bytes);
			if (limits !== undefined) return limits;
			const { done, value } = await reader.read();
			if (done) return null;
			const joined = new Uint8Array(bytes.length + value.length);
			joined.set(bytes);
			joined.set(value, bytes.length);
			bytes = joined;
		}
	} finally {
		reader.cancel().catch(() => {});
	}
}
