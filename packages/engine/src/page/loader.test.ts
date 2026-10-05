import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { coreUrls } from '../shared/core';
import { memoryImportLimits, readMemoryLimits } from '../shared/wasm';
import {
	createSharedMemory,
	DEFAULT_MAXIMUM_MIB,
	EARLY_CORE_SLOT,
	loadCore,
	MAX_MAXIMUM_MIB,
	MEMORY_RETRY_MS,
	MIN_MAXIMUM_MIB,
	maximumPages,
	memoryMaximumMiB,
} from './loader';

/** The limits of a core module that starts at 18 pages and declares 4 GiB. */
const LIMITS = { initial: 18, maximum: 65_536, shared: true };

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('memoryMaximumMiB', () => {
	it('gives 1024 MiB when neither the option nor the switch asks for a maximum', () => {
		expect(DEFAULT_MAXIMUM_MIB).toBe(1_024);
		expect(memoryMaximumMiB(undefined, undefined)).toBe(1_024);
	});

	it("takes the option's maximum, from 256 to the 4096 MiB that the core declares", () => {
		expect([MIN_MAXIMUM_MIB, MAX_MAXIMUM_MIB]).toEqual([256, 4_096]);
		for (const mib of [256, 257, 2_048, 4_096]) expect(memoryMaximumMiB(mib, undefined)).toBe(mib);
	});

	it("takes the switch's maximum over the option's", () => {
		expect(memoryMaximumMiB(2_048, 512)).toBe(512);
		expect(memoryMaximumMiB(undefined, 4_096)).toBe(4_096);
	});

	it("takes the quality preset's maximum when neither the option nor the switch asks for one", () => {
		expect(memoryMaximumMiB(undefined, undefined, 512)).toBe(512);
		expect(memoryMaximumMiB(2_048, undefined, 512)).toBe(2_048);
		expect(memoryMaximumMiB(undefined, 768, 512)).toBe(768);
	});

	it('refuses an option that is not a whole number of MiB from 256 to 4096, with E1409', () => {
		for (const mib of [255, 4_097, 0, -1_024, 1_536.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			let error: unknown;
			try {
				memoryMaximumMiB(mib, undefined);
			} catch (e) {
				error = e;
			}
			expect(error).toBeInstanceOf(EngineError);
			expect((error as EngineError).code).toBe('E1409');
			expect((error as EngineError).message).toStartWith(
				`E1409: the memory.maximumMiB option ${mib} is not a whole number of MiB from 256 to 4096. Give memory.maximumMiB`,
			);
		}
	});

	it('refuses a wrong option even when the switch wins', () => {
		expect(() => memoryMaximumMiB(8_192, 1_024)).toThrow(
			'E1409: the memory.maximumMiB option 8192',
		);
	});
});

describe('maximumPages', () => {
	it('turns MiB into 64 KiB pages', () => {
		expect(maximumPages(LIMITS, 256)).toBe(4_096);
		expect(maximumPages(LIMITS, 1_024)).toBe(16_384);
		expect(maximumPages(LIMITS, 4_096)).toBe(65_536);
	});

	it("stays within the module's declared maximum and above its initial size", () => {
		expect(maximumPages(LIMITS, 8_192)).toBe(65_536);
		expect(maximumPages(LIMITS, 1)).toBe(18);
		expect(maximumPages({ ...LIMITS, maximum: null }, 8_192)).toBe(131_072);
	});
});

/** The smallest valid WebAssembly module: the magic number and the version. */
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

/**
 * A module that imports a function, env.f, then a shared memory, env.memory, of 18 pages that
 * declares 65,536 pages at most, as the threaded core does.
 */
const SHARED_MEMORY_MODULE = new Uint8Array([
	...EMPTY_MODULE,
	// The type section: one function type, with no parameters and no results.
	0x01,
	0x04,
	0x01,
	0x60,
	0x00,
	0x00,
	// The import section.
	0x02,
	0x1a,
	0x02,
	0x03,
	0x65,
	0x6e,
	0x76,
	0x01,
	0x66,
	0x00,
	0x00,
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
	0x02,
	0x03,
	0x12,
	0x80,
	0x80,
	0x04,
]);

describe('memoryImportLimits', () => {
	it('reads the initial size, the maximum and the shared flag of an imported memory', () => {
		expect(memoryImportLimits(SHARED_MEMORY_MODULE)).toEqual(LIMITS);
	});

	it('waits for more bytes until the import section has arrived whole', () => {
		for (let end = 0; end < SHARED_MEMORY_MODULE.length; end++)
			expect(memoryImportLimits(SHARED_MEMORY_MODULE.subarray(0, end))).toBeUndefined();
	});

	it('gives null for a module whose sections after the imports start without one', () => {
		const functions = [0x03, 0x01, 0x00];
		expect(memoryImportLimits(new Uint8Array([...EMPTY_MODULE, ...functions]))).toBeNull();
	});
});

describe('readMemoryLimits', () => {
	it('stops reading once the import section has arrived', async () => {
		let pulls = 0;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(SHARED_MEMORY_MODULE);
			},
			pull(controller) {
				pulls++;
				controller.enqueue(new Uint8Array(1_000));
			},
		});
		expect(await readMemoryLimits(stream)).toEqual(LIMITS);
		expect(pulls).toBeLessThanOrEqual(1);
	});

	it('gives null when the stream ends before any import section', async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(EMPTY_MODULE);
				controller.close();
			},
		});
		expect(await readMemoryLimits(stream)).toBeNull();
	});
});

