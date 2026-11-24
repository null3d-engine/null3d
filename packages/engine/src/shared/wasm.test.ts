// How compileWasm hands a download to the browser's compile: the downloaded response itself when
// its type is application/wasm, so Chrome can keep the compiled code, and otherwise a response with
// the right type. Copies of the download feed the byte count and the reader of the module's start,
// and neither holds up the compile.
import { afterEach, describe, expect, test } from 'bun:test';
import { compileWasm, readMemoryLimits, type WasmError } from './wasm';

const error: WasmError = (code, message) => new Error(`${code}: ${message}`) as never;

const URL_OF_FILE = new URL('http://localhost/wasm-test/module.wasm');

/** The smallest valid WebAssembly module: the magic number and the version. */
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/** A module that imports a shared memory, env.memory, of 18 pages that declares 65,536 at most. */
const SHARED_MEMORY_MODULE = new Uint8Array([
	...EMPTY_MODULE,
	// The import section: one import of 18 bytes.
	0x02,
	0x12,
	0x01,
	// The module's name, env, and the import's name, memory.
	0x03,
	0x65,
	0x6e,
	0x76,
	0x06,
	0x6d,
	0x65,
	0x6d,
	0x6f,
	0x72,
	0x79,
	// A memory, shared and with a maximum: 18 pages at first, and 65,536 at most.
	0x02,
	0x03,
	0x12,
	0x80,
	0x80,
	0x04,
]);
const LIMITS = { initial: 18, maximum: 65_536, shared: true };

/** A download's body that gives `bytes` a few at a time, as the reader asks for them. */
function arriving(bytes: Uint8Array, size = 3): ReadableStream<Uint8Array> {
	let at = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (at >= bytes.length) return controller.close();
			controller.enqueue(bytes.slice(at, at + size));
			at += size;
		},
	});
}

/** A download of `bytes` with the Content-Type `type`, or none, and the length it announces. */
function download(bytes: Uint8Array, type: string | undefined): Response {
	const headers: Record<string, string> = { 'Content-Length': String(bytes.length) };
	if (type !== undefined) headers['Content-Type'] = type;
	return new Response(arriving(bytes), { headers });
}

/** The responses that reach the browser's compile while the test runs. */
function watchCompiles(): Response[] {
	const seen: Response[] = [];
	const browserCompile = WebAssembly.compileStreaming;
	WebAssembly.compileStreaming = (source) => {
		seen.push(source as Response);
		return browserCompile(source);
	};
	restores.push(() => {
		WebAssembly.compileStreaming = browserCompile;
	});
	return seen;
}

const restores: (() => void)[] = [];
afterEach(() => {
	for (const restore of restores.splice(0)) restore();
});

/** Compiles `response` as the core's loader does, with the readers that the test asks for. */
const compile = <T>(
	response: Response,
	readHead?: (stream: ReadableStream<Uint8Array>) => Promise<T>,
	onDownload?: (loaded: number, total: number) => void,
) =>
	compileWasm(
		URL_OF_FILE,
		'the test module',
		error,
		readHead,
		Promise.resolve(response),
		onDownload,
	);

/** The types that the browser compiles as sent, and the types that need a response of the engine's. */
const AS_SENT = ['application/wasm', 'Application/WASM'];
const WRAPPED = [undefined, 'application/octet-stream', 'application/wasm; charset=binary'];

