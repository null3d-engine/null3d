// Downloads WebAssembly files and compiles them as they arrive: the engine core and the KTX2
// transcoder. A failure names the file by its role and gives its cause: a download that failed,
// a file that is not WebAssembly, or a Content-Security-Policy that blocks WebAssembly.

import type { EngineError } from '../errors/engine-error';

/** The limits of the memory that a module imports. */
export interface MemoryLimits {
	/** Initial size in 64 KiB pages. */
	initial: number;
	/** Declared maximum in 64 KiB pages, or null when the module declares none. */
	maximum: number | null;
	shared: boolean;
}

/** Makes one of the engine's coded errors, as the calling thread makes them. */
export type WasmError = (code: 'E1406' | 'E1418', message: string) => EngineError;

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
	let response: Response;
	try {
		response = await (started ?? fetch(url));
	} catch (thrown) {
		throw error('E1406', `${name} did not download from ${where}: ${reason(thrown)}.`);
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

/** Reads an unsigned LEB128 number at `offset`: the value and the offset after it, or null past the end. */
function readLeb(bytes: Uint8Array, offset: number): [number, number] | null {
	let value = 0;
	let shift = 0;
	for (let at = offset; at < bytes.length; at++) {
		const byte = bytes[at] as number;
		value += (byte & 0x7f) * 2 ** shift;
		if ((byte & 0x80) === 0) return [value, at + 1];
		shift += 7;
	}
	return null;
}

/** The section that lists a module's imports. Only custom sections and the type section come before it. */
const IMPORT_SECTION = 2;

/**
 * The limits of the memory that a module imports, from the start of its bytes: null when it
 * imports no memory, and undefined when the bytes end before the import section does.
 */
export function memoryImportLimits(bytes: Uint8Array): MemoryLimits | null | undefined {
	let at = 8;
	while (at < bytes.length) {
		const id = bytes[at] as number;
		const header = readLeb(bytes, at + 1);
		if (!header) return undefined;
		const [size, start] = header;
		if (id > IMPORT_SECTION) return null;
		if (start + size > bytes.length) return undefined;
		if (id === IMPORT_SECTION) return importedMemory(bytes.subarray(start, start + size));
		at = start + size;
	}
	return undefined;
}

/** The limits of the memory in an import section's content, or null when it imports none. */
function importedMemory(section: Uint8Array): MemoryLimits | null {
	const leb = (offset: number) => readLeb(section, offset) ?? [0, section.length];
	let [count, cursor] = leb(0);
	for (; count > 0 && cursor < section.length; count--) {
		for (let name = 0; name < 2; name++) {
			const [length, afterLength] = leb(cursor);
			cursor = afterLength + length;
		}
		const kind = section[cursor++];
		if (kind === 0) {
			cursor = leb(cursor)[1];
		} else if (kind === 1) {
			cursor++;
			const flags = section[cursor++] ?? 0;
			cursor = leb(cursor)[1];
			if (flags & 1) cursor = leb(cursor)[1];
		} else if (kind === 2) {
			const flags = section[cursor++] ?? 0;
			const [initial, afterInitial] = leb(cursor);
			const maximum = flags & 1 ? leb(afterInitial)[0] : null;
			return { initial, maximum, shared: (flags & 2) !== 0 };
		} else if (kind === 3) {
			cursor += 2;
		} else {
			cursor++;
			cursor = leb(cursor)[1];
		}
	}
	return null;
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
