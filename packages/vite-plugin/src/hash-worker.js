// A worker thread of the hash pool. It reads one file in fixed-size chunks into one buffer of its
// own and answers with the prefix of the file's SHA-256, so the build hashes many files at once and
// the page's thread reads no file and keeps none of their bytes. The buffer is reused for every
// file, so a worker holds no whole file and its memory does not grow with the number of files. The
// worker imports only Node's own modules, so the plugin runs under Node as well as Bun.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';

/** The bytes that one read takes; a file is hashed in as many reads as it needs. */
const CHUNK = 64 * 1024;
/** The buffer that every read fills, so a worker allocates one buffer for its whole life. */
const chunk = Buffer.allocUnsafe(CHUNK);

/**
 * Answers with the first eight hexadecimal digits of the file's SHA-256, which is how a copied
 * shader file's name carries its content. The digest is the same as a hash of the whole file's
 * bytes, whatever the chunks are.
 */
async function hashFile(file) {
	const handle = await open(file, 'r');
	try {
		const hash = createHash('sha256');
		for (;;) {
			const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
			if (bytesRead === 0) return hash.digest('hex').slice(0, 8);
			hash.update(chunk.subarray(0, bytesRead));
		}
	} finally {
		await handle.close();
	}
}

/** Answers one request with its file's hash, or with the failure that reading it raised. */
async function answer({ id, file }) {
	try {
		parentPort?.postMessage({ id, hash: await hashFile(file) });
	} catch (error) {
		// The pool raises the failure on the build's thread, which fails the build as a direct read
		// does. The code lets a caller tell a vanished file from a worker that stopped.
		parentPort?.postMessage({
			id,
			error: { message: error.message, code: error.code },
		});
	}
}

// The pool sends many files to one worker, and the read buffer is shared, so the files are
// answered one after another; the other workers run meanwhile.
let answering = Promise.resolve();
parentPort?.on('message', (request) => {
	answering = answering.then(() => answer(request));
});
