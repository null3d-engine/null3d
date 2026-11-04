// The reader of SPZ files, Niantic's packed form of a Gaussian-splat cloud. A legacy file is one
// gzip stream whose contents are a header and the attribute arrays; a version 4 file is a plain
// header, a table of contents and one zstd stream for each attribute array.
//
// The reader reconstructs the cloud that the writer packed: 24-bit fixed-point centers, log spreads
// that become the standard deviations, unit quaternions, an opacity from each alpha's sigmoid, and
// the first spherical-harmonic band's color. Higher bands make a splat's color change with the
// view; this reader drops them, which the glTF extension allows.
import { colorOfSh, type SplatData, splatsError } from './format';

/** The magic value of every SPZ container, which reads "NGSP" in little-endian bytes. */
const MAGIC = 0x5053474e;

/** The first version whose file is a zstd container with a table of contents. */
const ZSTD_VERSION = 4;

/** The point count above which a file is refused, so a broken header cannot allocate the heap. */
const MAX_POINTS = 16_777_216;

/** The number of colored coefficients in each spherical-harmonic band. */
const DIM_FOR_DEGREE: Readonly<Record<number, number>> = { 0: 0, 1: 3, 2: 8, 3: 15, 4: 24 };

/** The scale that turns a byte into a first-band coefficient. */
const COLOR_SCALE = 0.15;

/** A row of the table of contents: where a stream lies and how large it grows. */
interface Stream {
	readonly compressed: number;
	readonly size: number;
}

/** The header that every file starts with, whether or not a zstd container follows it. */
interface Header {
	readonly version: number;
	readonly count: number;
	readonly shDegree: number;
	readonly fractionalBits: number;
	readonly flags: number;
	/** The byte after the header, and for a zstd container the size of the header itself. */
	readonly at: number;
}

/**
 * Reads an SPZ file into a cloud of splats. `file` holds the file's bytes as the browser delivers
 * them. Throws when the file is not an SPZ file this reader knows, when its sizes do not fit, and
 * when a zstd stream needs a browser without the zstd decompressor.
 *
 * @category api/splats
 */
export async function decodeSpz(file: Uint8Array | ArrayBuffer): Promise<SplatData> {
	const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
	const raw = await contain(bytes);
	const header = readHeader(raw);
	if (header.count > MAX_POINTS)
		throw splatsError(
			2102,
			`the SPZ file holds ${header.count} splats, and this reader takes up to ${MAX_POINTS}. Split the cloud across several files.`,
		);
	return header.version >= ZSTD_VERSION ? decodeZstd(raw, header) : decodeLegacy(raw, header);
}

/** The plain bytes of a legacy gzip file, or the bytes of a zstd container as they are. */
async function contain(bytes: Uint8Array): Promise<Uint8Array> {
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) return inflate('gzip', bytes);
	if (bytes.length >= 4 && view(bytes).getUint32(0, true) === MAGIC) return bytes;
	if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd)
		return inflate('zstd', bytes);
	throw splatsError(
		2103,
		'the file is not an SPZ file: it starts with neither the SPZ header, a gzip stream, nor a zstd stream.',
	);
}

/** The file's header, read from the plain bytes that start it. */
function readHeader(raw: Uint8Array): Header {
	if (raw.length < 16) throw splatsError(2103, 'the SPZ file is too short to hold its header.');
	const data = view(raw);
	if (data.getUint32(0, true) !== MAGIC)
		throw splatsError(2103, 'the SPZ file does not start with the SPZ magic value.');
	const version = data.getUint32(4, true);
	if (version < 1 || version > ZSTD_VERSION)
		throw splatsError(
			2103,
			`the SPZ file is version ${version}, and this reader reads versions 1 to ${ZSTD_VERSION}.`,
		);
	const count = data.getUint32(8, true);
	const shDegree = raw[12] as number;
	if (DIM_FOR_DEGREE[shDegree] === undefined)
		throw splatsError(
			2103,
			`the SPZ file gives the spherical-harmonic degree ${shDegree}, and a degree runs from 0 to 4.`,
		);
	return {
		version,
		count,
		shDegree,
		fractionalBits: raw[13] as number,
		flags: raw[14] as number,
		at: version >= ZSTD_VERSION ? 32 : 16,
	};
}

