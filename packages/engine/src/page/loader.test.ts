import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	createSharedMemory,
	DEFAULT_MAXIMUM_MIB,
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

	const wasm = () =>
		new Response(EMPTY_MODULE, { headers: { 'Content-Type': 'application/wasm' } });

	it('names a core file that the server does not send', async () => {
		serve({ 'null3d_bg.wasm': wasm });
		const error = await failure();
		expect(error).toBeInstanceOf(EngineError);
		expect(error.code).toBe('E1406');
		expect(error.message).toContain('null3d_memory.json did not download: HTTP 404.');
	});

	it('names a core file that arrives cut short', async () => {
		serve({ 'null3d_bg.wasm': wasm, 'null3d_memory.json': () => new Response('{"initial": 1') });
		const error = await failure();
		expect(error.code).toBe('E1406');
		expect(error.message).toContain('null3d_memory.json did not download whole:');
	});

	it('creates the shared memory with the maximum it is asked for', async () => {
		serve({ 'null3d_bg.wasm': wasm, 'null3d_memory.json': () => Response.json(LIMITS) });
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
		serve({ 'null3d_bg.wasm': wasm, 'null3d_memory.json': () => Response.json(LIMITS) });
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

	it('fails with E1109 after about 3 seconds of refusals', async () => {
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
			"the browser refused the engine's shared memory of 1024 MiB 7 times: Out of memory.",
		);
		expect(full.pauses).toEqual([...MEMORY_RETRY_MS]);
		expect(full.pauses.reduce((sum, ms) => sum + ms, 0)).toBe(3_150);
	});
});
