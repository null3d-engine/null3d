// The content hashes of the generated shader files, on worker threads. A build names each file it
// copies by a hash of the file, and the engine's set alone is thousands of files and gigabytes
// together: on the build's own thread that pass holds up module loading. The pool splits the files
// across a few workers, each of which reads its file in chunks, so the build hashes many files at
// once and keeps none of their bytes. A scan gives the permutation words of a file's builds as well,
// from the same read, for a build that narrows the set to a project's list.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/** The most workers a pool starts, where a wider pool read no faster. */
const MOST_WORKERS = 4;

/** The workers of a pool by default: one for each core but one, at most `MOST_WORKERS`. */
export function defaultHashWorkers(): number {
	return Math.max(1, Math.min(MOST_WORKERS, availableParallelism() - 1));
}

/** What a scan of a file gives: its hash, and the permutation word of each build that it holds. */
export interface Scanned {
	readonly hash: string;
	readonly words: readonly number[];
}

/** A worker thread and the files that it has not answered yet, by id. */
interface PoolWorker {
	readonly thread: Worker;
	readonly waiting: Map<number, { resolve(answer: Answer): void; reject(e: Error): void }>;
}

/** A worker's answer: the file's hash and, for a scan, its words, or the failure of the read. */
interface Answer {
	readonly id: number;
	readonly hash?: string;
	readonly words?: readonly number[];
	readonly error?: { message: string; code?: string };
}

/**
 * Hashes files on worker threads, which start at the first file. An idle worker does not keep the
 * process alive, so a build ends without `close`.
 */
export class HashPool {
	/** The most workers that run at once. */
	readonly size: number;
	private readonly workers: PoolWorker[] = [];
	private nextId = 0;

	constructor(size: number = defaultHashWorkers()) {
		this.size = size;
	}

	/**
	 * The first eight hexadecimal digits of the file's SHA-256, which is the same digest a hash of
	 * the whole file's bytes gives. A file that cannot be read rejects with the failure that the
	 * read raised.
	 */
	async hash(file: string): Promise<string> {
		return (await this.read(file, false)).hash;
	}

	/**
	 * The file's hash, as `hash` gives it, and the permutation word of each build that the file
	 * holds, from each line of the form that the shader build writes.
	 */
	async scan(file: string): Promise<Scanned> {
		const { hash, words = [] } = await this.read(file, true);
		return { hash, words };
	}

	/** Sends one file to the worker with the fewest files waiting, and gives its answer. */
	private read(file: string, scan: boolean): Promise<Answer & { hash: string }> {
		const worker = this.pick();
		const id = this.nextId++;
		const { thread, waiting } = worker;
		const answer = new Promise<Answer>((resolve, reject) => waiting.set(id, { resolve, reject }));
		thread.ref();
		thread.postMessage({ id, file, scan });
		return answer as Promise<Answer & { hash: string }>;
	}

	/** Stops every worker. A later hash starts them again. */
	async close(): Promise<void> {
		const workers = this.workers.splice(0);
		await Promise.all(workers.map((worker) => worker.thread.terminate()));
	}

	/** The worker with the fewest files waiting, or a new one while there is room. */
	private pick(): PoolWorker {
		let worker = this.workers.reduce<PoolWorker | undefined>(
			(best, next) => (!best || next.waiting.size < best.waiting.size ? next : best),
			undefined,
		);
		if (!worker || (worker.waiting.size > 0 && this.workers.length < this.size))
			worker = this.start();
		return worker;
	}

	private start(): PoolWorker {
		const thread = new Worker(new URL('./hash-worker.js', import.meta.url));
		const worker: PoolWorker = { thread, waiting: new Map() };
		thread.on('message', (answer: Answer) => {
			const call = worker.waiting.get(answer.id);
			if (call === undefined) return;
			worker.waiting.delete(answer.id);
			if (answer.hash === undefined) {
				call.reject(Object.assign(new Error(answer.error?.message ?? ''), answer.error));
			} else call.resolve(answer);
			if (worker.waiting.size === 0) thread.unref();
		});
		// A thread that stops takes every file it held with it, and the build fails rather than
		// naming a copy by a hash that was never computed.
		const fail = (error: Error) => {
			const index = this.workers.indexOf(worker);
			if (index >= 0) this.workers.splice(index, 1);
			for (const call of worker.waiting.values()) call.reject(error);
			worker.waiting.clear();
		};
		thread.on('error', (error: Error) =>
			fail(new Error(`null3D: a shader hash thread stopped: ${error.message}`)),
		);
		thread.on('exit', (code) =>
			fail(new Error(`null3D: a shader hash thread exited with code ${code}`)),
		);
		thread.unref();
		this.workers.push(worker);
		return worker;
	}
}
