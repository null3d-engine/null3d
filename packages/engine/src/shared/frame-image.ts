// Encodes a frame that the engine read back as a PNG file. The thread that draws encodes the frames
// it captures, and the page encodes hold mode's frame, which it keeps.

/**
 * Encodes a frame's RGBA8 rows, top row first, as a PNG file, changing `pixels` in place. On an
 * opaque canvas every pixel of the image is opaque too, whatever alpha the GPU wrote. A transparent
 * canvas's frame holds premultiplied color, which the image keeps with its alpha, as PNG files
 * store it: without the premultiplication.
 */
export function encodeFrame(
	{ width, height, pixels }: { width: number; height: number; pixels: Uint8Array },
	transparent: boolean,
): Promise<Blob> {
	if (transparent) unpremultiply(pixels);
	else for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('the browser has no 2D canvas to encode the frame with');
	const texels = new Uint8ClampedArray(
		pixels.buffer as ArrayBuffer,
		pixels.byteOffset,
		pixels.length,
	);
	context.putImageData(new ImageData(texels, width, height), 0, 0);
	return canvas.convertToBlob({ type: 'image/png' });
}

/** Divides each RGBA8 pixel's color by its alpha, in place. A pixel with no alpha stays black. */
export function unpremultiply(pixels: Uint8Array): void {
	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3] as number;
		if (alpha === 0 || alpha === 255) continue;
		for (let c = i; c < i + 3; c++)
			pixels[c] = Math.min(255, Math.round(((pixels[c] as number) * 255) / alpha));
	}
}