describe('loadCore', () => {
	const browserFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = browserFetch;
	});

	/** Answers each core file by the end of its path. */
	function serve(answers: Record<string, () => Response>) {
		globalThis.fetch = (async (input: string | URL | Request) => {
			const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
			const answer = Object.entries(answers).find(([end]) => path.endsWith(end))?.[1];
			return answer ? answer() : new Response('not found', { status: 404 });
		}) as typeof fetch;
	}

	async function failure(): Promise<EngineError> {
		try {
			await loadCore('threaded');
		} catch (e) {
			return e as EngineError;
		}
		throw new Error('the core loaded');
	}

	/** The core module, one byte at a time, with no content type, as a careless host sends it. */
	const wasm = () =>
		new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					for (const byte of SHARED_MEMORY_MODULE) controller.enqueue(new Uint8Array([byte]));
					controller.close();
				},
			}),
		);

	it('names the core file that the server does not send by its role and path', async () => {
		serve({});
		const error = await failure();
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1406');
		expect(error.message).toStartWith('E1406: the threaded engine core did not download from /');
		expect(error.message).toContain('/dist/wasm/threaded/null3d_bg.wasm: HTTP 404.');
	});

	it('names a core file that arrives cut short', async () => {
		serve({
			'null3d_bg.wasm': () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(SHARED_MEMORY_MODULE.subarray(0, 12));
							controller.error(new TypeError('network connection lost'));
						},
					}),
				),
		});
		const error = await failure();
		expect(error.code).toBe('E1406');
		expect(error.message).toContain('the threaded engine core did not download whole from');
	});

	it('names a core file that is not WebAssembly, such as a page that a host sends instead', async () => {
		serve({ 'null3d_bg.wasm': () => new Response('<!doctype html><title>Home</title>') });
		const error = await failure();
		expect(error.code).toBe('E1406');
		expect(error.message).toContain('null3d_bg.wasm is not a WebAssembly module:');
	});

	it("blames the page's Content-Security-Policy, with E1418, when it blocks WebAssembly", async () => {
		serve({ 'null3d_bg.wasm': wasm });
		const { Module, compileStreaming } = WebAssembly;
		const blocked = () => {
			throw new WebAssembly.CompileError("Refused to compile: 'wasm-unsafe-eval' is not allowed");
		};
		// biome-ignore lint/complexity/useArrowFunction: the check calls it with new, which an arrow function refuses.
		WebAssembly.Module = function () {
			blocked();
		} as unknown as typeof WebAssembly.Module;
		WebAssembly.compileStreaming = async () => blocked();
		try {
			const error = await failure();
			expect(error.code).toBe('E1418');
			expect(error.message).toStartWith(
				"E1418: the page's Content-Security-Policy does not let the threaded engine core compile: Refused to compile",
			);
		} finally {
			Object.assign(WebAssembly, { Module, compileStreaming });
		}
	});

	it('fails with E1402 when the threaded core imports no shared memory', async () => {
		serve({ 'null3d_bg.wasm': () => new Response(EMPTY_MODULE) });
		const error = await failure();
		expect(error.code).toBe('E1402');
	});

	it('downloads only the WebAssembly file, with no file of memory limits', async () => {
		const asked: string[] = [];
		serve({ 'null3d_bg.wasm': wasm });
		const served = globalThis.fetch;
		globalThis.fetch = ((input: string | URL | Request) => {
			asked.push(String(input));
			return served(input);
		}) as typeof fetch;
		await loadCore('threaded');
		expect(asked).toHaveLength(1);
		expect(asked[0]).toEndWith('/threaded/null3d_bg.wasm');
	});

	it('creates the shared memory with the maximum it is asked for', async () => {
		serve({ 'null3d_bg.wasm': wasm });
		const BrowserMemory = WebAssembly.Memory;
		const descriptors: WebAssembly.MemoryDescriptor[] = [];
		// biome-ignore lint/complexity/useArrowFunction: the loader calls it with new, which an arrow function refuses.
		WebAssembly.Memory = function (descriptor: WebAssembly.MemoryDescriptor) {
			descriptors.push(descriptor);
			return new BrowserMemory(descriptor);
		} as unknown as typeof WebAssembly.Memory;
		try {
			await loadCore('threaded', 2_048);
			await loadCore('threaded');
		} finally {
			WebAssembly.Memory = BrowserMemory;
		}
		expect(descriptors).toEqual([
			{ initial: LIMITS.initial, maximum: 32_768, shared: true },
			{ initial: LIMITS.initial, maximum: 16_384, shared: true },
		]);
	});

	it('creates the shared memory after the browser refused it once', async () => {
		serve({ 'null3d_bg.wasm': wasm });
		const BrowserMemory = WebAssembly.Memory;
		let refusals = 1;
		// biome-ignore lint/complexity/useArrowFunction: the loader calls it with new, which an arrow function refuses.
		WebAssembly.Memory = function (descriptor: WebAssembly.MemoryDescriptor) {
			if (refusals-- > 0) throw new RangeError('Out of memory');
			return new BrowserMemory(descriptor);
		} as unknown as typeof WebAssembly.Memory;
		try {
			const core = await loadCore('threaded');
			expect(core.memory?.buffer.byteLength).toBe(LIMITS.initial * 65_536);
			expect(refusals).toBe(-1);
		} finally {
			WebAssembly.Memory = BrowserMemory;
		}
	});
});

