// Textures as a sketch makes them: from decoded images, from data, and through the loading calls
// of assets.ts. The engine core gives each texture a layer of a texture array that textures of
// its size, format and mip levels share, and a sampler. An image travels to the thread that
// draws; data goes into engine memory. Either uploads in its turn, a band of rows per frame
// within the frame's upload budget, and then makes its mip levels on the GPU. Texels from a KTX2
// file (ktx2.ts) go into engine memory with every mip level, often in a compressed format. Until
// its texels are on the GPU, a material draws as without the map.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import {
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_NEAREST,
	TEXTURE_FORMAT_ASTC,
	TEXTURE_FORMAT_ASTC_SRGB,
	TEXTURE_FORMAT_BC6H,
	TEXTURE_FORMAT_BC7,
	TEXTURE_FORMAT_BC7_SRGB,
	TEXTURE_FORMAT_ETC2_RGB,
	TEXTURE_FORMAT_ETC2_RGB_SRGB,
	TEXTURE_FORMAT_ETC2_RGBA,
	TEXTURE_FORMAT_ETC2_RGBA_SRGB,
	TEXTURE_FORMAT_HALF_FLOAT,
	TEXTURE_FORMAT_LINEAR,
	TEXTURE_FORMAT_SHARED_EXPONENT,
	TEXTURE_FORMAT_SRGB,
	TEXTURE_MAX_DEPTH,
	TEXTURE_OPTION_MAX_ANISOTROPY,
	TEXTURE_OPTION_MEMORY_BUDGET_KIB,
	TEXTURE_OPTION_UPLOAD_BUDGET,
	TEXTURE_PREMULTIPLIED_ALPHA,
	TEXTURE_STAT_BUDGET_EPOCH,
	TEXTURE_STAT_DROPPED_LEVELS,
	TEXTURE_STAT_DROPPED_TEXTURES,
	TEXTURE_STAT_DROPPED_TOTAL,
	TEXTURE_STAT_IMAGES_SENT,
	TEXTURE_STAT_LARGEST_FRAME_BYTES,
	TEXTURE_STAT_LAST_FRAME_BYTES,
	TEXTURE_STAT_MAX_ANISOTROPY,
	TEXTURE_STAT_MAX_SIZE,
	TEXTURE_STAT_MEMORY_BUDGET,
	TEXTURE_STAT_MEMORY_BYTES,
	TEXTURE_STAT_RELOAD_LEVEL,
	TEXTURE_STAT_RELOAD_TEXTURE,
	TEXTURE_STAT_TEXTURE_BYTES,
	TEXTURE_STAT_UPLOAD_BUDGET,
	TEXTURE_STAT_WAITING,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_MIRROR,
	TEXTURE_WRAP_REPEAT,
} from '../generated/core';
import type { QualitySettingName, QualitySettings } from '../quality/presets';
import type { GeneratorSource, ImageSender } from '../shared/images';
import type { EnvironmentFormat } from './environment';
import { toHalfFloats } from './half-float';
import type { CoreMemory } from './memory';
import { checkPass, type RenderPass } from './render';

/**
 * What texture coordinates outside 0 to 1 read. `clamp` reads the texel at the edge, `repeat`
 * repeats the texture, and `mirror` repeats it with every other copy mirrored.
 *
 * @category api/textures
 */
export type TextureWrap = 'clamp' | 'repeat' | 'mirror';

/**
 * How texels are read between their centers and between mip levels: blended (`linear`), or the
 * nearest one (`nearest`), which keeps pixel art sharp.
 *
 * @category api/textures
 */
export type TextureFilter = 'linear' | 'nearest';

/**
 * `srgb` for colors, which sampling turns into linear values, or `linear` for data such as
 * normals, roughness and metalness, which sampling reads as they are.
 *
 * @category api/textures
 */
export type TextureColorSpace = 'srgb' | 'linear';

/**
 * How a texture stores its texels on the GPU: `rgba8unorm`, four 8-bit channels, or
 * `rgba16float`, four 16-bit floats for values outside 0 to 1.
 *
 * @category api/textures
 */
export type TextureFormat = 'rgba8unorm' | 'rgba16float';

/**
 * A compressed format, which stores blocks of 4 x 4 texels in a quarter or an eighth of the GPU
 * memory of `rgba8unorm`. A texture from a KTX2 file takes the one that the device supports:
 * `astc-4x4-unorm`, `bc7-rgba-unorm`, `etc2-rgb8unorm` without alpha or `etc2-rgba8unorm` with
 * it. A KTX2 file of high dynamic range data becomes `bc6h-rgb-ufloat`, which holds three half
 * floats per texel and no alpha, where the device has BC formats. The names are WebGPU's, and a
 * texture's `colorSpace` says whether sampling decodes sRGB.
 *
 * @category api/textures
 */
