// The stream index: the JSON that names a cloud's chunks, and the loader that fetches the chunks
// that a view asks for. The test gives the loader a fake network, so it can fail a request, cut a
// body short, and count the requests that a selection makes.
import { describe, expect, it } from 'bun:test';
import type { SplatData } from './format';
import { decodeSpz } from './spz';
import { encodeSpz } from './spz-write';
import { parseStreamIndex, SplatStreamLoader, startsStreamIndex } from './stream';

/** A cloud of `count` splats, all at the origin, which the test writes as a chunk file. */
function cloud(count: number): SplatData {
	const positions = new Float32Array(count * 3);
	const scales = new Float32Array(count * 3).fill(0.1);
	const rotations = new Float32Array(count * 4);
	const colors = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		rotations[i * 4 + 3] = 1;
		colors.set([1, 1, 1, 1], i * 4);
	}
	return { count, positions, scales, rotations, colors };
}

/** The index text of two chunks, which names each chunk's file and bounds. */
function indexText(chunks: readonly { count: number; url: string; bytes?: number }[]): string {
	return JSON.stringify({
		format: 'null3d.splats.stream',
		version: 1,
		count: chunks.reduce((total, chunk) => total + chunk.count, 0),
		chunks: chunks.map((chunk, i) => ({
			url: chunk.url,
			count: chunk.count,
			center: [i * 10, 0, 0],
			radius: 1,
			bytes: chunk.bytes ?? 0,
		})),
	});
}

/** A response with the given bytes. */
function body(bytes: Uint8Array): Response {
	return new Response(bytes as unknown as BodyInit);
}

