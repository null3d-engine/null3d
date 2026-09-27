// Pixel readback through the engine's own GPU code. Tests compare these bytes with reference
// images, so they never depend on browser screenshots or on encoding through a page canvas.

const BYTES_PER_PIXEL = 4;
/** WebGPU copies texture rows into buffers at offsets aligned to this many bytes. */
const COPY_ROW_ALIGNMENT = 256;

/**
 * Reads an `rgba8unorm` or `bgra8unorm` texture as tightly packed RGBA8 rows, top row first. The
 * texture needs `COPY_SRC` usage. The result arrives through a promise, because mapping a GPU
 * buffer is asynchronous in the browser.
 */
export async function readbackWebGPU(device: GPUDevice, texture: GPUTexture): Promise<Uint8Array> {
	const { width, height, format } = texture;
	if (format !== 'rgba8unorm' && format !== 'bgra8unorm') {
		throw new Error(`readbackWebGPU supports rgba8unorm and bgra8unorm, not ${format}`);
	}
	const rowBytes = width * BYTES_PER_PIXEL;
	const alignedRow = Math.ceil(rowBytes / COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT;
	const buffer = device.createBuffer({
		size: alignedRow * height,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer(
		{ texture },
		{ buffer, bytesPerRow: alignedRow, rowsPerImage: height },
		{ width, height },
	);
	device.queue.submit([encoder.finish()]);
	await buffer.mapAsync(GPUMapMode.READ);
	const mapped = new Uint8Array(buffer.getMappedRange());
	const out = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y++)
		out.set(mapped.subarray(y * alignedRow, y * alignedRow + rowBytes), y * rowBytes);
	buffer.unmap();
	buffer.destroy();
	if (format === 'bgra8unorm') {
		for (let i = 0; i < out.length; i += BYTES_PER_PIXEL) {
			const blue = out[i] ?? 0;
			out[i] = out[i + 2] ?? 0;
			out[i + 2] = blue;
		}
	}
	return out;
}

/** Reads the bound framebuffer of a WebGL2 context as tightly packed RGBA8 rows, top row first. */
export function readbackWebGL2(
	gl: WebGL2RenderingContext,
	width: number,
	height: number,
): Uint8Array {
	const rowBytes = width * BYTES_PER_PIXEL;
	const bottomUp = new Uint8Array(rowBytes * height);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
	const out = new Uint8Array(bottomUp.length);
	for (let y = 0; y < height; y++) {
		out.set(bottomUp.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
	}
	return out;
}
