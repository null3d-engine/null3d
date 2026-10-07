// Pixel readback through the engine's own GPU code. Tests compare these bytes with reference
// images, so they never depend on browser screenshots or on encoding through a page canvas.

import { messageOf } from '../errors/message';

const BYTES_PER_PIXEL = 4;
/** WebGPU copies texture rows into buffers at offsets aligned to this many bytes. */
const COPY_ROW_ALIGNMENT = 256;

/**
 * How long a failed readback waits for the device's loss to show, to name it as the cause. A
 * browser can fail the map before it reports the loss.
 */
const LOSS_WAIT_MS = 100;

/** A copy of a texture into a buffer that the GPU has been asked for, waiting to be mapped. */
interface PendingReadback {
	buffer: GPUBuffer;
	width: number;
	height: number;
	alignedRow: number;
	bgra: boolean;
}

/**
 * Reads an `rgba8unorm` or `bgra8unorm` texture as tightly packed RGBA8 rows, top row first. The
 * texture needs `COPY_SRC` usage. The result arrives through a promise, because mapping a GPU
 * buffer is asynchronous in the browser. A failure names its cause where WebGPU gives one: an
 * allocation that ran out of memory, or the loss of the device with its reason.
 */
export function readbackWebGPU(device: GPUDevice, texture: GPUTexture): Promise<Uint8Array> {
	return readInScope(device, () => texture);
}

/**
 * Makes an offscreen texture of a canvas's size and format, which `draw` draws into, and reads it
 * back as `readbackWebGPU` does. The texture is destroyed once its pixels are read. An allocation
 * of the drawing that runs out of memory also names the cause of a failure.
 */
export async function captureWebGPU(
	device: GPUDevice,
	width: number,
	height: number,
	format: GPUTextureFormat,
	draw: (texture: GPUTexture) => void,
): Promise<Uint8Array> {
	let texture: GPUTexture | undefined;
	try {
		return await readInScope(device, () => {
			texture = device.createTexture({
				size: [width, height],
				format,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
			});
			draw(texture);
			return texture;
		});
	} finally {
		texture?.destroy();
	}
}

/**
 * Reads back the texture that `record` returns, with its work and the copy inside an
 * out-of-memory error scope. Both run before the first wait, so no other work joins the scope.
 */
async function readInScope(device: GPUDevice, record: () => GPUTexture): Promise<Uint8Array> {
	device.pushErrorScope('out-of-memory');
	let pending: PendingReadback;
	let outOfMemory: Promise<GPUError | null>;
	try {
		pending = copyToBuffer(device, record());
	} finally {
		// A lost device can reject the scope's answer; the map's failure reports the loss instead.
		outOfMemory = device.popErrorScope().catch(() => null);
	}
	try {
		return await finishReadback(pending);
	} catch (error) {
		throw new Error(await readbackFailure(device, outOfMemory, error));
	}
}

/** Asks the GPU to copy a texture into a new buffer, which it maps once the copy is done. */
function copyToBuffer(device: GPUDevice, texture: GPUTexture): PendingReadback {
	const { width, height, format } = texture;
	if (format !== 'rgba8unorm' && format !== 'bgra8unorm')
		throw new Error(`readbackWebGPU supports rgba8unorm and bgra8unorm, not ${format}`);
	const alignedRow = Math.ceil((width * BYTES_PER_PIXEL) / COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT;
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
	return { buffer, width, height, alignedRow, bgra: format === 'bgra8unorm' };
}

/** Maps the buffer of a readback, and returns its pixels as tightly packed RGBA8 rows. */
async function finishReadback(pending: PendingReadback): Promise<Uint8Array> {
	const { buffer, width, height, alignedRow } = pending;
	try {
		await buffer.mapAsync(GPUMapMode.READ);
	} catch (error) {
		buffer.destroy();
		throw error;
	}
	const rowBytes = width * BYTES_PER_PIXEL;
	const mapped = new Uint8Array(buffer.getMappedRange());
	const out = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y++)
		out.set(mapped.subarray(y * alignedRow, y * alignedRow + rowBytes), y * rowBytes);
	buffer.unmap();
	buffer.destroy();
	if (pending.bgra) {
		for (let i = 0; i < out.length; i += BYTES_PER_PIXEL) {
			const blue = out[i] ?? 0;
			out[i] = out[i + 2] ?? 0;
			out[i + 2] = blue;
		}
	}
	return out;
}

/**
 * The cause of a readback whose map failed: the out-of-memory error of its allocations, or the
 * loss of the device, or else the map's own error. The map's error alone says no more than that
 * it failed in some browsers.
 */
async function readbackFailure(
	device: GPUDevice,
	outOfMemory: Promise<GPUError | null>,
	error: unknown,
): Promise<string> {
	const memory = await outOfMemory;
	if (memory) return `the GPU ran out of memory for the readback: ${memory.message}`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const lost = await Promise.race([
		device.lost,
		new Promise<undefined>((resolve) => {
			timer = setTimeout(() => resolve(undefined), LOSS_WAIT_MS);
		}),
	]);
	clearTimeout(timer);
	if (lost)
		return `the GPU device was lost during the readback (${lost.reason}: ${lost.message || 'no message'})`;
	return `the readback failed: ${messageOf(error)}`;
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
