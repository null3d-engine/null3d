// The engine's Basis Universal transcoder, for unit tests that read back the asset tool's KTX2
// files as the engine would: each file's header, and any level as RGBA8 texels.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRANSCODER = join(import.meta.dirname, '../../packages/engine/vendor/basis');

// biome-ignore lint/suspicious/noExplicitAny: the transcoder's module has no types.
let transcoder: Promise<any> | undefined;

/** The engine's transcoder, which the engine ships as an ES module, loaded once. */
export function loadTranscoder() {
	transcoder ??= (async () => {
		const { default: start } = await import(join(TRANSCODER, 'basis_transcoder.mjs'));
		const basis = await start({
			wasmBinary: readFileSync(join(TRANSCODER, 'basis_transcoder.wasm')),
		});
		basis.initializeBasis();
		return basis;
	})();
	return transcoder;
}

/** The KTX2 file's header fields that the engine reads. */
export function ktx2Header(ktx2: Uint8Array) {
	const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
	return {
		vkFormat: view.getUint32(12, true),
		width: view.getUint32(20, true),
		height: view.getUint32(24, true),
		levels: view.getUint32(40, true),
		supercompression: view.getUint32(44, true),
	};
}

/** A level of a KTX2 file, transcoded to RGBA8, and whether the file holds sRGB colors. */
export async function transcodeLevel(ktx2: Uint8Array, level = 0) {
	const basis = await loadTranscoder();
	const file = new basis.KTX2File(ktx2);
	try {
		if (!file.startTranscoding()) throw new Error('the transcoder refused the file');
		const format = basis.transcoder_texture_format.cTFRGBA32.value;
		const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, format));
		if (!file.transcodeImage(out, level, 0, 0, format, 0, -1, -1))
			throw new Error(`the transcoder could not transcode level ${level}`);
		return { srgb: file.isSRGB() as boolean, out };
	} finally {
		file.close();
		file.delete();
	}
}
