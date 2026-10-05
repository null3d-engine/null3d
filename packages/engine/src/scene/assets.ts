// The sketch's loading calls, `ctx.assets`: files downloaded with fetch and decoded by the browser,
// by the KTX2 transcoder (ktx2.ts), by the color grading table readers (lut-files.ts) or by the
// environment map reader (environment-file.ts), outside the sketch's frames, and a count of the
// downloads for loading screens. Built-in environments need no file: the GPU makes them
// (builtin-environments.ts). Relative addresses resolve against the page's address, in every thread
// mode. Files that `preload` downloaded wait in memory until a load takes them, and loads of one
// address at the same time share one download; the HTTP cache keeps everything else.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import { reasonOf } from '../errors/message';
import { type BuiltinEnvironmentName, Environment } from './environment';
import { FILE_LIMITS, imageSize, imageTooLarge } from './file-limits';
import { Lut } from './lut';
import type { CoreMemory } from './memory';
import type { Prefab } from './prefab';
import type { Geometry, Materials } from './resources';
import type { Scene } from './scene';
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
 * The options of `assets.loadGltf`.
 *
 * @category api/assets
 */
export interface LoadGltfOptions {
	/**
	 * Checks or changes each address that the file names, for a buffer or an image, before it
	 * downloads. It gets the address resolved against the file's own, and returns the address to
	 * download, or null to refuse the file with E1416. A model that a user uploads can name any
	 * address, which the page then requests with its cookies, so a page that loads such models
	 * should allow only the addresses it expects. three.js's `LoadingManager.setURLModifier` does
	 * the same for its loaders.
	 */
	rewriteUrl?: (address: URL) => URL | string | null;
}

