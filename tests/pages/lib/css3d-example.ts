// The shared stages of the ports of three.js's CSS3D examples (examples/css3d_*.html, r186). Each
// port draws its scene twice on one page: by null3D, where an HTML element with `transform: 'world'`
// or `'billboard'` is a plane of the scene, and by three.js's CSS3DRenderer, from the same data and
// camera. A picture test screenshots each stage's elements alone and compares the two.
//
// The engine's own pixels are not part of that comparison. The test hides both canvases first, so
// the screenshots hold the elements and the stage's background only. An example whose scene also
// has WebGL content reports the pixels that the engine drew, which proves that half drew too.
import { createEngine } from '@null3d/engine';
import * as THREE from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { STAGE } from './css3d-shared';
import { run } from './result';

/** One of the ports: the sketch, the page's own markup, and three.js's twin of the same scene. */
export interface Css3dPort {
	/** The page's name, which its result carries. */
	name: string;
	/** The engine's sketch module. */
	sketch: URL;
	/** The sketch time in seconds that the port holds at, so a picture repeats. */
	hold: number;
	/** The most planes the engine holds. */
	maxLabels3d: number;
	/**
	 * Makes the scene's elements in `layer`, binds each one to its label's id, and returns the
	 * elements in the order of the twin's.
	 */
	markup(layer: HTMLElement, bind: (id: string, element: HTMLElement) => void): HTMLElement[];
	/** Draws the same scene with three.js's CSS3DRenderer into `layer`, and gives its elements. */
	twin(layer: HTMLElement, time: number): HTMLElement[];
	/** True when the example's scene draws WebGL content beside its elements. */
	webgl?: boolean;
	/**
	 * True when the page puts the elements below the canvas, as the example whose WebGL content
	 * covers its elements does. The canvas is then see-through, so the elements show where nothing
	 * draws, and the drawn scene covers them where it does.
	 */
	labelsBelow?: boolean;
}

/** Resolves after `count` animation frames. */
export const frames = (count: number): Promise<void> =>
	new Promise((resolve) => {
		const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step));
		requestAnimationFrame(step);
	});

/** The element that `selector` names, or an error that names the page's missing markup. */
function required<T extends HTMLElement>(selector: string): T {
	const element = document.querySelector<T>(selector);
	if (!element) throw new Error(`the page lacks ${selector}`);
	return element;
}

/** True when an element shows a plane's matrix, which the engine writes once it places it. */
function placed(element: HTMLElement): boolean {
	return element.style.visibility !== 'hidden' && element.style.transform.includes('matrix3d');
}

/** Each element's box in its stage: x, y, width and height in CSS pixels from the stage's corner. */
function boxes(elements: readonly HTMLElement[], stage: HTMLElement): number[][] {
	const origin = stage.getBoundingClientRect();
	return elements.map((element) => {
		const box = element.getBoundingClientRect();
		return [box.x - origin.x, box.y - origin.y, box.width, box.height];
	});
}

/**
 * The pixels that the engine drew. A see-through canvas reports the pixels that it painted. An
 * opaque one reports the pixels that differ from the frame's first pixel, which shows the
 * background. A scene that draws nothing reports none.
 */
function litPixels(pixels: Uint8Array, seeThrough: boolean): number {
	const r0 = pixels[0] as number;
	const g0 = pixels[1] as number;
	const b0 = pixels[2] as number;
	let lit = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		if (seeThrough) {
			if ((pixels[i + 3] as number) > 8) lit++;
			continue;
		}
		if (
			Math.abs((pixels[i] as number) - r0) > 8 ||
			Math.abs((pixels[i + 1] as number) - g0) > 8 ||
			Math.abs((pixels[i + 2] as number) - b0) > 8
		)
			lit++;
	}
	return lit;
}

/**
 * Waits until every image and every iframe that the elements hold has loaded, or the limit runs out.
 * A slow machine may not have decoded an element's image by the frame that placed it.
 */
async function whenElementsLoaded(limit = 240): Promise<void> {
	for (let count = 0; count < limit; count++) {
		const images = [...document.querySelectorAll<HTMLImageElement>('img')];
		const embedded = [...document.querySelectorAll<HTMLIFrameElement>('iframe')];
		if (
			images.every((image) => image.complete) &&
			embedded.every((frame) => frame.dataset.loaded === '1')
		)
			return;
		await frames(1);
	}
}

