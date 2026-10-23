import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_NEAREST,
	TEXTURE_FORMAT_HALF_FLOAT,
	TEXTURE_FORMAT_LINEAR,
	TEXTURE_FORMAT_SHARED_EXPONENT,
	TEXTURE_FORMAT_SRGB,
	TEXTURE_PREMULTIPLIED_ALPHA,
	TEXTURE_STAT_BUDGET_EPOCH,
	TEXTURE_STAT_MAX_SIZE,
	TEXTURE_STAT_RELOAD_LEVEL,
	TEXTURE_STAT_RELOAD_TEXTURE,
	TEXTURE_STAT_TEXTURE_BYTES,
	TEXTURE_STAT_UPLOADING,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_MIRROR,
	TEXTURE_WRAP_REPEAT,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import type { GeneratorSource } from '../shared/images';
import { VIDEO_FOLLOW } from '../shared/videos';
import { CoreMemory } from './memory';
import { type TextureOptions, Textures } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A decoded image as the tests need one: a size, and a close that empties it. */
function image(width = 32, height = 16): ImageBitmap {
	const bitmap = {
		width,
		height,
		close() {
			bitmap.width = 0;
			bitmap.height = 0;
		},
	};
	return bitmap as unknown as ImageBitmap;
}

/** Where the fake core puts texture data in its memory. */
const DATA_ADDRESS = 1024;
/** Where the fake core puts a rectangle of new texels in its memory. */
const REGION_ADDRESS = DATA_ADDRESS + 4096;

/**
 * A core that records its texture calls, the images that went to the thread that draws, and the
 * data calls, with a largest texture of 64 texels. `arrived` stands for the wait until the thread
 * that draws holds an image or generator.
 */
function fakeCore(
	arrived?: (id: number) => Promise<void>,
	clock: { frame: number; now: number } = { frame: 3, now: 0 },
	page: (type: string, data?: unknown) => void = () => {},
) {
	const created: number[][] = [];
	const images: number[][] = [];
	const data: number[][] = [];
	const regions: number[][] = [];
	const destroyed: number[] = [];
	const sent: [number, ImageBitmap | GeneratorSource][] = [];
	/** The messages that the sketch sent to the page. */
	const posts: [string, unknown][] = [];
	let nextImage = 0;
	/** True while a texture of the fake core waits for its texels. */
	let uploading = false;
	/** False while the fake core has no texels of a texture, as before its first upload. */
	let regionReady = true;
	const glue = {
		createTexture: (...args: (number | boolean)[]) => {
			created.push(args.map(Number));
			return 7;
		},
		createCubeTexture: (...args: number[]) => {
			created.push(args);
			return 9;
		},
		setTextureImage: (...args: number[]) => {
			images.push(args);
			return ++nextImage;
		},
		generateTexture: (...args: number[]) => {
			images.push(args);
			return ++nextImage;
		},
		setTextureData: (...args: number[]) => {
			data.push(args);
			return DATA_ADDRESS;
		},
		setTextureRegion: (...args: number[]) => {
			regions.push(args);
			return regionReady ? REGION_ADDRESS : 0;
		},
		textureStat: (field: number, texture: number) =>
			field === TEXTURE_STAT_TEXTURE_BYTES
				? texture * 100
				: field === TEXTURE_STAT_MAX_SIZE
					? 64
					: field === TEXTURE_STAT_UPLOADING
						? Number(uploading)
						: 0,
		destroyTexture: (texture: number) => {
			destroyed.push(texture);
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	} as unknown as CoreGlue;
	const memory = new WebAssembly.Memory({ initial: 1 });
	const core = new CoreMemory(glue, memory);
	const send = (id: number, bitmap: ImageBitmap | GeneratorSource) => sent.push([id, bitmap]);
	const textures = new Textures(
		core,
		send,
		clock,
		0,
		undefined,
		arrived,
		false,
		false,
		undefined,
		(type, message) => {
			posts.push([type, message]);
			page(type, message);
		},
	);
	return {
		textures,
		created,
		images,
		data,
		regions,
		destroyed,
		sent,
		posts,
		memory,
		clock,
		setUploading: (value: boolean) => {
			uploading = value;
		},
		setRegionReady: (value: boolean) => {
			regionReady = value;
		},
	};
}

/** RGBA8 pixels of a canvas, with `color` at each texel, from its top row to its last. */
function canvasPixels(width: number, height: number, color: (x: number, y: number) => number[]) {
	return Uint8ClampedArray.from(
		Array.from({ length: width * height }, (_, k) =>
			color(k % width, Math.floor(k / width)),
		).flat(),
	);
}

/**
 * A canvas as `textures.fromCanvas` reads one: its pixels, from its top row to its last, and a 2D
 * context that returns a rectangle of them as `getImageData` does.
 */
function canvas(width: number, height: number, color: (x: number, y: number) => number[]) {
	const pixels = canvasPixels(width, height, color);
	const context = {
		getImageData(x: number, y: number, w: number, h: number) {
			const data = new Uint8ClampedArray(w * h * 4);
			for (let row = 0; row < h; row++)
				data.set(
					pixels.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4),
					row * w * 4,
				);
			return { data, width: w, height: h };
		},
	};
	return { width, height, getContext: () => context } as unknown as OffscreenCanvas;
}

