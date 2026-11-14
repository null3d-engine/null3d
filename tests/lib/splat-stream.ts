// The test server's splat streams: one cloud, cut into chunks that a page downloads as its view
// asks for them. The cloud is built here rather than in the page, so a device run measures a real
// download: the page reads a small index, and then only the chunk files that it needs.
//
// The cloud is made on the first request for a splat count, and kept in memory for the run. The
// files are not written to disk, and git holds none of them.
import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { chunkSplats } from '../../packages/splats/src/chunks.ts';
import { encodeSpz } from '../../packages/splats/src/spz-write.ts';
import { splatCloud } from './splat-cloud.ts';

/** The address prefix of a generated stream. */
export const SPLAT_STREAM_URL = '/splat-stream/gen';

/** The format name that every index gives, as the reader expects. */
const STREAM_FORMAT = 'null3d.splats.stream';

/** One generated stream: its index text and its chunk files. */
interface GeneratedStream {
	readonly index: Uint8Array;
	readonly chunks: readonly Uint8Array[];
}

/** The streams that this server has made, by splat count. */
const generated = new Map<number, Promise<GeneratedStream>>();

/** One stream, made once for its count and shared by every page that asks. */
export function streamOf(count: number): Promise<GeneratedStream> {
	let stream = generated.get(count);
	if (!stream) {
		stream = makeStream(count);
		generated.set(count, stream);
	}
	return stream;
}

/** Cuts a cloud into chunks, writes each as an SPZ file, and names them in an index. */
async function makeStream(count: number): Promise<GeneratedStream> {
	const { chunks } = await chunkSplats(splatCloud(count));
	const files = await Promise.all(chunks.map((chunk) => encodeSpz(chunk)));
	const index = {
		format: STREAM_FORMAT,
		version: 1,
		count,
		chunks: chunks.map((chunk, i) => ({
			url: `chunk-${i}.spz`,
			count: chunk.count,
			center: chunk.center,
			radius: chunk.radius,
			bytes: (files[i] as Uint8Array).byteLength,
		})),
	};
	return { index: new TextEncoder().encode(JSON.stringify(index)), chunks: files };
}

/** The request that a page makes: an index, or one chunk of it. */
interface StreamRequest {
	readonly count: number;
	readonly chunk: number | 'index';
}

/**
 * Reads the address of a generated stream, such as `/splat-stream/gen/400000/index.json` or
 * `/splat-stream/gen/400000/chunk-4.spz`, or undefined for another address.
 */
export function splatStreamRequest(url: string): StreamRequest | undefined {
	const path = url.split('?')[0] as string;
	if (!path.startsWith(`${SPLAT_STREAM_URL}/`)) return undefined;
	const rest = path.slice(SPLAT_STREAM_URL.length + 1);
	const match = /^(\d+)\/(index\.json|chunk-(\d+)\.spz)$/.exec(rest);
	if (!match) return undefined;
	const count = Number(match[1]);
	if (!Number.isFinite(count) || count < 0 || count > 4_000_000) return undefined;
	return { count, chunk: match[2] === 'index.json' ? 'index' : Number(match[3]) };
}

/** Serves the generated streams: an index first, and then the chunks that a page asks for. */
export function splatStreamServer(): Plugin {
	const serve: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
		const request = req.url === undefined ? undefined : splatStreamRequest(req.url);
		if (!request) return next();
		void respond(request, res);
	};
	return {
		name: 'null3d-splat-stream',
		// Before Vite's own resolver, which would look for the address under the project's root.
		enforce: 'pre',
		configureServer: (server) => void server.middlewares.use(serve),
		configurePreviewServer: (server) => void server.middlewares.use(serve),
	};
}

async function respond(request: StreamRequest, res: ServerResponse): Promise<void> {
	let stream: GeneratedStream;
	try {
		stream = await streamOf(request.count);
	} catch (error) {
		res.statusCode = 500;
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		res.end(`the splat stream of ${request.count} splats failed: ${(error as Error).message}`);
		return;
	}
	const bytes = request.chunk === 'index' ? stream.index : stream.chunks[request.chunk];
	if (!bytes) {
		res.statusCode = 404;
		res.end();
		return;
	}
	res.setHeader(
		'Content-Type',
		request.chunk === 'index' ? 'application/json' : 'application/gzip',
	);
	res.setHeader('Content-Length', bytes.byteLength);
	// A device run measures what the page downloads, so a cached copy must not stand in.
	res.setHeader('Cache-Control', 'no-store');
	res.end(bytes);
}
