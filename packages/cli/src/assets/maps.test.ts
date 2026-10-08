import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from 'fast-png';
import { main } from '../cli.js';
import { decodePng, writePng } from '../png.js';
import { decodeTga, imageType, readHeights } from './image-files.js';
import { isGray, normalsFromHeights, packChannels } from './maps.js';
import { parseBumpArgs } from './normal-from-bump.js';
import { parsePackArgs } from './pack-orm.js';

// UASTC encodes take a second or more on a busy machine.
setDefaultTimeout(60_000);

const scratch = mkdtempSync(join(tmpdir(), 'null3d-maps-'));
const log = spyOn(console, 'log').mockImplementation(() => {});
const error = spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
	log.mockRestore();
	error.mockRestore();
});

/** An RGBA8 image whose pixels `pixel` gives. */
function image(width: number, height: number, pixel: (x: number, y: number) => number[]) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	return { width, height, data };
}

const gray = (width: number, height: number, value: (x: number, y: number) => number) =>
	image(width, height, (x, y) => [value(x, y), value(x, y), value(x, y), 255]);

/** The RGBA of a pixel. */
const pixelAt = (img: { width: number; data: Uint8Array }, x: number, y: number) =>
	Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** The KTX2 file's format number, level count and supercompression. */
function ktx2Header(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	return {
		vkFormat: view.getUint32(12, true),
		width: view.getUint32(20, true),
		levels: view.getUint32(40, true),
		supercompression: view.getUint32(44, true),
	};
}

describe('packChannels', () => {
	it('puts occlusion, roughness and metalness in red, green and blue', () => {
		const packed = packChannels([
			{ image: gray(2, 2, () => 10) },
			{ image: gray(2, 2, (x) => (x === 0 ? 20 : 30)), invert: true },
			{ value: 0 },
		]);
		expect(pixelAt(packed, 0, 0)).toEqual([10, 235, 0, 255]);
		expect(pixelAt(packed, 1, 1)).toEqual([10, 225, 0, 255]);
	});

	it('stretches smaller maps to the largest', () => {
		const packed = packChannels([
			{ image: gray(1, 1, () => 77) },
			{ image: gray(4, 4, () => 5) },
			{ value: 255 },
		]);
		expect([packed.width, packed.height]).toEqual([4, 4]);
		expect(pixelAt(packed, 3, 3)).toEqual([77, 5, 255, 255]);
	});
});

describe('normalsFromHeights', () => {
	const heights = (width: number, height: number, h: (x: number, y: number) => number) => {
		const data = new Float32Array(width * height);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = h(x, y);
		return { width, height, data };
	};

	it('points a flat map straight out', () => {
		const normals = normalsFromHeights(
			heights(4, 4, () => 0.5),
			1,
			true,
		);
		expect(pixelAt(normals, 1, 1)).toEqual([128, 128, 255, 255]);
	});

	it('tilts away from where the height rises, 45 degrees at a slope of one per texel', () => {
		// Rises to the right, by the whole range per texel: X leans left.
		const right = normalsFromHeights(
			heights(8, 8, (x) => x),
			1,
			false,
		);
		const [r, g, b] = pixelAt(right, 4, 4) as [number, number, number];
		expect(r).toBe(Math.round((-Math.SQRT1_2 * 0.5 + 0.5) * 255));
		expect(g).toBe(128);
		expect(b).toBe(Math.round((Math.SQRT1_2 * 0.5 + 0.5) * 255));
		// Rises down the image: the normal's Y, which runs up the image, leans up.
		const down = normalsFromHeights(
			heights(8, 8, (_, y) => y / 8),
			2,
			false,
		);
		expect(pixelAt(down, 4, 4)[1]).toBeGreaterThan(128);
	});

	it('takes the edge neighbors from the opposite edge when the map tiles', () => {
		const ramp = heights(4, 1, (x) => x / 4);
		expect(pixelAt(normalsFromHeights(ramp, 1, true), 0, 0)[0]).toBeGreaterThan(128);
		expect(pixelAt(normalsFromHeights(ramp, 1, false), 0, 0)[0]).toBeLessThan(128);
	});
});

