// A splat stream: an index that names a cloud's chunks, and the loader that fetches the chunks that
// the view asks for. The index is small, so a page reads it first and then downloads only the
// chunks whose splats draw. Each chunk is an SPZ file of its own, so a large cloud appears a piece
// at a time instead of after its whole file arrives.
//
// The loader keeps a few requests in flight, retries a chunk that a lost connection or a cut-short
// body spoiled, and reports a chunk that stays unreachable. A chunk that arrives after the view
// moved away stays loaded but takes no row: the selection's counts decide which chunks draw.
import { chunkFrom, type SplatChunk } from './chunks';
import { checkSplats, type SplatData, splatsError } from './format';

/** The format name that a stream index gives. */
export const STREAM_FORMAT = 'null3d.splats.stream';

/** The index version that this reader takes. */
export const STREAM_VERSION = 1;

/**
 * One chunk of a splat stream: where its file lies, how many splats it holds, and the bounds that
 * the selection needs before it loads.
 *
 * @category api/splats
 */
export interface StreamChunk {
	/** The chunk's address, resolved against the index's own address. */
	readonly url: string;
	/** The number of splats in the chunk's file. */
	readonly count: number;
	/** The center of the chunk's bounds, in meters. */
	readonly center: readonly [number, number, number];
	/** The distance from the center to the farthest splat, in meters. */
	readonly radius: number;
	/** The size of the chunk's file in bytes, or 0 when the index does not give it. */
	readonly bytes: number;
}

/**
 * A splat stream's index: the cloud's count and the chunks that it is cut into.
 *
 * @category api/splats
 */
export interface SplatStream {
	/** The number of splats in the whole cloud. */
	readonly count: number;
	/** The chunks, in the index's order. */
	readonly chunks: readonly StreamChunk[];
	/** The bytes that every chunk file takes together, as far as the index gives them. */
	readonly bytes: number;
}

/** True when the bytes that a page downloaded start a stream index rather than a splat file. */
export function startsStreamIndex(bytes: Uint8Array): boolean {
	// Skip a byte-order mark and whitespace, which a JSON file may start with.
	let at = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	while (at < bytes.length) {
		const byte = bytes[at] as number;
		if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return byte === 0x7b;
		at++;
	}
	return false;
}

/**
 * Reads a stream index. `base` resolves each chunk's address, which a relative one needs. Throws
 * E2112 for a text that is not a stream index of this version, and for a cloud whose chunks do not
 * hold the number of splats that it names.
 *
 * @category api/splats
 */
export function parseStreamIndex(
	text: string,
	base: string | URL | undefined,
	what = 'the splat stream index',
): SplatStream {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw splatsError(
			2112,
			`${what} is not JSON, so it is not a splat stream index: ${(error as Error).message}. Give the address of an index that a stream writer made.`,
		);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
		throw splatsError(2112, `${what} holds no JSON object, so it is not a splat stream index.`);
	const index = parsed as Record<string, unknown>;
	if (index['format'] !== STREAM_FORMAT)
		throw splatsError(
			2112,
			`${what} names the format ${JSON.stringify(index['format'])}, and a splat stream index names ${JSON.stringify(STREAM_FORMAT)}.`,
		);
	if (index['version'] !== STREAM_VERSION)
		throw splatsError(
			2112,
			`${what} is version ${JSON.stringify(index['version'])}, and this reader reads version ${STREAM_VERSION}.`,
		);
	const count = index['count'];
	if (typeof count !== 'number' || !Number.isInteger(count) || count < 0)
		throw splatsError(
			2112,
			`${what} gives the count ${JSON.stringify(count)}, and a stream index takes a whole number of splats, 0 or more.`,
		);
	const rows = index['chunks'];
	if (!Array.isArray(rows))
		throw splatsError(2112, `${what} gives no list of chunks. Give a "chunks" array.`);
	const chunks: StreamChunk[] = [];
	let total = 0;
	let bytes = 0;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i] as unknown;
		if (typeof row !== 'object' || row === null || Array.isArray(row))
			throw splatsError(2112, `chunk ${i} of ${what} is not an object.`);
		const entry = row as Record<string, unknown>;
		const url = entry['url'];
		if (typeof url !== 'string' || url.length === 0)
			throw splatsError(2112, `chunk ${i} of ${what} gives no address. Give a "url".`);
		const chunkCount = entry['count'];
		if (typeof chunkCount !== 'number' || !Number.isInteger(chunkCount) || chunkCount < 0)
			throw splatsError(
				2112,
				`chunk ${i} of ${what} gives the count ${JSON.stringify(chunkCount)}, and a chunk takes a whole number of splats, 0 or more.`,
			);
		const center = entry['center'];
		if (!isVector(center))
			throw splatsError(
				2112,
				`chunk ${i} of ${what} gives no center of three finite numbers. Give a "center" array.`,
			);
		const radius = entry['radius'];
		if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0)
			throw splatsError(
				2112,
				`chunk ${i} of ${what} gives the radius ${JSON.stringify(radius)}, and a chunk takes a finite radius, 0 or more.`,
			);
		const size = entry['bytes'] ?? 0;
		if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
			throw splatsError(
				2112,
				`chunk ${i} of ${what} gives the size ${JSON.stringify(size)}, and a chunk takes a whole number of bytes, 0 or more.`,
			);
		let address: string;
		try {
			address =
				base === undefined ? new URL(url, 'http://localhost/').href : new URL(url, base).href;
		} catch {
			throw splatsError(
				2112,
				`chunk ${i} of ${what} gives the address ${url}, which is not a URL.`,
			);
		}
		chunks.push({
			url: address,
			count: chunkCount,
			center: [center[0] as number, center[1] as number, center[2] as number],
			radius,
			bytes: size,
		});
		total += chunkCount;
		bytes += size;
	}
	if (total !== count)
		throw splatsError(
			2112,
			`${what} names ${count} splats, and its chunks hold ${total}. Give every splat one chunk.`,
		);
	return { count, chunks, bytes };
}

