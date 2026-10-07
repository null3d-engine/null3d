// Panoramas of the light around a point, in Radiance (.hdr) and OpenEXR (.exr) files, which
// `assets.loadEnvironment` prefilters on the GPU at load. The panorama worker
// (workers/panorama-worker.ts) runs these readers off the sketch's frames.
//
// Each reader hands its rows, as 32-bit floats of red, green and blue, to a builder. The builder
// projects every row onto the nine spherical harmonics of the diffuse light, as the asset tool
// does, and averages squares of texels when the image is wider than the GPU's generator needs.
// Then it packs the panorama as shared-exponent texels for the GPU, divided by a power of two
// that keeps the brightest texel within the format. The generator multiplies that power of two
// back in where it writes the map, so a sun brighter than a 16-bit float keeps its light in the
// rough levels, as in the tool's 32-bit filter (D-19).
//
// The OpenEXR reader's decoders for PIZ, RLE, ZIP, PXR24 and B44 data follow three.js's
// `EXRLoader` (MIT), which follows TinyEXR and OpenEXR (BSD-3-Clause). THIRD-PARTY-NOTICES.txt
// holds their notices.
//
// The module imports only the file limits and the files' identifiers, so the worker's bundle holds
// its own copy of them.

import { isPanoramaFile } from './environment-file';
import { FILE_LIMITS } from './file-limits';

/** The largest value of a shared-exponent texel: 511 times 2 to the power 7. */
export const SHARED_EXPONENT_MAX = 65408;

/**
 * A panorama as the GPU's generator maps it onto a cube: an equirectangular image whose row 0 is
 * the top, the direction +Y, with columns as three.js maps them (the middle column faces +X).
 */
export interface Panorama {
	readonly width: number;
	readonly height: number;
	/** Shared-exponent texels of the light divided by `gain`, row after row. */
	readonly texels: Uint32Array;
	/** The power of two, 1 or more, that the generator multiplies each texel's light by. */
	readonly gain: number;
}

/** A panorama file as the readers give it: the panorama and its diffuse light. */
export interface PanoramaFile {
	readonly panorama: Panorama;
	/** The nine coefficients' red, green and blue values, in three.js's order. */
	readonly sh: Float32Array;
}

/**
 * Reads a Radiance or OpenEXR file into a panorama at most `maxSide` texels on each side, or
 * throws an Error that says what is wrong with the file.
 */
export async function readPanorama(bytes: ArrayBuffer, maxSide: number): Promise<PanoramaFile> {
	const file = new Uint8Array(bytes);
	if (!isPanoramaFile(file))
		throw new Error('it is neither a Radiance file (.hdr) nor an OpenEXR file (.exr)');
	return file[0] === 0x23 ? readRadiance(file, maxSide) : readOpenExr(file, maxSide);
}

/** Throws unless the image's sides are from 1 to the largest image side that the engine reads. */
function checkSize(width: number, height: number): void {
	const most = FILE_LIMITS.imageSide;
	if (!(width >= 1 && height >= 1 && width <= most && height <= most))
		throw new Error(`it is ${width} x ${height} texels; give an image from 1 to ${most} a side`);
}

// --- The builder --------------------------------------------------------------------------------

/**
 * Takes an image's rows in any order and builds its panorama and diffuse light. The panorama
 * averages squares of a power of two texels a side, the fewest that bring both sides within the
 * largest side.
 */
export class PanoramaBuilder {
	/** The panorama's width and height. */
	readonly width: number;
	readonly height: number;
	/** The side of the squares that each panorama texel averages. */
	private readonly factor: number;
	/** The sums of each panorama texel's red, green and blue. */
	private readonly sums: Float32Array;
	/** Each image column's panorama column. */
	private readonly columns: Int32Array;
	/** The cosine and sine of each image column's angle about Y, and of twice it. */
	private readonly cos1: Float64Array;
	private readonly sin1: Float64Array;
	private readonly cos2: Float64Array;
	private readonly sin2: Float64Array;
	private readonly sh = new Float64Array(27);
	/** One row's five sums of each channel, reused. */
	private readonly row5 = new Float64Array(15);

	constructor(
		private readonly sourceWidth: number,
		private readonly sourceHeight: number,
		maxSide: number,
	) {
		let factor = 1;
		while (Math.ceil(sourceWidth / factor) > maxSide || Math.ceil(sourceHeight / factor) > maxSide)
			factor *= 2;
		this.factor = factor;
		this.width = Math.ceil(sourceWidth / factor);
		this.height = Math.ceil(sourceHeight / factor);
		this.sums = new Float32Array(this.width * this.height * 3);
		this.columns = new Int32Array(sourceWidth);
		this.cos1 = new Float64Array(sourceWidth);
		this.sin1 = new Float64Array(sourceWidth);
		this.cos2 = new Float64Array(sourceWidth);
		this.sin2 = new Float64Array(sourceWidth);
		// Each column's average of the cosine and sine over its width is the value at its center
		// times a factor of the width, so the projection integrates each texel exactly.
		const width = (2 * Math.PI) / sourceWidth;
		const once = Math.sin(width / 2) / (width / 2);
		const twice = Math.sin(width) / width;
		for (let x = 0; x < sourceWidth; x++) {
			this.columns[x] = Math.floor(x / factor);
			// The column's center lies at u = (x + 0.5) / width, the angle atan2(z, x) = 2 pi (u - 0.5).
			const phi = 2 * Math.PI * ((x + 0.5) / sourceWidth - 0.5);
			this.cos1[x] = Math.cos(phi) * once;
			this.sin1[x] = Math.sin(phi) * once;
			this.cos2[x] = Math.cos(2 * phi) * twice;
			this.sin2[x] = Math.sin(2 * phi) * twice;
		}
	}

