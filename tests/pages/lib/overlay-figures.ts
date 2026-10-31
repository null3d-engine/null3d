// Reading the engine's stats overlay from the page: the figures that only it samples, such as the
// triangles drawn and the GPU's memory. A page shows the overlay after its own measurement, so the
// overlay's sampling costs none of the frames that the page times.

/** How long a page waits for the overlay's figures, with a limit so a page that cannot show them reports. */
export const OVERLAY_WAIT_MS = 30_000;

/**
 * A figure that the overlay shows, read through its shadow root, or null when the overlay hides the
 * figure because it has no value.
 */
export function overlayFigure(name: string): string | null {
	const root = document.querySelector<HTMLElement>('[data-null3d-stats]')?.shadowRoot;
	const node = root?.querySelector<HTMLElement>(`[data-figure="${name}"]`);
	// A tab that does not show still holds its figures, and the overlay keeps them current.
	if (!node || node.closest('[hidden]:not(.pane)')) return null;
	const text = node.textContent?.trim() ?? '';
	return text.length > 0 ? text : null;
}

/** Bytes from a figure that the overlay wrote in mebibytes, or null. The overlay rounds to 0.1. */
export function overlayMiB(text: string | null): number | null {
	const value = text?.match(/([\d.]+)\s*MiB/);
	return value?.[1] ? Math.round(Number(value[1]) * 1024 * 1024) : null;
}

/** A count from a figure that the overlay wrote, such as `12.4 k` or `2.31 M`, or null. */
export function overlayCount(text: string | null): number | null {
	const value = text?.match(/([\d.]+)\s*([kM])?/);
	if (!value?.[1]) return null;
	const factor = value[2] === 'k' ? 1000 : value[2] === 'M' ? 1_000_000 : 1;
	return Math.round(Number(value[1]) * factor);
}

/**
 * Waits for the overlay to show a count above zero, up to a time limit. The figures read zero until
 * the engine has a window of sampled frames, so a page that reads at once gets no count at all.
 */
export async function waitForOverlay(name: string): Promise<boolean> {
	const deadline = performance.now() + OVERLAY_WAIT_MS;
	while (performance.now() < deadline) {
		if ((overlayCount(overlayFigure(name)) ?? 0) > 0) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

/** The memory figures that the overlay shows, in bytes, or null for a figure it hides. */
export function overlayMemory(wasmBytes: number | null): {
	engineBytes: number | null;
	gpuTextureBytes: number | null;
	gpuBufferBytes: number | null;
	jsHeapBytes: number | null;
	totalBytes: number | null;
	wasmBytes: number | null;
} {
	return {
		// The overlay writes each figure in mebibytes, rounded to 0.1.
		engineBytes: overlayMiB(overlayFigure('engine-memory')),
		gpuTextureBytes: overlayMiB(overlayFigure('gpu-textures')),
		gpuBufferBytes: overlayMiB(overlayFigure('gpu-buffers')),
		jsHeapBytes: overlayMiB(overlayFigure('js-heap')),
		totalBytes: overlayMiB(overlayFigure('memory')),
		wasmBytes,
	};
}