/** True for three finite numbers. */
function isVector(value: unknown): value is [number, number, number] {
	return (
		Array.isArray(value) &&
		value.length === 3 &&
		value.every((item) => typeof item === 'number' && Number.isFinite(item))
	);
}

/** The calls that the loader makes, which a test replaces. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** How the stream loader behaves, and where its answers go. */
export interface StreamLoaderOptions {
	/** Downloads a chunk. The default is the page's `fetch`. */
	readonly fetch?: FetchLike;
	/** Reads a chunk file. */
	readonly decode: (bytes: Uint8Array) => Promise<SplatData>;
	/** The most requests in flight at once. The default is 4. */
	readonly concurrency?: number;
	/** How many times a chunk is fetched again after a failure. The default is 2. */
	readonly retries?: number;
	/** The wait before the first retry, in milliseconds. The default is 250, and each retry doubles it. */
	readonly retryDelayMs?: number;
	/** The time after which one request is given up, in milliseconds. The default is 30000. */
	readonly timeoutMs?: number;
	/** Sees a chunk once its data is decoded. */
	readonly onChunk: (index: number, chunk: SplatChunk) => void;
	/** Sees a chunk that stays unreachable, once. */
	readonly onFailed: (index: number, error: Error) => void;
	/** Runs when no request is in flight and no wanted chunk waits. */
	readonly onIdle: () => void;
}

/** The chunk states of the loader. */
const IDLE = 0;
const QUEUED = 1;
const LOADED = 2;
const FAILED = 3;
const IN_FLIGHT = 4;

/**
 * Loads the chunks of a splat stream that the view asks for. Call `load` with the wanted chunks,
 * nearest first, each time the selection changes. A chunk loads once: its request stays in flight
 * if the view moves away, and its data stays for a later look.
 */
export class SplatStreamLoader {
	private readonly fetchImpl: FetchLike;
	private readonly decode: (bytes: Uint8Array) => Promise<SplatData>;
	private readonly concurrency: number;
	private readonly retries: number;
	private readonly retryDelayMs: number;
	private readonly timeoutMs: number;
	private readonly states: Uint8Array;
	private readonly queue: number[] = [];
	private readonly controllers = new Set<AbortController>();
	private readonly options: StreamLoaderOptions;
	private inFlight = 0;
	private stopped = false;
	private loadedCount = 0;
	private failedCount = 0;
	private received = 0;