/** The bytes at an address of the fake core's memory. */
function memoryBytes(memory: WebAssembly.Memory, address: number, length: number): number[] {
	return [...new Uint8Array(memory.buffer, address, length)];
}

/**
 * The codes that `createTexture` got after the size and depth, for options as three.js's defaults:
 * the format, mip levels that the GPU makes, one level of texels, then the sampler's codes.
 */
const DEFAULT_CODES = [
	TEXTURE_FORMAT_SRGB,
	1,
	1,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_LINEAR,
	1,
];

describe('textures.fromImageBitmap', () => {
	test('asks the core for a texture with the options as codes, and sends the image under its id', () => {
		const { textures, created, images, sent } = fakeCore();
		const picture = image();
		const texture = textures.fromImageBitmap(picture);
		// sRGB, mip levels, clamped, linear filters and no anisotropy, as three.js's defaults.
		expect(created[0]).toEqual([32, 16, 1, ...DEFAULT_CODES]);
		expect(images[0]).toEqual([7, 32, 16, 0]);
		expect(sent).toEqual([[1, picture]]);
		expect([texture.width, texture.height, texture.depth, texture.bytes]).toEqual([32, 16, 1, 700]);
		expect([texture.format, texture.colorSpace, texture.uvSet]).toEqual(['rgba8unorm', 'srgb', 0]);
		const options: TextureOptions = {
			colorSpace: 'linear',
			wrap: ['repeat', 'mirror'],
			filter: 'nearest',
			mipmaps: false,
			anisotropy: 8,
			uvSet: 1,
		};
		const data = textures.fromImageBitmap(image(), options);
		expect(created[1]).toEqual([
			32,
			16,
			1,
			TEXTURE_FORMAT_LINEAR,
			0,
			1,
			TEXTURE_WRAP_REPEAT,
			TEXTURE_WRAP_MIRROR,
			TEXTURE_FILTER_NEAREST,
			TEXTURE_FILTER_NEAREST,
			TEXTURE_FILTER_NEAREST,
			8,
		]);
		expect([data.colorSpace, data.uvSet]).toEqual(['linear', 1]);
		expect(sent.map(([id]) => id)).toEqual([1, 2]);
	});

	test('throws E1208 for an image without pixels or too large, and for options it does not know', () => {
		const { textures, created } = fakeCore();
		const closed = image();
		closed.close();
		const fails = (make: () => unknown, message: string) => {
			expect(make).toThrow('E1208');
			expect(make).toThrow(message);
		};
		fails(() => textures.fromImageBitmap(closed), 'got an image without pixels');
		fails(
			() => textures.fromImageBitmap(image(128, 16)),
			'got 128 x 16 texels, larger than the 64 a side',
		);
		fails(
			() => textures.fromImageBitmap(image(), { anisotropy: 0 }),
			'give a whole number from 1 to 16',
		);
		fails(() => textures.fromImageBitmap(image(), { anisotropy: 2.5 }), 'anisotropy 2.5');
		const wrap = 'tile' as unknown as 'clamp';
		fails(
			() => textures.fromImageBitmap(image(), { wrap }),
			"got the wrap 'tile'. Use 'clamp' or 'repeat' or 'mirror'.",
		);
		const filter = 'cubic' as unknown as 'linear';
		fails(() => textures.fromImageBitmap(image(), { filter }), "got the filter 'cubic'");
		const colorSpace = 'p3' as unknown as 'srgb';
		fails(() => textures.fromImageBitmap(image(), { colorSpace }), "got the colorSpace 'p3'");
		const uvSet = 2 as unknown as 0;
		fails(() => textures.fromImageBitmap(image(), { uvSet }), 'got the uvSet 2: give 0 or 1');
		expect(created).toEqual([]);
	});
});