	/**
	 * Adds image row `y`, from 0 at the top, as red, green and blue. A value that is negative or
	 * not finite counts as no light, as the asset tool reads it.
	 */
	row(y: number, r: Float32Array, g: Float32Array, b: Float32Array): void {
		const { sourceWidth: width, sourceHeight: height, sums, columns, row5 } = this;
		const { cos1, sin1, cos2, sin2 } = this;
		const out = Math.floor(y / this.factor) * this.width;
		for (let ch = 0; ch < 3; ch++) {
			const light = ch === 0 ? r : ch === 1 ? g : b;
			let [sum, cosine, sine, cosine2, sine2] = [0, 0, 0, 0, 0];
			for (let x = 0; x < width; x++) {
				const raw = light[x] as number;
				// NaN fails both comparisons, so it counts as no light too.
				const v = raw > 0 && raw < Number.POSITIVE_INFINITY ? raw : 0;
				const at = 3 * (out + (columns[x] as number)) + ch;
				sums[at] = (sums[at] as number) + v;
				sum += v;
				cosine += v * (cos1[x] as number);
				sine += v * (sin1[x] as number);
				cosine2 += v * (cos2[x] as number);
				sine2 += v * (sin2[x] as number);
			}
			row5.set([sum, cosine, sine, cosine2, sine2], 5 * ch);
		}
		this.project(y, height, width);
	}

	/**
	 * Adds a row's sums to the nine coefficients. In the row, a direction is (c cos phi, s, c sin
	 * phi) for the sine `s` and cosine `c` of its latitude, so each basis function is a sum of the
	 * row's light times 1, cos phi, sin phi, cos 2 phi and sin 2 phi, scaled by the row's averages
	 * of s, c, s c and s squared over its band of the sphere, which have closed forms.
	 */
	private project(y: number, height: number, width: number): void {
		const { sh, row5 } = this;
		const top = Math.sin(Math.PI / 2 - (y * Math.PI) / height);
		const bottom = Math.sin(Math.PI / 2 - ((y + 1) * Math.PI) / height);
		const band = top - bottom;
		const solidAngle = ((2 * Math.PI) / width) * band;
		// Integrals over s of c = sqrt(1 - s^2) and of s c.
		const ofC = (v: number) => (v * Math.sqrt(1 - v * v) + Math.asin(v)) / 2;
		const ofSc = (v: number) => -((1 - v * v) ** 1.5) / 3;
		const s = (top + bottom) / 2;
		const ss = (top * top + top * bottom + bottom * bottom) / 3;
		const cc = Math.max(1 - ss, 0);
		const c = (ofC(top) - ofC(bottom)) / band;
		const sc = (ofSc(top) - ofSc(bottom)) / band;
		for (let ch = 0; ch < 3; ch++) {
			const k = 5 * ch;
			const sum = row5[k] as number;
			const cosine = row5[k + 1] as number;
			const sine = row5[k + 2] as number;
			const cosine2 = row5[k + 3] as number;
			const sine2 = row5[k + 4] as number;
			const terms = [
				0.282095 * sum,
				0.488603 * s * sum,
				0.488603 * c * sine,
				0.488603 * c * cosine,
				1.092548 * sc * cosine,
				1.092548 * sc * sine,
				0.315392 * (1.5 * cc * (sum - cosine2) - sum),
				1.092548 * cc * 0.5 * sine2,
				0.546274 * (0.5 * cc * (sum + cosine2) - ss * sum),
			];
			for (let n = 0; n < 9; n++)
				sh[3 * n + ch] = (sh[3 * n + ch] as number) + solidAngle * (terms[n] as number);
		}
	}

	/** The panorama and its diffuse light, once every row was added. */
	finish(): PanoramaFile {
		const { width, height, factor, sums, sourceWidth, sourceHeight } = this;
		let peak = 0;
		for (let y = 0; y < height; y++) {
			const rows = Math.min(factor, sourceHeight - y * factor);
			for (let x = 0; x < width; x++) {
				const count = rows * Math.min(factor, sourceWidth - x * factor);
				const at = 3 * (y * width + x);
				for (let ch = 0; ch < 3; ch++) {
					const v = (sums[at + ch] as number) / count;
					sums[at + ch] = v;
					if (v > peak) peak = v;
				}
			}
		}
		let gain = 1;
		while (peak / gain > SHARED_EXPONENT_MAX) gain *= 2;
		const texels = new Uint32Array(width * height);
		const scale = 1 / gain;
		for (let k = 0; k < texels.length; k++)
			texels[k] = rgb9e5(
				(sums[3 * k] as number) * scale,
				(sums[3 * k + 1] as number) * scale,
				(sums[3 * k + 2] as number) * scale,
			);
		return { panorama: { width, height, texels, gain }, sh: Float32Array.from(this.sh) };
	}
}

/**
 * The shared-exponent texel of `EXT_texture_shared_exponent`, rounded to nearest, as the asset
 * tool packs it: values of 0 or more, each limited to the format's largest.
 */
export function rgb9e5(r: number, g: number, b: number): number {
	const red = Math.min(r, SHARED_EXPONENT_MAX);
	const green = Math.min(g, SHARED_EXPONENT_MAX);
	const blue = Math.min(b, SHARED_EXPONENT_MAX);
	const largest = Math.max(red, green, blue);
	if (!(largest >= 2 ** -24)) return 0;
	let floorLog = Math.floor(Math.log2(largest));
	// log2 can land one off next to a power of two.
	if (2 ** floorLog > largest) floorLog--;
	else if (2 ** (floorLog + 1) <= largest) floorLog++;
	let exponent = Math.max(floorLog, -16) + 16;
	let unit = 2 ** (exponent - 24);
	if (Math.floor(largest / unit + 0.5) >= 512) {
		exponent++;
		unit *= 2;
	}
	const m = (c: number) => Math.min(Math.floor(c / unit + 0.5), 511);
	return (m(red) | (m(green) << 9) | (m(blue) << 18) | (exponent << 27)) >>> 0;
}

// --- Radiance -----------------------------------------------------------------------------------

/** 2 to the power `e - 136` for each RGBE exponent byte, so a channel's light is its byte times it. */
let rgbeScale: Float64Array | undefined;

