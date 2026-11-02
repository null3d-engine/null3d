// The garden's cloud as a splat stream: the cloud is cut into chunks, each written as an SPZ file,
// and a small index names them. The add-on reads the index first and then fetches only the chunks
// that the view's budget asks for, nearest first, which is the path that a captured scene of this
// size takes. The files are made in code and held as blob URLs, so the scene needs no server of its
// own and works wherever the examples page is built.
import { chunkSplats, encodeSpz, type SplatData } from '@null3d/splats';

/** A stream that a sketch can draw, with the numbers that its label shows. */
export interface GardenStream {
	/** The address of the index, which `createSplats` reads. */
	readonly url: string;
	/** The splats in the whole cloud. */
	readonly count: number;
	/** The chunks that the cloud is cut into. */
	readonly chunks: number;
	/** The bytes of every chunk file together. */
	readonly bytes: number;
	/** Frees the files that the browser holds. */
	destroy(): void;
}

/** The splats that one chunk file holds. */
const CHUNK_SPLATS = 30_000;

/**
 * Cuts a cloud into chunk files and a stream index, and returns the index's address. `progress`
 * hears how many chunks are written, and the share of the chunks that are done.
 */
export async function streamCloud(
	data: SplatData,
	progress: (written: number, total: number, share: number) => void,
): Promise<GardenStream> {
	const { chunks } = await chunkSplats(data, { splatsPerChunk: CHUNK_SPLATS });
	const urls: string[] = [];
	const files: Uint8Array[] = [];
	let bytes = 0;
	for (let i = 0; i < chunks.length; i++) {
		const file = await encodeSpz(chunks[i] as (typeof chunks)[number]);
		files.push(file);
		bytes += file.byteLength;
		progress(i + 1, chunks.length, (i + 1) / chunks.length);
	}
	// Each chunk file becomes its own address, so the loader can fetch the ones that it wants.
	for (const file of files) urls.push(URL.createObjectURL(new Blob([file as BlobPart])));
	const index = {
		format: 'null3d.splats.stream',
		version: 1,
		count: data.count,
		chunks: chunks.map((chunk, i) => ({
			url: urls[i] as string,
			count: chunk.count,
			center: chunk.center,
			radius: chunk.radius,
			bytes: (files[i] as Uint8Array).byteLength,
		})),
	};
	const indexUrl = URL.createObjectURL(
		new Blob([JSON.stringify(index)], { type: 'application/json' }),
	);
	return {
		url: indexUrl,
		count: data.count,
		chunks: chunks.length,
		bytes,
		destroy() {
			URL.revokeObjectURL(indexUrl);
			for (const url of urls) URL.revokeObjectURL(url);
		},
	};
}
