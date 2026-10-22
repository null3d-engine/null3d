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
	BACKGROUND_VALUE_COUNT,
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
	TEXTURE_STAT_UPLOADING,
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
 * A rectangle of a canvas: the column and row of its top-left texel, counted from the canvas's
 * top-left corner, and how many texels it spans.
 *
 * @category api/textures
 */
export interface CanvasRect {
	/** The left column of the rectangle, from 0 to the canvas's width less one. */
	x: number;
	/** The top row of the rectangle, from 0 to the canvas's height less one. */
	y: number;
	/** Texels across, at least 1 and at most the canvas's width less `x`. */
	width: number;
	/** Texels down, at least 1 and at most the canvas's height less `y`. */
	height: number;
}

/**
 * What `textures.fromCanvas` takes: the options of every texture, and how often the engine reads
 * the canvas.
 *
 * @category api/textures
 */
export interface CanvasTextureOptions extends TextureOptions {
	/**
	 * The most times per second that `texture.refresh` reads the canvas. A refresh that comes
	 * sooner does not read it: the next refresh covers its rectangle too. The default is 0, which
	 * reads the canvas at every call.
	 */
	refreshHz?: number;
}

/**
 * A texture's link to a canvas: where it reads pixels, and the rectangles that still have to
 * upload.
 */
interface CanvasSource {
	readonly context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	readonly width: number;
	readonly height: number;
	readonly refreshHz: number;
	/** The sketch time of the last refresh that read the canvas. */
	lastRefresh: number;
	/** True while a change waits for the next refresh to read the canvas. */
	dirty: boolean;
	/** The change's rectangle in the canvas's coordinates, while `dirty` is true. */
	dirtyLeft: number;
	dirtyTop: number;
	dirtyRight: number;
	dirtyBottom: number;
	/** True while the last read may still wait to upload, with its rectangle. */
	sent: boolean;
	sentLeft: number;
	sentTop: number;
	sentRight: number;
	sentBottom: number;
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
	/** @internal How the texture follows a canvas, for a texture that `textures.fromCanvas` made. */
	canvas?: CanvasSource;

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

	/**
	 * Reads the canvas again and gives the texture its pixels, in the rectangle `rect` or in the
	 * whole canvas. Only the rectangle uploads, in the texture's turn and within the frame's
	 * upload budget, and the rest of the texture keeps its texels. The last row of the canvas is
	 * the texture's first, so the canvas stands upright on a plane as on a page. A refresh that
	 * comes within the texture's `refreshHz` reads nothing: the next one covers its rectangle too.
	 * Returns true when it read the canvas, and false when the refresh rate skipped it or a read
	 * before it still waits to upload. Throws E1208 for a rectangle outside the canvas, and for a
	 * texture that does not follow a canvas. Throws E1101 after `destroy`.
	 */
	refresh(rect?: CanvasRect): boolean {
		if (this.destroyed)
			throw new EngineError(
				'E1101',
				'texture.refresh() was called on a texture that texture.destroy() destroyed.',
			);
		return this.textures.refresh(this, rect);
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
		this.canvas = undefined;
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
		private readonly time: { readonly frame: number; readonly now: number },
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
	 * A texture that follows a canvas, such as the `OffscreenCanvas` that the sketch draws a score,
	 * a map or a video frame on. The canvas's last row goes to v = 0, the bottom of a plane, so the
	 * canvas stands upright on a plane as on a page. Its texels upload as any image's do.
	 * `texture.refresh` then gives the texture the canvas's new pixels, and only those of the
	 * rectangle that changed. Throws E1208 for a canvas without a 2D context, or with no pixels.
	 * Call `getContext('2d', { willReadFrequently: true })` on the canvas, so the browser keeps its
	 * pixels where the engine reads them.
	 */
	fromCanvas(
		canvas: OffscreenCanvas | HTMLCanvasElement,
		options: CanvasTextureOptions = {},
	): Texture {
		const call = 'textures.fromCanvas';
		const { refreshHz = 0 } = options;
		if (DEV) {
			if (!canvas || !(canvas.width >= 1) || !(canvas.height >= 1))
				throw invalid(call, 'got a canvas with no pixels. Give it a width and a height first.');
			if (!(Number.isFinite(refreshHz) && refreshHz >= 0))
				throw invalid(call, `got the refreshHz ${refreshHz}: give 0 or a positive number.`);
		}
		const context = canvas.getContext('2d') as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!context)
			throw invalid(
				call,
				'got a canvas without a 2D context. Call getContext("2d") on the canvas and draw into it first.',
			);
		const { width, height } = canvas;
		const texture = this.create(width, height, 1, 'rgba8unorm', options, 'image', call);
		texture.canvas = {
			context,
			width,
			height,
			refreshHz: refreshHz > 0 ? refreshHz : 0,
			lastRefresh: Number.NEGATIVE_INFINITY,
			dirty: false,
			dirtyLeft: 0,
			dirtyTop: 0,
			dirtyRight: 0,
			dirtyBottom: 0,
			sent: false,
			sentLeft: 0,
			sentTop: 0,
			sentRight: 0,
			sentBottom: 0,
		};
		this.setData(texture, this.canvasRows(context, 0, 0, width, height), call);
		return texture;
	}

