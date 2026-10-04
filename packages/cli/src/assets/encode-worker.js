// A worker thread of the texture encoder. It loads the encoder once, then encodes each texture
// that its pool sends, one at a time, and hands back the KTX2 file without a copy.
import { parentPort } from 'node:worker_threads';
import { encodeTexture } from './encoder.js';

/** @import { TextureJob } from './encoder.js' */

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);

port.on('message', async (/** @type {{ id: number, job: TextureJob }} */ { id, job }) => {
	try {
		const texture = await encodeTexture(job);
		port.postMessage({ id, texture }, [/** @type {ArrayBuffer} */ (texture.ktx2.buffer)]);
	} catch (error) {
		port.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
});
