import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	PanoramaBuilder,
	type PanoramaFile,
	readPanorama,
	rgb9e5,
	SHARED_EXPONENT_MAX,
} from './panorama-files';

/** The OpenEXR fixtures, which an ignored test of the asset tool's crate writes (exr.rs). */
const FIXTURES = join(import.meta.dir, '../../../../tests/pages/assets/environments');

/** The fixtures' light at a texel, as the crate's `fixture_light` computes it. */
function fixtureLight(x: number, y: number, channel: number): number {
	if (x === 7 && y === 3) return 5000 + channel;
	return Math.abs(Math.sin(x * 0.37 + y * 0.21 + channel)) * 4 + 0.01 * (channel + 1);
}

/** A shared-exponent texel's light. */
function light(texel: number): [number, number, number] {
	const unit = 2 ** ((texel >>> 27) - 24);
	return [(texel & 511) * unit, ((texel >>> 9) & 511) * unit, ((texel >>> 18) & 511) * unit];
}

const bytesOf = (file: Uint8Array) =>
	file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;

async function readFixture(name: string, maxSide = 64): Promise<PanoramaFile> {
	return readPanorama(bytesOf(readFileSync(join(FIXTURES, name))), maxSide);
}

/** A Radiance file of flat rows, as the asset tool's tests build one. */
function radianceFile(width: number, height: number, texel: (x: number, y: number) => number[]) {
	const head = new TextEncoder().encode(
		`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
	);
	const out = [...head];
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.push(...texel(x, y));
	return Uint8Array.from(out);
}

const text = (s: string) => [...new TextEncoder().encode(s)];

describe('shared-exponent texels', () => {
	test('pack as the asset tool rounds them, and stop at the largest value', () => {
		expect(rgb9e5(1, 1, 1)).toBe((256 | (256 << 9) | (256 << 18) | (16 << 27)) >>> 0);
		expect(light(rgb9e5(0.5, 0.25, 0))).toEqual([0.5, 0.25, 0]);
		expect(rgb9e5(0, 0, 0)).toBe(0);
		expect(light(rgb9e5(1e9, 0, 0))[0]).toBe(SHARED_EXPONENT_MAX);
		// 511.6 rounds up into the next exponent, as 512.
		expect(light(rgb9e5(511.6, 0, 0))[0]).toBe(512);
	});
});

describe('Radiance files', () => {
	test('read flat rows', async () => {
		const file = radianceFile(3, 2, (x, y) => [128, 64, 0, 129 + x + y]);
		const { panorama } = await readPanorama(bytesOf(file), 64);
		expect([panorama.width, panorama.height, panorama.gain]).toEqual([3, 2, 1]);
		expect(light(panorama.texels[0] as number)).toEqual([1, 0.5, 0]);
		expect(light(panorama.texels[5] as number)).toEqual([8, 4, 0]);
	});

	test('read run-length rows', async () => {
		const width = 10;
		const file = Uint8Array.from([
			...text('#?RADIANCE\n\n-Y 1 +X 10\n'),
			...[2, 2, 0, width],
			// Red: a run of 10; green: 10 literal values; blue: a run of 4 and 6 literals; exponent: a run.
			...[128 + 10, 64],
			...[10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			...[128 + 4, 7, 6, 1, 2, 3, 4, 5, 6],
			...[128 + 10, 128],
		]);
		const { panorama } = await readPanorama(bytesOf(file), 64);
		expect(light(panorama.texels[0] as number)).toEqual([64 / 256, 0, 7 / 256]);
		expect(light(panorama.texels[9] as number)).toEqual([64 / 256, 9 / 256, 6 / 256]);
	});

	test('broken files give messages', async () => {
		const read = (bytes: number[] | Uint8Array) =>
			readPanorama(bytesOf(Uint8Array.from(bytes)), 64).then(
				() => 'read',
				(error: Error) => error.message,
			);
		expect(await read(text('P6 not a radiance file'))).toContain('neither');
		expect(await read(text('#?RADIANCE\nFORMAT=32-bit_rle_xyze\n\n-Y 1 +X 1\n\0\0\0\0'))).toContain(
			'xyze',
		);
		expect(await read(text('#?RADIANCE\n\n+Y 1 +X 1\n\0\0\0\0'))).toContain('top row down');
		const whole = radianceFile(4, 4, () => [1, 1, 1, 128]);
		expect(await read(whole.subarray(0, whole.length - 1))).toContain('end before');
		expect(await read([...text('#?RADIANCE\n\n-Y 1 +X 8\n'), 2, 2, 0, 8, 128 + 100, 1])).toContain(
			'runs past',
		);
		expect(await read(text('#?RADIANCE\n\n-Y 99999 +X 1\n'))).toContain('99999');
	});
});

describe('OpenEXR files', () => {
	const lossless = ['none', 'rle', 'zips', 'zip', 'piz', 'pxr24'];

	test('read the half floats of every compression to the same light', async () => {
		const none = await readFixture('exr-none-half.exr');
		expect([none.panorama.width, none.panorama.height]).toEqual([21, 37]);
		for (const name of lossless) {
			const read = await readFixture(`exr-${name}-half.exr`);
			expect(Array.from(read.panorama.texels), name).toEqual(Array.from(none.panorama.texels));
			expect(Array.from(read.sh), name).toEqual(Array.from(none.sh));
		}
		// B44 keeps each block of 4 x 4 values to a few percent of their range. The block of the
		// bright texel spans thousands, so its other values come out coarse, and the test skips it.
		// three.js's EXRLoader decodes the fixtures to the same values.
		for (const name of ['b44', 'b44a']) {
			const read = await readFixture(`exr-${name}-half.exr`);
			for (let y = 0; y < 37; y++)
				for (let x = 0; x < 21; x++) {
					if (x >= 4 && x < 8 && y < 4) continue;
					const k = y * 21 + x;
					const exact = light(none.panorama.texels[k] as number);
					const most = Math.max(...exact);
					light(read.panorama.texels[k] as number).forEach((c, ch) => {
						expect(Math.abs(c - (exact[ch] as number))).toBeLessThan(0.08 * most);
					});
				}
		}
	});

	test('read floats, and hold the light of the fixtures', async () => {
		const none = await readFixture('exr-none-float.exr');
		for (const name of ['zip', 'piz']) {
			const read = await readFixture(`exr-${name}-float.exr`);
			expect(Array.from(read.panorama.texels), name).toEqual(Array.from(none.panorama.texels));
		}
		// A shared-exponent texel holds each channel to a 512th of its largest channel's power of two.
		const pxr24 = await readFixture('exr-pxr24-float.exr');
		for (const file of [none, pxr24])
			for (let y = 0; y < 37; y++)
				for (let x = 0; x < 21; x++) {
					const expected = [0, 1, 2].map((ch) => fixtureLight(x, y, ch));
					const step = 2 ** Math.ceil(Math.log2(Math.max(...expected))) / 512;
					light(file.panorama.texels[y * 21 + x] as number).forEach((c, ch) => {
						expect(Math.abs(c - (expected[ch] as number))).toBeLessThanOrEqual(step);
					});
				}
	});

	test('refuse tiled files, unknown compressions and broken chunks', async () => {
		const file = readFileSync(join(FIXTURES, 'exr-zip-half.exr'));
		const read = (bytes: Uint8Array) =>
			readPanorama(bytesOf(bytes), 64).then(
				() => 'read',
				(error: Error) => error.message,
			);
		const tiled = Uint8Array.from(file);
		tiled[5] = (tiled[5] as number) | 2;
		expect(await read(tiled)).toContain('tiled');
		const dwaa = Uint8Array.from(file);
		const at = Buffer.from(dwaa).indexOf('compression\0compression\0');
		dwaa[at + 28] = 8;
		expect(await read(dwaa)).toContain('DWAA');
		expect(await read(file.subarray(0, file.length - 100))).toMatch(/outside|fewer|inflate/);
		const scrambled = Uint8Array.from(file);
		scrambled.fill(0x5a, scrambled.length - 300, scrambled.length - 200);
		expect(await read(scrambled)).not.toBe('read');
	});
});

describe('the panorama builder', () => {
	test('averages squares of texels until both sides fit', () => {
		const builder = new PanoramaBuilder(5, 2, 2);
		expect([builder.width, builder.height]).toEqual([2, 1]);
		for (let y = 0; y < 2; y++) {
			const row = Float32Array.from([1, 2, 3, 4, 5].map((v) => v + 10 * y));
			builder.row(y, row, row, row);
		}
		const { texels } = builder.finish().panorama;
		// Squares of 4 texels a side: the first texel averages 1 to 4 and 11 to 14, and the last
		// texel's square holds only 5 and 15.
		expect(light(texels[0] as number)[0]).toBe(7.5);
		expect(light(texels[1] as number)[0]).toBe(10);
	});

	test('divides light past the largest shared-exponent value by a power of two', () => {
		const builder = new PanoramaBuilder(2, 1, 8);
		builder.row(0, Float32Array.of(300_000, 1), Float32Array.of(0, 1), Float32Array.of(0, 1));
		const { gain, texels } = builder.finish().panorama;
		expect(gain).toBe(8);
		expect(light(texels[0] as number)[0]).toBeCloseTo(300_000 / 8, -2);
		expect(light(texels[1] as number)[0]).toBe(1 / 8);
	});

	test('counts negative and infinite light as none', () => {
		const builder = new PanoramaBuilder(3, 1, 8);
		const row = Float32Array.of(-1, Number.POSITIVE_INFINITY, Number.NaN);
		builder.row(0, row, row, row);
		const { panorama, sh } = builder.finish();
		expect(Array.from(panorama.texels)).toEqual([0, 0, 0]);
		expect(Array.from(sh).every((c) => c === 0)).toBe(true);
	});

	test('projects uniform light onto the first coefficient alone', () => {
		const [width, height] = [64, 32];
		const builder = new PanoramaBuilder(width, height, 64);
		const row = new Float32Array(width).fill(2);
		for (let y = 0; y < height; y++) builder.row(y, row, row, row);
		const { sh } = builder.finish();
		// The integral of 2 times the constant basis function over the sphere; the others sum to 0.
		expect(sh[0]).toBeCloseTo(2 * 0.282095 * 4 * Math.PI, 5);
		for (let k = 3; k < 27; k++) expect(Math.abs(sh[k] as number)).toBeLessThan(1e-6);
	});
});