describe("the page's early core download", () => {
	const browserFetch = globalThis.fetch;
	const slots = globalThis as Record<symbol, unknown>;
	afterEach(() => {
		globalThis.fetch = browserFetch;
		delete slots[EARLY_CORE_SLOT];
	});

	/** Counts the downloads that the loader starts itself. */
	function countFetches(): { count: number } {
		const fetches = { count: 0 };
		globalThis.fetch = (async () => {
			fetches.count++;
			return new Response(EMPTY_MODULE, { headers: { 'Content-Type': 'application/wasm' } });
		}) as unknown as typeof fetch;
		return fetches;
	}

	const early = (url: URL) => ({
		url: url.href,
		response: Promise.resolve(
			new Response(EMPTY_MODULE, { headers: { 'Content-Type': 'application/wasm' } }),
		),
	});

	it("compiles the early script's response once, and downloads afresh for a later start", async () => {
		const fetches = countFetches();
		slots[EARLY_CORE_SLOT] = early(coreUrls('single').wasm);
		await loadCore('single');
		expect(fetches.count).toBe(0);
		expect(slots[EARLY_CORE_SLOT]).toBeUndefined();
		await loadCore('single');
		expect(fetches.count).toBe(1);
	});

	it("leaves a response for the other build's core, and downloads its own", async () => {
		const fetches = countFetches();
		const threaded = early(coreUrls('threaded').wasm);
		slots[EARLY_CORE_SLOT] = threaded;
		await loadCore('single');
		expect(fetches.count).toBe(1);
		expect(slots[EARLY_CORE_SLOT]).toBe(threaded);
	});

	it("reads the threaded core's memory limits from the early script's response", async () => {
		const fetches = countFetches();
		slots[EARLY_CORE_SLOT] = {
			url: coreUrls('threaded').wasm.href,
			response: Promise.resolve(new Response(SHARED_MEMORY_MODULE)),
		};
		const core = await loadCore('threaded');
		expect(fetches.count).toBe(0);
		expect(core.memory?.buffer.byteLength).toBe(LIMITS.initial * 65_536);
	});

	it("reports an early download that failed with E1406, as the loader's own download", async () => {
		const fetches = countFetches();
		const response = Promise.reject(new TypeError('network connection lost'));
		response.catch(() => {});
		slots[EARLY_CORE_SLOT] = { url: coreUrls('single').wasm.href, response };
		const error = await loadCore('single').then(
			() => undefined,
			(e: EngineError) => e,
		);
		expect(error?.code).toBe('E1406');
		expect(error?.message).toContain('did not download from');
		expect(error?.message).toContain('network connection lost');
		expect(fetches.count).toBe(0);
	});

	it('picks the build as createEngine does, and leaves the response in the slot the loader reads', async () => {
		const requested: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			requested.push(String(input));
			return new Response(EMPTY_MODULE);
		}) as unknown as typeof fetch;
		const page = globalThis as { crossOriginIsolated?: boolean; location?: unknown };
		const saved = { isolated: page.crossOriginIsolated, location: page.location };
		// An isolated page that asks for the single-threaded build with ?threads=off.
		page.crossOriginIsolated = true;
		page.location = { search: '?gpu=webgl2&threads=off' };
		try {
			await import('./early-core');
		} finally {
			page.crossOriginIsolated = saved.isolated;
			page.location = saved.location;
		}
		const url = coreUrls('single').wasm.href;
		expect(requested).toEqual([url]);
		expect((slots[EARLY_CORE_SLOT] as { url: string }).url).toBe(url);
	});
});