/**
 * Reads a Radiance file of RGBE texels with rows from the top down, flat or with the run-length
 * rows that Radiance writes, as the asset tool and three.js's `HDRLoader` read it.
 */
function readRadiance(file: Uint8Array, maxSide: number): PanoramaFile {
	let at = 0;
	const line = () => {
		const end = file.indexOf(0x0a, at);
		if (end < 0) throw new Error('its Radiance header ends before its size line');
		const text = String.fromCharCode(...file.subarray(at, Math.min(end, at + 256)));
		at = end + 1;
		return text;
	};
	line();
	for (let header = line(); header.trim() !== ''; header = line()) {
		const format = header.startsWith('FORMAT=') ? header.slice(7).trim() : '';
		if (format && format !== '32-bit_rle_rgbe')
			throw new Error(`it holds Radiance texels of ${format}, not 32-bit_rle_rgbe`);
	}
	const size = line().trim();
	const parts = size.split(/\s+/);
	if (parts.length !== 4 || parts[0] !== '-Y' || parts[2] !== '+X')
		throw new Error(
			`its Radiance size line is "${size}", and the engine reads images stored from the top row down (-Y height +X width)`,
		);
	const height = Number(parts[1]);
	const width = Number(parts[3]);
	if (!Number.isInteger(height) || !Number.isInteger(width))
		throw new Error(`its Radiance size line "${size}" has no whole numbers`);
	checkSize(width, height);
	if (!rgbeScale) {
		rgbeScale = new Float64Array(256);
		for (let e = 1; e < 256; e++) rgbeScale[e] = 2 ** (e - 136);
	}
	const scales = rgbeScale;
	const builder = new PanoramaBuilder(width, height, maxSide);
	const row = new Uint8Array(4 * width);
	const red = new Float32Array(width);
	const green = new Float32Array(width);
	const blue = new Float32Array(width);
	const short = 'its Radiance texels end before its last row';
	const runs = width >= 8 && width < 0x8000;
	for (let y = 0; y < height; y++) {
		if (at + 4 > file.length) throw new Error(short);
		if (runs && file[at] === 2 && file[at + 1] === 2 && !((file[at + 2] as number) & 0x80)) {
			if ((((file[at + 2] as number) << 8) | (file[at + 3] as number)) !== width)
				throw new Error("a Radiance row's length does not match the image's width");
			at += 4;
			for (let channel = 0; channel < 4; channel++) {
				for (let x = 0; x < width; ) {
					if (at >= file.length) throw new Error(short);
					let count = file[at++] as number;
					if (count > 128) {
						count -= 128;
						if (x + count > width || at >= file.length)
							throw new Error("a Radiance row runs past the image's width");
						const value = file[at++] as number;
						for (const end = x + count; x < end; x++) row[4 * x + channel] = value;
					} else {
						if (count === 0 || x + count > width || at + count > file.length)
							throw new Error("a Radiance row runs past the image's width");
						for (const end = x + count; x < end; x++) row[4 * x + channel] = file[at++] as number;
					}
				}
			}
		} else {
			if (at + 4 * width > file.length) throw new Error(short);
			row.set(file.subarray(at, at + 4 * width));
			at += 4 * width;
		}
		for (let x = 0; x < width; x++) {
			const scale = scales[row[4 * x + 3] as number] as number;
			red[x] = (row[4 * x] as number) * scale;
			green[x] = (row[4 * x + 1] as number) * scale;
			blue[x] = (row[4 * x + 2] as number) * scale;
		}
		builder.row(y, red, green, blue);
	}
	return builder.finish();
}

// --- OpenEXR ------------------------------------------------------------------------------------

/** OpenEXR's pixel types: 32-bit whole numbers, half floats and floats. */
const UINT = 0;
const HALF = 1;
const FLOAT = 2;

/** Bytes of a value of each pixel type. */
const TYPE_BYTES = [4, 2, 4];

/** The compressions, by their number in the file, and the rows that a chunk of each holds. */
const COMPRESSIONS = [
	['none', 1],
	['RLE', 1],
	['ZIPS', 1],
	['ZIP', 16],
	['PIZ', 32],
	['PXR24', 16],
	['B44', 32],
	['B44A', 32],
	['DWAA', 32],
	['DWAB', 256],
] as const;

type Compression = (typeof COMPRESSIONS)[number][0];

/** The chunks that inflate at once, ahead of the one that the reader takes next. */
const CHUNKS_AHEAD = 8;

/** A channel of the file: its name, pixel type, and whether B44 stores it as perceptual values. */
interface Channel {
	name: string;
	type: number;
	linear: boolean;
}

/** What the reader needs of an OpenEXR file's header. */
interface ExrHeader {
	channels: Channel[];
	compression: Compression;
	/** The rows of each chunk. */
	block: number;
	/** The data window's first row, and its size. */
	top: number;
	width: number;
	height: number;
	/** Where the offset table starts. */
	end: number;
}

/**
 * Reads the R, G and B channels of a single-part scanline OpenEXR file, as three.js's
 * `EXRLoader` does. It reads every compression but DWAA and DWAB, as the asset tool does.
 */
