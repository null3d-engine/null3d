// KTX2 textures: the loader that assets.loadTexture imports the first time a file starts with the
// KTX2 identifier, so a page without KTX2 files downloads none of this, nor the transcoder.
//
// The sketch thread reads the file's header and picks the format that the device samples best:
// ASTC, BC7 or ETC2 where the device has them, and RGBA8 elsewhere. The Basis Universal
// transcoder then turns the file's ETC1S or UASTC data into that format in a job worker, as a
// task of the on-demand loader (shared/tasks.ts, scene/ktx2-transcode.ts), outside the sketch's
// frames, and hands back every mip level. The texels go into engine memory, and upload a band of
// rows of blocks per frame as data does.
//
// The loader imports no engine module but constants, types, and the on-demand loader, which no
// thread's first file shares with it. The bundler would move a module that this file shares with
// its thread's first file into a file of its own, which every page would then download at its
// start. So the caller hands it the engine's error class.
//
// The transcoder is built from Basis Universal v2.50 (github.com/BinomialLLC/basis_universal, tag
// v2_50) by tools/build-basis-transcoder.ts, under the Apache License 2.0, in
// packages/engine/vendor/basis with its licence and notice.

import type { EngineError } from '../errors/engine-error';
import {
	CAPABILITY_TEXTURE_ASTC,
	CAPABILITY_TEXTURE_BC,
	CAPABILITY_TEXTURE_ETC2,
} from '../generated/core';
import { runTask, type Task, TaskFailure } from '../shared/tasks';
import type { WasmError } from '../shared/wasm';
import type { LoadTextureOptions } from './assets';
import { FILE_LIMITS } from './file-limits';
import type {
	CompressedTextureFormat,
	Texture,
	TextureColorSpace,
	TextureFormat,
	Textures,
} from './textures';

/**
 * The transcoder's task. Its WebAssembly module goes to the workers under the name that the task
 * (scene/ktx2-transcode.ts) reads it by.
 */
const TRANSCODER: Task = {
	name: 'ktx2',
	wasm: [
		{
			name: 'basis',
			url: new URL('../../vendor/basis/basis_transcoder.wasm', import.meta.url),
			what: 'the KTX2 transcoder',
		},
	],
};

/** The data that a KTX2 file holds: Basis Universal's two codecs. */
export type Ktx2Codec = 'etc1s' | 'uastc';

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
	transcoder: 'cTFASTC_4x4_RGBA' | 'cTFBC7_RGBA' | 'cTFETC1_RGB' | 'cTFETC2_RGBA' | 'cTFRGBA32';
	format: TextureFormat | CompressedTextureFormat;
}

const ASTC: Ktx2Target = { transcoder: 'cTFASTC_4x4_RGBA', format: 'astc-4x4-unorm' };
const BC7: Ktx2Target = { transcoder: 'cTFBC7_RGBA', format: 'bc7-rgba-unorm' };
/** ETC1 blocks are ETC2 blocks, so ETC1S data without alpha becomes ETC2 at no loss. */
const ETC2_RGB: Ktx2Target = { transcoder: 'cTFETC1_RGB', format: 'etc2-rgb8unorm' };
const ETC2_RGBA: Ktx2Target = { transcoder: 'cTFETC2_RGBA', format: 'etc2-rgba8unorm' };
const RGBA8: Ktx2Target = { transcoder: 'cTFRGBA32', format: 'rgba8unorm' };

/** Texels on each side of a block of every compressed format. */
const BLOCK = 4;

/** Bytes of one block of each compressed format. */
const BLOCK_BYTES: Record<CompressedTextureFormat, number> = {
	'astc-4x4-unorm': 16,
	'bc7-rgba-unorm': 16,
	'etc2-rgb8unorm': 8,
	'etc2-rgba8unorm': 16,
};

/** The identifier that starts every KTX2 file. */
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** The header and index before the level index, in bytes. */
const HEADER_BYTES = 80;

// Numbers of the KTX2 specification and the Khronos data format descriptor.
const SUPERCOMPRESSION_NONE = 0;
const SUPERCOMPRESSION_BASIS_LZ = 1;
const SUPERCOMPRESSION_ZSTANDARD = 2;
const MODEL_ETC1S = 163;
const MODEL_UASTC = 166;
const MODEL_UASTC_HDR = 167;
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

/**
 * Reads a KTX2 file's header, and throws a `Ktx2Refusal` for a file that the engine does not
 * load: one without ETC1S or UASTC data, a cube map or a 3D texture.
 */
