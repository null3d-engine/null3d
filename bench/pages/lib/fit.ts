// Shows the whole benchmark canvas on screens smaller than it, such as phones.

/**
 * Scales a canvas down on screen until it fits the window, and does it again when the window
 * changes size. A transform changes only what the browser shows: the canvas keeps its layout size,
 * so each engine keeps drawing every pixel of its full-size image. Negative margins give the
 * scaled canvas a place in the page the size of what shows, so the page does not scroll. Call it
 * once the engine has started, as an engine may read the canvas's on-screen size at startup.
 */
export function fitToWindow(canvas: HTMLCanvasElement, width: number, height: number): void {
	const fit = (): void => {
		const scale = Math.min(1, innerWidth / width, innerHeight / height);
		canvas.style.transformOrigin = '0 0';
		canvas.style.transform = `scale(${scale})`;
		canvas.style.marginRight = `${(scale - 1) * width}px`;
		canvas.style.marginBottom = `${(scale - 1) * height}px`;
	};
	fit();
	addEventListener('resize', fit);
}
