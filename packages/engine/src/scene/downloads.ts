// The downloads behind the sketch's loading calls (assets.ts): each file fetched with one retry, its
// bytes counted for the progress handlers, and its failure given its code. Files that `preload` or a
// sketch's download list fetched wait in memory until a load takes them, and loads of one address at
// the same time share one download; the HTTP cache keeps everything else. A live sketch's list
// starts as soon as its module loads, before the engine's core has arrived, so this part of the
// loader needs no core. The list keeps few of its files downloading at once, so the engine's own
// start files find a free connection on a server that gives a page few. A development build also
// watches the sketch's own loads during the setup, and says when one waited for another
// (serial-loads.ts).

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { reasonOf } from '../errors/message';
import type { ProgressHandler } from './assets';
import { SerialLoads } from './serial-loads';

/** How long a download waits before its one retry, in ms. */
const RETRY_DELAY_MS = 250;

/** The call that a failed download of a listed file names, which the load that takes it rethrows. */
const LIST_CALL = 'the downloads of defineSketch';

/** Fetches a file. */
export type FetchFile = (address: URL) => Promise<Response>;

/** Fetches a file as the page's other requests are fetched. */
const fetchFile: FetchFile = (address) => fetch(address);

/**
 * Waits before a download's retry. A tunnel or a proxy can refuse a session's first request while
 * the same file serves a moment later, and a short wait lets it answer again.
 */
