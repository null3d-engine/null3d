// A KTX2 file's own bytes: what it holds, and the sizes the engine allows it to ask for. Both
// readers of such a file take their answer from here, so they always agree on what the engine
// loads: the loader (scene/ktx2.ts), which runs on the sketch thread and picks the format that the
// device samples best, and the transcoder's task (scene/ktx2-transcode.ts), which runs in a job
// worker and must not trust the bytes that another thread sent it.
//
// The module imports the shared limits and nothing else, so a worker's bundle and a loader that
// loads on first use can each hold their own copy, as `file-limits.ts` does.
//
// The environment map reader (scene/environment-file.ts) reads the other KTX2 dialect, the cube
// maps that the asset tool writes, and keeps its own reading of the file header and its own copy of
// the identifier on purpose. The two read different files with different limits, and one module
// that both imported would leave the KTX2 feature's own files to become a file that every page
// downloads at its start. They are two readers, not one reader written twice.
//
// The engine reads a KTX2 header and the level index that follows it, and nothing else: the texel
// data goes to the transcoder. Every count of those two structures is checked here before anything
// allocates, because the transcoder allocates from them: a hostile file of a few hundred bytes
// otherwise asks for gigabytes of its heap, which the worker then holds for its life.

import { FILE_LIMITS, type FileLimits } from './file-limits';
import type { CompressedTextureFormat, TextureColorSpace } from './textures';

/** The data that a KTX2 file holds: Basis Universal's codecs of color, and UASTC HDR. */
export type Ktx2Codec = 'etc1s' | 'uastc' | 'uastc-hdr';

/** What the engine reads from a KTX2 file's header. */
export interface Ktx2Header {
	width: number;
	height: number;
	/** Layers: 1, or more for an array texture. */
	layers: number;
	/** Mip levels in the file, from level 0. */
	levels: number;
	codec: Ktx2Codec;
	/** True when the data has an alpha channel. */
	alpha: boolean;
	/** The color space that the file's transfer function names. */
	colorSpace: TextureColorSpace;
}

/** A format that the transcoder writes: its name in the transcoder, and the texture's format. */
export interface Ktx2Target {
	transcoder:
		| 'cTFASTC_4x4_RGBA'
		| 'cTFBC6H'
		| 'cTFBC7_RGBA'
		| 'cTFETC1_RGB'
		| 'cTFETC2_RGBA'
		| 'cTFRGBA32'
		| 'cTFRGB_9E5';
	format: 'rgba8unorm' | 'rgb9e5ufloat' | CompressedTextureFormat;
}

/** Every format the engine asks the transcoder for, which `ktx2Target` chooses between. */
export const ASTC: Ktx2Target = { transcoder: 'cTFASTC_4x4_RGBA', format: 'astc-4x4-unorm' };
export const BC7: Ktx2Target = { transcoder: 'cTFBC7_RGBA', format: 'bc7-rgba-unorm' };
/** ETC1 blocks are ETC2 blocks, so ETC1S data without alpha becomes ETC2 at no loss. */
export const ETC2_RGB: Ktx2Target = { transcoder: 'cTFETC1_RGB', format: 'etc2-rgb8unorm' };
export const ETC2_RGBA: Ktx2Target = { transcoder: 'cTFETC2_RGBA', format: 'etc2-rgba8unorm' };
export const RGBA8: Ktx2Target = { transcoder: 'cTFRGBA32', format: 'rgba8unorm' };
export const BC6H: Ktx2Target = { transcoder: 'cTFBC6H', format: 'bc6h-rgb-ufloat' };
/** Shared-exponent floats: half the memory of `rgba16float`, and every path filters them. */
export const RGB9E5: Ktx2Target = { transcoder: 'cTFRGB_9E5', format: 'rgb9e5ufloat' };

/** Every format the transcoder writes, for the name it reads each one by. */
const TARGETS: readonly Ktx2Target[] = [ASTC, BC6H, BC7, ETC2_RGB, ETC2_RGBA, RGBA8, RGB9E5];

/**
 * The target that the transcoder knows as `name`, or undefined for a name the engine does not ask
 * it for. The transcoder's task is sent that name alone, and reads the sizes it writes from here.
 */
export function targetOfTranscoder(name: string): Ktx2Target | undefined {
	return TARGETS.find((target) => target.transcoder === name);
}

/** Texels on each side of a block of every compressed format. */
export const BLOCK = 4;

/** Bytes of one block of each compressed format. */
const BLOCK_BYTES: Record<CompressedTextureFormat, number> = {
	'astc-4x4-unorm': 16,
	'bc6h-rgb-ufloat': 16,
	'bc7-rgba-unorm': 16,
	'etc2-rgb8unorm': 8,
	'etc2-rgba8unorm': 16,
};

