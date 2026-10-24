// The SPZ reader: the header's sizes, the fixed-point centres, the log spreads, the smallest-three
// rotations, the alpha and the first-band colour. The test writes a small version 3 file, gzips it
// as a writer does, and reads it back.
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
});