describe('createSharedMemory', () => {
	const DESCRIPTOR = { initial: 18, maximum: 16_384, shared: true };
	/** A browser that refuses the memory `refusals` times, and the waits between the tries. */
	function browser(refusals: number) {
		const pauses: number[] = [];
		let tries = 0;
		const memory = {} as WebAssembly.Memory;
		return {
			pauses,
			tries: () => tries,
			create: () => {
				tries++;
				if (tries <= refusals) throw new RangeError('Out of memory');
				return memory;
			},
			pause: async (ms: number) => {
				pauses.push(ms);
			},
			memory,
		};
	}

	it('makes the memory at once when the browser has room', async () => {
		const room = browser(0);
		expect(await createSharedMemory(DESCRIPTOR, room.create, room.pause)).toBe(room.memory);
		expect(room.pauses).toEqual([]);
	});

	it('waits longer after each refusal, then makes the memory', async () => {
		const busy = browser(3);
		expect(await createSharedMemory(DESCRIPTOR, busy.create, busy.pause)).toBe(busy.memory);
		expect(busy.tries()).toBe(4);
		expect(busy.pauses).toEqual([50, 100, 200]);
	});

	it('fails with E1109 after about 10 seconds of refusals', async () => {
		const full = browser(Number.POSITIVE_INFINITY);
		let error: EngineError | undefined;
		try {
			await createSharedMemory(DESCRIPTOR, full.create, full.pause);
		} catch (e) {
			error = e as EngineError;
		}
		expect(error).toBeInstanceOf(EngineError);
		expect(error?.code).toBe('E1109');
		expect(error?.message).toContain(
			"the browser refused the engine's shared memory of 1024 MiB 9 times over 10 seconds: Out of memory.",
		);
		expect(full.pauses).toEqual([...MEMORY_RETRY_MS]);
		expect(full.pauses.reduce((sum, ms) => sum + ms, 0)).toBe(9_550);
	});
});
