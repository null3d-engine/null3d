// The labels of S6's pages, which both engines draw alike: a name tag over each of the tallest
// towers, and one over the picked building. The tags lie in a layer over the canvas that lets the
// pointer through, so clicks still reach the canvas.

/** The style of a tag. */
const TAG_STYLE =
	'padding: 2px 6px; border-radius: 3px; background: rgba(16, 20, 24, 0.75); color: #fff; font: 12px sans-serif; white-space: nowrap';

/** The layer over `canvas` that holds the tags, made on the first call. */
export function labelLayer(canvas: HTMLElement): HTMLElement {
	const parent = canvas.parentElement ?? document.body;
	let layer = parent.querySelector<HTMLElement>(':scope > .s6-labels');
	if (layer) return layer;
	layer = document.createElement('div');
	layer.className = 's6-labels';
	layer.style.cssText = 'position: absolute; overflow: hidden; pointer-events: none';
	parent.style.position = 'relative';
	parent.append(layer);
	const fit = () => {
		layer.style.left = `${canvas.offsetLeft}px`;
		layer.style.top = `${canvas.offsetTop}px`;
		layer.style.width = `${canvas.clientWidth}px`;
		layer.style.height = `${canvas.clientHeight}px`;
	};
	fit();
	new ResizeObserver(fit).observe(canvas);
	return layer;
}

/** A tag with `text`, in the layer. */
export function labelTag(layer: HTMLElement, text: string): HTMLElement {
	const tag = document.createElement('div');
	tag.style.cssText = TAG_STYLE;
	tag.textContent = text;
	layer.append(tag);
	return tag;
}

/** The text of the picked building's tag. */
export const pickedText = (building: number) => `Building ${building}`;