describe('textures.fromCanvas and texture.refresh', () => {
	/** A texel whose red channel names its place, so a test can tell the rows and columns apart. */
	const place = (x: number, y: number) => [y * 10 + x + 1, 0, 0, 255];

	test('makes a texture of the canvas, with its rows turned over so it stands upright', () => {
		const { textures, created, data, memory } = fakeCore();
		const drawn = canvas(2, 2, place);
		const texture = textures.fromCanvas(drawn);
		expect(created[0]).toEqual([2, 2, 1, ...DEFAULT_CODES]);
		expect(data).toEqual([[7, 2, 2]]);
		// The canvas's last row comes first, as v = 0 is the bottom of a plane.
		expect(memoryBytes(memory, DATA_ADDRESS, 16)).toEqual([
			11, 0, 0, 255, 12, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255,
		]);
		expect([texture.width, texture.height, texture.format]).toEqual([2, 2, 'rgba8unorm']);
	});

	test('refreshes only the rectangle that changed, with its rows turned over', () => {
		const { textures, data, regions, memory } = fakeCore();
		const texture = textures.fromCanvas(canvas(4, 4, place));
		texture.refresh({ x: 1, y: 1, width: 2, height: 2 });
		// The canvas's rectangle rows 1 and 2 are texture rows 1 and 2, counted from the bottom.
		expect(regions).toEqual([[7, 1, 1, 2, 2]]);
		expect(data.length).toBe(1);
		expect(memoryBytes(memory, REGION_ADDRESS, 16)).toEqual([
			22, 0, 0, 255, 23, 0, 0, 255, 12, 0, 0, 255, 13, 0, 0, 255,
		]);
	});

	test('refreshes the whole canvas when no rectangle is given', () => {
		const { textures, data, regions, memory } = fakeCore();
		const texture = textures.fromCanvas(canvas(2, 1, place));
		texture.refresh();
		expect(regions).toEqual([]);
		expect(data).toEqual([
			[7, 2, 1],
			[7, 2, 1],
		]);
		expect(memoryBytes(memory, DATA_ADDRESS, 8)).toEqual([1, 0, 0, 255, 2, 0, 0, 255]);
	});

	test('refreshes no faster than the texture says, and covers every rectangle it skipped', () => {
		const { textures, regions, clock, setUploading } = fakeCore();
		const texture = textures.fromCanvas(canvas(8, 8, place), { refreshHz: 30 });
		expect(regions.length).toBe(0);
		clock.now = 1;
		expect(texture.refresh({ x: 0, y: 0, width: 2, height: 2 })).toBe(true);
		expect(regions.length).toBe(1);
		// A refresh that comes too soon changes only the rectangle that the next one covers.
		clock.now = 1.01;
		expect(texture.refresh({ x: 5, y: 5, width: 2, height: 2 })).toBe(false);
		expect(regions.length).toBe(1);
		// A refresh still waiting to upload is read again with the next one's rectangle.
		setUploading(true);
		clock.now = 2;
		expect(texture.refresh({ x: 4, y: 4, width: 2, height: 2 })).toBe(true);
		expect(regions.length).toBe(2);
		expect(regions[1]).toEqual([7, 0, 1, 7, 7]);
	});

	test('sends the whole canvas when the texture holds no texels yet', () => {
		const { textures, data, regions, setRegionReady, memory } = fakeCore();
		const texture = textures.fromCanvas(canvas(4, 4, place));
		setRegionReady(false);
		texture.refresh({ x: 1, y: 1, width: 2, height: 2 });
		expect(regions).toEqual([[7, 1, 1, 2, 2]]);
		expect(data.length).toBe(2);
		expect(memoryBytes(memory, DATA_ADDRESS, 4)).toEqual([31, 0, 0, 255]);
	});

	test('waits with a rectangle that is on its way instead of sending the whole canvas', () => {
		const { textures, data, regions, clock, setUploading, setRegionReady } = fakeCore();
		const texture = textures.fromCanvas(canvas(8, 8, place));
		expect(data.length).toBe(1);
		clock.now = 1;
		expect(texture.refresh({ x: 1, y: 1, width: 2, height: 2 })).toBe(true);
		// The rectangle waits to upload, so the next read cannot join it. It keeps both for the
		// read after, and never sends the whole canvas in their place.
		setUploading(true);
		setRegionReady(false);
		clock.now = 2;
		expect(texture.refresh({ x: 5, y: 5, width: 2, height: 2 })).toBe(false);
		expect(data.length).toBe(1);
		// The upload lands, and the next read covers the change it waited with.
		setUploading(false);
		setRegionReady(true);
		clock.now = 3;
		expect(texture.refresh({ x: 6, y: 6, width: 1, height: 1 })).toBe(true);
		expect(data.length).toBe(1);
		expect(regions.at(-1)).toEqual([7, 1, 1, 6, 6]);
	});

	test('throws E1208 for a texture that follows no canvas, and for a rectangle outside it', () => {
		const { textures, created } = fakeCore();
		const plain = textures.fromData({ width: 1, height: 1, data: new Uint8Array(4) });
		expect(() => plain.refresh()).toThrow('E1208');
		expect(() => plain.refresh()).toThrow('does not follow a canvas');
		const texture = textures.fromCanvas(canvas(4, 4, place));
		for (const rect of [
			{ x: 3, y: 0, width: 2, height: 1 },
			{ x: -1, y: 0, width: 1, height: 1 },
			{ x: 0, y: 0, width: 0, height: 1 },
			{ x: 0.5, y: 0, width: 1, height: 1 },
		])
			expect(() => texture.refresh(rect)).toThrow('inside the canvas');
		expect(created.length).toBe(2);
	});

	test('throws E1208 for a canvas without a 2D context, and for a bad refresh rate', () => {
		const { textures, created } = fakeCore();
		const bare = { width: 4, height: 4, getContext: () => null } as unknown as OffscreenCanvas;
		expect(() => textures.fromCanvas(bare)).toThrow('without a 2D context');
		expect(() => textures.fromCanvas(canvas(4, 4, place), { refreshHz: -1 })).toThrow(
			'give 0 or a positive number',
		);
		expect(created).toEqual([]);
	});

	test('throws E1101 after destroy', () => {
		const { textures } = fakeCore();
		const texture = textures.fromCanvas(canvas(2, 2, place));
		texture.destroy();
		expect(() => texture.refresh()).toThrow('E1101');
	});
});