/** The identifier that starts every KTX2 file. */
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** The header and index before the level index, in bytes. */
const HEADER_BYTES = 80;

/** One level's entry in the level index: three 64-bit numbers. */
const LEVEL_BYTES = 24;

/**
 * The most bytes that one 4 x 4 block of a file's own data takes. Every codec the engine loads
 * stores its texels in whole blocks, and the largest of those blocks is UASTC's sixteen bytes, so
 * no legitimate file declares one level of a texture to decompress past this.
 */
const RAW_BLOCK_BYTES = 16;

// Numbers of the KTX2 specification and the Khronos data format descriptor.
const SUPERCOMPRESSION_NONE = 0;
const SUPERCOMPRESSION_BASIS_LZ = 1;
const SUPERCOMPRESSION_ZSTANDARD = 2;
const MODEL_ETC1S = 163;
const MODEL_UASTC = 166;
const MODEL_UASTC_HDR = 167;
const VK_FORMAT_ASTC_4X4_SFLOAT = 1000066000;
const TRANSFER_SRGB = 2;
const ETC1S_CHANNEL_AAA = 15;
const UASTC_CHANNEL_RGBA = 3;
const UASTC_CHANNEL_RRRG = 5;
/** The basic descriptor block's header, before its samples, and each sample's bytes. */
const DESCRIPTOR_BYTES = 24;
const SAMPLE_BYTES = 16;

/** A KTX2 file that the engine cannot load, with the reason in words. */
export class Ktx2Refusal extends Error {}

function refuse(reason: string): never {
	throw new Ktx2Refusal(reason);
}

/** Bytes in whole MiB, as the limits and the readers of files write them in a refusal. */
function mib(bytes: number): string {
	return `${Math.ceil(bytes / 2 ** 20)} MiB`;
}

/**
 * Reads a KTX2 file's header and level index, and throws a `Ktx2Refusal` for a file that the engine
 * does not load: one without ETC1S, UASTC or UASTC HDR data, a cube map or a 3D texture, or one
 * whose level index asks for more than its texels hold.
 */
export function readKtx2Header(file: Uint8Array, limits: FileLimits = FILE_LIMITS): Ktx2Header {
	if (file.length < HEADER_BYTES || IDENTIFIER.some((byte, k) => file[k] !== byte))
		refuse('the file does not start with a KTX2 header');
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const word = (at: number) => view.getUint32(at, true);
	const [vkFormat, width, height, depth] = [word(12), word(20), word(24), word(28)];
	const [layers, faces, levels, supercompression] = [word(32), word(36), word(40), word(44)];
	const [dfd, dfdBytes] = [word(48), word(52)];
	if (dfd + dfdBytes > file.length || dfdBytes < 4 + DESCRIPTOR_BYTES + SAMPLE_BYTES)
		refuse('its data format descriptor is cut short');
	const model = file[dfd + 12];
	// UASTC HDR blocks are ASTC HDR blocks, so Basis Universal names that format for them.
	if (vkFormat !== 0 && !(model === MODEL_UASTC_HDR && vkFormat === VK_FORMAT_ASTC_4X4_SFLOAT))
		refuse(
			`it holds texels in Vulkan format ${vkFormat}, and the engine loads KTX2 files of Basis Universal data, in ETC1S, UASTC or UASTC HDR`,
		);
	if (depth > 0) refuse('it holds a 3D texture');
	if (faces !== 1) refuse('it holds a cube map');
	if (width === 0 || height === 0) refuse('it has no texels');
	const blockBytes = word(dfd + 8) >>> 16;
	const samples = Math.floor((blockBytes - DESCRIPTOR_BYTES) / SAMPLE_BYTES);
	const channel = (sample: number) =>
		(file[dfd + 4 + DESCRIPTOR_BYTES + sample * 16 + 3] ?? 0) & 15;
	let codec: Ktx2Codec;
	let alpha: boolean;
	if (model === MODEL_ETC1S) {
		if (supercompression !== SUPERCOMPRESSION_BASIS_LZ) refuse('its ETC1S data is not in BasisLZ');
		codec = 'etc1s';
		alpha = samples > 1 && channel(1) === ETC1S_CHANNEL_AAA;
	} else if (model === MODEL_UASTC || model === MODEL_UASTC_HDR) {
		const hdr = model === MODEL_UASTC_HDR;
		if (
			supercompression !== SUPERCOMPRESSION_NONE &&
			supercompression !== SUPERCOMPRESSION_ZSTANDARD
		)
			refuse(`its UASTC${hdr ? ' HDR' : ''} data has supercompression scheme ${supercompression}`);
		codec = hdr ? 'uastc-hdr' : 'uastc';
		// The formats that HDR data becomes hold no alpha.
		alpha = !hdr && (channel(0) === UASTC_CHANNEL_RGBA || channel(0) === UASTC_CHANNEL_RRRG);
	} else
		refuse(
			`it holds data of color model ${model}, and the engine loads ETC1S, UASTC and UASTC HDR data`,
		);
	if (levels < 1) refuse('it holds no mip levels');
	if (levels * LEVEL_BYTES + HEADER_BYTES > file.length) refuse('its level index is cut short');
	// A level's entry gives where its data starts, how many bytes it takes, and how many bytes it
	// holds once decompressed. The transcoder allocates that last number before it decompresses
	// anything, so it is the count that turns a small file into a large allocation.
	for (let level = 0; level < levels; level++) {
		const at = HEADER_BYTES + level * LEVEL_BYTES;
		const [offset, length, uncompressed] = [word(at), word(at + 8), word(at + 16)];
		if (word(at + 4) !== 0 || word(at + 12) !== 0 || word(at + 20) !== 0)
			refuse(
				`its level ${level} holds more than 4 GiB of data or texels, more than any texture the engine loads`,
			);
		if (offset < HEADER_BYTES || length === 0 || offset + length > file.length)
			refuse(`its level ${level}'s data lies outside the file`);
		const texels = Math.min(
			rawTexelBytes(width, height, level, Math.max(1, layers)),
			limits.itemBytes,
		);
		if (uncompressed > texels)
			refuse(
				`its level ${level} says it decompresses to ${mib(uncompressed)}, more than the ${mib(texels)} that its texels hold`,
			);
		if (codec === 'etc1s' && uncompressed !== 0)
			refuse(`its level ${level} gives an uncompressed length, and BasisLZ data holds none`);
		if (supercompression === SUPERCOMPRESSION_ZSTANDARD && uncompressed === 0)
			refuse(`its level ${level} holds no uncompressed length, which Zstandard data must give`);
	}
	return {
		width,
		height,
		layers: Math.max(1, layers),
		levels: Math.max(1, levels),
		codec,
		alpha,
		// HDR values are linear, whatever transfer function the file names.
		colorSpace: codec !== 'uastc-hdr' && file[dfd + 14] === TRANSFER_SRGB ? 'srgb' : 'linear',
	};
}

