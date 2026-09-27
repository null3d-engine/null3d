// Converts pixel readbacks to the layout that parity images use: RGBA8, rows tightly packed, top
// row first.

const BYTES_PER_PIXEL = 4;

/**
 * Copies `height` rows of RGBA8 pixels into a tightly packed buffer, top row first. In `source`,
 * rows start `rowStride` bytes apart, which allows padding at the end of each row. `bottomFirst`
 * says that the first row in `source` is the bottom row of the image, as WebGL reads them.
 */
export function packRows(
	source: Uint8Array,
	width: number,
	height: number,
	rowStride: number,
	bottomFirst: boolean,
): Uint8Array {
	const rowBytes = width * BYTES_PER_PIXEL;
	if (rowStride < rowBytes || source.length < rowStride * (height - 1) + rowBytes) {
		throw new RangeError(
			`${source.length} bytes cannot hold ${height} rows of ${width} pixels, ${rowStride} bytes apart`,
		);
	}
	const out = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y++) {
		const from = y * rowStride;
		out.set(source.subarray(from, from + rowBytes), (bottomFirst ? height - 1 - y : y) * rowBytes);
	}
	return out;
}

/**
 * The distance between row starts in a readback of `height` rows of `width` pixels, from its
 * length. The last row carries no padding, so padded rows show as extra bytes on the other rows.
 */
export function rowStrideOf(length: number, width: number, height: number): number {
	const rowBytes = width * BYTES_PER_PIXEL;
	const stride = height > 1 ? (length - rowBytes) / (height - 1) : rowBytes;
	if (!Number.isInteger(stride) || stride < rowBytes) {
		throw new RangeError(`${length} bytes do not form ${height} rows of ${width} pixels`);
	}
	return stride;
}
