// The panorama worker: reads Radiance and OpenEXR files off the sketch's frames, for
// `assets.loadEnvironment`, whose loader (scene/panorama.ts) starts it with the first such file.
// Each file arrives as bytes, and its panorama and diffuse light go back in one message that moves
// their arrays rather than copying them. A file that the readers refuse comes back as the reason,
// so no load waits for an answer that does not come.

import { type PanoramaFile, readPanorama } from '../scene/panorama-files';

/** A file to read, into a panorama at most `maxSide` texels on each side. */
export interface PanoramaRequest {
	id: number;
	file: ArrayBuffer;
	maxSide: number;
}

/** The file's panorama and diffuse light, or why the readers refused it. */
export type PanoramaAnswer = { id: number; read: PanoramaFile } | { id: number; error: string };

self.onmessage = async (event: MessageEvent<PanoramaRequest>) => {
	const { id, file, maxSide } = event.data;
	const worker = self as unknown as Worker;
	try {
		const read = await readPanorama(file, maxSide);
		worker.postMessage({ id, read } satisfies PanoramaAnswer, [
			read.panorama.texels.buffer,
			read.sh.buffer,
		]);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		worker.postMessage({ id, error: reason } satisfies PanoramaAnswer);
	}
};
