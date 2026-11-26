// A worker thread of the hash pool. It reads one file in fixed-size chunks into one buffer of its
// own and answers with the prefix of the file's SHA-256, so the build hashes many files at once and
// the page's thread reads no file and keeps none of their bytes. The buffer is reused for every
// file, so a worker holds no whole file and its memory does not grow with the number of files. The
// worker imports only Node's own modules, so the plugin runs under Node as well as Bun. Asked to
// scan, it also gives the permutation word of each build that the file holds, from the same read.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';

/** The bytes that one read takes; a file is hashed in as many reads as it needs. */
const CHUNK = 64 * 1024;
/** The buffer that every read fills, so a worker allocates one buffer for its whole life. */
const chunk = Buffer.allocUnsafe(CHUNK);

/**
 * A line of a generated shader module that holds a build's permutation word: the same lines that
 * `PERMUTATION_LINE` in `shader-list.ts` reads.
 */
const PERMUTATION_LINE = /^\t*permutation: (\d+),$/gm;

/**
 * The first eight hexadecimal digits of the file's SHA-256, which is how a copied shader file's
 * name carries its content, and, when `scan` is set, the permutation word of each build that the
 * file holds. The digest is the same as a hash of the whole file's bytes, whatever the chunks are.
 * A line that two chunks split is read whole, from the text left after the last line break.
 */
async function readFile(file, scan) {
	const handle = await open(file, 'r');
	try {
		const hash = createHash('sha256');
		const words = new Set();
		const decoder = new TextDecoder();
		let rest = '';
		const lines = (text) => {
			for (const match of text.matchAll(PERMUTATION_LINE)) words.add(Number(match[1]));
		};
		for (;;) {
			const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
			if (bytesRead === 0) {
				if (scan) lines(rest + decoder.decode());
				return { hash: hash.digest('hex').slice(0, 8), words: scan ? [...words] : undefined };
			}
			const bytes = chunk.subarray(0, bytesRead);
			hash.update(bytes);
			if (!scan) continue;
			const text = rest + decoder.decode(bytes, { stream: true });
			const end = text.lastIndexOf('\n');
			lines(text.slice(0, end + 1));
			rest = text.slice(end + 1);
		}
	} finally {
		await handle.close();
	}
}

/** Answers one request with its file's hash, or with the failure that reading it raised. */
async function answer({ id, file, scan }) {
	try {
		parentPort?.postMessage({ id, ...(await readFile(file, scan === true)) });
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