async function readOpenExr(file: Uint8Array, maxSide: number): Promise<PanoramaFile> {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	if (file.length < 8) throw new Error('its OpenEXR header ends early');
	const flags = file[5] as number;
	if (flags & 2) throw new Error('it is a tiled OpenEXR file; save it with scanlines');
	if (flags & 8) throw new Error('it holds OpenEXR deep data, which holds no picture');
	if (flags & 16) throw new Error('it is a multi-part OpenEXR file; save its picture as one part');
	const header = readExrHeader(file, view);
	const { channels, compression, block, top, width, height } = header;
	checkSize(width, height);
	if (compression === 'DWAA' || compression === 'DWAB')
		throw new Error(`its OpenEXR data has ${compression} compression; save it with PIZ or ZIP`);
	const find = (name: string) => {
		const index = channels.findIndex((c) => c.name === name);
		if (index < 0) throw new Error('it has no R, G and B channels');
		return index;
	};
	const rgb = [find('R'), find('G'), find('B')];
	if (compression === 'B44' || compression === 'B44A')
		for (const k of rgb)
			if ((channels[k] as Channel).linear && (channels[k] as Channel).type === HALF)
				throw new Error('its B44 data holds perceptual channels; save it with PIZ or ZIP');
	// Each channel's place within a row of a chunk's raw data, as bytes per texel before it.
	const offsets: number[] = [];
	let texelBytes = 0;
	for (const channel of channels) {
		offsets.push(texelBytes);
		texelBytes += TYPE_BYTES[channel.type] as number;
	}
	const rowBytes = texelBytes * width;
	if (rowBytes * block > FILE_LIMITS.itemBytes)
		throw new Error(`its rows of ${rowBytes} bytes are too large to read`);
	const chunks = Math.ceil(height / block);
	if (header.end + 8 * chunks > file.length) throw new Error('its OpenEXR offset table ends early');
	const builder = new PanoramaBuilder(width, height, maxSide);
	const red = new Float32Array(width);
	const green = new Float32Array(width);
	const blue = new Float32Array(width);
	const outs = [red, green, blue];
	const halves = halfTable();
	const decoder = new ChunkDecoder(channels, width, compression);
	const rowsDone = new Uint8Array(height);
	// Inflating a chunk waits for the browser's decompression stream, so a few run at once.
	const raw = (chunk: number) => {
		const offset = view.getUint32(header.end + 8 * chunk, true);
		const high = view.getUint32(header.end + 8 * chunk + 4, true);
		if (high !== 0 || offset + 8 > file.length)
			throw new Error(`its chunk ${chunk} lies outside the file`);
		const y = view.getInt32(offset, true) - top;
		const size = view.getUint32(offset + 4, true);
		if (!(y >= 0 && y < height) || offset + 8 + size > file.length)
			throw new Error(`its chunk ${chunk} names rows or bytes outside the file`);
		const lines = Math.min(block, height - y);
		const data = file.subarray(offset + 8, offset + 8 + size);
		// A chunk that compression would not shrink is stored as it is.
		const bytes = size < lines * rowBytes ? decoder.decode(data, lines) : data;
		const made = Promise.resolve(bytes).then((b) => [y, lines, b] as const);
		// A chunk that fails while the reader waits for an earlier one fails the read only once.
		made.catch(() => undefined);
		return made;
	};
	const window: ReturnType<typeof raw>[] = [];
	for (let next = 0; next < Math.min(CHUNKS_AHEAD, chunks); next++) window.push(raw(next));
	for (let chunk = 0; chunk < chunks; chunk++) {
		const [y, lines, bytes] = await (window.shift() as ReturnType<typeof raw>);
		if (chunk + CHUNKS_AHEAD < chunks) window.push(raw(chunk + CHUNKS_AHEAD));
		if (bytes.length < lines * rowBytes)
			throw new Error(`its chunk ${chunk} holds fewer bytes than its rows`);
		const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		for (let line = 0; line < lines; line++) {
			if (rowsDone[y + line]) throw new Error(`it holds row ${y + line} twice`);
			rowsDone[y + line] = 1;
			for (let c = 0; c < 3; c++) {
				const channel = channels[rgb[c] as number] as Channel;
				const out = outs[c] as Float32Array;
				let at = line * rowBytes + (offsets[rgb[c] as number] as number) * width;
				if (channel.type === HALF)
					for (let x = 0; x < width; x++, at += 2)
						out[x] = halves[data.getUint16(at, true)] as number;
				else if (channel.type === FLOAT)
					for (let x = 0; x < width; x++, at += 4) out[x] = data.getFloat32(at, true);
				else for (let x = 0; x < width; x++, at += 4) out[x] = data.getUint32(at, true);
			}
			builder.row(y + line, red, green, blue);
		}
	}
	if (rowsDone.includes(0)) throw new Error('it lacks some of its rows');
	return builder.finish();
}

/** Reads an OpenEXR file's single header. */
function readExrHeader(file: Uint8Array, view: DataView): ExrHeader {
	let at = 8;
	const text = () => {
		const end = file.indexOf(0, at);
		if (end < 0 || end - at > 255) throw new Error('its OpenEXR header ends early');
		const value = String.fromCharCode(...file.subarray(at, end));
		at = end + 1;
		return value;
	};
	let channels: Channel[] | undefined;
	let compression: number | undefined;
	let window: [number, number, number, number] | undefined;
	for (let name = text(); name !== ''; name = text()) {
		const type = text();
		if (at + 4 > file.length) throw new Error('its OpenEXR header ends early');
		const size = view.getUint32(at, true);
		const start = at + 4;
		at = start + size;
		if (at > file.length) throw new Error('its OpenEXR header ends early');
		if (name === 'channels' && type === 'chlist') channels = readChannels(file, view, start, at);
		else if (name === 'compression' && type === 'compression') compression = file[start];
		else if (name === 'dataWindow' && type === 'box2i' && size === 16)
			window = [0, 4, 8, 12].map((k) => view.getInt32(start + k, true)) as typeof window;
	}
	if (!channels || compression === undefined || !window)
		throw new Error('its OpenEXR header lacks its channels, compression or data window');
	const known = COMPRESSIONS[compression];
	if (!known) throw new Error(`its OpenEXR data has compression ${compression}, which is unknown`);
	const [xMin, yMin, xMax, yMax] = window;
	return {
		channels,
		compression: known[0],
		block: known[1],
		top: yMin,
		width: xMax - xMin + 1,
		height: yMax - yMin + 1,
		end: at,
	};
}