export type CompressedTextureFormat =
	| 'astc-4x4-unorm'
	| 'bc6h-rgb-ufloat'
	| 'bc7-rgba-unorm'
	| 'etc2-rgb8unorm'
	| 'etc2-rgba8unorm';

/**
 * Texel data: bytes for `rgba8unorm`, and for `rgba16float` either half floats as 16-bit words or
 * 32-bit floats, which the engine turns into half floats. A 32-bit float outside the half float range
 * of -65,504 to 65,504 takes the nearer end of it, because an infinite texel would draw black.
 *
 * @category api/textures
 */
export type TextureDataArray = Uint8Array | Uint8ClampedArray | Uint16Array | Float32Array;

/**
 * How a texture stores and samples its texels. Every call that makes a texture takes them.
 *
 * @category api/textures
 */
export interface TextureOptions {
	/**
	 * `srgb` for color maps, such as a base color, and `linear` for data maps, such as normal,
	 * roughness, metalness and occlusion maps. The default is `srgb` for images and `linear` for
	 * data.
	 */
	colorSpace?: TextureColorSpace;
	/** Along u, then v, or one value for both. The default is `clamp`, as in three.js. */
	wrap?: TextureWrap | readonly [TextureWrap, TextureWrap];
	/** The filter of magnified and minified texels and between mip levels. The default is `linear`. */
	filter?: TextureFilter;
	/**
	 * True to make mip levels on the GPU after each upload, so the texture does not shimmer where
	 * it covers few pixels. The default is true for images and false for data. `rgba16float`
	 * textures have no mip levels.
	 */
	mipmaps?: boolean;
	/**
	 * Samples along the direction of steepest change, a whole number from 1 to 16, which keeps a
	 * texture sharp on a surface seen at a slant. The quality preset caps it, and a `nearest`
	 * filter turns it off. The default is 1, which is off.
	 */
	anisotropy?: number;
	/**
	 * The set of texture coordinates that materials read the texture at: 0 for the first, 1 for
	 * the second, as three.js's `texture.channel`. The default is 0.
	 */
	uvSet?: 0 | 1;
}

/**
 * A texture's size and texels for `textures.fromData`, with its options.
 *
 * @category api/textures
 */
export interface TextureData extends TextureOptions {
	/** Texels in each row, from 1 up to `textures.maxSize`. */
	width: number;
	/** Rows in each layer, from 1 up to `textures.maxSize`. */
	height: number;
	/** Layers, from 1 to 256. The default is 1. */
	depth?: number;
	/** The default is `rgba8unorm`. */
	format?: TextureFormat;
	/**
	 * Four numbers per texel, in rows from the first to the last, layer after layer. The first
	 * row is at v = 0, the bottom of a plane.
	 */
	data: TextureDataArray;
}

/**
 * The GPU memory that textures take, against the quality setting `textureMemoryMiB`, and the mip
 * levels that the engine dropped to stay under it, as `quality.textureMemory` reports them.
 *
 * @category api/quality
 */
export interface TextureMemory {
	/** The GPU bytes that every texture takes now, with the free layers of their texture arrays. */
	readonly bytes: number;
	/** The GPU bytes that textures may take: `textureMemoryMiB` in bytes. */
	readonly budgetBytes: number;
	/** The largest mip levels that the engine dropped, over every texture. */
	readonly droppedLevels: number;
	/** The textures that hold fewer mip levels than their own. */
	readonly droppedTextures: number;
}

/**
 * @internal Loads a texture's texels again from its file without the largest `level` mip levels,
 * and gives them to `target`, a hidden texture of that size.
 */
export type TextureReloader = (level: number, target: Texture) => Promise<void>;

/** The loads again that run at once, at most, so a burst of them does not crowd the network. */
const RELOADS_AT_ONCE = 2;

