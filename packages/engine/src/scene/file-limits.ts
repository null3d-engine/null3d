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
}

const MIB = 1024 * 1024;

/** The engine's limits for every file it reads. */
export const FILE_LIMITS: FileLimits = {
	itemBytes: 256 * MIB,
	modelFloorBytes: 64 * MIB,
	modelRatio: 32,
	modelCapBytes: 1024 * MIB,
	textureLayers: 256,
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