function waitBeforeRetry(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

/** @internal The downloads of one engine's loading calls, and the bytes they counted. */
export class Downloads {
	/** Downloads that `preload` or the list started, by address, which the first load of each takes. */
	private readonly preloaded = new Map<string, Promise<Blob>>();
	/** Downloads under way, by address, which loads at the same time share. */
	private readonly pending = new Map<string, Promise<Blob>>();
	/** The listed files that have not started, in the list's order, by address. */
	private readonly queued = new Map<string, URL>();
	/**
	 * The listed files that a load asked for while the most at once downloaded, in the order of
	 * their loads, by address: each one's download, and the start that the queue calls.
	 */
	private readonly asked = new Map<string, { download: Promise<Blob>; start(): void }>();
	/** The listed files that download now, whether the list or a load started them. */
	private listedActive = 0;
	/** The most listed files that download at once, while no load waits for one. */
	private listedAtOnce = 0;
	/** The most listed files that download at once, those that loads asked for included. */
	private listedMost = 0;
	/** Fetches a listed file that no load has asked for yet. */
	private fetchListed = fetchFile;
	private readonly handlers = new Set<ProgressHandler>();
	/** The handlers in registration order, for the report to walk by index. */
	private handlerList: ProgressHandler[] = [];
	/** Bytes that have arrived, and the bytes of the responses whose length is known so far. */
	private loadedBytes = 0;
	private totalBytes = 0;
	/** In a development build, the watch for the sketch's loads that wait for one another. */
	private readonly serial = DEV ? new SerialLoads() : undefined;

	/** @param base The page's address, which tells another origin's files from the page's own. */
	constructor(private readonly base: string) {}

	/**
	 * In a development build, gives the test of whether the sketch's loads are watched now: during
	 * the setup of a live start whose sketch did not turn the warning off.
	 */
	watch(watching: () => boolean): void {
		if (DEV && this.serial) this.serial.watching = watching;
	}

	/**
	 * Takes the downloads of a sketch's list. `started` holds the responses of its first addresses,
	 * which the thread fetched with `fetchListed` as the sketch's module loaded. The rest start in
	 * the list's order as those finish, `atOnce` at a time. A load that asks for one that has not
	 * started moves it ahead of the others, and up to `most` download while loads wait for them.
	 */
	list(
		addresses: readonly URL[],
		started: readonly Promise<Response>[],
		atOnce: number,
		most: number,
		fetchListed: FetchFile,
	): void {
		this.listedAtOnce = atOnce;
		this.listedMost = most;
		this.fetchListed = fetchListed;
		addresses.forEach((address, at) => {
			const response = started[at];
			if (response) this.startListed(address, response);
			else this.queued.set(address.href, address);
		});
	}

	/**
	 * A file for one of the sketch's own loading calls. A development build first checks whether
	 * its download starts only after another load's file arrived.
	 */
	load(address: URL, call: string): Promise<Blob> {
		if (DEV) this.serial?.starts(address, call, this.starts(address));
		const download = this.file(address, call);
		if (DEV) this.serial?.follow(download, address);
		return download;
	}

	/** In a development build, notes the text of a JSON file that a load read. */
	noteText(address: URL, text: string): void {
		if (DEV) this.serial?.read(address, text);
	}

	/**
	 * In a development build, notes a call of the sketch's that made its data with no file, such as
	 * a built-in environment, as it ends: a download that starts only after it could have run beside
	 * it.
	 */
	noteMade(call: string): void {
		if (DEV) this.serial?.made(call);
	}

	/**
	 * A file that `preload` or the list downloaded, a download of it under way, or a download of it
	 * now. A listed file that has not started becomes the load's own download, which starts at once
	 * unless the most listed files download, and then goes ahead of the list's other files.
	 */
	file(address: URL, call: string): Promise<Blob> {
		const key = address.href;
		const preloaded = this.preloaded.get(key);
		if (preloaded) {
			this.preloaded.delete(key);
			return preloaded;
		}
		const waiting = this.asked.get(key);
		if (waiting) return waiting.download;
		if (this.queued.delete(key)) return this.ask(address, call);
		return this.share(address, call, fetchFile);
	}

	/**
	 * Downloads files ahead of their loads, all at once, and resolves when every one has arrived.
	 * The next load of each address takes its file from memory. A failed file is not kept: a later
	 * load downloads it again.
	 */
	async preload(addresses: readonly URL[], call: string): Promise<void> {
		const downloads = addresses.map((address) => {
			const key = address.href;
			let download = this.preloaded.get(key) ?? this.asked.get(key)?.download;
			if (!download) {
				if (DEV) this.serial?.starts(address, call, this.starts(address));
				this.queued.delete(key);
				download = this.share(address, call, fetchFile);
				this.preloaded.set(key, download);
				download.then(undefined, () => this.preloaded.delete(key));
			}
			return download;
		});
		await Promise.all(downloads);
	}

	/**
	 * Calls `handler` as a download's bytes arrive and when one finishes or fails. Returns a
	 * function that removes the handler.
	 */
	onProgress(handler: ProgressHandler): () => void {
		if (!this.handlers.has(handler)) {
			this.handlers.add(handler);
			this.handlerList.push(handler);
		}
		return () => {
			if (!this.handlers.delete(handler)) return;
			// A new list, so a report that is walking the old one keeps its place and skips this
			// handler by the set's membership.
			this.handlerList = this.handlerList.filter((each) => each !== handler);
		};
	}

	/** True when a load of `address` would start a download, rather than take one. */
	private starts(address: URL): boolean {
		const key = address.href;
		return !this.preloaded.has(key) && !this.pending.has(key) && !this.asked.has(key);
	}

	/**
	 * The download of a listed file that a load asked for before the list started it: now, while
	 * fewer than the most listed files download, and otherwise once the queue reaches it.
	 */
	private ask(address: URL, call: string): Promise<Blob> {
		if (this.listedActive < this.listedMost)
			return this.listed(this.share(address, call, fetchFile));
		let start = () => {};
		const download = new Promise<Blob>((resolve, reject) => {
			start = () => this.listed(this.share(address, call, fetchFile)).then(resolve, reject);
		});
		this.asked.set(address.href, { download, start });
		return download;
	}

	/**
	 * Starts a listed file that no load has asked for, from `response` when the thread fetched it
	 * already. A load takes it, or the error it failed with.
	 */
	private startListed(address: URL, response?: Promise<Response>): void {
		const download = this.listed(this.share(address, LIST_CALL, this.fetchListed, response));
		// Its failure reaches the load that takes it, and no unhandled rejection reports it before.
		download.catch(() => {});
		this.preloaded.set(address.href, download);
	}

	/** Counts a listed file's download while it runs, and starts the next one when it ends. */
	private listed(download: Promise<Blob>): Promise<Blob> {
		this.listedActive++;
		const next = () => {
			this.listedActive--;
			this.startQueued();
		};
		download.then(next, next);
		return download;
	}

	/**
	 * Starts the listed files that loads asked for, in the order of their loads, while fewer than
	 * the most download, then the others in the list's order while fewer than the most at once do.
	 */
	private startQueued(): void {
		for (const [key, waiting] of this.asked) {
			if (this.listedActive >= this.listedMost) return;
			this.asked.delete(key);
			waiting.start();
		}
		for (const [key, address] of this.queued) {
			if (this.listedActive >= this.listedAtOnce) return;
			this.queued.delete(key);
			this.startListed(address);
		}
	}

	/** The download of an address under way, or a new one with `fetch`. */
	private share(
		address: URL,
		call: string,
		fetch: FetchFile,
		response?: Promise<Response>,
	): Promise<Blob> {
		const key = address.href;
		let download = this.pending.get(key);
		if (!download) {
			download = this.download(address, call, fetch, response);
			this.pending.set(key, download);
			if (DEV) this.serial?.begin(download);
			const forget = () => this.pending.delete(key);
			download.then(forget, forget);
		}
		return download;
	}

	/**
	 * Downloads a file with `fetch`, counts its bytes for the progress handlers, and gives failures
	 * their codes. `started` is the response of a fetch that began before, which takes the first
	 * attempt's place. A fetch that fails at the network level, or a server fault, gets one retry
	 * after a short wait; a refused answer and a body that will not read are reported as they come.
	 */
	private async download(
		address: URL,
		call: string,
		fetch: FetchFile,
		started?: Promise<Response>,
	): Promise<Blob> {
		// The bytes this download's response announced, and whether it delivered them.
		let announced = 0;
		let delivered = false;
		try {
			let response: Response | undefined;
			let failure: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				response = undefined;
				failure = undefined;
				try {
					response = attempt === 0 && started ? await started : await fetch(address);
				} catch (error) {
					failure = error;
					if (attempt === 0) {
						await waitBeforeRetry();
						continue;
					}
					break;
				}
				if (response.status >= 500 && attempt === 0) {
					await waitBeforeRetry();
					continue;
				}
				break;
			}
			if (!response) {
				// Fetch gives no reason for a blocked response, so another origin's refusal and a
				// network failure look alike. Another origin's file usually fails for its headers.
				if (address.origin !== new URL(this.base).origin)
					throw new EngineError(
						'E1413',
						`${call}() could not read ${address}: its server did not allow this page to read it, or could not be reached (${reasonOf(failure)}).`,
					);
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: ${reasonOf(failure)}.`,
				);
			}
			if (!response.ok)
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: HTTP ${response.status}.`,
				);
			const length = Number(response.headers.get('content-length'));
			if (Number.isFinite(length) && length > 0) {
				this.totalBytes += length;
				announced = length;
			}
			try {
				// A page that watches progress reads the body in chunks, which is the only way to see
				// the bytes before the whole file arrives. A listed file reads in chunks too, since a
				// handler that the setup adds later still sees its bytes arrive. Otherwise the browser
				// makes the blob in one step.
				if ((this.handlers.size > 0 || call === LIST_CALL) && response.body) {
					const streamed = await this.read(response, address);
					delivered = true;
					return streamed;
				}
				const blob = await response.blob();
				this.loadedBytes += blob.size;
				this.report(address.href);
				delivered = true;
				return blob;
			} catch (error) {
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: ${reasonOf(error)}.`,
				);
			}
		} finally {
			// A file that failed counts as done, so a loading bar reaches its end: the bytes its
			// response announced still count, and a failure that announced none counts one byte. A
			// file that arrived reported as its last bytes came, so it reports nothing here.
			if (!delivered) {
				if (announced > 0) this.loadedBytes += announced;
				else {
					this.loadedBytes += 1;
					this.totalBytes += 1;
				}
				this.report(address.href);
			}
		}
	}

	/** Reads a response's body in chunks, counting each as it arrives. */
	private async read(response: Response, address: URL): Promise<Blob> {
		const reader = response.body?.getReader();
		if (!reader) {
			const blob = await response.blob();
			this.loadedBytes += blob.size;
			return blob;
		}
		const chunks: Uint8Array[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			this.loadedBytes += value.byteLength;
			this.report(address.href);
		}
		return new Blob(chunks as BlobPart[]);
	}

	/** The bytes, total and address that the handlers last saw, so a repeat reports nothing. */
	private reportedLoaded = 0;
	private reportedTotal = 0;
	private reportedUrl: string | null = null;

	private report(url: string): void {
		// A chunk's report and the download's end can hold the same numbers; the handlers see one.
		if (
			url === this.reportedUrl &&
			this.loadedBytes === this.reportedLoaded &&
			this.totalBytes === this.reportedTotal
		)
			return;
		this.reportedLoaded = this.loadedBytes;
		this.reportedTotal = this.totalBytes;
		this.reportedUrl = url;
		// The handlers as this report began: one removed during it is skipped. An addition is
		// appended to the same list, so the walk reaches it unless an earlier removal replaced the
		// list. Walking by index makes no iterator per report.
		const handlers = this.handlerList;
		for (let i = 0; i < handlers.length; i++) {
			const handler = handlers[i];
			if (handler === undefined || !this.handlers.has(handler)) continue;
			try {
				handler(this.loadedBytes, this.totalBytes, url);
			} catch (error) {
				console.error(error);
			}
		}
	}
}