/** Reads a channel list from `start` up to `end`. */
function readChannels(file: Uint8Array, view: DataView, start: number, end: number): Channel[] {
	const channels: Channel[] = [];
	let at = start;
	while (at < end - 1) {
		const close = file.indexOf(0, at);
		if (close < 0 || close + 17 > end) throw new Error('its OpenEXR channel list ends early');
		const name = String.fromCharCode(...file.subarray(at, close));
		at = close + 1;
		const type = view.getInt32(at, true);
		const linear = file[at + 4] !== 0;
		const xSampling = view.getInt32(at + 8, true);
		const ySampling = view.getInt32(at + 12, true);
		at += 16;
		if (type !== UINT && type !== HALF && type !== FLOAT)
			throw new Error(`its channel ${name} has the pixel type ${type}, which is unknown`);
		if (xSampling !== 1 || ySampling !== 1)
			throw new Error(`its channel ${name} is subsampled; save the picture as full R, G and B`);
		channels.push({ name, type, linear });
	}
	if (channels.length === 0) throw new Error('its OpenEXR channel list is empty');
	return channels;
}

/** Each half float's value as a 32-bit float, by its bits. */
let halves: Float32Array | undefined;

function halfTable(): Float32Array {
	if (halves) return halves;
	halves = new Float32Array(65536);
	for (let bits = 0; bits < 65536; bits++) {
		const exponent = (bits >> 10) & 31;
		const fraction = bits & 1023;
		const magnitude =
			exponent === 0
				? fraction * 2 ** -24
				: exponent === 31
					? fraction
						? Number.NaN
						: Number.POSITIVE_INFINITY
					: (1 + fraction / 1024) * 2 ** (exponent - 15);
		halves[bits] = bits & 0x8000 ? -magnitude : magnitude;
	}
	return halves;
}

/**
 * Decodes the chunks of one file into their raw data: for each row of the chunk, each channel's
 * values in the file's channel order, little-endian.
 */
class ChunkDecoder {
	/** Bytes of a row of raw data. */
	private readonly rowBytes: number;
	private piz: Piz | undefined;

	constructor(
		private readonly channels: readonly Channel[],
		private readonly width: number,
		private readonly compression: Compression,
	) {
		this.rowBytes = width * channels.reduce((sum, c) => sum + (TYPE_BYTES[c.type] as number), 0);
	}

	/** The raw data of a compressed chunk of `lines` rows. */
	decode(data: Uint8Array, lines: number): Uint8Array | Promise<Uint8Array> {
		const size = lines * this.rowBytes;
		switch (this.compression) {
			case 'RLE':
				return unpredict(runLength(data, size));
			case 'ZIPS':
			case 'ZIP':
				return inflate(data, size).then(unpredict);
			case 'PIZ':
				this.piz ??= new Piz();
				return this.piz.decode(data, this.channels, this.width, lines);
			case 'PXR24':
				return inflate(data, this.pxr24Bytes(lines)).then((planes) =>
					this.pxr24(planes, lines, size),
				);
			case 'B44':
			case 'B44A':
				return this.b44(data, lines, size);
			default:
				throw new Error('a chunk holds fewer bytes than its rows');
		}
	}

	/** Bytes of a PXR24 chunk once inflated: floats keep their top 24 bits. */
	private pxr24Bytes(lines: number): number {
		const bytes = this.channels.reduce(
			(sum, c) => sum + (c.type === FLOAT ? 3 : c.type === HALF ? 2 : 4),
			0,
		);
		return lines * this.width * bytes;
	}

	/**
	 * PXR24 rows: for each channel, the bytes of each value's differences from the value before,
	 * most significant byte plane first.
	 */
	private pxr24(planes: Uint8Array, lines: number, size: number): Uint8Array {
		const { width, channels } = this;
		const out = new Uint8Array(size);
		const view = new DataView(out.buffer);
		let from = 0;
		let to = 0;
		for (let line = 0; line < lines; line++)
			for (const channel of channels) {
				const count = channel.type === FLOAT ? 3 : channel.type === HALF ? 2 : 4;
				let value = 0;
				for (let x = 0; x < width; x++) {
					let difference = 0;
					for (let plane = 0; plane < count; plane++)
						difference = (difference << 8) | (planes[from + plane * width + x] as number);
					if (channel.type === FLOAT) difference <<= 8;
					if (channel.type === HALF) {
						value = (value + difference) & 0xffff;
						view.setUint16(to, value, true);
						to += 2;
					} else {
						value = (value + difference) >>> 0;
						view.setUint32(to, value, true);
						to += 4;
					}
				}
				from += count * width;
			}
		return out;
	}

	/**
	 * B44 and B44A rows: each half-float channel in blocks of 4 x 4 values, 14 bytes each, or 3
	 * bytes for a block of one value in B44A; other channels as they are, row after row.
	 */
	private b44(data: Uint8Array, lines: number, size: number): Uint8Array {
		const { width, channels, rowBytes } = this;
		const flat = this.compression === 'B44A';
		const out = new Uint8Array(size);
		const block = new Uint16Array(16);
		const deltas = new Int32Array(16);
		let at = 0;
		let offset = 0;
		const need = (bytes: number) => {
			if (at + bytes > data.length) throw new Error('its B44 data ends early');
		};
		for (const channel of channels) {
			const bytes = TYPE_BYTES[channel.type] as number;
			if (channel.type !== HALF) {
				for (let line = 0; line < lines; line++) {
					need(width * bytes);
					out.set(data.subarray(at, at + width * bytes), line * rowBytes + offset * width);
					at += width * bytes;
				}
				offset += bytes;
				continue;
			}
			for (let by = 0; by < lines; by += 4)
				for (let bx = 0; bx < width; bx += 4) {
					need(3);
					if (flat && (data[at + 2] as number) >= 52) {
						const t = ((data[at] as number) << 8) | (data[at + 1] as number);
						block.fill(t & 0x8000 ? t & 0x7fff : ~t & 0xffff);
						at += 3;
					} else {
						need(14);
						b44Block(data, at, block, deltas);
						at += 14;
					}
					for (let y = 0; y < 4 && by + y < lines; y++)
						for (let x = 0; x < 4 && bx + x < width; x++) {
							const value = block[4 * y + x] as number;
							const to = (by + y) * rowBytes + offset * width + 2 * (bx + x);
							out[to] = value & 0xff;
							out[to + 1] = value >> 8;
						}
				}
			offset += 2;
		}
		return out;
	}
}