describe('textures.fromVideo', () => {
	test("makes a texture that waits for the page, and asks for the video's frames", () => {
		const { textures, created, posts } = fakeCore();
		const texture = textures.fromVideo('intro');
		// The first frame gives the texture its size, so it starts at one texel.
		expect(created).toEqual([[1, 1, 1, ...DEFAULT_CODES]]);
		expect(posts).toEqual([[VIDEO_FOLLOW, { name: 'intro', follow: true }]]);
		expect(texture.video).toEqual({ name: 'intro' });
	});

	test('uploads each frame that the page sends, and the frame gives the texture its size', () => {
		const { textures, created, images, sent } = fakeCore();
		const texture = textures.fromVideo('intro');
		const first = image(512, 288);
		textures.receiveVideoFrame({ name: 'intro', image: first });
		expect(images).toEqual([[7, 512, 288, 0]]);
		expect(sent).toEqual([[1, first]]);
		expect([texture.width, texture.height]).toEqual([512, 288]);
		const second = image(512, 288);
		textures.receiveVideoFrame({ name: 'intro', image: second });
		// A frame of the same size goes into the same texture, with no new texture for it.
		expect(created.length).toBe(1);
		expect(sent).toEqual([
			[1, first],
			[2, second],
		]);
	});

	test('drops a frame that comes while the one before it uploads, and closes it', () => {
		const { textures, images, setUploading } = fakeCore();
		textures.fromVideo('intro');
		textures.receiveVideoFrame({ name: 'intro', image: image(64, 64) });
		setUploading(true);
		const dropped = image(64, 64);
		textures.receiveVideoFrame({ name: 'intro', image: dropped });
		expect(images.length).toBe(1);
		// A closed image has no pixels, which the next test can see.
		expect([dropped.width, dropped.height]).toEqual([0, 0]);
		// The upload lands, and the next frame goes in its turn.
		setUploading(false);
		textures.receiveVideoFrame({ name: 'intro', image: image(64, 64) });
		expect(images.length).toBe(2);
	});

	test('closes a frame for a video that no texture follows', () => {
		const { textures, images, posts } = fakeCore();
		const frame = image(64, 64);
		textures.receiveVideoFrame({ name: 'gone', image: frame });
		expect(images).toEqual([]);
		expect(posts).toEqual([]);
		expect(frame.width).toBe(0);
	});

	test("stops the page's frames once the texture goes", () => {
		const { textures, posts } = fakeCore();
		const texture = textures.fromVideo('intro');
		texture.destroy();
		expect(posts).toEqual([
			[VIDEO_FOLLOW, { name: 'intro', follow: true }],
			[VIDEO_FOLLOW, { name: 'intro', follow: false }],
		]);
		const late = image(64, 64);
		textures.receiveVideoFrame({ name: 'intro', image: late });
		expect(late.width).toBe(0);
	});

	test('takes a name again once the texture that followed it goes', () => {
		const { textures, created, posts } = fakeCore();
		textures.fromVideo('intro').destroy();
		textures.fromVideo('intro');
		expect(created.length).toBe(2);
		expect(posts.at(-1)).toEqual([VIDEO_FOLLOW, { name: 'intro', follow: true }]);
	});

	test('throws E1208 for a name another texture follows, and for a name without characters', () => {
		const { textures, created } = fakeCore();
		textures.fromVideo('intro');
		expect(() => textures.fromVideo('intro')).toThrow('which a texture follows already');
		expect(() => textures.fromVideo('')).toThrow("got '' as the video");
		expect(created.length).toBe(1);
	});
});