/** A legacy file's arrays, laid end to end after its header. */
function decodeLegacy(raw: Uint8Array, header: Header): SplatData {
	const { count, version } = header;
	const floats = version === 1 ? 2 : 3;
	const rotations = version >= 3 ? 4 : 3;
	const shBytes = (DIM_FOR_DEGREE[header.shDegree] as number) * 3;
	const expected = header.at + count * (floats * 3 + 1 + 3 + 3 + rotations + shBytes);
	if (raw.length < expected)
		throw splatsError(
			2104,
			`the SPZ file holds ${raw.length} bytes, and its ${count} splats and their header need ${expected}. The file is cut short.`,
		);
	let at = header.at;
	const take = (bytes: number): Uint8Array => {
		const part = raw.subarray(at, at + bytes);
		at += bytes;
		return part;
	};
	const positions = take(count * floats * 3);
	const alphas = take(count);
	const colors = take(count * 3);
	const scales = take(count * 3);
	const quaternions = take(count * rotations);
	return assemble(count, positions, alphas, colors, scales, quaternions, header);
}

/** A zstd container's streams, each decompressed on its own. */
async function decodeZstd(raw: Uint8Array, header: Header): Promise<SplatData> {
	const { count, version } = header;
	if (raw.length < 32) throw splatsError(2103, 'the SPZ file is too short to hold its header.');
	const data = view(raw);
	const streamCount = raw[15] as number;
	const toc = data.getUint32(16, true);
	if (streamCount < 1 || streamCount > 6)
		throw splatsError(2103, `the SPZ file names ${streamCount} streams, and it takes 1 to 6.`);
	if (toc < header.at || toc + streamCount * 16 > raw.length)
		throw splatsError(2103, 'the SPZ file points its table of contents outside the file.');
	// The streams run positions, alphas, colors, scales, rotations and spherical harmonics, and a
	// stream that the file leaves out is missing from the end of the table.
	const tables: Stream[] = [];
	let compressed = toc + streamCount * 16;
	for (let i = 0; i < 6; i++) {
		if (i >= streamCount) {
			tables.push({ compressed: 0, size: 0 });
			continue;
		}
		const row = toc + i * 16;
		const sizes = {
			compressed: Number(data.getBigUint64(row, true)),
			size: Number(data.getBigUint64(row + 8, true)),
		};
		tables.push(sizes);
		compressed += sizes.compressed;
	}
	if (compressed !== raw.length)
		throw splatsError(
			2103,
			`the SPZ file's streams end at ${compressed}, and the file holds ${raw.length} bytes.`,
		);
	const rotations = version >= 3 ? 4 : 3;
	const shBytes = (DIM_FOR_DEGREE[header.shDegree] as number) * 3;
	const want = [count * 3 * 3, count, count * 3, count * 3, count * rotations, count * shBytes];
	const names = ['positions', 'alpha', 'colors', 'scales', 'rotations', 'spherical harmonics'];
	const parts: Uint8Array[] = [];
	let at = toc + streamCount * 16;
	for (let i = 0; i < 6; i++) {
		const table = tables[i] as Stream;
		const slice = raw.subarray(at, at + table.compressed);
		at += table.compressed;
		const part = table.compressed === 0 ? new Uint8Array(0) : await inflate('zstd', slice);
		if (part.length !== (want[i] as number))
			throw splatsError(
				2104,
				`the SPZ file's ${names[i]} stream holds ${part.length} bytes, and its ${count} splats need ${want[i]}.`,
			);
		parts.push(part);
	}
	const [positions, alphas, colors, scales, quaternions] = parts as Uint8Array[];
	return assemble(
		count,
		positions as Uint8Array,
		alphas as Uint8Array,
		colors as Uint8Array,
		scales as Uint8Array,
		quaternions as Uint8Array,
		header,
	);
}