describe('image files', () => {
	it('reads TGA files: plain bottom-up 24-bit, and run-length top-down 32-bit', () => {
		const plain = new Uint8Array(18 + 2 * 2 * 3);
		plain.set([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 0, 24, 0]);
		// Bottom row first, BGR: blue, green; then the top row: red, white.
		plain.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255], 18);
		const decoded = decodeTga(plain);
		expect(pixelAt(decoded, 0, 0)).toEqual([255, 0, 0, 255]);
		expect(pixelAt(decoded, 1, 1)).toEqual([0, 255, 0, 255]);

		const rle = new Uint8Array([
			...[0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 32, 40],
			// A run of two gray pixels, then one raw red pixel at half alpha.
			...[0x81, 50, 50, 50, 255, 0x00, 0, 0, 255, 128],
		]);
		const rows = decodeTga(rle);
		expect(pixelAt(rows, 1, 0)).toEqual([50, 50, 50, 255]);
		expect(pixelAt(rows, 2, 0)).toEqual([255, 0, 0, 128]);
		expect(() => decodeTga(rle.subarray(0, 24))).toThrow('ends before its last pixel');
		expect(imageType(rle, 'map.TGA')).toBe('image/x-tga');
	});

	it('reads a 16-bit height map at its full depth', () => {
		const data = Uint16Array.from([0, 1, 65534, 65535]);
		const png = encode({ width: 4, height: 1, data, channels: 1, depth: 16 });
		const { data: heights } = readHeights(png, 'h.png');
		expect(heights[1]).toBeCloseTo(1 / 65535, 9);
		expect(heights[2]).toBeCloseTo(65534 / 65535, 9);
	});

	it('tells gray maps from normal maps', () => {
		expect(isGray(gray(2, 2, (x) => x * 100))).toBe(true);
		expect(isGray(image(2, 2, () => [128, 128, 255, 255]))).toBe(false);
	});
});

describe('assets pack-orm', () => {
	const ao = join(scratch, 'ao.png');
	const rough = join(scratch, 'rough.png');
	writePng(
		ao,
		gray(8, 8, () => 200),
	);
	writePng(
		rough,
		gray(16, 16, (x) => x * 16),
	);

	it('reads its arguments', () => {
		expect(() => parsePackArgs(['out.png'])).toThrow('at least one of');
		expect(() => parsePackArgs(['out.jpg', '--roughness', rough])).toThrow('.ktx2 or .png');
		expect(() =>
			parsePackArgs(['out.png', '--roughness', rough, '--max-texture-size', '100']),
		).toThrow('power of two');
		expect(parsePackArgs(['out.ktx2', '--occlusion', ao]).format).toBe('ktx2');
	});

	it('writes a PNG file of the packed maps, white occlusion and black metal where none is given', async () => {
		const out = join(scratch, 'orm.png');
		expect(await main(['assets', 'pack-orm', out, '--roughness', rough])).toBe(0);
		const packed = decodePng(readFileSync(out), out);
		expect([packed.width, packed.height]).toEqual([16, 16]);
		expect(pixelAt(packed, 3, 0)).toEqual([255, 48, 0, 255]);
	});

	it('writes a KTX2 file in UASTC with every mip level', async () => {
		const out = join(scratch, 'orm.ktx2');
		expect(await main(['assets', 'pack-orm', out, '--occlusion', ao, '--roughness', rough])).toBe(
			0,
		);
		const header = ktx2Header(readFileSync(out));
		expect(header).toMatchObject({ width: 16, levels: 5, supercompression: 2 });
	});

	it('refuses maps of different shapes', async () => {
		const wide = join(scratch, 'wide.png');
		writePng(
			wide,
			gray(16, 4, () => 0),
		);
		expect(
			await main([
				'assets',
				'pack-orm',
				join(scratch, 'x.png'),
				'--occlusion',
				ao,
				'--metalness',
				wide,
			]),
		).toBe(1);
	});
});

describe('assets normal-from-bump', () => {
	const bump = join(scratch, 'bump.png');
	writePng(
		bump,
		gray(16, 8, (x) => (x >= 4 && x < 12 ? 255 : 0)),
	);

	it('reads its arguments', () => {
		expect(parseBumpArgs(['in.png', 'out.png'])).toMatchObject({ scale: 1, wrap: true });
		expect(parseBumpArgs(['in.png', 'out.png', '--scale', '0.25', '--clamp'])).toMatchObject({
			scale: 0.25,
			wrap: false,
		});
		expect(() => parseBumpArgs(['in.png', 'out.png', '--scale', '0'])).toThrow('above 0');
		expect(() => parseBumpArgs(['in.png'])).toThrow('not 1 argument');
	});

	it("writes a PNG normal map at the height map's size", async () => {
		const out = join(scratch, 'normal.png');
		expect(await main(['assets', 'normal-from-bump', bump, out])).toBe(0);
		const normals = decodePng(readFileSync(out), out);
		expect([normals.width, normals.height]).toEqual([16, 8]);
		// The left wall of the raised band rises to the right, so it leans left.
		expect(pixelAt(normals, 4, 4)[0]).toBeLessThan(128);
		expect(pixelAt(normals, 11, 4)[0]).toBeGreaterThan(128);
		expect(pixelAt(normals, 8, 4)).toEqual([128, 128, 255, 255]);
	});

	it('writes a KTX2 normal map in UASTC', async () => {
		const out = join(scratch, 'normal.ktx2');
		expect(await main(['assets', 'normal-from-bump', bump, out, '--scale', '0.5'])).toBe(0);
		expect(ktx2Header(readFileSync(out))).toMatchObject({
			width: 16,
			levels: 5,
			supercompression: 2,
		});
	});

	it('fails for a file that is not an image', async () => {
		const broken = join(scratch, 'broken.png');
		await Bun.write(broken, 'hello');
		expect(await main(['assets', 'normal-from-bump', broken, join(scratch, 'n.png')])).toBe(1);
	});
});
