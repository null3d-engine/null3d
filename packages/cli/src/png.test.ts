// The PNG helpers: an image of any 8-bit kind comes back as RGBA, so a browser's screenshot, which
// is often RGB, can be read beside the engine's own frames.
import { describe, expect, it } from 'bun:test';
import { encode } from 'fast-png';
import { decodePng, decodePngRgba } from './png.js';

/** A 2 by 2 image of `channels` bytes a pixel, whose bytes rise by ten each. */
function image(channels: number) {
	const width = 2;
	const height = 2;
	const data = new Uint8Array(width * height * channels);
	for (let i = 0; i < data.length; i++) data[i] = (i * 10) % 256;
	return { width, height, data, png: encode({ width, height, data, channels, depth: 8 }) };
}

describe('decodePngRgba', () => {
	it('widens an RGB image to RGBA, with an opaque alpha', () => {
		const read = decodePngRgba(image(3).png, 'the image');
		expect(read.width).toBe(2);
		expect(read.height).toBe(2);
		expect([...read.data]).toEqual([
			0, 10, 20, 255, 30, 40, 50, 255, 60, 70, 80, 255, 90, 100, 110, 255,
		]);
	});

	it('widens a grey image to RGBA', () => {
		const read = decodePngRgba(image(1).png, 'the image');
		expect([...read.data]).toEqual([
			0, 0, 0, 255, 10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255,
		]);
	});

	it('keeps a grey image its own alpha', () => {
		const read = decodePngRgba(image(2).png, 'the image');
		expect([...read.data]).toEqual([0, 0, 0, 10, 20, 20, 20, 30, 40, 40, 40, 50, 60, 60, 60, 70]);
	});

	it('returns an RGBA image as it is', () => {
		const source = image(4);
		expect([...decodePngRgba(source.png, 'the image').data]).toEqual([...source.data]);
	});

	it('leaves decodePng strict, so a reference image of the wrong kind is still refused', () => {
		expect(() => decodePng(image(3).png, 'the image')).toThrow('is not an 8-bit RGBA image');
	});
});