/** Decodes a 14-byte B44 block of 16 half floats into `block`. */
function b44Block(data: Uint8Array, at: number, block: Uint16Array, s: Int32Array): void {
	const d = (k: number) => data[at + k] as number;
	const shift = d(2) >> 2;
	const bias = 0x20 << shift;
	const step = (from: number, bits: number) => (from + bits * (1 << shift) - bias) & 0xffff;
	s[0] = (d(0) << 8) | d(1);
	s[4] = step(s[0] as number, ((d(2) << 4) | (d(3) >> 4)) & 0x3f);
	s[8] = step(s[4] as number, ((d(3) << 2) | (d(4) >> 6)) & 0x3f);
	s[12] = step(s[8] as number, d(4) & 0x3f);
	s[1] = step(s[0] as number, (d(5) >> 2) & 0x3f);
	s[5] = step(s[4] as number, ((d(5) << 4) | (d(6) >> 4)) & 0x3f);
	s[9] = step(s[8] as number, ((d(6) << 2) | (d(7) >> 6)) & 0x3f);
	s[13] = step(s[12] as number, d(7) & 0x3f);
	s[2] = step(s[1] as number, (d(8) >> 2) & 0x3f);
	s[6] = step(s[5] as number, ((d(8) << 4) | (d(9) >> 4)) & 0x3f);
	s[10] = step(s[9] as number, ((d(9) << 2) | (d(10) >> 6)) & 0x3f);
	s[14] = step(s[13] as number, d(10) & 0x3f);
	s[3] = step(s[2] as number, (d(11) >> 2) & 0x3f);
	s[7] = step(s[6] as number, ((d(11) << 4) | (d(12) >> 4)) & 0x3f);
	s[11] = step(s[10] as number, ((d(12) << 2) | (d(13) >> 6)) & 0x3f);
	s[15] = step(s[14] as number, d(13) & 0x3f);
	// The values are ordered magnitudes: a set top bit marks a positive half float.
	for (let k = 0; k < 16; k++) {
		const t = s[k] as number;
		block[k] = t & 0x8000 ? t & 0x7fff : ~t & 0xffff;
	}
}

/** Inflates zlib data that must come to exactly `size` bytes, with the browser's decompression. */
async function inflate(data: Uint8Array, size: number): Promise<Uint8Array> {
	const out = new Uint8Array(size);
	const source = new Blob([data as Uint8Array<ArrayBuffer>]).stream();
	const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
	let at = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (at + value.length > size) throw new Error('a chunk inflates to more than its rows');
			out.set(value, at);
			at += value.length;
		}
	} catch (error) {
		void reader.cancel().catch(() => undefined);
		throw error instanceof Error && error.message.startsWith('a chunk')
			? error
			: new Error('a ZIP chunk does not inflate');
	}
	if (at !== size) throw new Error('a chunk inflates to fewer bytes than its rows');
	return out;
}

/** OpenEXR's run-length data: a negative count before literal bytes, else a byte to repeat. */
function runLength(data: Uint8Array, size: number): Uint8Array {
	const out = new Uint8Array(size);
	let to = 0;
	for (let at = 0; at < data.length; ) {
		const count = ((data[at++] as number) << 24) >> 24;
		if (count < 0) {
			if (to - count > size || at - count > data.length)
				throw new Error('an RLE chunk runs past its rows');
			out.set(data.subarray(at, at - count), to);
			at -= count;
			to -= count;
		} else {
			if (to + count + 1 > size || at >= data.length)
				throw new Error('an RLE chunk runs past its rows');
			out.fill(data[at++] as number, to, to + count + 1);
			to += count + 1;
		}
	}
	if (to !== size) throw new Error('an RLE chunk holds fewer bytes than its rows');
	return out;
}

/**
 * Undoes the byte predictor and the split of RLE and ZIP data: each byte held its difference from
 * the one before plus 128, and the bytes at even places came first, then those at odd places.
 */
function unpredict(bytes: Uint8Array): Uint8Array {
	for (let t = 1; t < bytes.length; t++)
		bytes[t] = (bytes[t - 1] as number) + (bytes[t] as number) - 128;
	const out = new Uint8Array(bytes.length);
	const half = (bytes.length + 1) >> 1;
	for (let s = 0, a = 0, b = half; s < bytes.length; s++)
		out[s] = (s & 1 ? bytes[b++] : bytes[a++]) as number;
	return out;
}

// --- PIZ ----------------------------------------------------------------------------------------

const USHORT_RANGE = 1 << 16;
const BITMAP_SIZE = USHORT_RANGE >> 3;
const HUF_ENCSIZE = (1 << 16) + 1;
const HUF_DECBITS = 14;
const HUF_DECSIZE = 1 << HUF_DECBITS;
const HUF_DECMASK = HUF_DECSIZE - 1;
const SHORT_ZEROCODE_RUN = 59;
const LONG_ZEROCODE_RUN = 63;
const SHORTEST_LONG_RUN = 2 + LONG_ZEROCODE_RUN - SHORT_ZEROCODE_RUN;
const A_OFFSET = 1 << 15;
const MOD_MASK = (1 << 16) - 1;

/**
 * PIZ data: a table that maps the values that occur to a dense range, a Huffman code of the
 * values, and a wavelet transform of each channel. The tables live on for the file's next chunk.
 */