describe('textures.fromGenerator', () => {
	test('makes a shared-exponent cube, sends the generator under its id, and waits for it to arrive', async () => {
		let arrive = () => {};
		const waited: number[] = [];
		const { textures, created, images, sent } = fakeCore((id) => {
			waited.push(id);
			return new Promise((resolve) => {
				arrive = resolve;
			});
		});
		let made = false;
		const making = textures.fromGenerator('room', 256, 6, 'assets.builtinEnvironment');
		void making.then(() => {
			made = true;
		});
		expect(created).toEqual([[256, 6, TEXTURE_FORMAT_SHARED_EXPONENT]]);
		expect(images).toEqual([[9]]);
		expect(sent).toEqual([[1, 'room']]);
		expect(waited).toEqual([1]);
		await Promise.resolve();
		expect(made).toBe(false);
		arrive();
		const texture = await making;
		expect([texture.width, texture.depth, texture.format]).toEqual([256, 6, 'rgb9e5ufloat']);
	});
});

describe('textures.fromData', () => {
	test('writes bytes into engine memory for their upload, as linear data without mip levels', () => {
		const { textures, created, data, memory } = fakeCore();
		const bytes = Uint8Array.from({ length: 2 * 2 * 3 * 4 }, (_, k) => k);
		const texture = textures.fromData({ width: 2, height: 2, depth: 3, data: bytes });
		expect(created[0]).toEqual([2, 2, 3, TEXTURE_FORMAT_LINEAR, 0, ...DEFAULT_CODES.slice(2)]);
		expect(data[0]).toEqual([7, 2, 2]);
		expect([...new Uint8Array(memory.buffer, DATA_ADDRESS, bytes.length)]).toEqual([...bytes]);
		expect([texture.depth, texture.format, texture.colorSpace]).toEqual([
			3,
			'rgba8unorm',
			'linear',
		]);
		textures.fromData({
			width: 1,
			height: 1,
			data: new Uint8ClampedArray(4),
			colorSpace: 'srgb',
			mipmaps: true,
		});
		expect(created[1]?.slice(3, 5)).toEqual([TEXTURE_FORMAT_SRGB, 1]);
	});

	test('stores rgba16float data as half floats, from 16-bit words or 32-bit floats', () => {
		const { textures, created, memory } = fakeCore();
		textures.fromData({
			width: 1,
			height: 1,
			format: 'rgba16float',
			data: new Float32Array([1, -2, 0.5, 65504]),
		});
		expect(created[0]?.slice(3, 5)).toEqual([TEXTURE_FORMAT_HALF_FLOAT, 0]);
		const halves = new Uint16Array(memory.buffer, DATA_ADDRESS, 4);
		expect([...halves]).toEqual([0x3c00, 0xc000, 0x3800, 0x7bff]);
		textures.fromData({
			width: 1,
			height: 1,
			format: 'rgba16float',
			data: new Uint16Array([1, 2, 3, 4]),
		});
		expect([...halves]).toEqual([1, 2, 3, 4]);
	});

	test('throws E1208 for data that does not fit its size and format', () => {
		const { textures, destroyed } = fakeCore();
		const fails = (texture: Parameters<Textures['fromData']>[0], message: string) => {
			expect(() => textures.fromData(texture)).toThrow('E1208');
			expect(() => textures.fromData(texture)).toThrow(message);
		};
		const four = new Uint8Array(4);
		fails({ width: 0, height: 1, data: four }, 'got the width 0: give a whole number from 1 to 64');
		fails({ width: 1, height: 1.5, data: four }, 'the height 1.5');
		fails(
			{ width: 1, height: 1, depth: 257, data: four },
			'depth 257: give a whole number from 1 to 256',
		);
		const format = 'r8unorm' as unknown as 'rgba8unorm';
		fails({ width: 1, height: 1, format, data: four }, "got the format 'r8unorm'");
		fails(
			{ width: 2, height: 2, data: new Uint8Array(12) },
			'got 12 numbers for 2 x 2 x 1 texels, not 16',
		);
		fails(
			{ width: 1, height: 1, data: new Float32Array(4) },
			'got a Float32Array for rgba8unorm data. Give a Uint8Array or a Uint8ClampedArray',
		);
		fails(
			{ width: 1, height: 1, format: 'rgba16float', data: four },
			'Give a Uint16Array of half floats or a Float32Array',
		);
		fails(
			{ width: 1, height: 1, format: 'rgba16float', colorSpace: 'srgb', data: new Uint16Array(4) },
			"got colorSpace 'srgb' for rgba16float texels, which are linear",
		);
		fails(
			{ width: 1, height: 1, format: 'rgba16float', mipmaps: true, data: new Uint16Array(4) },
			'got mipmaps: true for rgba16float data',
		);
		// A texture whose data does not fit is destroyed again.
		expect(destroyed.length).toBeGreaterThan(0);
	});
});