describe('parseStreamIndex', () => {
	it('reads the chunks and resolves their addresses against the index', () => {
		const stream = parseStreamIndex(
			indexText([
				{ count: 2, url: 'chunk-0.spz', bytes: 100 },
				{ count: 3, url: '/scans/chunk-1.spz', bytes: 200 },
			]),
			'https://example.com/scans/cloud.json',
			'the index',
		);
		expect(stream.count).toBe(5);
		expect(stream.bytes).toBe(300);
		expect(stream.chunks[0]?.url).toBe('https://example.com/scans/chunk-0.spz');
		expect(stream.chunks[1]?.url).toBe('https://example.com/scans/chunk-1.spz');
		expect(stream.chunks[0]?.center).toEqual([0, 0, 0]);
	});

	it('refuses text that is not JSON', () => {
		expect(() => parseStreamIndex('not json', undefined, 'the index')).toThrow('is not JSON');
	});

	it('refuses another format or version', () => {
		const other = JSON.parse(indexText([])) as Record<string, unknown>;
		other['format'] = 'someone.else';
		expect(() => parseStreamIndex(JSON.stringify(other), undefined, 'the index')).toThrow(
			'names the format',
		);
		const future = JSON.parse(indexText([])) as Record<string, unknown>;
		future['version'] = 2;
		expect(() => parseStreamIndex(JSON.stringify(future), undefined, 'the index')).toThrow(
			'is version 2',
		);
	});

	it('refuses chunks that do not hold the count that the index names', () => {
		const wrong = JSON.parse(indexText([{ count: 2, url: 'a.spz' }])) as Record<string, unknown>;
		wrong['count'] = 5;
		expect(() => parseStreamIndex(JSON.stringify(wrong), undefined, 'the index')).toThrow(
			'its chunks hold 2',
		);
	});

	it('refuses a chunk without bounds', () => {
		const wrong = JSON.parse(indexText([{ count: 2, url: 'a.spz' }])) as {
			chunks: Record<string, unknown>[];
		};
		delete (wrong.chunks[0] as Record<string, unknown>)['center'];
		expect(() => parseStreamIndex(JSON.stringify(wrong), undefined, 'the index')).toThrow(
			'no center',
		);
	});

	it('knows a stream index from an SPZ file', () => {
		expect(startsStreamIndex(new TextEncoder().encode('  {"format":'))).toBe(true);
		expect(startsStreamIndex(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(false);
	});
});

describe('SplatStreamLoader', () => {
	/** The index and files of two chunks, with the loader's options that a test collects. */
	async function setup(
		network: (url: string, attempt: number) => Promise<Response>,
		options: { retries?: number; concurrency?: number } = {},
	) {
		const files = [await encodeSpz(cloud(2)), await encodeSpz(cloud(3))];
		const stream = parseStreamIndex(
			indexText([
				{ count: 2, url: 'chunk-0.spz' },
				{ count: 3, url: 'chunk-1.spz' },
			]),
			'https://example.com/cloud.json',
			'the index',
		);
		const requests: string[] = [];
		const attempts = new Map<string, number>();
		let idle = 0;
		const loaded: { index: number; count: number }[] = [];
		const failed: { index: number; message: string }[] = [];
		const loader = new SplatStreamLoader(stream, {
			concurrency: options.concurrency ?? 2,
			retries: options.retries ?? 0,
			retryDelayMs: 0,
			timeoutMs: 5_000,
			decode: decodeSpz,
			fetch: (url) => {
				requests.push(url);
				const attempt = attempts.get(url) ?? 0;
				attempts.set(url, attempt + 1);
				const at = url.endsWith('chunk-0.spz') ? files[0] : files[1];
				return network(url, attempt).then((response) => {
					// The test's own file body, a cut-short body, or a response that the test made.
					if (response === OK) return body(at as Uint8Array);
					if (response === SHORT) return body((at as Uint8Array).subarray(0, 20));
					return response as Response;
				});
			},
			onChunk: (index, chunk) => loaded.push({ index, count: chunk.count }),
			onFailed: (index, error) => failed.push({ index, message: error.message }),
			onIdle: () => {
				idle++;
			},
		});
		return { loader, files, requests, loaded, failed, idle: () => idle };
	}

	/** The sentinels that a test returns: its own file body, or a cut-short one. */
	const OK = new Response(null);
	const SHORT = new Response(null);

	it('fetches only the chunks that the view asks for, nearest first', async () => {
		const { loader, requests, loaded } = await setup(async () => OK);
		loader.load([1]);
		await waitFor(() => loaded.length === 1);
		expect(requests).toEqual(['https://example.com/chunk-1.spz']);
		expect(loaded[0]).toEqual({ index: 1, count: 3 });
		loader.abort();
	});

	it('fetches a chunk once, however often a look asks for it', async () => {
		const { loader, requests, loaded } = await setup(async () => OK);
		loader.load([0, 1]);
		await waitFor(() => loaded.length === 2);
		loader.load([0, 1]);
		await waitFor(() => loader.idle);
		expect(requests.length).toBe(2);
		loader.abort();
	});

	it('fetches a chunk again when the connection drops, and keeps the chunk', async () => {
		const { loader, requests, loaded, failed } = await setup(
			async (_url, attempt) => {
				if (attempt === 0) throw new Error('the connection dropped');
				return OK;
			},
			{ retries: 1 },
		);
		loader.load([0]);
		await waitFor(() => loaded.length === 1);
		expect(requests.length).toBe(2);
		expect(failed).toEqual([]);
		expect(loaded[0]?.count).toBe(2);
		loader.abort();
	});

	it('fetches a chunk again when its body is cut short', async () => {
		const { loader, requests, loaded, failed } = await setup(
			async (_url, attempt) => (attempt === 0 ? SHORT : OK),
			{ retries: 1 },
		);
		loader.load([1]);
		await waitFor(() => loaded.length === 1);
		expect(requests.length).toBe(2);
		expect(failed).toEqual([]);
		loader.abort();
	});

	it('reports a chunk that stays unreachable, once', async () => {
		const { loader, requests, loaded, failed } = await setup(
			async () => {
				throw new Error('the connection dropped');
			},
			{ retries: 1 },
		);
		loader.load([0]);
		await waitFor(() => failed.length === 1);
		await waitFor(() => loader.idle);
		expect(requests.length).toBe(2);
		expect(loaded).toEqual([]);
		expect(failed[0]?.message).toContain('the connection dropped');
		expect(loader.failed).toBe(1);
		loader.abort();
	});

	it('does not retry a chunk that the server does not have', async () => {
		const { loader, requests, failed } = await setup(
			async () => new Response(null, { status: 404 }),
			{ retries: 2 },
		);
		loader.load([0]);
		await waitFor(() => failed.length === 1);
		expect(requests.length).toBe(1);
		expect(failed[0]?.message).toContain('404');
		loader.abort();
	});

	it('reports idle once every wanted chunk has settled', async () => {
		const { loader, loaded, idle } = await setup(async () => OK);
		loader.load([0]);
		await waitFor(() => loaded.length === 1);
		await waitFor(() => idle() > 0);
		expect(loader.idle).toBe(true);
		loader.abort();
	});

	it('reports nothing after it stops', async () => {
		const { loader, loaded, failed } = await setup(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return OK;
		});
		loader.load([0, 1]);
		loader.abort();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(loaded).toEqual([]);
		expect(failed).toEqual([]);
	});
});

/** Waits for a condition that the loader's own promises settle, with a limit. */
async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) throw new Error('the condition did not hold in time');
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}