	/** @internal Reads a canvas's rectangle, with its rows turned over so that the last comes first. */
	private canvasRows(
		context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		x: number,
		y: number,
		width: number,
		height: number,
	): Uint8Array {
		const image = context.getImageData(x, y, width, height);
		const row = width * 4;
		const rows = new Uint8Array(row * height);
		rows.set(image.data);
		turnRows(rows, row, height);
		return rows;
	}

	/**
	 * @internal Gives a canvas texture the pixels of the rectangle that changed, or of the whole
	 * canvas when the texture holds no texels yet. The rectangle's upload covers the changes of
	 * every refresh that did not read the canvas, and of the last one while it still waits.
	 */
	refresh(texture: Texture, rect?: CanvasRect): boolean {
		const call = 'texture.refresh';
		const source = texture.canvas;
		if (!source)
			throw invalid(
				call,
				'got a texture that does not follow a canvas. Make it with textures.fromCanvas.',
			);
		// The rectangle of the canvas that changed, in the canvas's coordinates.
		let [left, top, right, bottom] = rect
			? [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]
			: [0, 0, source.width, source.height];
		if (DEV) {
			const whole =
				Number.isInteger(left) &&
				Number.isInteger(top) &&
				Number.isInteger(right) &&
				Number.isInteger(bottom) &&
				left >= 0 &&
				top >= 0 &&
				right > left &&
				bottom > top &&
				right <= source.width &&
				bottom <= source.height;
			if (!whole)
				throw invalid(
					call,
					`got the rectangle ${left}, ${top}, ${right - left} x ${bottom - top}. Give whole numbers inside the canvas's ${source.width} x ${source.height} texels.`,
				);
		} else {
			// A release build reads the part of the rectangle that the canvas holds.
			left = Math.max(0, Math.min(source.width, Math.trunc(left)));
			top = Math.max(0, Math.min(source.height, Math.trunc(top)));
			right = Math.max(left, Math.min(source.width, Math.trunc(right)));
			bottom = Math.max(top, Math.min(source.height, Math.trunc(bottom)));
			if (right === left || bottom === top) return false;
		}
		// Every change joins the rectangle of the next read, so none is lost.
		if (source.dirty) {
			source.dirtyLeft = Math.min(source.dirtyLeft, left);
			source.dirtyTop = Math.min(source.dirtyTop, top);
			source.dirtyRight = Math.max(source.dirtyRight, right);
			source.dirtyBottom = Math.max(source.dirtyBottom, bottom);
		} else {
			source.dirty = true;
			source.dirtyLeft = left;
			source.dirtyTop = top;
			source.dirtyRight = right;
			source.dirtyBottom = bottom;
		}
		const now = this.time.now;
		if (source.refreshHz > 0 && now - source.lastRefresh < 1 / source.refreshHz) return false;
		if (source.sent && !this.uploading(texture)) source.sent = false;
		// True while the texture still waits for a rectangle that a read before this one sent.
		// Another rectangle cannot join it, so this read waits and the next one covers both.
		const pending = source.sent;
		// The read covers every change since the last read, and a read still waiting to upload
		// keeps its rectangle in the next read.
		left = source.dirtyLeft;
		top = source.dirtyTop;
		right = source.dirtyRight;
		bottom = source.dirtyBottom;
		if (source.sent) {
			left = Math.min(left, source.sentLeft);
			top = Math.min(top, source.sentTop);
			right = Math.max(right, source.sentRight);
			bottom = Math.max(bottom, source.sentBottom);
		}
		source.lastRefresh = now;
		source.dirty = false;
		source.sent = false;
		const width = right - left;
		const height = bottom - top;
		// A whole canvas fills a texture that waits for all its texels too.
		if (left === 0 && top === 0 && width === source.width && height === source.height) {
			this.setData(texture, this.canvasRows(source.context, left, top, width, height), call);
			return true;
		}
		if (this.setRegion(texture, source, left, top, width, height, call)) {
			source.sent = true;
			source.sentLeft = left;
			source.sentTop = top;
			source.sentRight = right;
			source.sentBottom = bottom;
		} else if (pending) {
			// The texture still waits for the rectangle read before this one, so it cannot take
			// another yet. Both rectangles stay for the next read, rather than the whole canvas
			// going in place of a rectangle that is already on its way.
			source.dirty = true;
			source.dirtyLeft = left;
			source.dirtyTop = top;
			source.dirtyRight = right;
			source.dirtyBottom = bottom;
			source.sent = true;
			source.sentLeft = left;
			source.sentTop = top;
			source.sentRight = right;
			source.sentBottom = bottom;
			return false;
		} else {
			// The rectangle cannot fill the rest of the texture, so the whole canvas does.
			this.setData(
				texture,
				this.canvasRows(source.context, 0, 0, source.width, source.height),
				call,
			);
		}
		return true;
	}

