// Worker threads that encode textures, one texture on each thread at a time. The encoder is
// single-threaded, so a texture's bytes do not depend on how many threads run.
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

/** @import { EncodedTexture, TextureJob } from './encoder.js' */

/** The worker threads to start when a command does not say: one for each logical core. */
export const defaultJobs = () => availableParallelism();

/**
 * @typedef {object} Task
 * @property {TextureJob} job
 * @property {(texture: EncodedTexture) => void} resolve
 * @property {(error: Error) => void} reject
 */

/**
 * A pool of encoder threads. Threads start as textures wait for one, up to `size`, and all stop
 * with `close`. A thread that fails fails its texture, and a new thread takes its place.
 *
 * @param {number} size The most threads.
 */
export function encoderPool(size) {
	/** @type {Worker[]} */
	const idle = [];
	/** @type {Set<Worker>} */
	const all = new Set();
	/** @type {Task[]} */
	const queue = [];
	let next = 0;

	function start() {
		const worker = new Worker(new URL('./encode-worker.js', import.meta.url));
		all.add(worker);
		serve(worker);
	}

	/** @param {Worker} worker */
	function serve(worker) {
		const task = queue.shift();
		if (!task) {
			idle.push(worker);
			return;
		}
		const id = next++;
		/** @param {{ id: number, texture?: EncodedTexture, error?: string }} message */
		const done = (message) => {
			if (message.id !== id) return;
			worker.off('message', done);
			worker.off('error', failed);
			if (message.texture) task.resolve(message.texture);
			else task.reject(new Error(message.error));
			serve(worker);
		};
		/** @param {Error} error */
		const failed = (error) => {
			worker.off('message', done);
			all.delete(worker);
			task.reject(error);
			if (queue.length > 0) start();
		};
		worker.on('message', done);
		worker.once('error', failed);
		const bytes = task.job.bytes.slice();
		worker.postMessage({ id, job: { ...task.job, bytes } }, [bytes.buffer]);
	}

	return {
		/**
		 * Encodes a texture on the first free thread.
		 *
		 * @param {TextureJob} job
		 * @returns {Promise<EncodedTexture>}
		 */
		encode(job) {
			return new Promise((resolve, reject) => {
				queue.push({ job, resolve, reject });
				const worker = idle.pop();
				if (worker) serve(worker);
				else if (all.size < size) start();
			});
		},
		/** Stops every thread. */
		async close() {
			const workers = [...all];
			all.clear();
			idle.length = 0;
			await Promise.all(workers.map((worker) => worker.terminate()));
		},
	};
}

/**
 * An encode that runs once for each image and setting: a second texture with the same image,
 * kind, format and largest side, in this model or another, takes the first one's result.
 *
 * @param {(job: TextureJob) => Promise<EncodedTexture>} encode
 * @returns {(job: TextureJob) => Promise<EncodedTexture>}
 */
export function encodeOnce(encode) {
	/** @type {Map<string, Promise<EncodedTexture>>} */
	const started = new Map();
	return (job) => {
		const hash = createHash('sha256').update(job.bytes).digest('hex');
		const key = `${hash} ${job.kind} ${job.codec} ${job.maxSide}`;
		let pending = started.get(key);
		if (!pending) {
			pending = encode(job);
			started.set(key, pending);
		}
		return pending;
	};
}
