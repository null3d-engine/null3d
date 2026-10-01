// Shows the whole benchmark canvas on screens smaller than it, such as phones, below the page's
// name.

/**
 * Scales a canvas down on screen until it fits the window below what sits above it, and does it
 * again when the window changes size. A transform changes only what the browser shows: the canvas
 * keeps its layout size, so each engine keeps drawing every pixel of its full-size image. Negative
 * margins give the scaled canvas a place in the page the size of what shows, so the page does not
 * scroll. Call it once the engine has started, as an engine may read the canvas's on-screen size
 * at startup.
 */
export function fitToWindow(canvas: HTMLCanvasElement, width: number, height: number): void {
	const fit = (): void => {
		const room = innerHeight - canvas.offsetTop;
		const scale = Math.min(1, innerWidth / width, room / height);
		canvas.style.transformOrigin = '0 0';
		canvas.style.transform = `scale(${scale})`;
		canvas.style.marginRight = `${(scale - 1) * width}px`;
		canvas.style.marginBottom = `${(scale - 1) * height}px`;
	};
	fit();
	addEventListener('resize', fit);
}

/**
 * Makes a canvas fill the window below what sits above it, as a full-screen app does, and again
 * when the window changes size. Call it before the engine starts, which reads the canvas's size.
 */
export function fillWindow(canvas: HTMLCanvasElement): void {
	const fill = (): void => {
		canvas.style.width = `${innerWidth}px`;
		canvas.style.height = `${Math.max(1, innerHeight - canvas.offsetTop)}px`;
	};
	fill();
	addEventListener('resize', fill);
}

/**
 * Shows the page's title and switches in its status line, at the top of the page, while it runs,
 * so a window that runs one benchmark page after another shows which one is on screen. The page
 * puts its result there when it finishes.
 */
export function showPageName(): void {
	const status = document.getElementById('status');
	const switches = location.search.slice(1);
	if (status) status.textContent = `${document.title}${switches ? ` (${switches})` : ''}: running`;
}
