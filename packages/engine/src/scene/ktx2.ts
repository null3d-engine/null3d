// KTX2 textures: the loader that assets.loadTexture imports the first time a file starts with the
// KTX2 identifier, so a page without KTX2 files downloads none of this, nor the transcoder.
//
// The sketch thread reads the file's header and level index (ktx2-file.ts, which the transcoder's
// task reads the file with too), and picks the format that the device samples best: ASTC, BC7 or
// ETC2 where the device has them, and RGBA8 elsewhere. High dynamic range data (UASTC HDR) becomes
// BC6H where the device has BC formats, and shared-exponent floats elsewhere.
// The Basis Universal transcoder then turns the file's data into that format in a job worker, as a
// task of the on-demand loader (shared/tasks.ts, scene/ktx2-transcode.ts), outside the sketch's
// frames, and hands back every mip level. The texels go into engine memory, and upload a band of
// rows of blocks per frame as data does. The cache of transcoded textures (ktx2-cache.ts) keeps
// them too, so a later load of the same file skips the transcoder.
//
// The loader imports no engine module but constants, types, the reader of the file, the on-demand
// loader and the cache of transcoded textures, which no thread's first file shares with it. The
// bundler would move a module that this file shares with its thread's first file into a file of its
// own, which every page would then download at its start. So the caller hands it the engine's
// error class.
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
import { TranscodeCache } from './ktx2-cache';
import {
	ASTC,
	BC6H,
	BC7,
	BLOCK,
	ETC2_RGB,
	ETC2_RGBA,
	type Ktx2Header,
	type Ktx2Target,
	ktx2TooLarge,
	RGB9E5,
	RGBA8,
	readKtx2Header,
	transcodedBytes,
} from './ktx2-file';
import type { FileTexels, Texture, Textures } from './textures';

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

/**
 * The format that a file's data becomes on a device with `capabilities`: UASTC keeps the most
 * detail in ASTC, then BC7, then ETC2. ETC1S data is ETC1, so it becomes ETC2 first, at half the
 * memory without alpha, then BC7 and ASTC. A device without these, or a texture whose size is not
 * a whole number of blocks, gets RGBA8. UASTC HDR data becomes BC6H on a device with BC, and
 * shared-exponent floats elsewhere, which every path filters: WebGPU and WebGL2 have no ASTC HDR.
 *
 * On WebGL2, a device with BC takes BC7 first for both codecs. Desktop GPUs have BC, and some
 * desktop drivers (Mesa on Linux) offer ETC2 and ASTC on GPUs that lack them, then decode such
 * textures in software on the page's thread. The choice reads the device's formats alone, never
 * its GPU's name, which some browsers hide. WebGPU offers each family only where the GPU has it.
 */
export function ktx2Target(
	capabilities: number,
	{ codec, alpha, width, height }: Pick<Ktx2Header, 'codec' | 'alpha' | 'width' | 'height'>,
	webgl2 = false,
): Ktx2Target {
	const blocks = width % BLOCK === 0 && height % BLOCK === 0;
	if (codec === 'uastc-hdr') return blocks && capabilities & CAPABILITY_TEXTURE_BC ? BC6H : RGB9E5;
	if (!blocks) return RGBA8;
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
	maxSize: number,
	address: URL,
	call: string,
	error: Ktx2Error,
): Promise<ArrayBuffer> {
	try {
		return await runTask<ArrayBuffer>(
			TRANSCODER,
			{ file, format: target.transcoder, levels, layers, maxSize },
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
 * the file's mip levels unless `mipmaps` is false. Where `textures.textureCache` is on, the texels
 * come from the cache of transcoded textures when it holds them, and go into it when it does not.
 * Throws E1412 for a file that the engine does not load, and E1406, E1418, E1422 or E1423 when the
 * transcoder does not load, each made by `error`.
 */
export async function loadKtx2(
	textures: Textures,
	file: ArrayBuffer,
	address: URL,
	options: LoadTextureOptions,
	call: string,
	error: Ktx2Error,
): Promise<Texture> {
	const texels = await transcodeKtx2(textures, file, address, options, call, error);
	return textures.fromTexels(texels, options, call);
}

/**
 * The texels of a KTX2 file without its largest `level` mip levels, for a texture's load again of
 * the file: each remaining level's layers in turn, as `transcodeKtx2` gives them.
 */
export async function reloadKtx2(
	textures: Textures,
	file: ArrayBuffer,
	address: URL,
	options: LoadTextureOptions,
	level: number,
	call: string,
	error: Ktx2Error,
): Promise<Uint8Array> {
	const { format, width, height, depth, levels, texels } = await transcodeKtx2(
		textures,
		file,
		address,
		options,
		call,
		error,
	);
	const start = transcodedBytes(format, width, height, level, depth);
	return texels.subarray(start, transcodedBytes(format, width, height, levels, depth));
}

/**
 * Transcodes a KTX2 file, which moves to the transcoder's worker, into the format of `ktx2Target`,
 * with the file's mip levels unless `mipmaps` is false. Throws as `loadKtx2` does.
 */
async function transcodeKtx2(
	textures: Textures,
	file: ArrayBuffer,
	address: URL,
	options: LoadTextureOptions,
	call: string,
	error: Ktx2Error,
): Promise<FileTexels & { format: Ktx2Target['format'] }> {
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
	const compressed =
		header.codec === 'uastc-hdr'
			? CAPABILITY_TEXTURE_BC
			: CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ETC2;
	if (DEV && (target === RGBA8 || target === RGB9E5) && textures.capabilities & compressed)
		console.warn(
			`${call}() loads ${address} as uncompressed ${target.format}, which takes ${Math.ceil(transcodedBytes(target.format, width, height, levels, layers) / 1024)} KB: its size, ${width} x ${height}, is not a whole number of 4 x 4 blocks. Save it at a size whose sides are multiples of 4, as the asset tool does.`,
		);
	const expected = transcodedBytes(target.format, width, height, levels, layers);
	const cached = textures.textureCache
		? await cacheOfThisThread().lookup(file, target.transcoder, levels, expected)
		: undefined;
	let texels = cached?.texels;
	if (!texels) {
		texels = await transcode(file, target, levels, layers, textures.maxSize, address, call, error);
		if (texels.byteLength !== expected)
			throw error(
				'E1412',
				`${call}() could not decode ${address} as a KTX2 texture: the transcoder wrote ${texels.byteLength} bytes, not ${expected}.`,
			);
		cached?.store?.(texels);
	}
	return {
		width,
		height,
		depth: layers,
		levels,
		format: target.format,
		colorSpace: header.colorSpace,
		texels: new Uint8Array(texels),
	};
}

/** This thread's cache of transcoded textures, which opens with the first KTX2 file. */
let transcodeCache: TranscodeCache | undefined;

function cacheOfThisThread(): TranscodeCache {
	transcodeCache ??= new TranscodeCache();
	return transcodeCache;
}
