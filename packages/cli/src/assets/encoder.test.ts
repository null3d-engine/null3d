import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../png.js';
import { ENCODER_FILES, encodeTexture, texturePixels } from './encoder.js';
import {
	decodeImage,
	linearToSrgb,
	nearestPowerOfTwo,
	resizeImage,
	srgbToLinear,
	textureSize,
} from './images.js';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

/**
 * The files of the official Basis Universal v2.50 encoder build (tag v2_50, commit 9bebe16, the
 * folder webgl/encoder/build), by SHA-256: the same release as the transcoder that the engine
 * ships. The tool runs them unchanged.
 */
const OFFICIAL_BUILD = {
	glue: 'd225ce1e7012609bcfbe338351c8778d95eb1c19d404314d513b2b2df94a6ffb',
	wasm: '48d4e39ccaa1e290a17d00c13b353a728227bb439108d5e6c944fe6ab80552db',
};

const TRANSCODER = join(import.meta.dir, '../../../engine/vendor/basis');

/** The engine's transcoder, which the engine ships as an ES module. */
async function loadTranscoder() {
	const { default: start } = await import(join(TRANSCODER, 'basis_transcoder.mjs'));
	const basis = await start({
		wasmBinary: readFileSync(join(TRANSCODER, 'basis_transcoder.wasm')),
	});
	basis.initializeBasis();
	return basis;
}

/** A picture of 64 x 64 texels: soft color bands, with a dark ring. */
function picture(width = 64, height = 64) {
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const ring = Math.abs(Math.hypot(x - width / 2, y - height / 2) - width / 4) < 2;
			data.set(
				ring ? [20, 20, 30, 255] : [(x * 255) / (width - 1), (y * 255) / (height - 1), 140, 255],
				(y * width + x) * 4,
			);
		}
	return { width, height, data };
}

/** The KTX2 file's header fields that the engine reads. */
function header(ktx2: Uint8Array) {
	const view = new DataView(ktx2.buffer, ktx2.byteOffset, ktx2.byteLength);
	return {
		vkFormat: view.getUint32(12, true),
		width: view.getUint32(20, true),
		height: view.getUint32(24, true),
		levels: view.getUint32(40, true),
		supercompression: view.getUint32(44, true),
	};
}

/** The top level of a KTX2 file, transcoded to RGBA8 with the engine's transcoder. */
async function topLevel(ktx2: Uint8Array) {
	const basis = await loadTranscoder();
	const file = new basis.KTX2File(ktx2);
	try {
		expect(file.startTranscoding()).toBeTruthy();
		const format = basis.transcoder_texture_format.cTFRGBA32.value;
		const out = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, format));
		expect(file.transcodeImage(out, 0, 0, 0, format, 0, -1, -1)).toBeTruthy();
		return { srgb: file.isSRGB(), out };
	} finally {
		file.close();
		file.delete();
	}
}

/** The mean difference of the color channels of two RGBA8 images, from 0 to 255. */
function meanError(a: Uint8Array, b: Uint8Array) {
	let sum = 0;
	for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i]! - b[i]!);
	return sum / ((a.length / 4) * 3);
}