describe('texture.update and destroy', () => {
	test('an image may bring a new size; data must fit the texture', () => {
		const { textures, images, data, sent, destroyed } = fakeCore();
		const texture = textures.fromImageBitmap(image());
		const next = image(8, 4);
		texture.update(next);
		expect(sent.at(-1)).toEqual([2, next]);
		expect(images.at(-1)).toEqual([7, 8, 4, 0]);
		expect([texture.width, texture.height]).toEqual([8, 4]);
		texture.update(new Uint8Array(8 * 4 * 4));
		expect(data.at(-1)).toEqual([7, 8, 4]);
		expect(() => texture.update(new Uint8Array(4))).toThrow('E1208');
		const layers = textures.fromData({ width: 1, height: 1, depth: 2, data: new Uint8Array(8) });
		expect(() => layers.update(image(1, 1))).toThrow(
			'Images fill textures of one layer in rgba8unorm',
		);
		texture.destroy();
		expect(destroyed).toEqual([7]);
	});

	test('an image from loadTexture keeps its premultiplied flag', () => {
		const { textures, images } = fakeCore();
		textures.fromImage(image(), {}, 1, 'assets.loadTexture');
		expect(images[0]).toEqual([7, 32, 16, TEXTURE_PREMULTIPLIED_ALPHA]);
	});
});

