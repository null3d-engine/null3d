// The PNG helpers: an image of any 8-bit kind comes back as RGBA, so a browser's screenshot, which
// is often RGB, can be read beside the engine's own frames.
import { describe, expect, it } from 'bun:test';
import { decode, encode } from 'fast-png';
import { decodePng, decodePngFile, decodePngRgba, splitImageData } from './png.js';

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

describe('splitImageData', () => {
	/** The type and length of each chunk of a PNG file. */
	function chunks(png: Uint8Array) {
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		const out: [string, number][] = [];
		for (let at = 8; at < png.length; at += 12 + view.getUint32(at))
			out.push([new TextDecoder().decode(png.subarray(at + 4, at + 8)), view.getUint32(at)]);
		return out;
	}

	it('splits image data into chunks of at most 64 KiB that decode to the same pixels', () => {
		const width = 512;
		const data = new Uint8Array(width * width * 3);
		let seed = 1;
		for (let i = 0; i < data.length; i++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			data[i] = seed >>> 24;
		}
		const png = encode({ width, height: width, data, channels: 3, depth: 8 });
		expect(Math.max(...chunks(png).map(([, length]) => length))).toBeGreaterThan(65536);
		const split = splitImageData(png);
		const parts = chunks(split);
		expect(parts.filter(([type]) => type === 'IDAT').length).toBeGreaterThan(1);
		expect(Math.max(...parts.map(([, length]) => length))).toBeLessThanOrEqual(65536);
		const read = decodePngFile(png);
		expect(read.width).toBe(width);
		expect(Buffer.compare(Buffer.from(read.data as Uint8Array), Buffer.from(data))).toBe(0);
		// Each new chunk carries a valid check.
		expect(decode(split, { checkCrc: true }).width).toBe(width);
	});

	it('returns a file of small chunks as it is', () => {
		const { png } = image(4);
		expect(splitImageData(png)).toBe(png);
	});
});
