// The cache of transcoded KTX2 textures, a namespace of the cache of derived data
// (derived-cache.ts). The KTX2 loader keeps each file's texels, in the format that the device
// takes, so a later load of the same file, on this visit or a later one, reads them back instead of
// transcoding, and a page whose files all come from the cache never downloads the transcoder.
//
// An entry's key is the SHA-256 of the file's bytes with the format and the mip levels that the
// transcoder writes. The file's address and its response's validator would not do: the textures
// inside one glTF file share its address and validator, and a server that sends no validator would
// leave its files out. The namespace's version holds the transcoder's version and the layout of the
// texels, so an engine whose transcoder writes other bytes starts again with no entries. An entry
// that reads back at another size than the file's header gives is transcoded again and written over.
//
// Like the KTX2 loader, this module imports no engine module but the cache, so it stays in the
// loader's file.

import type { DerivedCache } from './derived-cache';

/** The namespace of transcoded textures in the cache of derived data. */
export const KTX2_CACHE_NAME = 'null3d-ktx2';

/**
 * The namespace's version: the transcoder's version, Basis Universal 2.50, and the version of the
 * entries' layout, every mip level in turn with each level's layers in turn.
 */
export const KTX2_CACHE_VERSION = 'basis-2.50-1';

/** The cache's key of a file's texels: the file's hash, the format, and the mip levels written. */
export function cacheKey(hash: ArrayBuffer, format: string, levels: number): string {
	let hex = '';
	for (const byte of new Uint8Array(hash)) hex += byte.toString(16).padStart(2, '0');
	return `${hex}/${format}/${levels}`;
}

/** What the cache answers for a file: its texels, or a way to store them once transcoded. */
export type CacheLookup =
	| { texels: Uint8Array; store?: undefined }
	| { texels?: undefined; store(texels: Uint8Array): void };

/** SHA-256, where the page is a secure context that has it. */
export type Digest = (data: ArrayBuffer) => Promise<ArrayBuffer>;

export function browserDigest(): Digest | undefined {
	const subtle = globalThis.crypto?.subtle;
	return subtle && ((data) => subtle.digest('SHA-256', data));
}

/** A lookup that only skips: the cache could not answer. */
const NO_CACHE: CacheLookup = { store() {} };

/** The transcoded textures of one thread's cache of derived data. */
export class TranscodeCache {
	constructor(
		private readonly cache: DerivedCache,
		private readonly digest: Digest | undefined,
	) {}

	/**
	 * The texels of `file` in `format` with `levels` mip levels, when the cache holds them at
	 * `bytes` bytes, or a function that stores them. The file stays usable: hashing reads a copy.
	 */
	async lookup(
		file: ArrayBuffer,
		format: string,
		levels: number,
		bytes: number,
	): Promise<CacheLookup> {
		if (!this.digest) return NO_CACHE;
		let key: string;
		try {
			key = cacheKey(await this.digest(file), format, levels);
		} catch {
			return NO_CACHE;
		}
		const texels = await this.cache.get(key);
		if (texels?.byteLength === bytes) return { texels };
		return { store: (made) => void this.cache.put(key, made) };
	}
}
