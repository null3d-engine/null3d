// The headers of PNG, JPEG, WebP and AVIF files of any claimed size, with no pixels after them: small hostile
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

/** Four characters as bytes. */
const ascii = (text: string) => new TextEncoder().encode(text);

/**
 * A WebP file's RIFF header and first chunk, which give `width` x `height`: `lossy` data (`VP8 `),
 * `lossless` data (`VP8L`) or the `extended` format's canvas (`VP8X`), with no image data.
 */
export function webpHeader(
	width: number,
	height: number,
	kind: 'lossy' | 'lossless' | 'extended' = 'extended',
): Uint8Array {
	const bytes = new Uint8Array(30);
	const view = new DataView(bytes.buffer);
	bytes.set(ascii('RIFF'));
	view.setUint32(4, bytes.length - 8, true);
	bytes.set(ascii('WEBP'), 8);
	bytes.set(ascii({ lossy: 'VP8 ', lossless: 'VP8L', extended: 'VP8X' }[kind]), 12);
	view.setUint32(16, 10, true);
	if (kind === 'lossy') {
		bytes.set([0x9d, 0x01, 0x2a], 23);
		view.setUint16(26, width, true);
		view.setUint16(28, height, true);
	} else if (kind === 'lossless') {
		bytes[20] = 0x2f;
		view.setUint32(21, (width - 1) | ((height - 1) << 14), true);
	} else {
		for (const [at, side] of [
			[24, width - 1],
			[27, height - 1],
		] as const)
			bytes.set([side & 0xff, (side >>> 8) & 0xff, (side >>> 16) & 0xff], at);
	}
	return bytes;
}

/** A box: its size, its four-character type, then its contents. */
function box(type: string, ...contents: Uint8Array[]): Uint8Array {
	const size = 8 + contents.reduce((sum, part) => sum + part.length, 0);
	const bytes = new Uint8Array(size);
	new DataView(bytes.buffer).setUint32(0, size);
	bytes.set(ascii(type), 4);
	let at = 8;
	for (const part of contents) {
		bytes.set(part, at);
		at += part.length;
	}
	return bytes;
}

/**
 * An AVIF file's boxes up to its item properties, whose image spatial extents give `width` x
 * `height` and then each of `more` sizes, as an alpha plane or a grid's tiles add, with no image
 * data.
 */
export function avifHeader(
	width: number,
	height: number,
	more: readonly [number, number][] = [],
): Uint8Array {
	const ispe = ([w, h]: readonly [number, number]) => {
		const sizes = new Uint8Array(12);
		const view = new DataView(sizes.buffer);
		view.setUint32(4, w);
		view.setUint32(8, h);
		return box('ispe', sizes);
	};
	const ftyp = box('ftyp', ascii('avif'), new Uint8Array(4), ascii('mif1'), ascii('miaf'));
	const properties = box('iprp', box('ipco', ...[[width, height] as const, ...more].map(ispe)));
	return Uint8Array.from([
		...ftyp,
		...box('meta', new Uint8Array(4), box('hdlr', new Uint8Array(25)), properties),
	]);
}
