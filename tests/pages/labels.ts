// Starts the engine with a label on a box, binds an element to it, and records where the element
// sits in each frame on screen, with the number of the frame whose labels it shows. `labels()` on
// the window gives those samples and the sketch's place of the box in each frame. In hold mode the
// camera stays still, and the page gives the element's place and the center of the box's red pixels
// in the held frame instead. `far` starts the engine in large-world mode, with the camera and the box
// at the Earth's radius.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		labels?: () => Promise<unknown>;
	}
}

/** Frames on screen that the page samples. */
const SAMPLES = 90;

/** The center of the element's box, from its transform, or null while it is hidden. */
function placeOf(element: HTMLElement): [number, number] | null {
	if (element.style.visibility === 'hidden' || !element.style.transform) return null;
	const match = /translate3d\(([^p]+)px,\s*([^p]+)px/.exec(element.style.transform);
	return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Resolves after `count` animation frames. */
const frames = (count: number) =>
	new Promise<void>((resolve) => {
		const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step));
		requestAnimationFrame(step);
	});

run('labels', async () => {
	const canvas = document.querySelector('canvas');
	const layer = document.querySelector<HTMLElement>('#labels');
	if (!canvas || !layer) throw new Error('the page has no canvas or label layer');
	const params = new URLSearchParams(location.search);
	const hold = params.has('hold');
	const far = params.has('far');
	const sketch = new URL('./sketches/labels-sketch.ts', import.meta.url);
	if (hold) sketch.searchParams.set('still', '');
	if (far) sketch.searchParams.set('far', '');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, largeWorld: far });
	const element = document.createElement('div');
	element.className = 'label';
	layer.append(element);
	engine.labels.bind('box', element);
	const shown = () => (engine.labels as unknown as { frame: number }).frame;
	if (hold) {
		while (placeOf(element) === null) await frames(1);
		const { width, height, pixels } = await engine.captureFrame();
		let [sumX, sumY, count] = [0, 0, 0];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const at = (y * width + x) * 4;
				if ((pixels[at] as number) > 128 && (pixels[at + 1] as number) < 64) {
					sumX += x + 0.5;
					sumY += y + 0.5;
					count++;
				}
			}
		return {
			mode: engine.mode,
			label: placeOf(element),
			pixels: count,
			center: count > 0 ? [sumX / count, sumY / count] : null,
		};
	}
	await engine.firstFrame;
	const samples: number[] = [];
	await new Promise<void>((resolve) => {
		let last = -1;
		const sample = () => {
			const frame = shown();
			const place = placeOf(element);
			if (frame !== last && place) {
				last = frame;
				samples.push(frame, place[0], place[1]);
			}
			if (samples.length >= SAMPLES * 3) resolve();
			else requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	window.labels = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'places') return;
				off();
				resolve({ samples, places: data });
			});
			engine.postToSketch('places');
		});
	return { mode: engine.mode };
});
