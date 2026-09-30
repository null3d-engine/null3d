import { beforeEach, describe, expect, test } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	TEXTURE_FILTER_LINEAR,
	TEXTURE_FILTER_NEAREST,
	TEXTURE_FORMAT_LINEAR,
	TEXTURE_FORMAT_SRGB,
	TEXTURE_STAT_TEXTURE_BYTES,
	TEXTURE_WRAP_CLAMP,
	TEXTURE_WRAP_MIRROR,
	TEXTURE_WRAP_REPEAT,
} from '../generated/core';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { attachTextures, Textures, texturesOf } from './textures';

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

/** A core that records its texture calls, and the images that went to the thread that draws. */
function fakeCore() {
	const created: number[][] = [];
	const sent: [number, ImageBitmap][] = [];
	let nextImage = 0;
	const glue = {
		createTexture: (...args: (number | boolean)[]) => {
			created.push(args.map(Number));
			return 7;
		},
		setTextureImage: () => ++nextImage,
		textureStat: (field: number, texture: number) =>
			field === TEXTURE_STAT_TEXTURE_BYTES ? texture * 100 : 0,
		destroyTexture: () => 0,
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	} as unknown as CoreGlue;
	const core = new CoreMemory(glue, new WebAssembly.Memory({ initial: 1 }));
	const textures = new Textures(core, (id, bitmap) => sent.push([id, bitmap]), { frame: 3 });
	return { textures, created, sent };
}

describe('textures.fromImageBitmap', () => {
	test('asks the core for a texture with the options as codes, and sends the image under its id', () => {
		const { textures, created, sent } = fakeCore();
		const picture = image();
		const texture = textures.fromImageBitmap(picture);
		// sRGB, mip levels, clamped, linear filters and no anisotropy, as three.js's defaults.
		expect(created[0]).toEqual([
			32,
			16,
			TEXTURE_FORMAT_SRGB,
			1,
			TEXTURE_WRAP_CLAMP,
			TEXTURE_WRAP_CLAMP,
			TEXTURE_FILTER_LINEAR,
			TEXTURE_FILTER_LINEAR,
			TEXTURE_FILTER_LINEAR,
			1,
		]);
		expect(sent).toEqual([[1, picture]]);
		expect([texture.handle, texture.width, texture.height, texture.bytes]).toEqual([
			7, 32, 16, 700,
		]);
		textures.fromImageBitmap(image(), {
			colorSpace: 'linear',
			wrap: ['repeat', 'mirror'],
			magFilter: 'nearest',
			minFilter: 'nearest',
			mipmapFilter: 'nearest',
			mipmaps: false,
			anisotropy: 8,
		});
		expect(created[1]).toEqual([
			32,
			16,
			TEXTURE_FORMAT_LINEAR,
			0,
			TEXTURE_WRAP_REPEAT,
			TEXTURE_WRAP_MIRROR,
			TEXTURE_FILTER_NEAREST,
			TEXTURE_FILTER_NEAREST,
			TEXTURE_FILTER_NEAREST,
			8,
		]);
		expect(sent.map(([id]) => id)).toEqual([1, 2]);
	});

	test('refuses an image without pixels and options the engine does not know', () => {
		const { textures, created } = fakeCore();
		const closed = image();
		closed.close();
		expect(() => textures.fromImageBitmap(closed)).toThrow('got an image without pixels');
		expect(() => textures.fromImageBitmap(image(), { anisotropy: 0 })).toThrow(
			'give a whole number from 1 to 16',
		);
		expect(() => textures.fromImageBitmap(image(), { anisotropy: 2.5 })).toThrow('2.5');
		const wrap = 'tile' as unknown as 'clamp';
		expect(() => textures.fromImageBitmap(image(), { wrap })).toThrow(
			"got wrap: 'tile'. Use one of 'clamp', 'repeat', 'mirror'.",
		);
		expect(created).toEqual([]);
	});

	test("texture.update sends the new image, and texturesOf finds a context's textures", () => {
		const { textures, sent } = fakeCore();
		const texture = textures.fromImageBitmap(image());
		const next = image();
		texture.update(next);
		expect(sent.at(-1)).toEqual([2, next]);
		const context = {};
		attachTextures(context, textures);
		expect(texturesOf(context)).toBe(textures);
		expect(() => texturesOf({})).toThrow('not a sketch context');
	});
});