/** @internal What `loadGltf` makes a model's meshes, materials and skeleton with. */
export interface ModelMakers {
	core: CoreMemory;
	geometry: Geometry;
	materials: Materials;
	scene: Scene;
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
		private readonly makers?: ModelMakers,
	) {
		this.base = base;
	}

	/**
	 * Downloads an image file or a KTX2 file, decodes it off the sketch's frames, and makes a
	 * texture from it. The browser decodes PNG, JPEG, WebP and AVIF files. A KTX2 file of ETC1S or
	 * UASTC data becomes the compressed format that the device supports, with the file's mip
	 * levels, and UASTC HDR data becomes BC6H or shared-exponent floats. The first KTX2 file loads
	 * the transcoder.
	 * Throws E1411 when the file does not download, E1413 when a server of another origin does not
	 * allow the page to read it, E1412 when the file does not decode or passes a limit of the
	 * engine's (a KTX2 file larger than the device's textures, before it transcodes), E1406 when the
	 * transcoder does not load, and E1208 for options the engine does not know.
	 */
	async loadTexture(url: string | URL, options: LoadTextureOptions = {}): Promise<Texture> {
		const call = 'assets.loadTexture';
		const address = this.resolve(url);
		const blob = await this.file(address, call);
		if (await isKtx2(blob)) return loadKtx2(this.textures, blob, address, options, call);
		const image = await decode(blob, address, options, call, this.textures.maxSize);
		return this.textures.fromImage(image, options, options.premultipliedAlpha ? 1 : 0, call);
	}

	/**
	 * Downloads a glTF 2.0 model, a `.glb` file or a `.gltf` file with the files it names, and
	 * makes a prefab of it: its meshes, materials, textures, lights and nodes, made once, which
	 * `scene.instantiate` copies. A worker parses the file off the sketch's frames, and the first
	 * call downloads the loader and its worker. The first file with meshopt compression also
	 * downloads the meshopt decoder. The loads count for `onProgress`, the files the model names too,
	 * and they take files that `preload` downloaded. Throws E1411 when a file does not download,
	 * E1413 when a server of another origin does not allow the page to read it, E1416 for a file
	 * that is not a glTF model the engine reads or that passes a limit on what one file may decode
	 * to, E1417 for a file that requires an extension the engine does not read, E1412 when an image
	 * does not decode, E1109 when a mesh does not fit engine memory, and E1406 when the loader or
	 * the meshopt decoder does not download. `options.rewriteUrl` checks the addresses that the
	 * file names.
	 */
	async loadGltf(url: string | URL, options: LoadGltfOptions = {}): Promise<Prefab> {
		const call = 'assets.loadGltf';
		const address = this.resolve(url);
		const makers = this.makers;
		if (!makers) throw new Error(`${call}() needs the engine's meshes and materials`);
		const [file, gltf] = await Promise.all([this.file(address, call), loadModule(address, call)]);
		return gltf.loadGltf(
			{
				...makers,
				textures: this.textures,
				download: (at, during) => this.file(rewritten(at, address, options, during), during),
				decode: (blob, at, colorSpace, during) =>
					decode(blob, at, { colorSpace, flipY: false }, during, this.textures.maxSize),
				error: (code, message) => new EngineError(code, message),
			},
			file,
			address,
			call,
		);
	}

	/**
	 * Downloads an image file and decodes it into an `ImageBitmap`, off the sketch's frames. By
	 * default it decodes as `loadTexture` does, so `textures.fromImageBitmap` makes the same
	 * texture. Throws E1411, E1412 or E1413 as `loadTexture` does.
	 */
	async loadImageBitmap(url: string | URL, options: LoadImageOptions = {}): Promise<ImageBitmap> {
		const call = 'assets.loadImageBitmap';
		const address = this.resolve(url);
		const blob = await this.file(address, call);
		return decode(blob, address, options, call, FILE_LIMITS.imageSide);
	}

	/**
	 * Downloads a color grading table in a `.cube` or a `.3dl` file and makes a `Lut` from it, for
	 * `post.set({ lut })`. It reads the forms that three.js's `LUTCubeLoader` and `LUT3dlLoader`
	 * read, with tables of 2 to 256 texels a side. A `.cube` file's domain and title come along;
	 * a `.3dl` file's values are whole numbers of the depth that its largest value or its `Mesh`
	 * line gives. The first table loads the readers. Throws E1411 or E1413 as `loadTexture` does,
	 * E1412 when the file holds no table that the engine reads, and E1406 when the readers do not
	 * load.
	 */
	async loadLut(url: string | URL): Promise<Lut> {
		const call = 'assets.loadLut';
		const address = this.resolve(url);
		const text = await (await this.file(address, call)).text();
		let files: typeof import('./lut-files');
		try {
			files = await import('./lut-files');
		} catch (error) {
			throw new EngineError(
				'E1406',
				`the color grading table reader did not download for ${call}() of ${address}: ${reasonOf(error)}.`,
			);
		}
		let table: import('./lut-files').LutTable;
		try {
			table = files.parseLut(text);
		} catch (error) {
			throw new EngineError(
				'E1412',
				`${call}() could not read ${address} as a color grading table: ${reasonOf(error)}.`,
			);
		}
		const { size, title, domainMin, domainMax, texels } = table;
		const texture = this.textures.fromVolume(size, texels, call);
		return new Lut(texture, size, title, domainMin, domainMax);
	}

	/**
	 * Downloads an environment map that `bunx @null3d/cli assets env` made, a KTX2 file, and makes
	 * an `Environment` from it, for `scene.setEnvironment`. The map's cube texture uploads in the
	 * frames after the call, and the scene draws without the environment until it is on the GPU.
	 * The first environment loads the file reader. Throws E1411 or E1413 as `loadTexture` does,
	 * E1412 when the file is not an environment map that the engine reads, and E1406 when the
	 * reader does not load.
	 */
	async loadEnvironment(url: string | URL): Promise<Environment> {
		const call = 'assets.loadEnvironment';
		return this.environment(this.resolve(url), call);
	}

	/**
	 * Makes a built-in environment: `room`, the room that three.js's `RoomEnvironment` builds, for
	 * soft, neutral light with no file of your own. No file downloads: the GPU draws the room into
	 * its cube map and filters it for each roughness, as three.js's `PMREMGenerator.fromScene` does.
	 * It resolves once the code and the shaders that make the map are ready. The next frame then
	 * makes the whole map before it draws, so the first frame with the environment already has its
	 * light. That frame takes longer, by the map's GPU time: call it while the scene loads, since a
	 * call during play makes one long frame. The first one loads the code that makes it, about 7 KB
	 * after Brotli. Throws E1213 for a name that no built-in environment has, and E1406 when its
	 * code does not download.
	 */
	async builtinEnvironment(name: BuiltinEnvironmentName): Promise<Environment> {
		const call = 'assets.builtinEnvironment';
		let builtins: typeof import('./builtin-environments');
		try {
			builtins = await import('./builtin-environments');
		} catch (error) {
			throw new EngineError(
				'E1406',
				`the built-in environments did not download for ${call}(): ${reasonOf(error)}.`,
			);
		}
		if (!Object.hasOwn(builtins.BUILTIN_ENVIRONMENTS, name))
			throw new EngineError(
				'E1213',
				`${call}() got ${JSON.stringify(name)}, which names no built-in environment. Use 'room'.`,
			);
		const { size, levels, sh } = builtins.BUILTIN_ENVIRONMENTS[name];
		const texture = await this.textures.fromGenerator(name, size, levels, call);
		return new Environment(texture, size, levels, 'rgb9e5ufloat', sh);
	}

	/** Downloads and reads an environment map's file, and makes its cube texture. */
	private async environment(address: URL, call: string): Promise<Environment> {
		const [file, reader] = await Promise.all([
			this.file(address, call),
			environmentReader(call, String(address)),
		]);
		let map: import('./environment-file').EnvironmentFile;
		try {
			map = reader.readEnvironmentFile(await file.arrayBuffer());
		} catch (error) {
			throw new EngineError(
				'E1412',
				`${call}() could not read ${address} as an environment map: ${reasonOf(error)}.`,
			);
		}
		const { size, levels, format, texels, sh } = map;
		const texture = this.textures.fromCube(size, levels, format, texels, call);
		return new Environment(texture, size, levels, format, sh);
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
				`${call}() could not read ${address} as JSON: ${reasonOf(error)}.`,
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
						`${call}() could not read ${address}: its server did not allow this page to read it, or could not be reached (${reasonOf(error)}).`,
					);
				throw new EngineError(
					'E1411',
					`${call}() could not download ${address}: ${reasonOf(error)}.`,
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
					`${call}() could not download ${address}: ${reasonOf(error)}.`,
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
			`the KTX2 loader did not download for ${call}() of ${address}: ${reasonOf(error)}.`,
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

/**
 * The address to download for one that a model file at `file` names: `options.rewriteUrl`'s
 * answer, or the address itself. Throws E1416 when the option refuses it.
 */
function rewritten(at: URL, file: URL, options: LoadGltfOptions, call: string): URL {
	if (!options.rewriteUrl) return at;
	const answer = options.rewriteUrl(at);
	if (answer === null)
		throw new EngineError(
			'E1416',
			`${call}() could not read ${file}: it names ${at}, which the rewriteUrl option refused.`,
		);
	return new URL(answer, at);
}

type EnvironmentReader = typeof import('./environment-file');

/**
 * Imports the environment map reader, which a page downloads with its first environment, or
 * throws E1406 that names what `call` was loading.
 */
async function environmentReader(call: string, what: string): Promise<EnvironmentReader> {
	try {
		return await import('./environment-file');
	} catch (error) {
		throw new EngineError(
			'E1406',
			`the environment map reader did not download for ${call}() of ${what}: ${reasonOf(error)}.`,
		);
	}
}

/** Imports the glTF loader, which a page downloads with its first glTF file, or throws E1406. */
async function loadModule(address: URL, call: string): Promise<typeof import('./gltf')> {
	try {
		return await import('./gltf');
	} catch (error) {
		throw new EngineError(
			'E1406',
			`the glTF loader did not download for ${call}() of ${address}: ${reasonOf(error)}.`,
		);
	}
}

/**
 * The bytes at the start of an image file that its size is read from. A JPEG's frame header comes
 * after its other header segments, which rarely pass this.
 */
const HEADER_BYTES = 1 << 20;

/**
 * Decodes an image file as `options` ask, or throws E1412. A PNG, JPEG, WebP or AVIF file whose
 * header gives a side longer than `maxSide` fails before the browser decodes it.
 */
async function decode(
	blob: Blob,
	address: URL,
	options: LoadImageOptions,
	call: string,
	maxSide: number,
): Promise<ImageBitmap> {
	const head = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
	const refused = imageTooLarge(imageSize(head), maxSide);
	if (refused)
		throw new EngineError(
			'E1412',
			`${call}() could not decode ${address} as an image: ${refused}.`,
		);
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
			`${call}() could not decode ${address} as an image: ${reasonOf(error)}.`,
		);
	}
}