describe('loads of textures again for the texture memory budget', () => {
	/** A core whose texture budget asks the page to load `asked` textures again. */
	function budgetCore(asked: number[]) {
		let next = 10;
		let epoch = 0;
		const reloadable: number[] = [];
		const failed: number[] = [];
		const glue = {
			createTexture: () => next++,
			setTextureImage: () => 1,
			setTextureReloadable: (texture: number) => {
				reloadable.push(texture);
				return 0;
			},
			takeTextureReload: () => asked.shift() ?? 0,
			failTextureReload: (texture: number) => failed.push(texture),
			textureStat: (field: number, texture: number) =>
				field === TEXTURE_STAT_BUDGET_EPOCH
					? epoch
					: field === TEXTURE_STAT_RELOAD_LEVEL
						? 1
						: field === TEXTURE_STAT_RELOAD_TEXTURE
							? texture + 100
							: field === TEXTURE_STAT_MAX_SIZE
								? 4096
								: 0,
			lastErrorCode: () => 0,
			lastErrorDetail: () => 0,
		} as unknown as CoreGlue;
		const core = new CoreMemory(glue, new WebAssembly.Memory({ initial: 1 }));
		const textures = new Textures(core, () => {}, { frame: 3, now: 0 }, 0);
		return { textures, reloadable, failed, core, bump: () => epoch++ };
	}

	test('start two at a time when the budget changes, each into a hidden texture of its size', async () => {
		const asked: number[] = [];
		const { textures, reloadable, bump } = budgetCore(asked);
		const calls: [number, number, number, number][] = [];
		const finish: (() => void)[] = [];
		for (let k = 0; k < 3; k++) {
			const texture = textures.fromImage(image(64, 32), {}, 0, 'assets.loadTexture');
			textures.reloadsFrom(texture, (level, target) => {
				calls.push([texture.handle, level, target.handle, target.width]);
				return new Promise<void>((resolve) => finish.push(resolve));
			});
		}
		expect(reloadable).toEqual([10, 11, 12]);
		expect(textures.pollBudget()).toBe(false);
		asked.push(10, 11, 12);
		bump();
		expect(textures.pollBudget()).toBe(true);
		expect(calls).toEqual([
			[10, 1, 110, 32],
			[11, 1, 111, 32],
		]);
		expect(textures.pollBudget()).toBe(false);
		finish[0]?.();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls.map(([texture]) => texture)).toEqual([10, 11, 12]);
	});

	test('give up on a texture whose file does not load again, and on one the sketch refilled', async () => {
		const asked: number[] = [];
		const { textures, failed, bump } = budgetCore(asked);
		const broken = textures.fromImage(image(), {}, 0, 'assets.loadTexture');
		textures.reloadsFrom(broken, () => Promise.reject(new Error('HTTP 404')));
		const refilled = textures.fromImage(image(), {}, 0, 'assets.loadTexture');
		textures.reloadsFrom(refilled, () => Promise.resolve());
		refilled.update(image());
		asked.push(broken.handle, refilled.handle);
		bump();
		const warn = console.warn;
		console.warn = () => {};
		try {
			textures.pollBudget();
			await new Promise((resolve) => setTimeout(resolve, 0));
		} finally {
			console.warn = warn;
		}
		expect(failed.sort()).toEqual([broken.handle, refilled.handle].sort());
	});

	test('reach no core once the engine stops while a load again runs', async () => {
		const asked: number[] = [];
		const { textures, failed, bump, core } = budgetCore(asked);
		const finish: ((error: Error) => void)[] = [];
		const pending: number[] = [];
		for (let k = 0; k < 3; k++) {
			const texture = textures.fromImage(image(), {}, 0, 'assets.loadTexture');
			textures.reloadsFrom(texture, () => new Promise<void>((_, reject) => finish.push(reject)));
			pending.push(texture.handle);
		}
		asked.push(...pending);
		bump();
		textures.pollBudget();
		core.stop();
		for (const reject of finish) reject(new Error('the engine stopped'));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(failed).toEqual([]);
		expect(asked).toEqual(pending.slice(2));
	});
});