class Piz {
	private readonly bitmap = new Uint8Array(BITMAP_SIZE);
	private readonly lut = new Uint16Array(USHORT_RANGE);
	/** Each value's code: its length in bits plus 64 times its bits. */
	private readonly codes = new Float64Array(HUF_ENCSIZE);
	/** The decoding table of codes up to 14 bits: each entry's length and value. */
	private readonly lengths = new Uint8Array(HUF_DECSIZE);
	private readonly values = new Int32Array(HUF_DECSIZE);
	/** The values of the longer codes that start with each entry's 14 bits. */
	private readonly longer: (number[] | null)[] = new Array(HUF_DECSIZE).fill(null);
	private readonly counts = new Float64Array(59);
	/** The bit reader's place, buffer and buffered bits. */
	private at = 0;
	private c = 0;
	private lc = 0;
	private bytes: Uint8Array = new Uint8Array(0);

	decode(data: Uint8Array, channels: readonly Channel[], width: number, lines: number): Uint8Array {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		if (data.length < 4) throw new Error('its PIZ data ends early');
		const minNonZero = view.getUint16(0, true);
		const maxNonZero = view.getUint16(2, true);
		if (maxNonZero >= BITMAP_SIZE) throw new Error('its PIZ bitmap is too large');
		let at = 4;
		const { bitmap, lut } = this;
		bitmap.fill(0);
		if (minNonZero <= maxNonZero) {
			const count = maxNonZero - minNonZero + 1;
			if (at + count > data.length) throw new Error('its PIZ data ends early');
			bitmap.set(data.subarray(at, at + count), minNonZero);
			at += count;
		}
		let k = 0;
		for (let i = 0; i < USHORT_RANGE; i++)
			if (i === 0 || (bitmap[i >> 3] as number) & (1 << (i & 7))) lut[k++] = i;
		const maxValue = k - 1;
		lut.fill(0, k);
		if (at + 4 > data.length) throw new Error('its PIZ data ends early');
		const length = view.getUint32(at, true);
		at += 4;
		if (at + length > data.length) throw new Error('its PIZ data ends early');
		// Each channel's values for the chunk, one after the other: a float or whole number is two
		// 16-bit halves.
		const sizes = channels.map((c) => (c.type === HALF ? 1 : 2));
		const words = sizes.reduce((sum, size) => sum + size * width * lines, 0);
		const out = new Uint16Array(words);
		this.huffman(data, at, length, out);
		let start = 0;
		for (const size of sizes) {
			for (let j = 0; j < size; j++)
				wavelet(out, start + j, width, size, lines, width * size, maxValue);
			start += width * lines * size;
		}
		for (let i = 0; i < words; i++) out[i] = lut[out[i] as number] as number;
		// Into rows: each row holds each channel's values for that row.
		const raw = new Uint16Array(words);
		let to = 0;
		const ends = [];
		for (let c = 0, from = 0; c < sizes.length; c++) {
			ends.push(from);
			from += width * lines * (sizes[c] as number);
		}
		for (let line = 0; line < lines; line++)
			for (let c = 0; c < sizes.length; c++) {
				const n = width * (sizes[c] as number);
				const from = ends[c] as number;
				raw.set(out.subarray(from, from + n), to);
				ends[c] = from + n;
				to += n;
			}
		return new Uint8Array(raw.buffer);
	}

	private bit(): number {
		if (this.at >= this.bytes.length) throw new Error('its PIZ data ends early');
		return this.bytes[this.at++] as number;
	}

	private bits(count: number): number {
		while (this.lc < count) {
			this.c = (this.c << 8) | this.bit();
			this.lc += 8;
		}
		this.lc -= count;
		return (this.c >> this.lc) & ((1 << count) - 1);
	}

	/** Decodes `length` bytes of Huffman data from `start` into `out`. */
	private huffman(data: Uint8Array, start: number, length: number, out: Uint16Array): void {
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		if (length < 20) throw new Error('its PIZ data ends early');
		const im = view.getUint32(start, true);
		const iM = view.getUint32(start + 4, true);
		const bitCount = view.getUint32(start + 12, true);
		if (im >= HUF_ENCSIZE || iM >= HUF_ENCSIZE) throw new Error('its PIZ code table is broken');
		this.bytes = data.subarray(0, start + length);
		this.at = start + 20;
		this.c = 0;
		this.lc = 0;
		this.unpackCodes(im, iM, length - 20);
		if (bitCount > 8 * (start + length - this.at)) throw new Error('its PIZ data ends early');
		this.buildTable(im, iM);
		this.decodeBits(bitCount, iM, out);
	}

	/** Reads the code length of each value from `im` to `iM`, then gives each its code. */
	private unpackCodes(im: number, iM: number, bytes: number): void {
		const { codes } = this;
		codes.fill(0);
		const begin = this.at;
		for (; im <= iM; im++) {
			if (this.at - begin > bytes) throw new Error('its PIZ code table is broken');
			const l = this.bits(6);
			codes[im] = l;
			if (l === LONG_ZEROCODE_RUN || l >= SHORT_ZEROCODE_RUN) {
				let run =
					l === LONG_ZEROCODE_RUN ? this.bits(8) + SHORTEST_LONG_RUN : l - SHORT_ZEROCODE_RUN + 2;
				if (im + run > iM + 1) throw new Error('its PIZ code table is broken');
				while (run--) codes[im++] = 0;
				im--;
			}
		}
		const { counts } = this;
		counts.fill(0);
		for (let i = 0; i < HUF_ENCSIZE; i++) {
			const l = codes[i] as number;
			counts[l] = (counts[l] as number) + 1;
		}
		let c = 0;
		for (let i = 58; i > 0; i--) {
			const next = Math.floor((c + (counts[i] as number)) / 2);
			counts[i] = c;
			c = next;
		}
		for (let i = 0; i < HUF_ENCSIZE; i++) {
			const l = codes[i] as number;
			if (l > 0) codes[i] = l + 64 * (counts[l] as number)++;
		}
	}

