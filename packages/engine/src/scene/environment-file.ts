// The reader of environment map files, which `assets.loadEnvironment` and
// `assets.builtinEnvironment` import the first time, so a page without an environment never
// downloads it. An environment map is a KTX2 file that `bunx @null3d/cli assets env` writes (D-19):
// a cube map of `rgb9e5ufloat` or `rgba16float` texels with no supercompression, one roughness per
// mip level, and the nine coefficients of its diffuse light in the key-value data under
// `null3d.environment`.

/** The built-in environments, by name: the files in the engine's package, which load on first use. */
export const BUILTIN_ENVIRONMENTS = {
	/** The room that three.js's `RoomEnvironment` builds: a white room with boxes and lit panels. */
	room: new URL('../../environments/room.ktx2?no-inline', import.meta.url),
} as const;

/** The texel formats of environment maps, by their Vulkan format number in the file. */
const FORMATS = { 123: 'rgb9e5ufloat', 97: 'rgba16float' } as const;

/** Bytes per texel of each format. */
const TEXEL_BYTES = { rgb9e5ufloat: 4, rgba16float: 8 } as const;

/** The key of the map's data in the key-value data. */
const KEY = 'null3d.environment';

/** The identifier that starts every KTX2 file. */
const IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** The fewest and the most texels a side of the largest faces. */
const MIN_SIZE = 8;
const MAX_SIZE = 2048;

/** An environment map as its file gives it. */
export interface EnvironmentFile {
	/** The width of the largest faces. */
	size: number;
	/** Mip levels, from the largest faces down. */
	levels: number;
	format: (typeof FORMATS)[keyof typeof FORMATS];
	/** Each level's six faces, from level 0, as views of the file's bytes. */
	texels: Uint8Array[];
	/** The nine coefficients' red, green and blue values, in three.js's order. */
	sh: Float32Array;
}

/** Reads an environment map's file, or throws an Error that says what is wrong with it. */
export function readEnvironmentFile(bytes: ArrayBuffer): EnvironmentFile {
	const file = new Uint8Array(bytes);
	if (file.length < 80 || !IDENTIFIER.every((byte, k) => file[k] === byte))
		throw new Error('it is not a KTX2 file');
	const view = new DataView(bytes);
	const word = (at: number) => view.getUint32(at, true);
	const long = (at: number) => Number(view.getBigUint64(at, true));
	const format = FORMATS[word(12) as keyof typeof FORMATS];
	if (!format)
		throw new Error(
			`its texels have the Vulkan format ${word(12)}, not rgb9e5ufloat (123) or rgba16float (97); make it with bunx @null3d/cli assets env`,
		);
	const size = word(20);
	if (word(24) !== size || word(36) !== 6 || word(28) !== 0 || word(32) > 1)
		throw new Error('it is not a cube map of square faces');
	if (!(size >= MIN_SIZE && size <= MAX_SIZE && (size & (size - 1)) === 0))
		throw new Error(`its faces are ${size} texels wide, not a power of 2 from 8 to 2048`);
	if (word(44) !== 0) throw new Error('it is supercompressed, which environment maps are not');
	const levels = word(40);
	if (levels < 1 || levels > Math.log2(size) + 1 || 80 + 24 * levels > file.length)
		throw new Error(`it names ${levels} mip levels for faces ${size} texels wide`);
	const texels: Uint8Array[] = [];
	for (let level = 0; level < levels; level++) {
		const side = size >> level;
		const expected = 6 * side * side * TEXEL_BYTES[format];
		const offset = long(80 + 24 * level);
		if (long(88 + 24 * level) !== expected || offset + expected > file.length)
			throw new Error(`its level ${level} does not hold ${expected} bytes of six faces`);
		texels.push(file.subarray(offset, offset + expected));
	}
	return { size, levels, format, texels, sh: readCoefficients(file, word(56), word(60)) };
}

/** The nine coefficients from the key-value data at `start`, `length` bytes long. */
function readCoefficients(file: Uint8Array, start: number, length: number): Float32Array {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const end = Math.min(start + length, file.length);
	const text = new TextDecoder();
	for (let at = start; at + 4 <= end; ) {
		const entry = view.getUint32(at, true);
		const data = file.subarray(at + 4, Math.min(at + 4 + entry, end));
		const split = data.indexOf(0);
		if (split > 0 && text.decode(data.subarray(0, split)) === KEY) {
			let value: unknown;
			try {
				value = JSON.parse(text.decode(data.subarray(split + 1)).replace(/\0$/, ''));
			} catch {
				throw new Error(`its ${KEY} data is not JSON`);
			}
			const sh = (value as { sh?: unknown }).sh;
			if (!Array.isArray(sh) || sh.length !== 27 || !sh.every(Number.isFinite))
				throw new Error(`its ${KEY} data holds no 27 numbers of diffuse light`);
			return Float32Array.from(sh as number[]);
		}
		at += 4 + entry + ((4 - (entry % 4)) % 4);
	}
	throw new Error(`it has no ${KEY} data: make it with bunx @null3d/cli assets env`);
}