	/**
	 * @internal Copies a rectangle of the canvas into engine memory for a partial upload. Returns
	 * false when the texture still waits for all its texels: the rectangle cannot fill the rest, so
	 * the caller sends the whole canvas instead.
	 */
	private setRegion(
		texture: Texture,
		source: CanvasSource,
		x: number,
		top: number,
		width: number,
		height: number,
		call: string,
	): boolean {
		// An update of another size left the texture with a size that the canvas's rectangle does
		// not fit, so the whole canvas fills it again.
		if (texture.width !== source.width || texture.height !== source.height) return false;
		const { core } = this;
		// The texture's rows count from the bottom, and the canvas's from the top.
		const y = source.height - top - height;
		const address = core.glue.setTextureRegion(texture.handle, x, y, width, height);
		if (address === 0) {
			if (core.glue.lastErrorCode() !== 0) core.fail(call, 'a texture');
			return false;
		}
		core.refresh();
		const row = width * 4;
		const view = core.view(Uint8Array, address, row * height);
		const image = source.context.getImageData(x, top, width, height);
		view.set(image.data);
		turnRows(view, row, height);
		return true;
	}

	/** @internal True while a texture waits for texels to upload. */
	private uploading(texture: Texture): boolean {
		return this.core.glue.textureStat(TEXTURE_STAT_UPLOADING, texture.handle) !== 0;
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
		this.core.view(Uint8Array, address, texels.length).set(texels);
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
		return this.fromVolumeData(size, size, size, 'rgba8unorm', texels, call);
	}

	/**
	 * @internal A 3D texture of `width` x `height` x `depth` texels in `format`, read with a linear
	 * filter and clamped at its edges, filled with `texels`: four numbers per texel, in rows from
	 * the bottom up, slice after slice. Light probe grids are such textures.
	 */
	fromVolumeData(
		width: number,
		height: number,
		depth: number,
		format: TextureFormat,
		texels: TextureDataArray,
		call: string,
	): Texture {
		const { core } = this;
		const handle = core.checkGrowth(
			core.glue.createVolumeTexture(width, height, depth, FORMAT_CODES[format][0]),
			call,
		);
		const texture = new Texture(handle, width, height, depth, format, 'linear', 0, this);
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
				core.view(Uint8Array, address, level.length).set(level);
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
	 * @internal Sends the generator that runs reflection probes' filters under image id `id`, which
	 * the engine core gave, so the thread that draws loads the generators' code.
	 */
	sendProbeGenerator(id: number): void {
		this.send(id, 'probes');
	}

	/**
	 * @internal Makes a cube texture that `fromGenerator` made for the sky a map of the scene's
	 * sky, which refreshes in `stages` stages, after `defaults` wrote the sky's defaults into the
	 * background's block of values where no sky background wrote its own.
	 */
	addSkyMap(
		texture: Texture,
		stages: number,
		call: string,
		defaults: (values: Float32Array) => void,
	): void {
		const { core } = this;
		defaults(core.f32(core.glue.backgroundValues(), BACKGROUND_VALUE_COUNT));
		core.check(core.glue.addSkyMap(texture.handle, stages), call, 'a texture', true);
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
		const { core } = this;
		if (data instanceof Float32Array) toHalfFloats(data, core.view(Uint16Array, address, values));
		else if (data instanceof Uint16Array) core.view(Uint16Array, address, values).set(data);
		else core.view(Uint8Array, address, values).set(data);
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
		this.core.view(Uint8Array, address, texels.length).set(texels);
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
 * Turns a rectangle's rows over in place, so that its last row comes first. A canvas counts rows
 * from its top, and a texture counts them from v = 0, the bottom of a plane.
 */
function turnRows(rows: Uint8Array, row: number, height: number): void {
	for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
		const a = top * row;
		const b = bottom * row;
		for (let k = 0; k < row; k++) {
			const texel = rows[a + k] as number;
			rows[a + k] = rows[b + k] as number;
			rows[b + k] = texel;
		}
	}
}

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
