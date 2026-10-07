import { describe, expect, test } from 'bun:test';
import {
	avifHeader,
	jpegHeader,
	pngHeader,
	webpHeader,
} from '../../../../tests/pages/lib/image-headers';
import { FILE_LIMITS, FileBudget, imageSize, imageTooLarge, modelAllowance } from './file-limits';

describe('imageSize', () => {
	test("reads a PNG's IHDR and a JPEG's frame header after the segments before it", () => {
		expect(imageSize(pngHeader(640, 480))).toEqual([640, 480]);
		expect(imageSize(pngHeader(65536, 1))).toEqual([65536, 1]);
		expect(imageSize(jpegHeader(1920, 1080))).toEqual([1920, 1080]);
		expect(imageSize(jpegHeader(30, 20, 5000))).toEqual([30, 20]);
	});

	test("reads each kind of WebP's first chunk", () => {
		expect(imageSize(webpHeader(300, 200, 'lossy'))).toEqual([300, 200]);
		expect(imageSize(webpHeader(16383, 1, 'lossless'))).toEqual([16383, 1]);
		expect(imageSize(webpHeader(65536, 65536, 'extended'))).toEqual([65536, 65536]);
	});

	test("takes an AVIF's largest image spatial extents, as an alpha plane or a grid adds more", () => {
		expect(imageSize(avifHeader(640, 480))).toEqual([640, 480]);
		expect(
			imageSize(
				avifHeader(512, 512, [
					[512, 512],
					[65536, 64],
				]),
			),
		).toEqual([65536, 512]);
	});

	test('gives nothing for other formats and for headers cut short', () => {
		expect(imageSize(webpHeader(64, 64, 'lossy').slice(0, 24))).toBeUndefined();
		expect(imageSize(avifHeader(64, 64).slice(0, 40))).toBeUndefined();
		// An ISO file of another brand, such as a HEIC photo, is not an AVIF.
		const heic = avifHeader(64, 64);
		heic.set(new TextEncoder().encode('heic'), 8);
		heic.set(new TextEncoder().encode('heix'), 16);
		heic.set(new TextEncoder().encode('heix'), 20);
		expect(imageSize(heic)).toBeUndefined();
		// A box that claims more bytes than the file holds is read up to the file's end.
		const long = avifHeader(64, 64);
		new DataView(long.buffer).setUint32(24, 0xffffffff);
		expect(imageSize(long)).toEqual([64, 64]);
		expect(imageSize(new TextEncoder().encode('GIF89a'))).toBeUndefined();
		expect(imageSize(new Uint8Array())).toBeUndefined();
		expect(imageSize(pngHeader(64, 64).slice(0, 20))).toBeUndefined();
		const jpeg = jpegHeader(64, 64, 100);
		expect(imageSize(jpeg.slice(0, 60))).toBeUndefined();
		// A segment whose length is less than its own two bytes would never end.
		const looping = jpeg.slice();
		new DataView(looping.buffer).setUint16(4, 0);
		expect(imageSize(looping)).toBeUndefined();
	});
});

test('imageTooLarge names the size and the limit, and lets through what it does not know', () => {
	expect(imageTooLarge([8192, 16], 4096)).toBe(
		'its header gives 8192 x 16 pixels, larger than the 4096 a side that it may have',
	);
	expect(imageTooLarge([4096, 4096], 4096)).toBeUndefined();
	expect(imageTooLarge(undefined, 4096)).toBeUndefined();
});

describe('the shared limits', () => {
	test("a model file's allowance grows with its bytes, between the floor and the cap", () => {
		expect(modelAllowance(0)).toBe(FILE_LIMITS.modelFloorBytes);
		expect(modelAllowance(1 << 20)).toBe(
			FILE_LIMITS.modelFloorBytes + FILE_LIMITS.modelRatio * (1 << 20),
		);
		expect(modelAllowance(1 << 30)).toBe(FILE_LIMITS.modelCapBytes);
	});

	test('a budget refuses one item past the item limit, and items that together pass the allowance', () => {
		const fail = (reason: string): never => {
			throw new Error(reason);
		};
		const budget = new FileBudget(0, fail);
		expect(() => budget.take(FILE_LIMITS.itemBytes + 1, 'the array')).toThrow(
			'the array decodes to 256 MiB, more than the 256 MiB that one array or texture may hold',
		);
		expect(() => budget.take(Number.NaN, 'the array')).toThrow('more bytes than a number holds');
		budget.take(FILE_LIMITS.modelFloorBytes - 10, 'the first array');
		expect(() => budget.take(11, 'the second array')).toThrow(
			'the second array would bring what the file decodes to 64 MiB, more than the 64 MiB that a file of its size may decode to',
		);
		expect(budget.used).toBe(FILE_LIMITS.modelFloorBytes - 10);
	});
});