export function readKtx2Header(file: Uint8Array): Ktx2Header {
	if (file.length < HEADER_BYTES || IDENTIFIER.some((byte, k) => file[k] !== byte))
		refuse('the file does not start with a KTX2 header');
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const word = (at: number) => view.getUint32(at, true);
	const [vkFormat, width, height, depth] = [word(12), word(20), word(24), word(28)];
	const [layers, faces, levels, supercompression] = [word(32), word(36), word(40), word(44)];
	const [dfd, dfdBytes] = [word(48), word(52)];
	if (vkFormat !== 0)
		refuse(
			`it holds texels in Vulkan format ${vkFormat}, and the engine loads KTX2 files of Basis Universal data, in ETC1S or UASTC`,
		);
	if (depth > 0) refuse('it holds a 3D texture');
	if (faces !== 1) refuse('it holds a cube map');
	if (width === 0 || height === 0) refuse('it has no texels');
	if (dfd + dfdBytes > file.length || dfdBytes < 4 + DESCRIPTOR_BYTES + SAMPLE_BYTES)
		refuse('its data format descriptor is cut short');
	const model = file[dfd + 12];
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
	} else if (model === MODEL_UASTC) {
		if (
			supercompression !== SUPERCOMPRESSION_NONE &&
			supercompression !== SUPERCOMPRESSION_ZSTANDARD
		)
			refuse(`its UASTC data has supercompression scheme ${supercompression}`);
		codec = 'uastc';
		alpha = channel(0) === UASTC_CHANNEL_RGBA || channel(0) === UASTC_CHANNEL_RRRG;
	} else
		refuse(
			model === MODEL_UASTC_HDR
				? 'it holds UASTC HDR data, and the engine loads ETC1S and UASTC LDR data'
				: `it holds data of color model ${model}, and the engine loads ETC1S and UASTC data`,
		);
	return {
		width,
		height,
		layers: Math.max(1, layers),
		levels: Math.max(1, levels),
		codec,
		alpha,
		colorSpace: file[dfd + 14] === TRANSFER_SRGB ? 'srgb' : 'linear',
	};
}

/**
 * The format that a file's data becomes on a device with `capabilities`: UASTC keeps the most
 * detail in ASTC, then BC7, then ETC2. ETC1S data is ETC1, so it becomes ETC2 first, at half the
 * memory without alpha, then BC7 and ASTC. A device without these, or a texture whose size is not
 * a whole number of blocks, gets RGBA8.
 *
 * On WebGL2, a device with BC takes BC7 first for both codecs. Desktop GPUs have BC, and some
 * desktop drivers (Mesa on Linux) offer ETC2 and ASTC on GPUs that lack them, then decode such
 * textures in software on the page's thread. WebGPU offers each family only where the GPU has it.
 */
export function ktx2Target(
	capabilities: number,
	{ codec, alpha, width, height }: Pick<Ktx2Header, 'codec' | 'alpha' | 'width' | 'height'>,
	webgl2 = false,
): Ktx2Target {
	if (width % BLOCK !== 0 || height % BLOCK !== 0) return RGBA8;
	if (webgl2 && capabilities & CAPABILITY_TEXTURE_BC) return BC7;
	const etc2 = alpha ? ETC2_RGBA : ETC2_RGB;
	const order: readonly [number, Ktx2Target][] =
		codec === 'uastc'
			? [
					[CAPABILITY_TEXTURE_ASTC, ASTC],
					[CAPABILITY_TEXTURE_BC, BC7],
					[CAPABILITY_TEXTURE_ETC2, etc2],
				]
			: [
					[CAPABILITY_TEXTURE_ETC2, etc2],
					[CAPABILITY_TEXTURE_BC, BC7],
					[CAPABILITY_TEXTURE_ASTC, ASTC],
				];
	for (const [flag, target] of order) if (capabilities & flag) return target;
	return RGBA8;
}

/**
 * Why the engine refuses a file with `header` before it transcodes it, or undefined. Its sides may
 * reach the device's `maxSize`, its layers the shared limit, and its mip levels a chain down to
 * one texel. Its texels in the `format` it becomes may reach the limit of one texture.
 */
export function ktx2TooLarge(
	header: Pick<Ktx2Header, 'width' | 'height' | 'layers' | 'levels'>,
	format: TextureFormat | CompressedTextureFormat,
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
		return `its texels take ${Math.ceil(bytes / 2 ** 20)} MiB as ${format}, more than the ${limits.itemBytes / 2 ** 20} MiB that one texture may hold`;
	return undefined;
}

