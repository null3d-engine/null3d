import { afterEach, describe, expect, it } from 'bun:test';
import { EngineError } from '../errors/engine-error';
import { loadCore, maximumPages } from './loader';

/** The limits of a core module that starts at 18 pages and declares 4 GiB. */
const LIMITS = { initial: 18, maximum: 65_536, shared: true };

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
});