describe('compileWasm', () => {
	test.each(AS_SENT)(
		'compiles the downloaded response itself when its type is %s',
		async (type) => {
			const seen = watchCompiles();
			const response = download(EMPTY_MODULE, type);
			const { module } = await compile(response, readMemoryLimits, () => {});
			expect(module).toBeInstanceOf(WebAssembly.Module);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toBe(response);
		},
	);

	test('compiles a task module that it downloads itself as the browser sent it', async () => {
		const seen = watchCompiles();
		const browserFetch = globalThis.fetch;
		restores.push(() => {
			globalThis.fetch = browserFetch;
		});
		const response = download(EMPTY_MODULE, 'application/wasm');
		globalThis.fetch = (async () => response) as unknown as typeof fetch;
		const { module, head } = await compileWasm(URL_OF_FILE, 'the test module', error);
		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(head).toBeUndefined();
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBe(response);
	});

	test.each(WRAPPED)(
		'compiles a file sent with the type %s through a response of the right type',
		async (type) => {
			const seen = watchCompiles();
			const response = download(EMPTY_MODULE, type);
			const { module } = await compile(response);
			expect(module).toBeInstanceOf(WebAssembly.Module);
			expect(seen).toHaveLength(1);
			expect(seen[0]).not.toBe(response);
			expect(seen[0]?.headers.get('content-type')).toBe('application/wasm');
		},
	);

	test.each([...AS_SENT, ...WRAPPED])(
		'counts the bytes of a file sent with the type %s up to the announced length, before it returns',
		async (type) => {
			const seen: [number, number][] = [];
			let seenAtReturn = -1;
			await compile(download(SHARED_MEMORY_MODULE, type), undefined, (loaded, total) =>
				seen.push([loaded, total]),
			).then(() => {
				seenAtReturn = seen.length;
			});
			const size = SHARED_MEMORY_MODULE.length;
			expect(seen[0]).toEqual([0, size]);
			expect(seen.at(-1)).toEqual([size, size]);
			expect(seenAtReturn).toBe(seen.length);
			for (let k = 1; k < seen.length; k++)
				expect(seen[k]?.[0]).toBeGreaterThan(seen[k - 1]?.[0] ?? 0);
		},
	);

	test.each([...AS_SENT, ...WRAPPED])(
		'reads the memory limits from the start of a file sent with the type %s, and still counts every byte',
		async (type) => {
			const seen: number[] = [];
			const { module, head } = await compile(
				download(SHARED_MEMORY_MODULE, type),
				readMemoryLimits,
				(loaded) => seen.push(loaded),
			);
			expect(module).toBeInstanceOf(WebAssembly.Module);
			expect(head).toEqual(LIMITS);
			expect(seen.at(-1)).toBe(SHARED_MEMORY_MODULE.length);
		},
	);

	test('lets neither a reader that stops early nor the count hold up the compile', async () => {
		// The reader takes one byte range and then leaves its copy unread and open.
		const firstRange = async (stream: ReadableStream<Uint8Array>) =>
			(await stream.getReader().read()).value?.length;
		let counted = 0;
		const { module, head } = await compile(
			download(SHARED_MEMORY_MODULE, 'application/wasm'),
			firstRange,
			(loaded) => {
				counted = loaded;
			},
		);
		expect(module).toBeInstanceOf(WebAssembly.Module);
		expect(head).toBe(3);
		expect(counted).toBe(SHARED_MEMORY_MODULE.length);
	});

	test('keeps its errors for a download that fails, arrives cut short or is not WebAssembly', async () => {
		await expect(compile(new Response(null, { status: 404 }))).rejects.toThrow(
			'E1406: the test module did not download from /wasm-test/module.wasm: HTTP 404.',
		);
		const cut = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(SHARED_MEMORY_MODULE.subarray(0, 12));
					controller.error(new TypeError('network connection lost'));
				},
			}),
			{ headers: { 'Content-Type': 'application/wasm' } },
		);
		await expect(compile(cut, readMemoryLimits, () => {})).rejects.toThrow(
			'E1406: the test module did not download whole from /wasm-test/module.wasm',
		);
		const page = download(
			new TextEncoder().encode('<!doctype html><title>Home</title>'),
			'application/wasm',
		);
		await expect(compile(page)).rejects.toThrow(
			'E1406: the test module from /wasm-test/module.wasm is not a WebAssembly module',
		);
		const failed = Promise.reject(new TypeError('network connection lost'));
		failed.catch(() => {});
		await expect(
			compileWasm(URL_OF_FILE, 'the test module', error, undefined, failed),
		).rejects.toThrow(
			'E1406: the test module did not download from /wasm-test/module.wasm: network connection lost.',
		);
	});
});