/** The cloud that the arrays hold, in the form that the draw takes. */
function assemble(
	count: number,
	positions: Uint8Array,
	alphas: Uint8Array,
	colors: Uint8Array,
	scales: Uint8Array,
	quaternions: Uint8Array,
	header: Header,
): SplatData {
	const out = {
		count,
		positions: new Float32Array(count * 3),
		scales: new Float32Array(count * 3),
		rotations: new Float32Array(count * 4),
		colors: new Float32Array(count * 4),
	};
	const fixed = 1 / 2 ** header.fractionalBits;
	const half = header.version === 1;
	const smallestThree = header.version >= 3;
	for (let i = 0; i < count; i++) {
		for (let k = 0; k < 3; k++) {
			const at = (i * 3 + k) * (half ? 2 : 3);
			out.positions[i * 3 + k] = half
				? halfToFloat((positions[at] as number) | ((positions[at + 1] as number) << 8))
				: signed24(positions, at) * fixed;
		}
		for (let k = 0; k < 3; k++)
			out.scales[i * 3 + k] = Math.exp((scales[i * 3 + k] as number) / 16 - 10);
		if (smallestThree) smallestThreeQuaternion(out.rotations, i * 4, quaternions, i * 4);
		else firstThreeQuaternion(out.rotations, i * 4, quaternions, i * 3);
		const alpha = (alphas[i] as number) / 255;
		const dc = [0, 1, 2].map(
			(k) => ((colors[i * 3 + (k as number)] as number) / 255 - 0.5) / COLOR_SCALE,
		) as [number, number, number];
		colorOfSh(dc, true, out.colors.subarray(i * 4, i * 4 + 3));
		out.colors[i * 4 + 3] = alpha;
	}
	return out;
}

/** A three-byte fixed-point value, sign-extended from its 24th bit. */
function signed24(bytes: Uint8Array, at: number): number {
	let value =
		(bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16);
	if ((value & 0x800000) !== 0) value |= 0xff000000;
	return value;
}

/** A half-precision float, as the first version of the format stores centers. */
function halfToFloat(bits: number): number {
	const sign = bits & 0x8000 ? -1 : 1;
	const exponent = (bits >> 10) & 0x1f;
	const fraction = bits & 0x3ff;
	if (exponent === 0) return sign * fraction * 2 ** -24;
	if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
	return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** A quaternion that stores its first three components, with `w` from the unit length. */
function firstThreeQuaternion(out: Float32Array, to: number, bytes: Uint8Array, at: number): void {
	let sum = 0;
	for (let k = 0; k < 3; k++) {
		const value = (bytes[at + k] as number) / 127.5 - 1;
		out[to + k] = value;
		sum += value * value;
	}
	out[to + 3] = Math.sqrt(Math.max(0, 1 - sum));
}

/** A quaternion in the smallest-three form: two bits name the largest, three signed 10-bit values hold the rest. */
function smallestThreeQuaternion(
	out: Float32Array,
	to: number,
	bytes: Uint8Array,
	at: number,
): void {
	const word =
		((bytes[at] as number) |
			((bytes[at + 1] as number) << 8) |
			((bytes[at + 2] as number) << 16) |
			((bytes[at + 3] as number) << 24)) >>>
		0;
	const largest = word >>> 30;
	let rest = word & 0x3fffffff;
	let sum = 0;
	// The three stored components come in the order w, z, y, x, with the largest left out.
	for (let k = 3; k >= 0; k--) {
		if (k === largest) continue;
		const magnitude = rest & 0x1ff;
		const negative = (rest >>> 9) & 1;
		rest >>>= 10;
		const value = ((negative === 1 ? -1 : 1) * Math.SQRT1_2 * magnitude) / 0x1ff;
		out[to + k] = value;
		sum += value * value;
	}
	out[to + largest] = Math.sqrt(Math.max(0, 1 - sum));
}

/** Decompresses a stream with the browser's own decompressor. */
async function inflate(format: 'gzip' | 'zstd', bytes: Uint8Array): Promise<Uint8Array> {
	if (typeof DecompressionStream === 'undefined')
		throw splatsError(
			2105,
			`this browser has no decompressor, so it cannot read the SPZ file's ${format} stream. Use a browser that supports DecompressionStream.`,
		);
	let stream: ReadableStream<Uint8Array>;
	try {
		stream = new Blob([bytes as BlobPart])
			.stream()
			.pipeThrough(new DecompressionStream(format as unknown as CompressionFormat));
	} catch {
		throw splatsError(
			2105,
			`this browser cannot decompress ${format}, which this SPZ file needs. Use a browser that supports ${format} in DecompressionStream.`,
		);
	}
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A view of the same bytes, for the header's whole numbers. */
function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
