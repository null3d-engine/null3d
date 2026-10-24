// Writes a cloud as the compressed SPZ file that this add-on reads: a gzip stream around a version 3
// header and the packed attribute arrays. A stream writer cuts a large cloud with `chunkSplats` and
// writes each chunk with `encodeSpz`, so a page can load the chunks that its view asks for.
import { type SplatData, splatsError } from './format';

/** The magic value of every SPZ container, which reads "NGSP" in little-endian bytes. */
const MAGIC = 0x5053474e;

/** The version that this writer makes: the compressed containers start at version 4. */
const VERSION = 3;

/** The constant that turns the first spherical-harmonic band into a color. */
const SH_C0 = 0.2820947917738781;

/** The scale that turns a first-band coefficient into a byte. */
const COLOR_SCALE = 0.15;

/** The largest magnitude that a 24-bit signed fixed-point value holds. */
const FIXED_MAX = 8_388_607;

/** The most fractional bits that a center may keep, which keeps meters precise to about 0.1 mm. */
const MOST_FRACTIONAL_BITS = 14;

/**
 * Writes a cloud as a version 3 SPZ file, gzipped as the readers of the format expect. A stream
 * writer cuts a cloud with `chunkSplats` and writes each chunk with this call, then names the files
 * in a stream index. Throws E2101 for a cloud whose arrays do not fit its count.
 *
 * @category api/splats
 */
export async function encodeSpz(data: SplatData): Promise<Uint8Array> {
	const { count, positions, scales, rotations, colors } = data;
	if (
		!Number.isInteger(count) ||
		count < 0 ||
		positions.length !== count * 3 ||
		scales.length !== count * 3 ||
		rotations.length !== count * 4 ||
		colors.length !== count * 4
	)
		throw splatsError(
			2101,
			'this cloud does not give every one of its splats an entry in each array.',
		);
	const fractionalBits = bitsFor(positions, count);
	const bytes = new Uint8Array(16 + count * (3 * 3 + 1 + 3 + 3 + 4));
	const view = new DataView(bytes.buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, VERSION, true);
	view.setUint32(8, count, true);
	bytes[12] = 0;
	bytes[13] = fractionalBits;
	let at = 16;
	const fixed = (value: number): void => {
		const raw = Math.max(
			-FIXED_MAX - 1,
			Math.min(FIXED_MAX, Math.round(value * 2 ** fractionalBits)),
		);
		bytes[at] = raw & 0xff;
		bytes[at + 1] = (raw >> 8) & 0xff;
		bytes[at + 2] = (raw >> 16) & 0xff;
		at += 3;
	};
	for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) fixed(positions[i * 3 + k] as number);
	for (let i = 0; i < count; i++) bytes[at++] = toByte((colors[i * 4 + 3] as number) * 255);
	for (let i = 0; i < count; i++) {
		// The file stores a color as its first band: the inverse of the reader's own step.
		const dc = channelOfSh(colors, i * 4);
		for (let k = 0; k < 3; k++) bytes[at++] = toByte((dc[k] as number) * COLOR_SCALE * 255 + 127.5);
	}
	for (let i = 0; i < count; i++)
		for (let k = 0; k < 3; k++) {
			const scale = Math.max(scales[i * 3 + k] as number, 1e-30);
			bytes[at++] = toByte((Math.log(scale) + 10) * 16);
		}
	for (let i = 0; i < count; i++) {
		view.setUint32(at, quaternionWord(rotations, i * 4), true);
		at += 4;
	}
	return gzip(bytes);
}

/** The fractional bits that keep the cloud's largest center in the fixed-point range. */
function bitsFor(positions: Float32Array, count: number): number {
	let largest = 0;
	for (let i = 0; i < count * 3; i++) {
		const value = Math.abs(positions[i] as number);
		if (value > largest) largest = value;
	}
	let bits = MOST_FRACTIONAL_BITS;
	while (bits > 0 && largest * 2 ** bits > FIXED_MAX) bits--;
	if (largest * 2 ** bits > FIXED_MAX)
		throw splatsError(
			2101,
			`this cloud reaches ${largest} meters from its origin, which is too far to write. Move the cloud's origin nearer to it.`,
		);
	return bits;
}

/** The three first-band coefficients of a linear color, which the reader turns back into the color. */
function channelOfSh(colors: Float32Array, at: number): [number, number, number] {
	return [0, 1, 2].map((k) => {
		const linear = Math.min(Math.max(colors[at + k] as number, 0), 1);
		const display = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
		return (display - 0.5) / SH_C0;
	}) as [number, number, number];
}

/** A rounded byte, held inside the byte range. */
function toByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

/** A quaternion in the smallest-three form: two bits name the largest part, and the others follow. */
function quaternionWord(rotations: Float32Array, at: number): number {
	const values = [
		rotations[at] as number,
		rotations[at + 1] as number,
		rotations[at + 2] as number,
		rotations[at + 3] as number,
	];
	if ((values[3] as number) < 0) for (let k = 0; k < 4; k++) values[k] = -(values[k] as number);
	let largest = 0;
	for (let k = 1; k < 4; k++)
		if (Math.abs(values[k] as number) > Math.abs(values[largest] as number)) largest = k;
	const sign = (values[largest] as number) < 0 ? -1 : 1;
	let word = largest << 30;
	let shift = 0;
	for (let k = 3; k >= 0; k--) {
		if (k === largest) continue;
		const value = (values[k] as number) * sign;
		const magnitude = Math.min(511, Math.round((Math.abs(value) / Math.SQRT1_2) * 511));
		word |= (((value < 0 ? 1 : 0) << 9) | magnitude) << shift;
		shift += 10;
	}
	return word >>> 0;
}

/** Wraps the file in the gzip stream that the readers of the format expect. */
async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	// A typed array is a part of a blob at run time; the type keeps the buffer it views.
	const stream = new Blob([bytes as unknown as ArrayBuffer])
		.stream()
		.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