/** Numbers of the texture uploads. */
export interface TextureUploads {
	/** Texel bytes that the last recorded frame uploads. */
	lastFrameBytes: number;
	/** The most texel bytes that any frame uploaded. */
	largestFrameBytes: number;
	/** Textures whose texels are not on the GPU yet. */
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

const COLOR_SPACES: Record<TextureColorSpace, true> = { srgb: true, linear: true };

const FORMATS: Record<TextureFormat, true> = { rgba8unorm: true, rgba16float: true };

/** Every format that a texture stores its texels in. */
type AnyTextureFormat = TextureFormat | CompressedTextureFormat | EnvironmentFormat;

/** The formats of high dynamic range texels, which hold linear values alone. */
const HDR_FORMATS: ReadonlySet<AnyTextureFormat> = new Set([
	'rgba16float',
	'rgb9e5ufloat',
	'bc6h-rgb-ufloat',
]);

/** The core's code of each format, in linear values and in sRGB. */
const FORMAT_CODES: Record<AnyTextureFormat, readonly [number, number]> = {
	rgba8unorm: [TEXTURE_FORMAT_LINEAR, TEXTURE_FORMAT_SRGB],
	rgba16float: [TEXTURE_FORMAT_HALF_FLOAT, TEXTURE_FORMAT_HALF_FLOAT],
	rgb9e5ufloat: [TEXTURE_FORMAT_SHARED_EXPONENT, TEXTURE_FORMAT_SHARED_EXPONENT],
	'astc-4x4-unorm': [TEXTURE_FORMAT_ASTC, TEXTURE_FORMAT_ASTC_SRGB],
	'bc6h-rgb-ufloat': [TEXTURE_FORMAT_BC6H, TEXTURE_FORMAT_BC6H],
	'bc7-rgba-unorm': [TEXTURE_FORMAT_BC7, TEXTURE_FORMAT_BC7_SRGB],
	'etc2-rgb8unorm': [TEXTURE_FORMAT_ETC2_RGB, TEXTURE_FORMAT_ETC2_RGB_SRGB],
	'etc2-rgba8unorm': [TEXTURE_FORMAT_ETC2_RGBA, TEXTURE_FORMAT_ETC2_RGBA_SRGB],
};

/** @internal Texels from a file, with the mip levels that it holds. */
export interface FileTexels {
	width: number;
	height: number;
	/** Layers: 1, or more for an array texture. */
	depth: number;
	/** Mip levels, from level 0: all that the file holds, or 1. */
	levels: number;
	format: AnyTextureFormat;
	/** The color space that the file names, which the options can change. */
	colorSpace: TextureColorSpace;
	/** Tightly packed rows, of blocks in a compressed format: each level's layers in turn. */
	texels: Uint8Array;
}

/**
 * A texture: an image or data on the GPU, which materials sample. Its texels upload in the
 * frames after the call that makes it, a band of rows per frame. A material draws with its color
 * alone until they are on the GPU.
 *
 * @category api/textures
 */
export class Texture {
	private size: [number, number];
	private destroyed = false;

	/** @internal */
	constructor(
		/** @internal The engine core's handle. */
		readonly handle: number,
		width: number,
		height: number,
		/** Layers: 1, or more for a texture from data with a depth. */
		readonly depth: number,
		/**
		 * How the texture stores its texels on the GPU. A texture from a KTX2 file has the
		 * compressed format that the device supports, or `rgba8unorm` where it supports none.
		 */
		readonly format: TextureFormat | CompressedTextureFormat | EnvironmentFormat,
		/** Whether sampling turns the texels from sRGB into linear values, or reads them as they are. */
		readonly colorSpace: TextureColorSpace,
		/** The set of texture coordinates that materials read the texture at. */
		readonly uvSet: 0 | 1,
		private readonly textures: Textures,
		/** @internal True for a texture from a file, whose texels come from the file alone. */
		readonly fromFile = false,
		/** @internal The render pass whose texture this is, whose texels come from the pass alone. */
		readonly pass?: RenderPass,
	) {
		this.size = [width, height];
	}

	/** Texels in each row. An update with an image of another size changes it. */
	get width(): number {
		return this.size[0];
	}

	/** Rows in each layer. An update with an image of another size changes it. */
	get height(): number {
		return this.size[1];
	}

	/**
	 * The GPU bytes of the texture: its layers, with every mip level that the GPU holds. A texture
	 * whose largest levels the memory budget dropped takes less.
	 */
	get bytes(): number {
		return this.textures.bytesOf(this);
	}

	/**
	 * The largest mip levels that the GPU does not hold, which the texture memory budget dropped:
	 * 0 to 3. `width` and `height` stay the texture's own size.
	 */
	get droppedLevels(): number {
		return this.textures.droppedLevelsOf(this);
	}

	/**
	 * Gives the texture new texels, which upload in their turn. An image may have another size,
	 * and the texture then takes that size; the image moves to the thread that draws, so this
	 * thread can use it no more. Data must fit the texture's size and format. Until the new texels
	 * are on the GPU, materials draw with their colors alone. A texture from a KTX2 file takes no
	 * updates, and throws E1208: load the file again.
	 */
	update(source: ImageBitmap | TextureDataArray): void {
		const call = 'texture.update';
		if (this.pass)
			throw invalid(
				call,
				`got the texture of the pass "${this.pass.name}", whose texels come from the pass alone.`,
			);
		// Release builds refuse too: the texture's memory holds its file's blocks, not RGBA texels.
		if (this.fromFile)
			throw invalid(
				call,
				'got a texture from a KTX2 file, whose texels come from the file alone. Load the file again, or make the texture with fromImageBitmap or fromData.',
			);
		this.textures.forgetFile(this);
		if (ArrayBuffer.isView(source)) this.textures.setData(this, source, call);
		else this.textures.setImage(this, source, 0, call);
	}

