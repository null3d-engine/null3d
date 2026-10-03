// The KTX2 encoder: the official Basis Universal 2.50 encoder for JavaScript, from the same
// release as the transcoder that the engine ships, kept unchanged in vendor/basis with its
// licence and notice. It is the single-threaded 32-bit WebAssembly build, so every machine encodes
// a texture to the same bytes. The tool runs one copy on each worker thread, one texture at a time.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { decodeImage, hasAlpha, resizeImage, textureSize } from './images.js';

/** @import { Pixels } from './images.js' */

/** The encoder's files: its JavaScript glue and its WebAssembly module. */
export const ENCODER_FILES = {
	glue: fileURLToPath(new URL('../../vendor/basis/basis_encoder.js', import.meta.url)),
	wasm: fileURLToPath(new URL('../../vendor/basis/basis_encoder.wasm', import.meta.url)),
};

/**
 * What a texture holds, which sets how it encodes: `color` for sRGB colors, such as base color
 * and emissive maps; `data` for linear values, such as roughness, metalness and occlusion; and
 * `normal` for normal maps.
 *
 * @typedef {'color' | 'data' | 'normal'} TextureKind
 */

/**
 * The texture format: `etc1s`, small with some loss, or `uastc`, about four times larger with
 * little loss.
 *
 * @typedef {'etc1s' | 'uastc'} Codec
 */

/**
 * A texture to encode.
 *
 * @typedef {object} TextureJob
 * @property {Uint8Array} bytes The source image file.
 * @property {string} mimeType `image/png` or `image/jpeg`.
 * @property {TextureKind} kind
 * @property {Codec} codec
 * @property {number} maxSide The largest side, a power of two up to 2048.
 */

/**
 * An encoded texture.
 *
 * @typedef {object} EncodedTexture
 * @property {Uint8Array} ktx2 The KTX2 file.
 * @property {number} width The texture's width, a power of two.
 * @property {number} height The texture's height, a power of two.
 * @property {number} sourceWidth The source image's width.
 * @property {number} sourceHeight The source image's height.
 * @property {boolean} alpha True when the texture keeps an alpha channel.
 * @property {number} ms The time the encode took, in milliseconds.
 */

/** ETC1S's quality, from 1 to 255: the default of the basisu command. */
const ETC1S_QUALITY = 128;

/** ETC1S's effort, from 0 to 6: the default of the basisu command. */
const ETC1S_EFFORT = 2;

/** @type {Promise<any> | undefined} */
let module;

/**
 * The encoder's module, loaded on the first call. Its messages go nowhere: it prints its progress
 * and its errors itself, and the tool reports failures by the encode's result.
 *
 * @returns {Promise<any>}
 */
export function loadEncoder() {
	module ??= (async () => {
		const require = createRequire(import.meta.url);
		const BASIS = require(ENCODER_FILES.glue);
		const basis = await BASIS({
			wasmBinary: readFileSync(ENCODER_FILES.wasm),
			print: () => {},
			printErr: () => {},
		});
		basis.initializeBasis();
		return basis;
	})();
	return module;
}

/**
 * Sets the encoder up for a texture: its format, color space, mip levels and supercompression.
 *
 * @param {any} basis The encoder's module.
 * @param {any} encoder A `BasisEncoder`.
 * @param {TextureKind} kind
 * @param {Codec} codec
 */
function configure(basis, encoder, kind, codec) {
	encoder.setCreateKTX2File(true);
	encoder.setDebug(false);
	if (codec === 'uastc') {
		encoder.setFormatMode(basis.basis_tex_format.cUASTC_LDR_4x4.value);
		encoder.setPackUASTCFlags(basis.cPackUASTCLevelDefault);
		encoder.setRDOUASTC(false);
		encoder.setKTX2UASTCSupercompression(true);
	} else {
		encoder.setFormatMode(basis.basis_tex_format.cETC1S.value);
		encoder.setQualityLevel(ETC1S_QUALITY);
		encoder.setETC1SCompressionLevel(ETC1S_EFFORT);
	}
	if (kind === 'normal') {
		encoder.setNormalMapPreset();
		encoder.setRenormalize(true);
		encoder.setMipRenormalize(true);
	} else {
		encoder.setSRGBOptions(kind === 'color');
	}
	encoder.setMipGen(true);
	encoder.setCheckForAlpha(true);
}

/**
 * The pixels of a texture: the source image at the texture's size.
 *
 * @param {TextureJob} job
 * @returns {{ pixels: Pixels, sourceWidth: number, sourceHeight: number }}
 */
export function texturePixels(job) {
	const source = decodeImage(job.bytes, job.mimeType);
	const [width, height] = textureSize(source.width, source.height, job.maxSide);
	return {
		pixels: resizeImage(source, width, height, job.kind === 'color'),
		sourceWidth: source.width,
		sourceHeight: source.height,
	};
}

/**
 * Encodes a texture as a KTX2 file with every mip level.
 *
 * @param {TextureJob} job
 * @returns {Promise<EncodedTexture>}
 */
export async function encodeTexture(job) {
	const basis = await loadEncoder();
	const start = performance.now();
	const { pixels, sourceWidth, sourceHeight } = texturePixels(job);
	const encoder = new basis.BasisEncoder();
	try {
		configure(basis, encoder, job.kind, job.codec);
		encoder.setSliceSourceImage(
			0,
			pixels.data,
			pixels.width,
			pixels.height,
			basis.ldr_image_type.cRGBA32.value,
		);
		// Mip levels add a third to the top level. A UASTC block takes 16 bytes for 16 texels, and
		// the room left over covers the file's header and key-value data.
		const out = new Uint8Array(Math.ceil(pixels.width * pixels.height * 2) + 65536);
		const length = encoder.encode(out);
		if (!length) throw new Error('the Basis Universal encoder could not encode the image');
		return {
			ktx2: out.slice(0, length),
			width: pixels.width,
			height: pixels.height,
			sourceWidth,
			sourceHeight,
			alpha: hasAlpha(pixels),
			ms: performance.now() - start,
		};
	} finally {
		encoder.delete();
	}
}
