// The canvas's size for the engine's threads. The page writes the canvas size in device pixels and
// in CSS pixels, and the pixel ratio, into the control block whenever they or the pixel ratio cap
// change; the thread that owns the canvas applies the size at frame start, and the sketch reads the
// CSS size and the ratio for pointer positions and its viewport. A hidden page that shows again
// counts as a resume, so the sketch's next step counts no time.

import { controlViews, Slot } from '../shared/control';

export interface CanvasWatch {
	/** Starts or stops watching. Starting writes the canvas's current size. */
	listen(on: boolean): void;
	/** Caps the device pixel ratio at `ratio` from now on, and writes the size again while watching. */
	setMaxPixelRatio(ratio: number): void;
}

type DevicePixels = { width: number; height: number };

/** Watches the canvas's size and the page's visibility, and writes them into the control block. */
export function watchCanvas(
	canvas: HTMLCanvasElement,
	control: ArrayBufferLike,
	maxPixelRatio: number,
): CanvasWatch {
	const { slots, slotFloats } = controlViews(control);
	let cap = maxPixelRatio;
	/** The sizes of the last write, which a new cap writes again. */
	let last: { cssWidth: number; cssHeight: number; devicePixels?: DevicePixels } | undefined;

	const writeSize = (cssWidth: number, cssHeight: number, devicePixels?: DevicePixels) => {
		last = { cssWidth, cssHeight, devicePixels };
		const ratio = Math.min(globalThis.devicePixelRatio ?? 1, cap);
		const exact = devicePixels && ratio === globalThis.devicePixelRatio;
		const width = exact ? devicePixels.width : Math.round(cssWidth * ratio);
		const height = exact ? devicePixels.height : Math.round(cssHeight * ratio);
		slotFloats[Slot.CanvasCssWidth] = cssWidth;
		slotFloats[Slot.CanvasCssHeight] = cssHeight;
		slotFloats[Slot.PixelRatio] = ratio;
		Atomics.store(slots, Slot.CanvasWidth, Math.max(1, width));
		Atomics.store(slots, Slot.CanvasHeight, Math.max(1, height));
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
			cap = ratio;
			if (listening && last) writeSize(last.cssWidth, last.cssHeight, last.devicePixels);
		},
	};
}