	/** @internal Takes the size that an image of another size gave the texture. */
	resize(width: number, height: number): void {
		this.size = [width, height];
	}

	/**
	 * Frees the texture's GPU memory. Materials that map it draw with their colors alone. Calls on
	 * the texture after this throw E1101.
	 */
	destroy(): void {
		this.textures.destroy(this);
		this.destroyed = true;
	}

	/** @internal True until `destroy` runs. */
	get live(): boolean {
		return !this.destroyed;
	}
}

/**
 * Makes textures from decoded images and from data, and reads what the GPU holds. A sketch finds
 * it as `ctx.textures`. `ctx.assets.loadTexture` loads and decodes image files into textures.
 *
 * @category api/textures
 */
export class Textures {
	/** The function that loads each texture from a file again, by the texture's handle. */
	private readonly reloaders = new Map<number, { texture: Texture; reload: TextureReloader }>();
	/** The budget's number of changes when this thread last looked. */
	private budgetEpoch = 0;
	/** Loads again under way. */
	private reloading = 0;

	/** @internal The texture memory, as `quality.textureMemory` reports it. */
	readonly memory: TextureMemory;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		private readonly send: ImageSender,
		private readonly time: { readonly frame: number },
		/** @internal The device's capability flags, which say what compressed formats it has. */
		readonly capabilities: number,
		private readonly ownBudget: () => void = () => {},
		/** Resolves once the thread that draws holds every image and generator up to an id. */
		private readonly arrived: (id: number) => Promise<void> = async () => {},
		/** @internal True when the engine draws with WebGL2. */
		readonly webgl2 = false,
		/**
		 * @internal True when KTX2 files keep their transcoded texels in the browser's Cache Storage,
		 * so later loads of the same file skip the transcoder.
		 */
		readonly textureCache = false,
		private readonly ownMemory: () => void = () => {},
	) {
		const stat = (field: number) => this.stat(field);
		this.memory = {
			get bytes() {
				return stat(TEXTURE_STAT_MEMORY_BYTES);
			},
			get budgetBytes() {
				return stat(TEXTURE_STAT_MEMORY_BUDGET);
			},
			get droppedLevels() {
				return stat(TEXTURE_STAT_DROPPED_TOTAL);
			},
			get droppedTextures() {
				return stat(TEXTURE_STAT_DROPPED_TEXTURES);
			},
		};
	}

	/**
	 * The texture that a render pass draws into, which materials and sprites take as a map, as
	 * three.js's render target textures are. It holds linear color, after the exposure and before
	 * the tone curve: high dynamic range color where the device draws it. The image stands upright
	 * on a plane, with v = 0 at its bottom row. It samples as no texture until the pass first draws,
	 * and keeps the last image while the pass is switched off. `render.removePass` destroys it.
	 * Throws E1101 for a pass that was removed.
	 */
	fromPass(pass: RenderPass): Texture {
		const call = 'textures.fromPass';
		checkPass(pass, call);
		const handle = this.core.check(
			this.core.glue.createPassTexture(pass.place, pass.width, pass.height),
			call,
		);
		const texture = new Texture(
			handle,
			pass.width,
			pass.height,
			1,
			this.passFormat,
			'linear',
			0,
			this,
			false,
			pass,
		);
		pass.textures.push(texture);
		return texture;
	}

	/** @internal How the targets of render passes store their texels: the scene color's format. */
	passFormat: TextureFormat = 'rgba16float';

	/**
	 * A texture from a decoded image. The image's first row goes to v = 0, the bottom of a plane.
	 * Decode images with `imageOrientation: 'flipY'`, as `assets.loadImageBitmap` does by default,
	 * so that they stand upright as three.js shows them. The image moves to the thread that draws,
	 * so this thread can use it no more. Throws E1208 for an image without pixels, one larger than
	 * `maxSize`, and options the engine does not know.
	 */
	fromImageBitmap(image: ImageBitmap, options: TextureOptions = {}): Texture {
		return this.fromImage(image, options, 0, 'textures.fromImageBitmap');
	}

	/**
	 * @internal A texture from a decoded image that holds colors multiplied by alpha when
	 * `premultiplied` is true, as `assets.loadTexture` decodes them.
	 */
	fromImage(
		image: ImageBitmap,
		options: TextureOptions,
		premultiplied: 0 | 1,
		call: string,
	): Texture {
		if (DEV) checkImage(image, call);
		const texture = this.create(image.width, image.height, 1, 'rgba8unorm', options, 'image', call);
		this.setImage(texture, image, premultiplied, call);
		return texture;
	}

