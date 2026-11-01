// The test server's splat streams: the addresses that a page asks for, and the index and chunk
// files that the server makes. The test reads the index with the add-on's own reader, so a server
// that names a chunk wrongly fails here and not in a device run.
import { describe, expect, it } from 'bun:test';
import { parseStreamIndex } from '../../packages/splats/src/stream';
import { SPLAT_STREAM_URL, splatStreamRequest, streamOf } from './splat-stream';

describe('splatStreamRequest', () => {
	it('reads an index and a chunk of a generated stream', () => {
		expect(splatStreamRequest(`${SPLAT_STREAM_URL}/400000/index.json`)).toEqual({
			count: 400000,
			chunk: 'index',
		});
		expect(splatStreamRequest(`${SPLAT_STREAM_URL}/400000/chunk-4.spz?v=1`)).toEqual({
			count: 400000,
			chunk: 4,
		});
	});

	it('leaves every other address to the server', () => {
		expect(splatStreamRequest('/tests/pages/splats-stream.html')).toBeUndefined();
		expect(splatStreamRequest(`${SPLAT_STREAM_URL}/400000/other.json`)).toBeUndefined();
		expect(splatStreamRequest(`${SPLAT_STREAM_URL}/many/index.json`)).toBeUndefined();
	});
});

describe('streamOf', () => {
	it('makes an index that the add-on reads, and chunk files that decode', async () => {
		const stream = await streamOf(1_000);
		const address = `https://example.com${SPLAT_STREAM_URL}/1000/index.json`;
		const index = parseStreamIndex(new TextDecoder().decode(stream.index), address, 'the index');
		expect(index.count).toBe(1_000);
		expect(index.chunks.length).toBe(stream.chunks.length);
		expect(index.chunks.reduce((sum, chunk) => sum + chunk.count, 0)).toBe(1_000);
		expect(index.bytes).toBeGreaterThan(0);
		// Every chunk's file has the size that its entry names, and the first chunk's address
		// resolves beside the index.
		expect(index.chunks[0]?.url).toBe(`https://example.com${SPLAT_STREAM_URL}/1000/chunk-0.spz`);
		for (let i = 0; i < index.chunks.length; i++)
			expect(index.chunks[i]?.bytes).toBe((stream.chunks[i] as Uint8Array).byteLength);
	});
});
