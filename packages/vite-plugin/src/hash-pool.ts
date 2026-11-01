// The content hashes of the generated shader files, on worker threads. A build names each file it
// copies by a hash of the file, and the engine's set alone is thousands of files and gigabytes
// together: on the build's own thread that pass holds up module loading. The pool splits the files
// across a few workers, each of which reads its file in chunks, so the build hashes many files at
// once and keeps none of their bytes.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/** The most workers a pool starts, where a wider pool read no faster. */
const MOST_WORKERS = 4;

/** The workers of a pool by default: one for each core but one, at most `MOST_WORKERS`. */
export function defaultHashWorkers(): number {
	return Math.max(1, Math.min(MOST_WORKERS, availableParallelism() - 1));
}

/** A worker thread and the files that it has not answered yet, by id. */
interface PoolWorker {
	readonly thread: Worker;
	readonly waiting: Map<number, { resolve(hash: string): void; reject(e: Error): void }>;
}

/** A worker's answer: the file's hash, or the failure that reading it raised. */
interface Answer {
	readonly id: number;
	readonly hash?: string;
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
	hash(file: string): Promise<string> {
		const worker = this.pick();
		const id = this.nextId++;
		const { thread, waiting } = worker;
		const answer = new Promise<string>((resolve, reject) => waiting.set(id, { resolve, reject }));
		thread.ref();
		thread.postMessage({ id, file });
		return answer;
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
			} else call.resolve(answer.hash);
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
