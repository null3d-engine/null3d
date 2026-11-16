// The canvas's size for the engine's threads. The page writes the canvas size in device pixels and
// in CSS pixels, and the pixel ratio, into the control block whenever they or the pixel ratio cap
// change; the thread that owns the canvas applies the size at frame start, and the sketch reads the
// CSS size and the ratio for pointer positions and its viewport. A hidden page that shows again
// counts as a resume, so the sketch's next step counts no time.
//
// The size of the drawing buffer never passes the largest that the GPU path draws into. A larger
// canvas draws at a lower pixel ratio, which the page writes as the ratio, so the sketch still maps
// pointer positions to the buffer.

import { controlViews, Slot } from '../shared/control';

export interface CanvasWatch {
	/** Starts or stops watching. Starting writes the canvas's current size. */
	listen(on: boolean): void;
	/**
	 * Caps the device pixel ratio at `ratio` from now on. A new cap writes the size again while
	 * watching.
	 */
	setMaxPixelRatio(ratio: number): void;
}

type DevicePixels = { width: number; height: number };

/**
 * The drawing buffer's size and pixel ratio for a canvas of `cssWidth` by `cssHeight` CSS pixels, at
 * the page's `pageRatio` capped at `cap`, within `maxSize` on each side. The browser's device-pixel
 * box gives the exact size where the ratio is the page's own, which avoids a rounding step. It must
 * agree with the CSS size times the ratio, within that rounding: Chrome under a test runner's ratio
 * emulation reports the screen's own device pixels, twice the size on a high-density screen, while
 * the page's ratio says 1. Such a box would draw four times the pixels and pass the cap.
 */
export function canvasPixels(
	cssWidth: number,
	cssHeight: number,
	pageRatio: number,
	cap: number,
	devicePixels: DevicePixels | undefined,
	maxSize: number,
): { width: number; height: number; ratio: number } {
	const ratio = Math.min(pageRatio, cap);
	let width = Math.round(cssWidth * ratio);
	let height = Math.round(cssHeight * ratio);
	if (
		devicePixels &&
		ratio === pageRatio &&
		Math.abs(devicePixels.width - cssWidth * ratio) <= 1 &&
		Math.abs(devicePixels.height - cssHeight * ratio) <= 1
	) {
		width = devicePixels.width;
		height = devicePixels.height;
	}
	const fit = Math.min(1, maxSize / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * fit)),
		height: Math.max(1, Math.round(height * fit)),
		ratio: ratio * fit,
	};
}

/**
 * Fixes the CSS width or height of a canvas where it follows the size of the drawing buffer, as it
 * does on a canvas that no CSS sizes. The engine sizes the buffer to the CSS size times the pixel
 * ratio, so such a canvas would grow by that ratio at each resize, until the GPU could not draw
 * into it. The test doubles the buffer for a moment, which keeps its shape: a side whose CSS size
 * changes follows the buffer, and keeps the size it had. Call it before the canvas has a context.
 */
function fixSelfSizedCanvas(canvas: HTMLCanvasElement): void {
	const style = getComputedStyle(canvas);
	const cssWidth = style.width;
	const cssHeight = style.height;
	const { width, height } = canvas;
	canvas.width = Math.max(1, width) * 2;
	canvas.height = Math.max(1, height) * 2;
	const followsWidth = style.width !== cssWidth;
	const followsHeight = style.height !== cssHeight;
	canvas.width = width;
	canvas.height = height;
	if (followsWidth) canvas.style.width = cssWidth;
	if (followsHeight) canvas.style.height = cssHeight;
}

/**
 * Watches the canvas's size and the page's visibility, and writes them into the control block.
 * `maxSize` is the largest width and height of a drawing buffer that the GPU path draws into. With
 * `fixSize`, it first fixes the CSS size of a canvas that no CSS sizes; only a canvas that no engine
 * has used needs it.
 */
export function watchCanvas(
	canvas: HTMLCanvasElement,
	control: ArrayBufferLike,
	maxPixelRatio: number,
	maxSize: number,
	fixSize = true,
): CanvasWatch {
	const { slots, slotFloats } = controlViews(control);
	if (fixSize) fixSelfSizedCanvas(canvas);
	let cap = maxPixelRatio;
	/** The sizes of the last write, which a new cap writes again. */
	let last: { cssWidth: number; cssHeight: number; devicePixels?: DevicePixels } | undefined;

	const writeSize = (cssWidth: number, cssHeight: number, devicePixels?: DevicePixels) => {
		last = { cssWidth, cssHeight, devicePixels };
		const pixels = canvasPixels(
			cssWidth,
			cssHeight,
			globalThis.devicePixelRatio ?? 1,
			cap,
			devicePixels,
			maxSize,
		);
		slotFloats[Slot.CanvasCssWidth] = cssWidth;
		slotFloats[Slot.CanvasCssHeight] = cssHeight;
		slotFloats[Slot.PixelRatio] = pixels.ratio;
		Atomics.store(slots, Slot.CanvasWidth, pixels.width);
		Atomics.store(slots, Slot.CanvasHeight, pixels.height);
		Atomics.add(slots, Slot.ResizeSerial, 1);
	};
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const device = entry.devicePixelContentBoxSize?.[0];
			writeSize(
				entry.contentRect.width,
				entry.contentRect.height,
				device ? { width: device.inlineSize, height: device.blockSize } : undefined,
			);
		}
	});
	const writeCurrentSize = () => {
		const current = canvas.getBoundingClientRect();
		writeSize(current.width, current.height);
	};
	// Without the device-pixel box, a new pixel ratio with the same CSS size, as when the window
	// moves to another screen, reaches no resize observer. A query for the current ratio notices it.
	let ratioQuery: MediaQueryList | undefined;
	const onRatioChange = () => {
		watchRatio();
		writeCurrentSize();
	};
	const watchRatio = () => {
		ratioQuery?.removeEventListener('change', onRatioChange);
		ratioQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
		ratioQuery.addEventListener('change', onRatioChange);
	};
	const onVisibility = () => {
		if (!document.hidden) Atomics.add(slots, Slot.Resumes, 1);
	};

	let listening = false;
	return {
		listen(on) {
			if (on === listening) return;
			listening = on;
			if (on) {
				writeCurrentSize();
				try {
					observer.observe(canvas, { box: 'device-pixel-content-box' });
				} catch {
					observer.observe(canvas);
					watchRatio();
				}
				document.addEventListener('visibilitychange', onVisibility);
			} else {
				observer.disconnect();
				ratioQuery?.removeEventListener('change', onRatioChange);
				ratioQuery = undefined;
				document.removeEventListener('visibilitychange', onVisibility);
			}
		},
		setMaxPixelRatio(ratio) {
			if (ratio === cap) return;
			cap = ratio;
			if (listening && last) writeSize(last.cssWidth, last.cssHeight, last.devicePixels);
		},
	};
}