	constructor(
		readonly stream: SplatStream,
		options: StreamLoaderOptions,
	) {
		this.options = options;
		this.fetchImpl = options.fetch ?? defaultFetch;
		this.decode = options.decode;
		this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
		this.retries = Math.max(0, Math.floor(options.retries ?? 2));
		this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
		this.timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);
		this.states = new Uint8Array(stream.chunks.length);
	}

	/** The chunks whose data is loaded. */
	get loaded(): number {
		return this.loadedCount;
	}

	/** The chunks that stayed unreachable. */
	get failed(): number {
		return this.failedCount;
	}

	/** The bytes of the chunk files that have arrived. */
	get receivedBytes(): number {
		return this.received;
	}

	/** True when no request is in flight and no wanted chunk waits. */
	get idle(): boolean {
		return this.inFlight === 0 && this.queue.length === 0;
	}

	/**
	 * Wants the chunks that `order` names, nearest first, and starts the requests that fit. A chunk
	 * that is already loaded, failed or in flight is left alone.
	 */
	load(order: ArrayLike<number>): void {
		if (this.stopped) return;
		// A chunk that waited for a look that has passed gives its place to the new order.
		for (let i = 0; i < this.states.length; i++)
			if (this.states[i] === QUEUED) this.states[i] = IDLE;
		this.queue.length = 0;
		for (let k = 0; k < order.length; k++) {
			const i = order[k] as number;
			if (this.states[i] === IDLE) {
				this.states[i] = QUEUED;
				this.queue.push(i);
			}
		}
		this.pump();
	}

	/** Stops every request, and reports nothing more. */
	abort(): void {
		this.stopped = true;
		this.queue.length = 0;
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
		this.inFlight = 0;
	}

	private pump(): void {
		if (this.stopped) return;
		while (this.inFlight < this.concurrency && this.queue.length > 0) {
			const index = this.queue.shift() as number;
			this.states[index] = IN_FLIGHT;
			this.inFlight++;
			void this.loadChunk(index);
		}
		if (this.idle) this.options.onIdle();
	}

	private async loadChunk(index: number): Promise<void> {
		try {
			await this.fetchChunk(index);
		} finally {
			// The chunk settles once, whether it loaded, failed, stopped or found no retry left.
			this.inFlight = Math.max(0, this.inFlight - 1);
			this.pump();
		}
	}

	private async fetchChunk(index: number): Promise<void> {
		const chunk = this.stream.chunks[index] as StreamChunk;
		let attempt = 0;
		for (;;) {
			const controller = new AbortController();
			this.controllers.add(controller);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const request = this.fetchImpl(chunk.url, { signal: controller.signal });
				timer = setTimeout(() => controller.abort(), this.timeoutMs);
				const response = await request;
				if (!response.ok) {
					// A server that lacks the file cannot answer it on a retry either.
					throw permanent(
						splatsError(
							2114,
							`chunk ${index} of the splat stream answered ${response.status} at ${chunk.url}. Give an index whose chunk files the page may read.`,
						),
					);
				}
				const bytes = new Uint8Array(await response.arrayBuffer());
				const data = checkSplats(await this.decode(bytes), `chunk ${index} of the splat stream`);
				if (data.count !== chunk.count)
					throw permanent(
						splatsError(
							2113,
							`chunk ${index} of the splat stream holds ${data.count} splats at ${chunk.url}, and the index says ${chunk.count}. Check that the index and its chunk files belong together.`,
						),
					);
				if (this.stopped) return;
				this.states[index] = LOADED;
				this.loadedCount++;
				this.received += bytes.byteLength;
				this.options.onChunk(index, chunkFrom(data, chunk.center, chunk.radius));
				return;
			} catch (error) {
				if (this.stopped) return;
				if (isPermanent(error) || attempt >= this.retries) {
					this.states[index] = FAILED;
					this.failedCount++;
					this.options.onFailed(index, asError(error));
					return;
				}
				attempt++;
				await delay(this.retryDelayMs * 2 ** (attempt - 1));
				if (this.stopped) return;
			} finally {
				clearTimeout(timer);
				this.controllers.delete(controller);
			}
		}
	}
}

/** A failure that a retry cannot mend. */
interface PermanentError extends Error {
	readonly permanent: true;
}

function permanent(error: Error): PermanentError {
	return Object.assign(error, { permanent: true as const });
}

function isPermanent(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		(error as { permanent?: unknown }).permanent === true
	);
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function delay(ms: number): Promise<void> {
	return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
