// Limits on what one untrusted file may make the engine allocate, shared by every reader of model
// and texture files: the glTF parser and its meshopt decoding, the KTX2 transcoder, and each later
// decoder (Draco, WebP and AVIF images, UASTC HDR textures). A reader checks every count against
// these limits before it allocates, so a small hostile file fails fast with a coded error instead
// of filling memory or holding a thread for minutes.
//
// The module imports nothing, so a worker's bundle and a loader that loads on first use can each
// hold their own copy.

/** The limits of one file. `.dev/decisions/D-59-file-limits.md` gives each value's reason. */
export interface FileLimits {
	/**
	 * The most bytes that one decoded array or texture may hold: an accessor, a decoded buffer
	 * view, a triangle list made from a strip, or one texture's texels with every level and layer.
	 * It is WebGPU's portable limit on a buffer's size.
	 */
	readonly itemBytes: number;
	/** The bytes that any model file may decode to, however small it is. */
	readonly modelFloorBytes: number;
	/** Bytes that each byte of a model file and its buffers may add to `modelFloorBytes`. */
	readonly modelRatio: number;
	/** The most bytes that any model file may decode to, however large it is. */
	readonly modelCapBytes: number;
	/** The most layers that one texture file may hold: WebGPU's default limit on array layers. */
	readonly textureLayers: number;
	/**
	 * The longest side of an image that becomes a texture: the engine's largest texture, which
	 * WebGPU's compatibility mode sets. A device's `textures.maxSize` can be smaller.
	 */
	readonly textureSide: number;
	/** The longest side of an image that decodes for any other use: browsers' largest canvas. */
	readonly imageSide: number;
}

const MIB = 1024 * 1024;

/** The engine's limits for every file it reads. */
export const FILE_LIMITS: FileLimits = {
	itemBytes: 256 * MIB,
	modelFloorBytes: 64 * MIB,
	modelRatio: 32,
	modelCapBytes: 1024 * MIB,
	textureLayers: 256,
	textureSide: 4096,
	imageSide: 16384,
};

/**
 * The decoded bytes that a model file of `sourceBytes` bytes, its buffers included, may make:
 * the floor, plus the ratio times the file's bytes, up to the cap.
 */
export function modelAllowance(sourceBytes: number, limits: FileLimits = FILE_LIMITS): number {
	return Math.min(limits.modelCapBytes, limits.modelFloorBytes + limits.modelRatio * sourceBytes);
}

/**
 * The decoded bytes that one file has left. Each reader takes its bytes before it allocates
 * them; `fail` throws the reader's own coded error, so the glTF parser refuses with E1416 and
 * the texture loaders with E1412.
 */
export class FileBudget {
	/** The bytes taken so far. */
	used = 0;
	/** The bytes the file may decode to in all. */
	readonly allowance: number;

	constructor(
		sourceBytes: number,
		private readonly fail: (reason: string) => never,
		readonly limits: FileLimits = FILE_LIMITS,
	) {
		this.allowance = modelAllowance(sourceBytes, limits);
	}

	/**
	 * Takes `bytes` for one array or texture that `what` names, or throws through `fail` when it
	 * is larger than one item may be, or more than the file has left.
	 */
	take(bytes: number, what: string): void {
		if (!(bytes <= this.limits.itemBytes))
			this.fail(
				`${what} decodes to ${describe(bytes)}, more than the ${describe(this.limits.itemBytes)} that one array or texture may hold`,
			);
		if (this.used + bytes > this.allowance)
			this.fail(
				`${what} would bring what the file decodes to ${describe(this.used + bytes)}, more than the ${describe(this.allowance)} that a file of its size may decode to`,
			);
		this.used += bytes;
	}
}

/** Bytes in words: whole MiB from 1 MiB up, else bytes. */
function describe(bytes: number): string {
	if (!Number.isFinite(bytes)) return 'more bytes than a number holds';
	return bytes >= MIB
		? `${(bytes / MIB).toLocaleString('en-US', { maximumFractionDigits: 1 })} MiB`
		: `${bytes.toLocaleString('en-US')} bytes`;
}

/**
 * The width and height that a PNG or JPEG file's header gives, or undefined for another format or
 * a header that is cut short. A PNG gives them in its IHDR chunk, and a JPEG in its frame header
 * (SOF), after any segments before it. A decoder reads them before it decodes, so a small file
 * that claims a huge image fails before the browser allocates its pixels.
 */
export function imageSize(bytes: Uint8Array): [width: number, height: number] | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const word = (at: number) => (at + 4 <= bytes.length ? view.getUint32(at) : -1);
	const half = (at: number) => (at + 2 <= bytes.length ? view.getUint16(at) : -1);
	if (word(0) === PNG_SIGNATURE[0] && word(4) === PNG_SIGNATURE[1]) {
		if (word(12) !== IHDR) return undefined;
		const [width, height] = [word(16), word(20)];
		return width < 0 || height < 0 ? undefined : [width, height];
	}
	if (half(0) !== JPEG_START) return undefined;
	// Each segment after the start: a marker of 0xFF and its kind, then its length, which counts
	// the two length bytes and not the marker.
	for (let at = 2; at + 4 <= bytes.length; ) {
		if (bytes[at] !== 0xff) return undefined;
		const kind = bytes[at + 1] as number;
		if (kind === 0xff) {
			at++;
			continue;
		}
		if (JPEG_FRAMES.has(kind)) {
			const [height, width] = [half(at + 5), half(at + 7)];
			return width < 0 || height < 0 ? undefined : [width, height];
		}
		const length = half(at + 2);
		if (length < 2) return undefined;
		at += 2 + length;
	}
	return undefined;
}

/** The eight bytes that start every PNG file, as two big-endian words. */
const PNG_SIGNATURE = [0x89504e47, 0x0d0a1a0a] as const;
/** The type of a PNG's first chunk, which holds its size. */
const IHDR = 0x49484452;
/** The marker that starts every JPEG file. */
const JPEG_START = 0xffd8;
/** The JPEG markers of a frame header (SOF0 to SOF15, less DHT, JPG and DAC), which give the size. */
const JPEG_FRAMES: ReadonlySet<number> = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Why an image whose header gives `size` is refused before it decodes, or undefined: a side
 * longer than `maxSide`.
 */
export function imageTooLarge(
	size: readonly [number, number] | undefined,
	maxSide: number,
): string | undefined {
	if (!size) return undefined;
	const [width, height] = size;
	if (width > maxSide || height > maxSide)
		return `its header gives ${width} x ${height} pixels, larger than the ${maxSide} a side that it may have`;
	return undefined;
}
