// The sketch's loading calls, `ctx.assets`: files downloaded with fetch and decoded by the browser,
// or by the KTX2 transcoder (ktx2.ts), outside the sketch's frames, and a count of the downloads
// for loading screens. Relative addresses resolve against the page's address, in every thread
// mode. Files that `preload` downloaded wait in memory until a load takes them, and loads of one
// address at the same time share one download; the HTTP cache keeps everything else.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import type { Texture, TextureColorSpace, TextureOptions, Textures } from './textures';

/**
 * The options of `assets.loadTexture`: how the image decodes, and the texture's options. A KTX2
 * file takes its color space from the file unless `colorSpace` gives one, and its mip levels from
 * the file unless `mipmaps` is false.
 *
 * @category api/assets
 */
export interface LoadTextureOptions extends TextureOptions {
	/**
	 * True to put the image's top row at v = 1, the top of a plane, as three.js's `TextureLoader`
	 * does. The default is true. glTF textures use false. A KTX2 file keeps the rows as it holds
	 * them, its first row at v = 0, as three.js's `KTX2Loader` does: encode it flipped, as
	 * `basisu -y_flip` does, for a plane. It takes no `flipY: true`.
	 */
	flipY?: boolean;
	/**
	 * True to store each color multiplied by its alpha, as three.js's `premultiplyAlpha` does. The
	 * default is false. A KTX2 file takes no `premultipliedAlpha: true`.
	 */
	premultipliedAlpha?: boolean;
}

/**
 * The options of `assets.loadImageBitmap`, which decode an image as `loadTexture` would.
 *
 * @category api/assets
 */
export interface LoadImageOptions {
	/**
	 * `srgb` keeps the browser's color management, which converts images with a color profile to
	 * sRGB. `linear` turns it off, so data such as normal maps keeps its values. The default is
	 * `srgb`.
	 */
	colorSpace?: TextureColorSpace;
	/** True to put the image's top row last, as textures read it. The default is true. */
	flipY?: boolean;
	/** True to multiply each color by its alpha. The default is false. */
	premultipliedAlpha?: boolean;
}

/**
 * Called each time a download finishes or fails. It gets the files downloaded so far, the files
 * asked for so far, and the address of the file that finished.
 *
 * @category api/assets
 */
export type ProgressHandler = (loaded: number, total: number, url: string) => void;

/**
 * Loads files, and textures from image files. Every call runs outside the sketch's frames, so a
 * frame never waits for a download or a decode. A sketch finds it as `ctx.assets`. Addresses
 * resolve against the page's address.
 *
 * @category api/assets
 */
export class Assets {
	private readonly base: string;
	/** Downloads that `preload` started, by address, which the first load of each takes. */
	private readonly preloaded = new Map<string, Promise<Blob>>();
	/** Downloads under way, by address, which loads at the same time share. */
	private readonly pending = new Map<string, Promise<Blob>>();
	private readonly handlers = new Set<ProgressHandler>();
	private loaded = 0;
	private total = 0;

	/** @internal */
	constructor(
		private readonly textures: Textures,
		/** The page's address, which relative addresses resolve against. */
		base: string,
	) {
		this.base = base;
	}

	/**
	 * Downloads an image file or a KTX2 file, decodes it off the sketch's frames, and makes a
	 * texture from it. The browser decodes PNG, JPEG and WebP files, and AVIF files where it
	 * supports them. A KTX2 file of ETC1S or UASTC data becomes the compressed format that the
	 * device supports, with the file's mip levels, and the first KTX2 file loads the transcoder.
	 * Throws E1411 when the file does not download, E1413 when a server of another origin does not
	 * allow the page to read it, E1412 when the file does not decode, E1406 when the transcoder does
	 * not load, and E1208 for options the engine does not know.
	 */
	async loadTexture(url: string | URL, options: LoadTextureOptions = {}): Promise<Texture> {
		const call = 'assets.loadTexture';
		const address = this.resolve(url);
		const blob = await this.file(address, call);
		if (await isKtx2(blob)) return loadKtx2(this.textures, blob, address, options, call);
		const image = await decode(blob, address, options, call);
		return this.textures.fromImage(image, options, options.premultipliedAlpha ? 1 : 0, call);
	}

	/**
	 * Downloads an image file and decodes it into an `ImageBitmap`, off the sketch's frames. By
	 * default it decodes as `loadTexture` does, so `textures.fromImageBitmap` makes the same
	 * texture. Throws E1411, E1412 or E1413 as `loadTexture` does.
	 */
	async loadImageBitmap(url: string | URL, options: LoadImageOptions = {}): Promise<ImageBitmap> {
		const call = 'assets.loadImageBitmap';
		const address = this.resolve(url);
		return decode(await this.file(address, call), address, options, call);
	}

	/**
	 * Downloads a JSON file and parses it. Throws E1411 or E1413 as `loadTexture` does, and E1412
	 * when the file is not valid JSON.
	 */
	async loadJson<T = unknown>(url: string | URL): Promise<T> {
		const call = 'assets.loadJson';
		const address = this.resolve(url);
		const text = await (await this.file(address, call)).text();
		try {
			return JSON.parse(text) as T;
		} catch (error) {
			throw new EngineError(
				'E1412',
				`${call}() could not read ${address} as JSON: ${reason(error)}.`,
			);
		}
	}

	/** Downloads a file as bytes. Throws E1411 or E1413 as `loadTexture` does. */
	async loadBinary(url: string | URL): Promise<ArrayBuffer> {
		const address = this.resolve(url);
		return (await this.file(address, 'assets.loadBinary')).arrayBuffer();
	}