/**
 * Draws a port's page: the engine's stage from the sketch, then three.js's twin from the same data,
 * held at the same time. The page publishes each element's box and the pixels that the engine drew.
 */
export function runPort(port: Css3dPort): void {
	run(port.name, async () => {
		const canvas = required<HTMLCanvasElement>('#mine canvas');
		const mineStage = required('#mine');
		const layer = required('#mine-labels');
		const theirStage = required('#theirs');
		const theirLayer = required('#theirs-labels');
		const engine = await createEngine({
			canvas,
			sketch: port.sketch,
			maxPixelRatio: 1,
			// An example whose scene is HTML alone leaves the page's own background showing. One whose
			// drawn scene covers its elements puts a see-through canvas over them instead.
			transparent: port.labelsBelow === true || !port.webgl,
			maxLabels3d: port.maxLabels3d,
			hold: port.hold,
		});
		const elements = port.markup(layer, (id, element) => engine.labels.bind(id, element));
		await engine.firstFrame;
		// The thread that draws places the elements through its own frame callback, so wait for the
		// labels of the held frame to reach the page. A software GPU draws few frames a second.
		for (let count = 0; count < 240 && !elements.some(placed); count++) await frames(1);
		if (!elements.some(placed)) throw new Error('the null3D labels did not reach the screen');
		// The remaining elements may sit behind the camera, which the engine hides and the twin
		// hides too, so a few more frames settle every element that shows.
		await frames(4);
		await whenElementsLoaded();
		const time = engine.mode.hold ?? port.hold;
		const theirElements = port.twin(theirLayer, time);
		await frames(2);
		await whenElementsLoaded();
		const captured = port.webgl ? await engine.captureFrame() : undefined;
		const seeThrough = port.labelsBelow === true || !port.webgl;
		return {
			stage: STAGE,
			mine: elements.length,
			theirs: theirElements.length,
			boxes: { mine: boxes(elements, mineStage), theirs: boxes(theirElements, theirStage) },
			shown: { mine: elements.map((element) => element.style.visibility !== 'hidden') },
			webglPixels: captured ? litPixels(captured.pixels, seeThrough) : 0,
			mode: engine.mode,
		};
	});
}

/**
 * Draws a port's scene with three.js's CSS3DRenderer into `layer`, at the stage's fixed size, and
 * gives the renderer, its camera and the scene. The port adds its objects, then calls `render`.
 */
export function css3dTwin(
	layer: HTMLElement,
	camera: THREE.Camera,
): { renderer: CSS3DRenderer; camera: THREE.Camera; scene: THREE.Scene } {
	const renderer = new CSS3DRenderer();
	renderer.setSize(STAGE.width, STAGE.height);
	layer.append(renderer.domElement);
	const scene = new THREE.Scene();
	return { renderer, camera, scene };
}

/** A three.js camera at `position`, turned toward `target`, with the example's own lens. */
export function twinCamera(
	position: readonly [number, number, number],
	target: readonly [number, number, number] = [0, 0, 0],
	lens: { fov?: number; near?: number; far?: number } = {},
): THREE.PerspectiveCamera {
	const { fov = 50, near = 1, far = 5000 } = lens;
	const camera = new THREE.PerspectiveCamera(fov, STAGE.width / STAGE.height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);
	camera.updateMatrixWorld();
	return camera;
}

/**
 * A three.js orthographic camera whose view is `height` world units tall, with the width that the
 * stage's aspect gives it, at `position` and turned toward `target`.
 */
export function twinOrthographic(
	height: number,
	position: readonly [number, number, number],
	target: readonly [number, number, number] = [0, 0, 0],
	lens: { near?: number; far?: number } = {},
): THREE.OrthographicCamera {
	const { near = 1, far = 1000 } = lens;
	const aspect = STAGE.width / STAGE.height;
	const half = height / 2;
	const camera = new THREE.OrthographicCamera(
		-half * aspect,
		half * aspect,
		half,
		-half,
		near,
		far,
	);
	camera.position.set(...position);
	camera.lookAt(...target);
	camera.updateMatrixWorld();
	return camera;
}
