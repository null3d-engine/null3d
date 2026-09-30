import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_NEAREST,
	TEXTURE_FORMAT_HALF_FLOAT,
	TEXTURE_FORMAT_LINEAR,
	TEXTURE_FORMAT_SRGB,
	TEXTURE_PREMULTIPLIED_ALPHA,
	TEXTURE_STAT_MAX_SIZE,
	TEXTURE_STAT_TEXTURE_BYTES,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_MIRROR,
	TEXTURE_WRAP_REPEAT,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
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

/**
 * A core that records its texture calls, the images that went to the thread that draws, and the
 * data calls, with a largest texture of 64 texels.
 */
function fakeCore() {
	const created: number[][] = [];
	const images: number[][] = [];
	const data: number[][] = [];
	const destroyed: number[] = [];
	const sent: [number, ImageBitmap][] = [];
	let nextImage = 0;
	const glue = {
		createTexture: (...args: (number | boolean)[]) => {
			created.push(args.map(Number));
			return 7;
		},
		setTextureImage: (...args: number[]) => {
			images.push(args);
			return ++nextImage;
		},
		setTextureData: (...args: number[]) => {
			data.push(args);
			return DATA_ADDRESS;
		},
		textureStat: (field: number, texture: number) =>
			field === TEXTURE_STAT_TEXTURE_BYTES
				? texture * 100
				: field === TEXTURE_STAT_MAX_SIZE
					? 64
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
	const textures = new Textures(core, (id, bitmap) => sent.push([id, bitmap]), { frame: 3 });
	return { textures, created, images, data, destroyed, sent, memory };
}

/** The codes that `createTexture` got after the size and depth, for options as three.js's defaults. */
const DEFAULT_CODES = [
	TEXTURE_FORMAT_SRGB,
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
			"got colorSpace 'srgb' for rgba16float data",
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