	/**
	 * Downloads files ahead of their loads, all at once, and resolves when every one has arrived.
	 * The next load of each address takes its file from memory. Pair it with `onProgress` for a
	 * loading screen. Throws the error of the first file that fails, as `loadBinary` does.
	 */
	async preload(urls: readonly (string | URL)[]): Promise<void> {
		const call = 'assets.preload';
		const downloads = urls.map((url) => {
			const address = this.resolve(url);
			const key = address.href;
			let download = this.preloaded.get(key);
			if (!download) {
				download = this.share(address, call);
				this.preloaded.set(key, download);
				// A failed file is not kept: a later load downloads it again.
				download.then(undefined, () => this.preloaded.delete(key));
			}
			return download;
		});
		await Promise.all(downloads);
	}

	/**
	 * Calls `handler` each time a download finishes or fails, with the files downloaded so far and
	 * the files asked for so far. Loads that take a file that `preload` downloaded count no
	 * further. Returns a function that removes the handler.
	 */
	onProgress(handler: ProgressHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	private resolve(url: string | URL): URL {
		return new URL(url, this.base);
	}

	/** A file that `preload` downloaded, or a download of it now. */
	private file(address: URL, call: string): Promise<Blob> {
		const key = address.href;
		const preloaded = this.preloaded.get(key);
		if (preloaded) {
			this.preloaded.delete(key);
			return preloaded;
		}
		return this.share(address, call);
	}

	/** The download of an address under way, or a new one. */
	private share(address: URL, call: string): Promise<Blob> {
		const key = address.href;
		let download = this.pending.get(key);
		if (!download) {
			download = this.download(address, call);
			this.pending.set(key, download);
			const forget = () => this.pending.delete(key);
			download.then(forget, forget);
		}
		return download;
	}

	/** Downloads a file, counts it for the progress handlers, and gives failures their codes. */
	private async download(address: URL, call: string): Promise<Blob> {
		this.total++;
		try {
			let response: Response;
			try {
				response = await fetch(address);
			} catch (error) {
				// Fetch gives no reason for a blocked response, so another origin's refusal and a
				// network failure look alike. Another origin's file usually fails for its headers.
				if (address.origin !== new URL(this.base).origin)
					throw new EngineError(
						'E1413',
						`${call}() could not read ${address}: its server did not allow this page to read it, or could not be reached (${reason(error)}).`,
					);
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: ${reason(error)}.`,
				);
			}
			if (!response.ok)
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: HTTP ${response.status}.`,
				);
			try {
				return await response.blob();
			} catch (error) {
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: ${reason(error)}.`,
				);
			}
		} finally {
			this.loaded++;
			this.report(address.href);
		}
	}

	private report(url: string): void {
		for (const handler of this.handlers)
			try {
				handler(this.loaded, this.total, url);
			} catch (error) {
				console.error(error);
			}
	}
}

/** A failure's message without its closing period. */
function reason(error: unknown): string {
	return messageOf(error).replace(/\.$/, '');
}

/** The identifier that starts every KTX2 file. */
const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** True for a file that starts with the KTX2 identifier. */
async function isKtx2(blob: Blob): Promise<boolean> {
	if (blob.size < KTX2_IDENTIFIER.length) return false;
	const head = new Uint8Array(await blob.slice(0, KTX2_IDENTIFIER.length).arrayBuffer());
	return KTX2_IDENTIFIER.every((byte, k) => head[k] === byte);
}

/**
 * Makes a texture from a KTX2 file with the KTX2 loader, which this imports the first time, so a
 * page without KTX2 files never downloads it. Throws E1406 when the loader does not download, and
 * E1208 for options that a KTX2 file cannot take.
 */
async function loadKtx2(
	textures: Textures,
	blob: Blob,
	address: URL,
	options: LoadTextureOptions,
	call: string,
): Promise<Texture> {
	if (DEV) {
		const refuse = (option: string, why: string) =>
			new EngineError('E1208', `${call}() got ${option}: true for ${address}, a KTX2 file. ${why}`);
		if (options.flipY === true)
			throw refuse(
				'flipY',
				'Its compressed rows cannot turn over: encode the file flipped, as basisu -y_flip does.',
			);
		if (options.premultipliedAlpha === true)
			throw refuse(
				'premultipliedAlpha',
				'Its compressed colors cannot change: encode the file from colors multiplied by alpha.',
			);
	}
	let ktx2: typeof import('./ktx2');
	try {
		ktx2 = await import('./ktx2');
	} catch (error) {
		throw new EngineError(
			'E1406',
			`the KTX2 loader did not download for ${call}() of ${address}: ${reason(error)}.`,
		);
	}
	return ktx2.loadKtx2(
		textures,
		await blob.arrayBuffer(),
		address,
		options,
		call,
		(code, message) => new EngineError(code, message),
	);
}

/** Decodes an image file as `options` ask, or throws E1412. */
async function decode(
	blob: Blob,
	address: URL,
	options: LoadImageOptions,
	call: string,
): Promise<ImageBitmap> {
	const { colorSpace = 'srgb', flipY = true, premultipliedAlpha = false } = options;
	const decoding: ImageBitmapOptions = {
		premultiplyAlpha: premultipliedAlpha ? 'premultiply' : 'none',
		colorSpaceConversion: colorSpace === 'linear' ? 'none' : 'default',
	};
	// Without an orientation, the image keeps its own, which every browser takes.
	if (flipY) decoding.imageOrientation = 'flipY';
	try {
		return await createImageBitmap(blob, decoding);
	} catch (error) {
		throw new EngineError(
			'E1412',
			`${call}() could not decode ${address} as an image: ${reason(error)}.`,
		);
	}
}
