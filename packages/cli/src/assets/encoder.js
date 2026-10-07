// The KTX2 encoder: the official Basis Universal 2.50 encoder for JavaScript, from the same
// release as the transcoder that the engine ships, kept unchanged in vendor/basis with its
// licence and notice. It is the single-threaded 32-bit WebAssembly build, so every machine encodes
// a texture to the same bytes. The tool runs one copy on each worker thread, one texture at a time.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { decodeImage, hasAlpha, resizeImage, textureSize } from './images.js';
import { bakeLevels } from './roughness.js';

/** @import { Pixels } from './images.js' */
/** @import { RoughnessBake } from './roughness.js' */

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
 * The texture format: `etc1s`, small with some loss, or `uastc`, several times larger with
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
 * @property {RoughnessBake} [bake] For a metal-rough map, the normal map whose detail its
 *   roughness levels take. A baked map takes UASTC.
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
 * The strength of UASTC's rate-distortion step on baked metal-rough maps: the encoder's default,
 * which halves such a map after Zstandard and moves roughness by about one step of 255.
 */
const BAKED_RDO_QUALITY = 1;

/**
 * Sets the encoder up for a texture: its format, color space, mip levels and supercompression.
 * A level of a baked map encodes alone, with no mip levels of its own, and with UASTC's
 * rate-distortion step, which shapes its blocks for Zstandard.
 *
 * @param {any} basis The encoder's module.
 * @param {any} encoder A `BasisEncoder`.
 * @param {TextureKind} kind
 * @param {Codec} codec
 * @param {boolean} baked
 */
function configure(basis, encoder, kind, codec, baked) {
	encoder.setCreateKTX2File(true);
	encoder.setDebug(false);
	if (codec === 'uastc') {
		encoder.setFormatMode(basis.basis_tex_format.cUASTC_LDR_4x4.value);
		encoder.setPackUASTCFlags(basis.cPackUASTCLevelDefault);
		encoder.setRDOUASTC(baked);
		if (baked) encoder.setRDOUASTCQualityScalar(BAKED_RDO_QUALITY);
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
	encoder.setMipGen(!baked);
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
 * One image as a KTX2 file: with every mip level that the encoder makes from it, or, for a level
 * of a baked map, with the image alone as its only level.
 *
 * @param {any} basis The encoder's module.
 * @param {Pixels} pixels
 * @param {TextureKind} kind
 * @param {Codec} codec
 * @param {boolean} baked
 */
function encodeImage(basis, pixels, kind, codec, baked) {
	const encoder = new basis.BasisEncoder();
	try {
		configure(basis, encoder, kind, codec, baked);
		encoder.setSliceSourceImage(
			0,
			pixels.data,
			pixels.width,
			pixels.height,
			basis.ldr_image_type.cRGBA32.value,
		);
		// Mip levels add a third to the top level. A UASTC block takes 16 bytes for 16 texels, and
		// the room left over covers the file's header, key-value data and a level under one block.
		const out = new Uint8Array(Math.ceil(pixels.width * pixels.height * 2) + 65536);
		const length = encoder.encode(out);
		if (!length) throw new Error('the Basis Universal encoder could not encode the image');
		return out.slice(0, length);
	} finally {
		encoder.delete();
	}
}

/**
 * Encodes a texture as a KTX2 file with every mip level. A baked metal-rough map encodes each of
 * its own levels alone, then joins them, since the encoder makes levels only from the top one.
 *
 * @param {TextureJob} job
 * @returns {Promise<EncodedTexture>}
 */
export async function encodeTexture(job) {
	const basis = await loadEncoder();
	const start = performance.now();
	const { pixels, sourceWidth, sourceHeight } = texturePixels(job);
	const bake = job.bake;
	let ktx2;
	if (bake) {
		const normal = decodeImage(bake.bytes, bake.mimeType);
		const [width, height] = textureSize(normal.width, normal.height, job.maxSide);
		const normals = resizeImage(normal, width, height, false);
		const levels = bakeLevels(pixels, normals, bake.scale, bake.factor);
		ktx2 = joinLevels(levels.map((level) => encodeImage(basis, level, job.kind, job.codec, true)));
	} else ktx2 = encodeImage(basis, pixels, job.kind, job.codec, false);
	return {
		ktx2,
		width: pixels.width,
		height: pixels.height,
		sourceWidth,
		sourceHeight,
		alpha: hasAlpha(pixels),
		ms: performance.now() - start,
	};
}

/** The bytes of a KTX2 file before its level index: its identifier, header and data index. */
const KTX2_INDEX_END = 80;

/** The bytes of each entry of a KTX2 file's level index. */
const KTX2_LEVEL_ENTRY = 24;

/**
 * One KTX2 file from files of one level each, the full size first, all with the same format
 * and supercompression that keeps each level apart, as UASTC with Zstandard does. The file takes
 * the first file's header, format descriptor and key-value data, and stores the levels from the
 * smallest up, packed with no padding, as the encoder lays out its own levels.
 *
 * @param {Uint8Array[]} files
 * @returns {Uint8Array}
 */
export function joinLevels(files) {
	const parts = files.map((file) => {
		const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
		const u32 = (/** @type {number} */ at) => view.getUint32(at, true);
		const u64 = (/** @type {number} */ at) => Number(view.getBigUint64(at, true));
		if (u32(40) !== 1) throw new Error('each KTX2 file to join must hold one level');
		if (u64(64) !== 0) throw new Error('KTX2 levels that share supercompression data cannot join');
		const offset = u64(KTX2_INDEX_END);
		const length = u64(KTX2_INDEX_END + 8);
		return {
			view,
			data: file.subarray(offset, offset + length),
			uncompressed: u64(KTX2_INDEX_END + 16),
		};
	});
	const first = /** @type {(typeof parts)[number]} */ (parts[0]);
	const head = first.view;
	const source = new Uint8Array(head.buffer, head.byteOffset, head.byteLength);
	const dfd = head.getUint32(48, true);
	const kvd = head.getUint32(56, true);
	const kvdLength = head.getUint32(60, true);
	const descriptors = source.subarray(dfd, kvd + kvdLength);
	const dfdAt = KTX2_INDEX_END + parts.length * KTX2_LEVEL_ENTRY;
	let end = dfdAt + descriptors.byteLength;
	const offsets = parts.map(() => 0);
	for (let level = parts.length - 1; level >= 0; level--) {
		offsets[level] = end;
		end += /** @type {(typeof parts)[number]} */ (parts[level]).data.byteLength;
	}
	const out = new Uint8Array(end);
	const view = new DataView(out.buffer);
	out.set(source.subarray(0, 48));
	view.setUint32(40, parts.length, true);
	view.setUint32(48, dfdAt, true);
	view.setUint32(52, head.getUint32(52, true), true);
	view.setUint32(56, dfdAt + (kvd - dfd), true);
	view.setUint32(60, kvdLength, true);
	out.set(descriptors, dfdAt);
	parts.forEach((part, level) => {
		const entry = KTX2_INDEX_END + level * KTX2_LEVEL_ENTRY;
		const at = /** @type {number} */ (offsets[level]);
		view.setBigUint64(entry, BigInt(at), true);
		view.setBigUint64(entry + 8, BigInt(part.data.byteLength), true);
		view.setBigUint64(entry + 16, BigInt(part.uncompressed), true);
		out.set(part.data, at);
	});
	return out;
}
