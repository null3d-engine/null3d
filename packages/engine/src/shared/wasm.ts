// Downloads WebAssembly files and compiles them as they arrive: the engine core, and the modules
// that the on-demand loader (shared/tasks.ts) loads on first use. A failure names the file by its
// role and gives its cause: a download that failed, a file that is not WebAssembly, or a
// Content-Security-Policy that blocks WebAssembly. A file from another origin, such as a CDN, can
// also fail because the policy does not allow its origin, or because it came without CORS.

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

/**
 * Downloads a WebAssembly file and compiles it as it arrives. `name` says what the file is, for
 * errors. `readHead` reads a copy of the download, such as the start of the module, while the
 * browser compiles. Fails with E1406 when the file does not download whole or is not WebAssembly,
 * and with E1418 when the page's Content-Security-Policy blocks WebAssembly.
 */
export async function compileWasm<T>(
	url: URL,
	name: string,
	error: WasmError,
	readHead?: (stream: ReadableStream<Uint8Array>) => Promise<T>,
	started?: Promise<Response>,
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
	let body = response.body;
	let head: Promise<T | undefined> = Promise.resolve(undefined);
	if (readHead) {
		const [compiled, read] = body.tee();
		body = compiled;
		// A broken download also fails the compile, which reports it.
		head = readHead(read).catch(() => undefined);
	}
	let module: WebAssembly.Module;
	try {
		// The engine gives the type itself, so a host that sends .wasm files with another type still
		// compiles them as they arrive.
		module = await WebAssembly.compileStreaming(
			new Response(body, { headers: { 'Content-Type': 'application/wasm' } }),
		);
	} catch (thrown) {
		if (!wasmAllowed())
			throw error(
				'E1418',
				`the page's Content-Security-Policy does not let ${name} compile: ${reason(thrown)}.`,
			);
		if (thrown instanceof WebAssembly.CompileError)
			throw error('E1406', `${name} from ${where} is not a WebAssembly module: ${reason(thrown)}.`);
		throw error('E1406', `${name} did not download whole from ${where}: ${reason(thrown)}.`);
	}
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