	/**
	 * @internal A texture from texels that a file brought, with their mip levels, such as a KTX2
	 * file's once transcoded. The texels move into engine memory at once.
	 */
	fromTexels(file: FileTexels, options: TextureOptions, call: string): Texture {
		const { width, height, depth, levels, format, colorSpace, texels } = file;
		const texture = this.create(
			width,
			height,
			depth,
			format,
			{ colorSpace, ...options, mipmaps: false },
			'file',
			call,
			levels,
		);
		const address = this.texelAddress(texture, width, height, call);
		new Uint8Array(this.core.memory.buffer, address, texels.length).set(texels);
		return texture;
	}

	/**
	 * Where the texture's new texels go in engine memory. The core makes room for them there, which
	 * can grow the memory.
	 */
	private texelAddress(texture: Texture, width: number, height: number, call: string): number {
		const { core } = this;
		return core.checkGrowth(
			core.glue.setTextureData(texture.handle, width, height),
			call,
			'a texture',
		);
	}

	/**
	 * A texture from data: four numbers per texel, in rows from the bottom up, layer after layer.
	 * A texture of several layers is a texture array of its own. Throws E1208 when the data does
	 * not fit the size and format, and for options the engine does not know.
	 */
	fromData(texture: TextureData): Texture {
		const call = 'textures.fromData';
		const { width, height, depth = 1, format = 'rgba8unorm', data } = texture;
		if (DEV) {
			if (!FORMATS[format as TextureFormat])
				throw invalid(call, `got the format ${quote(format)}. Use 'rgba8unorm' or 'rgba16float'.`);
			for (const [name, value, max] of [
				['width', width, this.maxSize],
				['height', height, this.maxSize],
				['depth', depth, TEXTURE_MAX_DEPTH],
			] as const)
				if (!(Number.isInteger(value) && value >= 1 && value <= max))
					throw invalid(call, `got the ${name} ${value}: give a whole number from 1 to ${max}.`);
		}
		const made = this.create(width, height, depth, format, texture, 'data', call);
		try {
			this.setData(made, data, call);
		} catch (error) {
			made.destroy();
			throw error;
		}
		return made;
	}

	/**
	 * @internal A 3D texture of `size` texels along each side, read with a linear filter and
	 * clamped at its edges, filled with `texels`: four bytes per texel of linear 8-bit color, red
	 * fastest, then green, then blue. Color grading tables are such textures.
	 */
	fromVolume(size: number, texels: Uint8Array, call: string): Texture {
		const { core } = this;
		const handle = core.checkGrowth(
			core.glue.createVolumeTexture(size, size, size, TEXTURE_FORMAT_LINEAR),
			call,
		);
		const texture = new Texture(handle, size, size, size, 'rgba8unorm', 'linear', 0, this);
		try {
			this.setData(texture, texels, call);
		} catch (error) {
			texture.destroy();
			throw error;
		}
		return texture;
	}

	/**
	 * @internal A cube texture with faces of `size` texels a side and `levels` mip levels, read
	 * with linear filters within and between levels, filled with `texels`: each level's six faces,
	 * from the largest level, as an environment map's file holds them.
	 */
	fromCube(
		size: number,
		levels: number,
		format: EnvironmentFormat,
		texels: readonly Uint8Array[],
		call: string,
	): Texture {
		const { core } = this;
		const code =
			format === 'rgb9e5ufloat' ? TEXTURE_FORMAT_SHARED_EXPONENT : TEXTURE_FORMAT_HALF_FLOAT;
		const handle = core.checkGrowth(core.glue.createCubeTexture(size, levels, code), call);
		const texture = new Texture(handle, size, size, 6, format, 'linear', 0, this, true);
		try {
			let address = this.texelAddress(texture, size, size, call);
			for (const level of texels) {
				new Uint8Array(core.memory.buffer, address, level.length).set(level);
				address += level.length;
			}
		} catch (error) {
			texture.destroy();
			throw error;
		}
		return texture;
	}

	/**
	 * @internal A cube texture of 8-bit sRGB texels and one level, whose faces come from six
	 * square images of one size, from +X to -Z, each with its first row at the top of its face.
	 * The images upload in the frames after the call.
	 */
	fromCubeImages(faces: readonly ImageBitmap[], call: string): Texture {
		const { core } = this;
		const size = (faces[0] as ImageBitmap).width;
		const handle = core.checkGrowth(
			core.glue.createCubeTexture(size, 1, TEXTURE_FORMAT_SRGB),
			call,
		);
		const texture = new Texture(handle, size, size, 6, 'rgba8unorm', 'srgb', 0, this, true);
		try {
			const first = core.checkGrowth(core.glue.setCubeImages(handle, 0), call, 'a texture');
			for (let face = 0; face < faces.length; face++)
				this.send(first + face, faces[face] as ImageBitmap);
		} catch (error) {
			texture.destroy();
			throw error;
		}
		return texture;
	}