/** The bytes that the transcoder writes for `levels` mip levels of `layers` layers in `format`. */
export function transcodedBytes(
	format: TextureFormat | CompressedTextureFormat,
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
			format === 'rgba8unorm' || format === 'rgba16float'
				? w * h * 4
				: Math.ceil(w / BLOCK) * Math.ceil(h / BLOCK) * BLOCK_BYTES[format];
	}
	return bytes * layers;
}

declare const __NULL3D_DEV__: boolean | undefined;

/**
 * True in development builds, which warn when a file loads uncompressed. The loader reads the
 * constant itself, as the glTF loader does, to import no engine module.
 */
const DEV: boolean = typeof __NULL3D_DEV__ === 'undefined' ? true : __NULL3D_DEV__;

/** Makes one of the engine's coded errors: the caller's `EngineError`. */
export type Ktx2Error = (
	code: Parameters<WasmError>[0] | 'E1412' | 'E1420',
	message: string,
) => EngineError;

/**
 * Transcodes a file, which moves to a job worker, into texels of every level and layer. A file that
 * the transcoder cannot read fails with E1412, and a transcoder that does not load with E1406, or
 * with the policy's or the server's code when its file does not download or compile. A file that
 * waits when the engine stops fails with E1420.
 */
async function transcode(
	file: ArrayBuffer,
	target: Ktx2Target,
	levels: number,
	layers: number,
	address: URL,
	call: string,
	error: Ktx2Error,
): Promise<ArrayBuffer> {
	try {
		return await runTask<ArrayBuffer>(
			TRANSCODER,
			{ file, format: target.transcoder, levels, layers },
			[file],
			error,
		);
	} catch (thrown) {
		if (!(thrown instanceof TaskFailure)) throw thrown;
		if (thrown.stage === 'stopped')
			throw error('E1420', 'a KTX2 texture was still loading when the engine stopped.');
		throw thrown.stage === 'run'
			? error(
					'E1412',
					`${call}() could not decode ${address} as a KTX2 texture: ${thrown.message}.`,
				)
			: error(
					'E1406',
					`the KTX2 transcoder did not load for ${call}(): ${thrown.message.replace(/\.$/, '')}.`,
				);
	}
}

/**
 * Makes a texture from a KTX2 file, which moves to a job worker for the transcoder. The texture
 * takes the format of `ktx2Target`, the color space of the file unless the options give one, and
 * the file's mip levels unless `mipmaps` is false. Throws E1412 for a file that the engine does not
 * load, and E1406, E1418, E1422 or E1423 when the transcoder does not load, each made by `error`.
 */
export async function loadKtx2(
	textures: Textures,
	file: ArrayBuffer,
	address: URL,
	options: LoadTextureOptions,
	call: string,
	error: Ktx2Error,
): Promise<Texture> {
	let header: Ktx2Header;
	try {
		header = readKtx2Header(new Uint8Array(file));
	} catch (thrown) {
		throw error(
			'E1412',
			`${call}() could not load ${address} as a KTX2 texture: ${thrown instanceof Error ? thrown.message : thrown}.`,
		);
	}
	const { width, height, layers } = header;
	const levels = options.mipmaps === false ? 1 : header.levels;
	const target = ktx2Target(textures.capabilities, header, textures.webgl2);
	const tooLarge = ktx2TooLarge({ ...header, levels }, target.format, textures.maxSize);
	if (tooLarge)
		throw error('E1412', `${call}() could not load ${address} as a KTX2 texture: ${tooLarge}.`);
	const compressed = CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ETC2;
	if (DEV && target === RGBA8 && textures.capabilities & compressed)
		console.warn(
			`${call}() loads ${address} as uncompressed RGBA8, which takes ${Math.ceil(transcodedBytes(RGBA8.format, width, height, levels, layers) / 1024)} KB: its size, ${width} x ${height}, is not a whole number of 4 x 4 blocks. Save it at a size whose sides are multiples of 4, as the asset tool does.`,
		);
	const texels = await transcode(file, target, levels, layers, address, call, error);
	const expected = transcodedBytes(target.format, width, height, levels, layers);
	if (texels.byteLength !== expected)
		throw error(
			'E1412',
			`${call}() could not decode ${address} as a KTX2 texture: the transcoder wrote ${texels.byteLength} bytes, not ${expected}.`,
		);
	return textures.fromTexels(
		{
			width,
			height,
			depth: layers,
			levels,
			format: target.format,
			colorSpace: header.colorSpace,
			texels: new Uint8Array(texels),
		},
		options,
		call,
	);
}
