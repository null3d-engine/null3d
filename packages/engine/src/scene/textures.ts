// Textures on the GPU, as the sketch thread makes them. The engine core gives each texture a layer
// of a texture array that textures of its size, format and mip levels share, and a sampler. Its
// image travels to the thread that draws, which uploads it in its turn, a band of rows per frame
// within the frame's upload budget, and then makes its mip levels on the GPU. Until the image is
// on the GPU, a material draws as without the map.
//
// These calls are the engine's own for now: the loading API builds on them.

import {
	SHADING_UNLIT_MAP,
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_NEAREST,
	TEXTURE_FORMAT_LINEAR,
	TEXTURE_FORMAT_SRGB,
	TEXTURE_OPTION_MAX_ANISOTROPY,
	TEXTURE_OPTION_UPLOAD_BUDGET,
	TEXTURE_STAT_IMAGES_SENT,
	TEXTURE_STAT_LARGEST_FRAME_BYTES,
	TEXTURE_STAT_LAST_FRAME_BYTES,
	TEXTURE_STAT_MAX_SIZE,
	TEXTURE_STAT_MEMORY_BYTES,
	TEXTURE_STAT_TEXTURE_BYTES,
	TEXTURE_STAT_WAITING,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_MIRROR,
	TEXTURE_WRAP_REPEAT,
} from '../generated/core';
import type { ImageSender } from '../shared/images';
import type { CoreMemory } from './memory';
import type { Material, MaterialOptions, Materials } from './resources';

/** What texture coordinates outside 0 to 1 read. */
export type TextureWrap = 'clamp' | 'repeat' | 'mirror';

/** How texels between texel centers, or between mip levels, are read. */
export type TextureFilter = 'linear' | 'nearest';

/** How a texture stores and samples its image. */
export interface TextureOptions {
	/**
	 * `srgb` for colors, which sampling turns into linear values, or `linear` for data such as
	 * normals and roughness, which sampling reads as they are. The default is `srgb`.
	 */
	colorSpace?: 'srgb' | 'linear';
	/** Along u, then v, or one value for both. The default is `clamp`, as in three.js. */
	wrap?: TextureWrap | readonly [TextureWrap, TextureWrap];
	/** The filter of magnified texels. The default is `linear`. */
	magFilter?: TextureFilter;
	/** The filter of minified texels. The default is `linear`. */
	minFilter?: TextureFilter;
	/** The filter between mip levels. The default is `linear`. */
	mipmapFilter?: TextureFilter;
	/** True to make mip levels on the GPU from each image. The default is true. */
	mipmaps?: boolean;
	/**
	 * Samples along the direction of steepest change, up to 16, for surfaces seen at a slant. The
	 * quality preset caps it, and a nearest filter turns it off. The default is 1.
	 */
	anisotropy?: number;
}

/** Numbers of the texture uploads. */
export interface TextureUploads {
	/** Texel bytes that the last recorded frame uploads. */
	lastFrameBytes: number;
	/** The most texel bytes that any frame uploaded. */
	largestFrameBytes: number;
	/** Textures whose image is not on the GPU yet. */
	waiting: number;
}

const WRAPS: Record<TextureWrap, number> = {
	clamp: TEXTURE_WRAP_CLAMP,
	repeat: TEXTURE_WRAP_REPEAT,
	mirror: TEXTURE_WRAP_MIRROR,
};

const FILTERS: Record<TextureFilter, number> = {
	linear: TEXTURE_FILTER_LINEAR,
	nearest: TEXTURE_FILTER_NEAREST,
};

/** A texture: an image in a layer of a texture array on the GPU. */
export class Texture {
	constructor(
		/** The engine core's handle. */
		readonly handle: number,
		readonly width: number,
		readonly height: number,
		private readonly textures: Textures,
	) {}

	/** The GPU bytes of the texture: its layer, with every mip level. */
	get bytes(): number {
		return this.textures.bytesOf(this);
	}

	/** Gives the texture a new image of its size, which uploads in its turn. */
	update(image: ImageBitmap): void {
		this.textures.setImage(this, image, 'texture.update');
	}

	/** Frees the texture's layer. Materials that map it draw with their colors alone. */
	destroy(): void {
		this.textures.destroy(this);
	}
}

/** Makes textures, and reads what the GPU holds. */
export class Textures {
	constructor(
		private readonly core: CoreMemory,
		private readonly send: ImageSender,
		private readonly time: { readonly frame: number },
	) {}