	/**
	 * @internal A cube texture of shared-exponent floats with faces of `size` texels a side and
	 * `levels` mip levels, read with linear filters within and between levels, whose texels a
	 * generator makes on the GPU from `source`: the built-in room, or a panorama, whose texels move
	 * to the thread that draws. It resolves once that thread has loaded the generator's code and
	 * built its pipelines. The next frame then makes every texel in one submit, before it draws, so
	 * no frame draws with the texture before its texels are made.
	 */
	async fromGenerator(
		source: GeneratorSource,
		size: number,
		levels: number,
		call: string,
	): Promise<Texture> {
		const { core } = this;
		const format = TEXTURE_FORMAT_SHARED_EXPONENT;
		const handle = core.checkGrowth(core.glue.createCubeTexture(size, levels, format), call);
		const texture = new Texture(handle, size, size, 6, 'rgb9e5ufloat', 'linear', 0, this, true);
		let id: number;
		try {
			id = core.checkGrowth(core.glue.generateTexture(handle), call, 'a texture');
			this.send(id, source);
		} catch (error) {
			texture.destroy();
			throw error;
		}
		await this.arrived(id);
		return texture;
	}

	/**
	 * Checks the options and makes a texture with no texels yet. `source` says where its texels
	 * come from: images and data have their own defaults, and a file brings `levels` mip levels,
	 * which the GPU never makes.
	 */
	private create(
		width: number,
		height: number,
		depth: number,
		format: AnyTextureFormat,
		options: TextureOptions,
		source: 'image' | 'data' | 'file',
		call: string,
		levels = 1,
	): Texture {
		const image = source === 'image';
		const {
			colorSpace = image ? 'srgb' : 'linear',
			wrap = 'clamp',
			filter = 'linear',
			mipmaps = image,
			anisotropy = 1,
			uvSet = 0,
		} = options;
		const [wrapU, wrapV] = typeof wrap === 'string' ? [wrap, wrap] : wrap;
		if (DEV) {
			if (!COLOR_SPACES[colorSpace as TextureColorSpace])
				throw invalid(call, `got the colorSpace ${quote(colorSpace)}. Use 'srgb' or 'linear'.`);
			if (HDR_FORMATS.has(format) && colorSpace === 'srgb')
				throw invalid(call, `got colorSpace 'srgb' for ${format} texels, which are linear.`);
			if (format === 'rgba16float' && mipmaps)
				throw invalid(call, 'got mipmaps: true for rgba16float data, which has no mip levels.');
			if (!(Number.isInteger(anisotropy) && anisotropy >= 1 && anisotropy <= 16))
				throw invalid(call, `got the anisotropy ${anisotropy}: give a whole number from 1 to 16.`);
			if (uvSet !== 0 && uvSet !== 1) throw invalid(call, `got the uvSet ${uvSet}: give 0 or 1.`);
			checkName(WRAPS, wrapU, 'wrap', call);
			checkName(WRAPS, wrapV, 'wrap', call);
			checkName(FILTERS, filter, 'filter', call);
			const max = this.maxSize;
			if (width > max || height > max)
				throw invalid(
					call,
					`got ${width} x ${height} texels, larger than the ${max} a side that this device's textures hold. Use a smaller image.`,
				);
		}
		const filterCode = FILTERS[filter];
		const { core } = this;
		const handle = core.checkGrowth(
			core.glue.createTexture(
				width,
				height,
				depth,
				FORMAT_CODES[format][colorSpace === 'srgb' ? 1 : 0],
				mipmaps === true,
				levels,
				WRAPS[wrapU],
				WRAPS[wrapV],
				filterCode,
				filterCode,
				filterCode,
				anisotropy,
			),
			call,
		);
		return new Texture(
			handle,
			width,
			height,
			depth,
			format,
			colorSpace,
			uvSet,
			this,
			source === 'file',
		);
	}

	/**
	 * @internal Gives a texture an image, and sends the image under the id the core gave it. An
	 * image of another size gives the texture that size.
	 */
	setImage(texture: Texture, image: ImageBitmap, premultiplied: 0 | 1, call: string): void {
		if (DEV) {
			checkImage(image, call);
			if (texture.depth > 1 || texture.format !== 'rgba8unorm')
				throw invalid(
					call,
					`got an image for a texture of ${texture.depth} layers in ${texture.format}. Images fill textures of one layer in rgba8unorm: update this one with data.`,
				);
		}
		const { width, height } = image;
		const id = this.core.checkGrowth(
			this.core.glue.setTextureImage(
				texture.handle,
				width,
				height,
				premultiplied * TEXTURE_PREMULTIPLIED_ALPHA,
			),
			call,
			'a texture',
		);
		texture.resize(width, height);
		this.send(id, image);
	}

