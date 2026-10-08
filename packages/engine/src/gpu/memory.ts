// The GPU memory that a backend holds: a running total of the bytes of its textures and one of its
// buffers. The backend and its helpers change the totals where they create, grow and free each GPU
// object, on the thread that owns the objects, so reading the totals walks nothing. The totals
// live in a typed array, which the renderer copies into the metrics buffer while the page samples.
//
// Bytes count as the GPU stores them: each mip level of each layer in whole blocks of texels, times
// the sample count. A driver may round an object up to its own alignment or page size, which no
// browser reports, so the totals count the size that the engine asked for.

import * as G from '../generated/gpu';

/** The total's index of the bytes of textures and renderbuffers. */
export const TEXTURE_BYTES = 0;
/** The total's index of the bytes of buffers and query sets. */
export const BUFFER_BYTES = 1;

/** The GPU memory that one backend holds, by kind, which it changes as it creates and frees. */
export class GpuMemory {
	/** The bytes of textures and renderbuffers, then the bytes of buffers and query sets. */
	readonly bytes = new Float64Array(2);

	/** Adds bytes of textures, or takes them away when negative. */
	addTextures(bytes: number): void {
		this.bytes[TEXTURE_BYTES] = (this.bytes[TEXTURE_BYTES] as number) + bytes;
	}

	/** Adds bytes of buffers, or takes them away when negative. */
	addBuffers(bytes: number): void {
		this.bytes[BUFFER_BYTES] = (this.bytes[BUFFER_BYTES] as number) + bytes;
	}
}

/**
 * Bytes of one block of texels of a format as the GPU stores it. The draw list's table gives no
 * bytes for 24-bit depth, since writes and copies cannot reach its texels; GPUs store it in 4.
 */
function storedBlockBytes(format: number): number {
	return format === G.FORMAT_DEPTH24_PLUS ? 4 : (G.FORMAT_BLOCK_BYTES[format] ?? 0);
}

/**
 * The bytes that a texture takes on the GPU: every mip level of every layer, in whole blocks of
 * texels, times its sample count. A 3D texture (`volume`) halves its depth at each level, as it
 * halves its width and height; the layers of an array or a cube stay.
 */
export function textureBytes(
	format: number,
	width: number,
	height: number,
	layers: number,
	mips: number,
	samples: number,
	volume = false,
): number {
	const block = G.FORMAT_BLOCK_SIZE[format] ?? 1;
	const blockBytes = storedBlockBytes(format);
	let bytes = 0;
	for (let level = 0; level < mips; level++) {
		const across = Math.ceil(Math.max(1, width >> level) / block);
		const down = Math.ceil(Math.max(1, height >> level) / block);
		const deep = volume ? Math.max(1, layers >> level) : layers;
		bytes += across * down * deep * blockBytes;
	}
	return bytes * Math.max(1, samples);
}