describe('the encoder', () => {
	it('is the official Basis Universal 2.50 build, unchanged', () => {
		const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
		expect({ glue: hash(ENCODER_FILES.glue), wasm: hash(ENCODER_FILES.wasm) }).toEqual(
			OFFICIAL_BUILD,
		);
	});

	it('writes ETC1S color maps with every mip level, which transcode to the source picture', async () => {
		const source = picture();
		const texture = await encodeTexture({
			bytes: encodePng(source),
			mimeType: 'image/png',
			kind: 'color',
			codec: 'etc1s',
			maxSide: 2048,
		});
		expect(header(texture.ktx2)).toEqual({
			vkFormat: 0,
			width: 64,
			height: 64,
			levels: 7,
			supercompression: 1,
		});
		const { srgb, out } = await topLevel(texture.ktx2);
		expect(srgb).toBe(true);
		// ETC1S at its default quality strays by about 6 of 255 on this picture's gradients.
		expect(meanError(out, source.data)).toBeLessThan(8);
		expect(texture.alpha).toBe(false);
	});

	it('writes UASTC normal maps in linear values with Zstandard, closer to the source', async () => {
		const source = picture();
		const texture = await encodeTexture({
			bytes: encodePng(source),
			mimeType: 'image/png',
			kind: 'normal',
			codec: 'uastc',
			maxSide: 2048,
		});
		expect(header(texture.ktx2)).toMatchObject({ vkFormat: 0, levels: 7, supercompression: 2 });
		const { srgb, out } = await topLevel(texture.ktx2);
		expect(srgb).toBe(false);
		// The encoder renormalizes each texel as a normal, so compare it with the renormalized picture.
		const normal = Uint8Array.from(source.data);
		for (let i = 0; i < normal.length; i += 4) {
			const v = [0, 1, 2].map((c) => (normal[i + c]! / 255) * 2 - 1);
			const length = Math.hypot(...v) || 1;
			for (let c = 0; c < 3; c++) normal[i + c] = Math.round(((v[c]! / length) * 0.5 + 0.5) * 255);
		}
		expect(meanError(out, normal)).toBeLessThan(3);
	});

	it('resizes a picture to powers of two within the largest side, and keeps its alpha', async () => {
		const source = picture(100, 40);
		for (let i = 3; i < source.data.length; i += 8) source.data[i] = 128;
		const job = {
			bytes: encodePng(source),
			mimeType: 'image/png',
			kind: 'color',
			codec: 'etc1s',
			maxSide: 64,
		} as const;
		const { pixels, sourceWidth } = texturePixels(job);
		expect([pixels.width, pixels.height, sourceWidth]).toEqual([64, 16, 100]);
		const texture = await encodeTexture(job);
		expect(header(texture.ktx2)).toMatchObject({ width: 64, height: 16, levels: 7 });
		expect(texture.alpha).toBe(true);
	});
});

describe('the images', () => {
	it('take the nearest power of two, with ties up, then halve together to fit', () => {
		expect([1, 3, 600, 767, 768, 1000, 4096].map(nearestPowerOfTwo)).toEqual([
			1, 4, 512, 512, 1024, 1024, 4096,
		]);
		expect(textureSize(4096, 1024, 2048)).toEqual([2048, 512]);
		expect(textureSize(96, 48, 2048)).toEqual([128, 64]);
		expect(textureSize(8, 4000, 512)).toEqual([4, 512]);
		// Each side is a whole number of the compressed formats' 4 x 4 blocks.
		expect(textureSize(1, 2, 2048)).toEqual([4, 4]);
	});

	it('turn every sRGB value into linear light and back unchanged', () => {
		for (let v = 0; v < 256; v++) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
		expect(linearToSrgb(0)).toBe(0);
		expect(linearToSrgb(65535)).toBe(255);
	});

	it('keep a flat color flat at any size, and mix sRGB colors as light', () => {
		const flat = { width: 3, height: 5, data: new Uint8Array(60).fill(200) };
		const grown = resizeImage(flat, 4, 8, true);
		expect(new Set(grown.data)).toEqual(new Set([200]));
		const halves = {
			width: 2,
			height: 1,
			data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
		};
		const mixed = resizeImage(halves, 1, 1, true);
		// Half the light of white is 188 in sRGB, not 128.
		expect(Array.from(mixed.data)).toEqual([188, 188, 188, 255]);
		expect(Array.from(resizeImage(halves, 1, 1, false).data)).toEqual([128, 128, 128, 255]);
	});

	it('decode gray and 16-bit PNG files to 8-bit RGBA', () => {
		const { encode } = require('fast-png') as typeof import('fast-png');
		const gray = decodeImage(
			encode({ width: 2, height: 1, data: new Uint16Array([0, 0xffff]), channels: 1, depth: 16 }),
			'image/png',
		);
		expect(Array.from(gray.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
		expect(() => decodeImage(new Uint8Array(4), 'image/webp')).toThrow('PNG and JPEG');
	});
});