	/** @internal Copies data of the texture's size and format into engine memory for its upload. */
	setData(texture: Texture, data: TextureDataArray, call: string): void {
		const { width, height, depth, format } = texture;
		const values = width * height * depth * 4;
		if (DEV) {
			const half = format === 'rgba16float';
			const fits = half
				? data instanceof Uint16Array || data instanceof Float32Array
				: data instanceof Uint8Array || data instanceof Uint8ClampedArray;
			if (!fits)
				throw invalid(
					call,
					`got a ${data?.constructor?.name ?? typeof data} for ${format} data. Give ${half ? 'a Uint16Array of half floats or a Float32Array' : 'a Uint8Array or a Uint8ClampedArray'}.`,
				);
			if (data.length !== values)
				throw invalid(
					call,
					`got ${data.length} numbers for ${width} x ${height} x ${depth} texels, not ${values}: give four per texel.`,
				);
		}
		const address = this.texelAddress(texture, width, height, call);
		const { buffer } = this.core.memory;
		if (data instanceof Float32Array) toHalfFloats(data, new Uint16Array(buffer, address, values));
		else if (data instanceof Uint16Array) new Uint16Array(buffer, address, values).set(data);
		else new Uint8Array(buffer, address, values).set(data);
	}

	/** @internal */
	bytesOf(texture: Texture): number {
		return this.stat(TEXTURE_STAT_TEXTURE_BYTES, texture.handle);
	}

	/** @internal */
	droppedLevelsOf(texture: Texture): number {
		return this.stat(TEXTURE_STAT_DROPPED_LEVELS, texture.handle);
	}

	/**
	 * @internal Lets the texture memory budget drop the largest mip levels of a texture whose
	 * texels `reload` can load again from its file, at any level.
	 */
	reloadsFrom(texture: Texture, reload: TextureReloader): void {
		if (this.core.glue.setTextureReloadable(texture.handle) === 0)
			this.reloaders.set(texture.handle, { texture, reload });
	}

	/** @internal Forgets a texture's file once the sketch gives it texels of its own. */
	forgetFile(texture: Texture): void {
		this.reloaders.delete(texture.handle);
	}

	/**
	 * @internal Writes texels that bring their own mip levels into a texture, as a load again of a
	 * file without its largest levels does.
	 */
	setTexels(texture: Texture, texels: Uint8Array, call: string): void {
		const address = this.texelAddress(texture, texture.width, texture.height, call);
		new Uint8Array(this.core.memory.buffer, address, texels.length).set(texels);
	}

	/**
	 * @internal Looks for a change of the texture memory budget's work once per frame, and starts
	 * the loads again that the engine asks for. Returns true when levels dropped or came back,
	 * or a load again started, so the quality change handlers run.
	 */
	pollBudget(): boolean {
		const epoch = this.stat(TEXTURE_STAT_BUDGET_EPOCH);
		if (epoch === this.budgetEpoch) return false;
		this.budgetEpoch = epoch;
		this.startReloads();
		return true;
	}

	/** Starts the loads again that the engine asks for, up to `RELOADS_AT_ONCE` at a time. */
	private startReloads(): void {
		const { glue } = this.core;
		while (this.reloading < RELOADS_AT_ONCE) {
			const handle = glue.takeTextureReload();
			if (handle === 0) return;
			const file = this.reloaders.get(handle);
			if (!file) {
				glue.failTextureReload(handle);
				continue;
			}
			const level = this.stat(TEXTURE_STAT_RELOAD_LEVEL, handle);
			const { texture } = file;
			const target = new Texture(
				this.stat(TEXTURE_STAT_RELOAD_TEXTURE, handle),
				Math.max(1, texture.width >> level),
				Math.max(1, texture.height >> level),
				texture.depth,
				texture.format,
				texture.colorSpace,
				texture.uvSet,
				this,
				texture.fromFile,
			);
			this.reloading++;
			file.reload(level, target).then(
				() => this.finishReload(),
				(error: unknown) => {
					// A texture destroyed meanwhile took its hidden texture with it, and an engine that
					// stopped meanwhile took every texture: its core belongs to no sketch any more.
					if (!this.core.stopped && this.reloaders.get(handle) === file) {
						this.reloaders.delete(handle);
						this.core.glue.failTextureReload(handle);
						if (DEV)
							console.warn(
								`The engine could not load a texture's file again, so the texture keeps the mip levels it holds: ${error instanceof Error ? error.message : String(error)}`,
							);
					}
					this.finishReload();
				},
			);
		}
	}

