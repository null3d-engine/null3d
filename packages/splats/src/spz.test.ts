// The SPZ reader: the header's sizes, the fixed-point centres, the log spreads, the smallest-three
// rotations, the alpha and the first-band colour. The test writes a small version 3 file, gzips it
// as a writer does, and reads it back; a version 4 file holds the same cloud as zstd streams, and
// its table of contents names their sizes.
import { describe, expect, it } from 'bun:test';
import { decodeSpz } from './spz';

/** The fixed-point scale that the test's writer uses, which is also the writer's own precision. */
const FRACTIONAL_BITS = 12;

/** One component of a 24-bit fixed-point centre, in the file's little-endian bytes. */
function fixed24(value: number): number[] {
	const raw = Math.round(value * 2 ** FRACTIONAL_BITS);
	return [raw & 0xff, (raw >> 8) & 0xff, (raw >> 16) & 0xff];
}

/** A version 3 SPZ file with two splats, before gzip. */
function legacyFile(): Uint8Array {
	const count = 2;
	const header = 16;
	const positions = count * 3 * 3;
	const alphas = count;
	const colors = count * 3;
	const scales = count * 3;
	const rotations = count * 4;
	const bytes = new Uint8Array(header + positions + alphas + colors + scales + rotations);
	const data = new DataView(bytes.buffer);
	data.setUint32(0, 0x5053474e, true);
	data.setUint32(4, 3, true);
	data.setUint32(8, count, true);
	bytes[12] = 0; // Spherical-harmonic degree 0: no higher bands follow.
	bytes[13] = FRACTIONAL_BITS;
	let at = header;
	for (const value of [1, 2, -1, 0.5, 0, 3]) {
		bytes.set(fixed24(value), at);
		at += 3;
	}
	bytes.set([255, 0], at); // Opacities of the sigmoid's ends.
	at += alphas;
	for (const value of [128, 128, 128, 200, 100, 50]) bytes[at++] = value;
	for (const value of [160, 176, 192, 160, 160, 160]) bytes[at++] = value;
	// Identity quaternions in the smallest-three form: the largest is w, and the others are 0.
	for (let i = 0; i < count; i++) {
		data.setUint32(at, 0xc0000000, true);
		at += 4;
	}
	return bytes;
}

/** The gzip stream that a writer stores a legacy file in. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The attribute arrays of the test's two splats, each in the form that a version 4 stream holds. */
function streams(): Uint8Array[] {
	const count = 2;
	const positions = new Uint8Array(count * 9);
	const alphas = new Uint8Array([255, 0]);
	const colors = new Uint8Array([128, 128, 128, 200, 100, 50]);
	const scales = new Uint8Array([160, 176, 192, 160, 160, 160]);
	const rotations = new Uint8Array(count * 4);
	const view = new DataView(rotations.buffer);
	for (let i = 0; i < count; i++) view.setUint32(i * 4, 0xc0000000, true);
	let at = 0;
	for (const value of [1, 2, -1, 0.5, 0, 3]) {
		for (const byte of fixed24(value)) positions[at++] = byte;
	}
	// The streams run in the file's order: positions, alphas, colors, scales, rotations.
	return [positions, alphas, colors, scales, rotations];
}

/** A version 4 SPZ file: a plain header, a table of contents, and one zstd stream per array. */
async function zstdFile(): Promise<Uint8Array> {
	const parts = streams();
	const compressed = await Promise.all(
		parts.map(async (part) => {
			const stream = new Blob([part as BlobPart])
				.stream()
				.pipeThrough(new CompressionStream('zstd' as CompressionFormat));
			return new Uint8Array(await new Response(stream).arrayBuffer());
		}),
	);
	const header = 32;
	const toc = header;
	const tocBytes = compressed.length * 16;
	const dataAt = toc + tocBytes;
	const size = dataAt + compressed.reduce((total, part) => total + part.length, 0);
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x5053474e, true);
	view.setUint32(4, 4, true);
	view.setUint32(8, 2, true);
	bytes[12] = 0;
	bytes[13] = FRACTIONAL_BITS;
	bytes[14] = 0;
	bytes[15] = compressed.length;
	view.setUint32(16, toc, true);
	let at = toc;
	for (let i = 0; i < compressed.length; i++) {
		const part = compressed[i] as Uint8Array;
		view.setBigUint64(at, BigInt(part.length), true);
		view.setBigUint64(at + 8, BigInt((parts[i] as Uint8Array).length), true);
		at += 16;
	}
	let body = dataAt;
	for (const part of compressed) {
		bytes.set(part, body);
		body += part.length;
	}
	return bytes;
}

describe('decodeSpz', () => {
	it('reads the centres, the spreads, the rotation, the alpha and the colour', async () => {
		const cloud = await decodeSpz(await gzip(legacyFile()));
		expect(cloud.count).toBe(2);
		expect([...cloud.positions.subarray(0, 6)]).toEqual([1, 2, -1, 0.5, 0, 3]);
		// The spreads are logarithms, so the byte's value comes back as its exponential.
		expect(cloud.scales[0]).toBeCloseTo(1, 5);
		expect(cloud.scales[1]).toBeCloseTo(Math.E, 5);
		expect(cloud.scales[2]).toBeCloseTo(Math.E ** 2, 4);
		expect([...cloud.rotations.subarray(0, 4)]).toEqual([0, 0, 0, 1]);
		expect(cloud.colors[3]).toBeCloseTo(1, 5);
		expect(cloud.colors[7]).toBe(0);
		// The first band's value, moved onto 0 to 1 and decoded from sRGB, is a light grey.
		expect(cloud.colors[0]).toBeCloseTo(0.2175, 3);
	});

	it('refuses a file that is not an SPZ file', async () => {
		await expect(decodeSpz(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow('not an SPZ file');
	});

	it('refuses a file that its header cuts short', async () => {
		const cut = legacyFile().subarray(0, 20);
		await expect(decodeSpz(await gzip(cut))).rejects.toThrow('cut short');
	});

	it('reads a version 4 file from its table of contents and its zstd streams', async () => {
		const cloud = await decodeSpz(await zstdFile());
		expect(cloud.count).toBe(2);
		expect([...cloud.positions.subarray(0, 6)]).toEqual([1, 2, -1, 0.5, 0, 3]);
		expect(cloud.scales[0]).toBeCloseTo(1, 5);
		expect([...cloud.rotations.subarray(0, 4)]).toEqual([0, 0, 0, 1]);
		expect(cloud.colors[3]).toBeCloseTo(1, 5);
		expect(cloud.colors[0]).toBeCloseTo(0.2175, 3);
	});

	it('refuses a version 4 file whose streams do not fill the file', async () => {
		const file = await zstdFile();
		await expect(decodeSpz(file.subarray(0, file.length - 3))).rejects.toThrow('streams end at');
	});

	it('refuses a version 4 file whose table of contents lies outside it', async () => {
		const file = await zstdFile();
		new DataView(file.buffer).setUint32(16, file.length + 64, true);
		await expect(decodeSpz(file)).rejects.toThrow('table of contents outside the file');
	});
});