	/** Fills the decoding table from the codes of the values from `im` to `iM`. */
	private buildTable(im: number, iM: number): void {
		const { codes, lengths, values, longer } = this;
		lengths.fill(0);
		values.fill(0);
		longer.fill(null);
		for (; im <= iM; im++) {
			const code = codes[im] as number;
			const l = code % 64;
			const c = Math.floor(code / 64);
			if (Math.floor(c / 2 ** l) !== 0) throw new Error('its PIZ code table is broken');
			if (l > HUF_DECBITS) {
				const index = Math.floor(c / 2 ** (l - HUF_DECBITS));
				if (lengths[index]) throw new Error('its PIZ code table is broken');
				const list = longer[index];
				if (list) list.push(im);
				else longer[index] = [im];
			} else if (l) {
				const first = c * 2 ** (HUF_DECBITS - l);
				for (let i = 0; i < 2 ** (HUF_DECBITS - l); i++) {
					const index = first + i;
					if (lengths[index] || longer[index]) throw new Error('its PIZ code table is broken');
					lengths[index] = l;
					values[index] = im;
				}
			}
		}
	}

	/** Decodes `bitCount` bits into `out`, where the value `rlc` repeats the value before. */
	private decodeBits(bitCount: number, rlc: number, out: Uint16Array): void {
		const { codes, lengths, values, longer } = this;
		// The data starts at the byte after the code table, with no bits left over from it.
		this.c = 0;
		this.lc = 0;
		let to = 0;
		const put = (value: number) => {
			if (value === rlc) {
				if (this.lc < 8) {
					this.c = (this.c << 8) | this.bit();
					this.lc += 8;
				}
				this.lc -= 8;
				let count = (this.c >> this.lc) & 0xff;
				if (to + count > out.length || to === 0) throw new Error('its PIZ data runs too long');
				const repeat = out[to - 1] as number;
				while (count-- > 0) out[to++] = repeat;
			} else {
				if (to >= out.length) throw new Error('its PIZ data runs too long');
				out[to++] = value;
			}
		};
		const end = this.at + Math.ceil(bitCount / 8);
		while (this.at < end) {
			this.c = (this.c << 8) | this.bit();
			this.lc += 8;
			while (this.lc >= HUF_DECBITS) {
				const index = (this.c >> (this.lc - HUF_DECBITS)) & HUF_DECMASK;
				const length = lengths[index] as number;
				if (length) {
					this.lc -= length;
					put(values[index] as number);
					continue;
				}
				const candidates = longer[index];
				if (!candidates) throw new Error('its PIZ data holds an unknown code');
				let found = false;
				for (const value of candidates) {
					const code = codes[value] as number;
					const l = code % 64;
					while (this.lc < l && this.at < end) {
						this.c = (this.c << 8) | this.bit();
						this.lc += 8;
					}
					if (
						this.lc >= l &&
						Math.floor(code / 64) === ((this.c >> (this.lc - l)) & ((1 << l) - 1))
					) {
						this.lc -= l;
						put(value);
						found = true;
						break;
					}
				}
				if (!found) throw new Error('its PIZ data holds an unknown code');
			}
		}
		const skip = (8 - bitCount) & 7;
		this.c >>= skip;
		this.lc -= skip;
		while (this.lc > 0) {
			const index = (this.c << (HUF_DECBITS - this.lc)) & HUF_DECMASK;
			const length = lengths[index] as number;
			if (!length) throw new Error('its PIZ data holds an unknown code');
			this.lc -= length;
			put(values[index] as number);
		}
		if (to !== out.length) throw new Error('its PIZ data holds fewer values than its rows');
	}
}

/** A 16-bit value as a signed one. */
const int16 = (v: number) => ((v & 0xffff) << 16) >> 16;

/**
 * Undoes PIZ's 2D Haar wavelet transform in place on the values at `j` of `buffer`, `nx` by `ny`
 * of them, `ox` and `oy` apart: the 14-bit form when every value is below 2 to the 14th, else the
 * 16-bit form.
 */
function wavelet(
	buffer: Uint16Array,
	j: number,
	nx: number,
	ox: number,
	ny: number,
	oy: number,
	mx: number,
): void {
	const w14 = mx < 1 << 14;
	const n = nx > ny ? ny : nx;
	let p = 1;
	while (p <= n) p <<= 1;
	p >>= 1;
	let p2 = p;
	p >>= 1;
	let a = 0;
	let b = 0;
	const decode = (l: number, h: number) => {
		if (w14) {
			const hi = int16(h);
			const ai = int16(l) + (hi & 1) + (hi >> 1);
			a = ai & 0xffff;
			b = (ai - hi) & 0xffff;
		} else {
			const m = l & 0xffff;
			const d = h & 0xffff;
			b = (m - (d >> 1)) & MOD_MASK;
			a = (d + b - A_OFFSET) & MOD_MASK;
		}
	};
	while (p >= 1) {
		let py = 0;
		const ey = oy * (ny - p2);
		const oy1 = oy * p;
		const oy2 = oy * p2;
		const ox1 = ox * p;
		const ox2 = ox * p2;
		for (; py <= ey; py += oy2) {
			let px = py;
			const ex = py + ox * (nx - p2);
			for (; px <= ex; px += ox2) {
				const p01 = px + ox1;
				const p10 = px + oy1;
				const p11 = p10 + ox1;
				decode(buffer[px + j] as number, buffer[p10 + j] as number);
				const i00 = a;
				const i10 = b;
				decode(buffer[p01 + j] as number, buffer[p11 + j] as number);
				const i01 = a;
				const i11 = b;
				decode(i00, i01);
				buffer[px + j] = a;
				buffer[p01 + j] = b;
				decode(i10, i11);
				buffer[p10 + j] = a;
				buffer[p11 + j] = b;
			}
			if (nx & p) {
				const p10 = px + oy1;
				decode(buffer[px + j] as number, buffer[p10 + j] as number);
				buffer[p10 + j] = b;
				buffer[px + j] = a;
			}
		}
		if (ny & p) {
			let px = py;
			const ex = py + ox * (nx - p2);
			for (; px <= ex; px += ox2) {
				const p01 = px + ox1;
				decode(buffer[px + j] as number, buffer[p01 + j] as number);
				buffer[p01 + j] = b;
				buffer[px + j] = a;
			}
		}
		p2 = p;
		p >>= 1;
	}
}