	private finishReload(): void {
		this.reloading--;
		if (!this.core.stopped) this.startReloads();
	}

	/** @internal */
	destroy(texture: Texture): void {
		this.reloaders.delete(texture.handle);
		this.core.checkGrowth(
			this.core.glue.destroyTexture(texture.handle, this.time.frame),
			'texture.destroy',
			'a texture',
			true,
		);
	}

	private stat(field: number, texture = 0): number {
		return this.core.glue.textureStat(field, texture);
	}

	/**
	 * The GPU bytes that every texture holds, with the free layers of their texture arrays. It
	 * counts what the GPU holds already, so it grows as uploads finish.
	 */
	get memoryBytes(): number {
		return this.stat(TEXTURE_STAT_MEMORY_BYTES);
	}

	/**
	 * The widest and tallest texture this device takes: 4096 texels, or less on a WebGL2 device
	 * that allows less.
	 */
	get maxSize(): number {
		return this.stat(TEXTURE_STAT_MAX_SIZE);
	}

	/** @internal The last image id sent to the thread that draws, or 0 before the first. */
	get imagesSent(): number {
		return this.stat(TEXTURE_STAT_IMAGES_SENT);
	}

	/** @internal */
	uploads(): TextureUploads {
		return {
			lastFrameBytes: this.stat(TEXTURE_STAT_LAST_FRAME_BYTES),
			largestFrameBytes: this.stat(TEXTURE_STAT_LARGEST_FRAME_BYTES),
			waiting: this.stat(TEXTURE_STAT_WAITING),
		};
	}

	/**
	 * @internal Sets the texel bytes that one frame may upload, in place of the quality setting's
	 * value until the sketch changes the setting or the preset. Tests take budgets below the
	 * setting's range.
	 */
	setUploadBudget(bytes: number): void {
		this.core.glue.setTextureOption(TEXTURE_OPTION_UPLOAD_BUDGET, bytes);
		this.ownBudget();
	}

	/**
	 * @internal Sets the GPU bytes that textures may take, rounded up to whole KiB, in place of the
	 * quality setting's value until the sketch changes the setting or the preset. Tests take budgets
	 * below the setting's range.
	 */
	setMemoryBudget(bytes: number): void {
		this.core.glue.setTextureOption(TEXTURE_OPTION_MEMORY_BUDGET_KIB, Math.ceil(bytes / 1024));
		this.ownMemory();
	}

	/** @internal The texel bytes that one frame may upload, as the core holds it. */
	get uploadBudget(): number {
		return this.stat(TEXTURE_STAT_UPLOAD_BUDGET);
	}

	/** @internal The anisotropy cap of every texture's sampler, as the core holds it. */
	get maxAnisotropy(): number {
		return this.stat(TEXTURE_STAT_MAX_ANISOTROPY);
	}

	/**
	 * @internal Gives the core the texture settings among `names`: the upload budget, the
	 * anisotropy cap and the memory budget. The others belong to other parts of the engine.
	 */
	applyQuality(settings: QualitySettings, names: readonly QualitySettingName[]): void {
		const { glue } = this.core;
		if (names.includes('uploadBytesPerFrame'))
			glue.setTextureOption(TEXTURE_OPTION_UPLOAD_BUDGET, settings.uploadBytesPerFrame);
		if (names.includes('maxAnisotropy'))
			glue.setTextureOption(TEXTURE_OPTION_MAX_ANISOTROPY, settings.maxAnisotropy);
		if (names.includes('textureMemoryMiB'))
			glue.setTextureOption(TEXTURE_OPTION_MEMORY_BUDGET_KIB, settings.textureMemoryMiB * 1024);
	}
}

/** E1208 from a call, with the details of what it got. */
function invalid(call: string, detail: string): EngineError {
	return new EngineError('E1208', `${call}() ${detail}`);
}

const quote = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value));

/**
 * Throws E1208 unless the image holds pixels: a closed image, or one sent away already, has none.
 * Call it inside `if (DEV)`.
 */
function checkImage(image: ImageBitmap, call: string): void {
	if (!image || image.width === 0 || image.height === 0)
		throw invalid(
			call,
			'got an image without pixels: it was closed, or it went to the GPU already. Decode the image again.',
		);
}

/** Throws E1208 that lists the values when an option names none of them. Call it inside `if (DEV)`. */
function checkName(
	codes: Record<string, number>,
	value: string,
	option: string,
	call: string,
): void {
	if (codes[value] === undefined)
		throw invalid(
			call,
			`got the ${option} ${quote(value)}. Use ${Object.keys(codes).map(quote).join(' or ')}.`,
		);
}
