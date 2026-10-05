// The headers of PNG and JPEG files of any claimed size, with no pixels after them: small hostile
// files for the image size checks, for unit tests and test pages alike. It imports nothing.

/** A PNG signature and an IHDR chunk that give `width` x `height`, 8-bit RGBA, and nothing more. */
export function pngHeader(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(33);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	view.setUint32(16, width);
	view.setUint32(20, height);
	bytes.set([8, 6, 0, 0, 0], 24);
	return bytes;
}

/**
 * A JPEG start, an APP0 segment of `padding` bytes, and a baseline frame header that gives
 * `width` x `height`, with no scan after it.
 */
export function jpegHeader(width: number, height: number, padding = 14): Uint8Array {
	const bytes = new Uint8Array(2 + 4 + padding + 19);
	const view = new DataView(bytes.buffer);
	view.setUint16(0, 0xffd8);
	view.setUint16(2, 0xffe0);
	view.setUint16(4, 2 + padding);
	const frame = 6 + padding;
	view.setUint16(frame, 0xffc0);
	view.setUint16(frame + 2, 17);
	bytes[frame + 4] = 8;
	view.setUint16(frame + 5, height);
	view.setUint16(frame + 7, width);
	bytes[frame + 9] = 3;
	return bytes;
}