/**
 * The bytes that one level of `layers` layers holds as the file's own data, which is the most that
 * a legitimate file declares that level decompresses to.
 */
function rawTexelBytes(width: number, height: number, level: number, layers: number): number {
	const w = Math.max(1, width >> level);
	const h = Math.max(1, height >> level);
	return Math.ceil(w / BLOCK) * Math.ceil(h / BLOCK) * RAW_BLOCK_BYTES * layers;
}

/**
 * Why the engine refuses a file with `header` before it transcodes it, or undefined. Its sides may
 * reach the device's `maxSize`, its layers the shared limit, and its mip levels a chain down to
 * one texel. Its texels in the `format` it becomes may reach the limit of one texture.
 */
export function ktx2TooLarge(
	header: Pick<Ktx2Header, 'width' | 'height' | 'layers' | 'levels'>,
	format: Ktx2Target['format'],
	maxSize: number,
	limits = FILE_LIMITS,
): string | undefined {
	const { width, height, layers, levels } = header;
	if (width > maxSize || height > maxSize)
		return `it is ${width} x ${height} texels, larger than the ${maxSize} a side that this device's textures hold`;
	if (layers > limits.textureLayers)
		return `it holds ${layers} layers, more than the ${limits.textureLayers} that a texture may hold`;
	const chain = Math.floor(Math.log2(Math.max(width, height))) + 1;
	if (levels > chain)
		return `it holds ${levels} mip levels, more than the ${chain} that a texture of its size has`;
	const bytes = transcodedBytes(format, width, height, levels, layers);
	if (bytes > limits.itemBytes)
		return `its texels take ${mib(bytes)} as ${format}, more than the ${mib(limits.itemBytes)} that one texture may hold`;
	return undefined;
}

/** The bytes that the transcoder writes for `levels` mip levels of `layers` layers in `format`. */
export function transcodedBytes(
	format: Ktx2Target['format'],
	width: number,
	height: number,
	levels: number,
	layers: number,
): number {
	let bytes = 0;
	for (let level = 0; level < levels; level++) {
		const w = Math.max(1, width >> level);
		const h = Math.max(1, height >> level);
		bytes +=
			format === 'rgba8unorm' || format === 'rgb9e5ufloat'
				? w * h * 4
				: Math.ceil(w / BLOCK) * Math.ceil(h / BLOCK) * BLOCK_BYTES[format];
	}
	return bytes * layers;
}