	/**
	 * A texture from a decoded image. The image moves to the thread that draws, so this thread can
	 * use it no more.
	 */
	fromImageBitmap(image: ImageBitmap, options: TextureOptions = {}): Texture {
		const call = 'textures.fromImageBitmap';
		const { glue } = this.core;
		const { width, height } = image;
		const [wrapU, wrapV] =
			typeof options.wrap === 'string'
				? [options.wrap, options.wrap]
				: (options.wrap ?? ['clamp', 'clamp']);
		const anisotropy = options.anisotropy ?? 1;
		if (!(Number.isInteger(anisotropy) && anisotropy >= 1 && anisotropy <= 16))
			throw new Error(
				`${call}() got the anisotropy ${anisotropy}: give a whole number from 1 to 16.`,
			);
		checkImage(image, call);
		const handle = this.core.check(
			glue.createTexture(
				width,
				height,
				options.colorSpace === 'linear' ? TEXTURE_FORMAT_LINEAR : TEXTURE_FORMAT_SRGB,
				options.mipmaps ?? true,
				pick(WRAPS, wrapU, 'wrap', call),
				pick(WRAPS, wrapV, 'wrap', call),
				pick(FILTERS, options.magFilter ?? 'linear', 'magFilter', call),
				pick(FILTERS, options.minFilter ?? 'linear', 'minFilter', call),
				pick(FILTERS, options.mipmapFilter ?? 'linear', 'mipmapFilter', call),
				anisotropy,
			),
			call,
		);
		const texture = new Texture(handle, width, height, this);
		this.setImage(texture, image, call);
		return texture;
	}

	/** @internal Gives a texture an image, and sends the image under the id the core gave it. */
	setImage(texture: Texture, image: ImageBitmap, call: string): void {
		checkImage(image, call);
		const id = this.core.check(
			this.core.glue.setTextureImage(texture.handle, image.width, image.height),
			call,
		);
		this.send(id, image);
	}

	/** @internal */
	bytesOf(texture: Texture): number {
		return this.stat(TEXTURE_STAT_TEXTURE_BYTES, texture.handle);
	}

	/** @internal */
	destroy(texture: Texture): void {
		this.core.check(
			this.core.glue.destroyTexture(texture.handle, this.time.frame),
			'texture.destroy',
			undefined,
			true,
		);
	}

	private stat(field: number, texture = 0): number {
		return this.core.glue.textureStat(field, texture);
	}

	/** The GPU bytes that every texture array holds, their free layers included. */
	get memoryBytes(): number {
		return this.stat(TEXTURE_STAT_MEMORY_BYTES);
	}

	/** The widest and tallest texture this device takes. */
	get maxSize(): number {
		return this.stat(TEXTURE_STAT_MAX_SIZE);
	}

	/** The images sent to the thread that draws so far. */
	get imagesSent(): number {
		return this.stat(TEXTURE_STAT_IMAGES_SENT);
	}

	uploads(): TextureUploads {
		return {
			lastFrameBytes: this.stat(TEXTURE_STAT_LAST_FRAME_BYTES),
			largestFrameBytes: this.stat(TEXTURE_STAT_LARGEST_FRAME_BYTES),
			waiting: this.stat(TEXTURE_STAT_WAITING),
		};
	}

	/** Sets the texel bytes that one frame may upload. */
	setUploadBudget(bytes: number): void {
		this.core.glue.setTextureOption(TEXTURE_OPTION_UPLOAD_BUDGET, bytes);
	}

	/** Caps the anisotropy of every texture's sampler. */
	setMaxAnisotropy(cap: number): void {
		this.core.glue.setTextureOption(TEXTURE_OPTION_MAX_ANISOTROPY, cap);
	}
}

/** Throws unless the image holds pixels: a closed image, or one sent away already, has none. */
function checkImage(image: ImageBitmap, call: string): void {
	if (image.width === 0 || image.height === 0)
		throw new Error(
			`${call}() got an image without pixels: it was closed, or it went to the GPU already. Decode the image again.`,
		);
}

/** The engine's code of a named option value, or a thrown error that lists the values. */
function pick<Name extends string>(
	codes: Record<Name, number>,
	value: Name,
	option: string,
	call: string,
): number {
	const code = codes[value];
	if (code === undefined)
		throw new Error(
			`${call}() got ${option}: '${value}'. Use one of ${Object.keys(codes)
				.map((name) => `'${name}'`)
				.join(', ')}.`,
		);
	return code;
}

const TEXTURES = Symbol.for('null3d.textures');

/** @internal Keeps a sketch context's textures on it, where `texturesOf` finds them. */
export function attachTextures(context: object, textures: Textures): void {
	(context as { [TEXTURES]?: Textures })[TEXTURES] = textures;
}

/** The textures of a sketch's context. */
export function texturesOf(context: object): Textures {
	const textures = (context as { [TEXTURES]?: Textures })[TEXTURES];
	if (!textures) throw new Error('texturesOf() got an object that is not a sketch context.');
	return textures;
}

/**
 * A material that shows its color times a map, like three.js's `MeshBasicMaterial` with a `map`.
 * Meshes need texture coordinates to show the map.
 */
export function unlitMapMaterial(
	materials: Materials,
	map: Texture,
	options: MaterialOptions = {},
): Material {
	const call = 'unlitMapMaterial';
	const material = materials.create(SHADING_UNLIT_MAP, options, call);
	materials.setMap(material, map, call);
	return material;
}
