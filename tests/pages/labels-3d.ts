// Draws a card that turns with its object and a card that faces the camera, as HTML elements that
// the engine turns. In hold mode it draws the same scene again with three.js's CSS3DRenderer, so a
// test can compare where each element sits in the two engines. Otherwise it samples the green card's
// element in each frame on screen, with the number of the frame whose labels it shows, and
// `labels3d()` on the window answers with those samples and the sketch's place of the card.
import { createEngine } from '@null3d/engine';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer, CSS3DSprite } from 'three/addons/renderers/CSS3DRenderer.js';
import { run } from './lib/result';
import { CAMERA, FACE, PLATE } from './sketches/labels-3d-scene';

declare global {
	interface Window {
		labels3d?: () => Promise<unknown>;
	}
}

/** Frames on screen that the page samples, at most. */
const SAMPLES = 90;
/**
 * How long the page samples for, in seconds. A sample needs the frame on screen to change, and a
 * software renderer draws only a few frames a second, so a count alone would outlast the test's
 * wait on a busy machine. The test checks a floor of samples of its own.
 */
const SAMPLE_SECONDS = 25;

/** An element of the card's size, in CSS pixels, with no border or padding, in both engines. */
function card(width: number, height: number, color: string): HTMLElement {
	const element = document.createElement('div');
	element.style.width = `${width}px`;
	element.style.height = `${height}px`;
	element.style.background = color;
	return element;
}

/** The element's box on the page: x, y, width and height. */
function boxOf(element: HTMLElement): [number, number, number, number] {
	const box = element.getBoundingClientRect();
	return [box.x, box.y, box.width, box.height];
}

/** Resolves after `count` animation frames. */
const frames = (count: number) =>
	new Promise<void>((resolve) => {
		const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step));
		requestAnimationFrame(step);
	});

/** The same scene in three.js, drawn by its CSS3DRenderer into `layer`. */
function threeScene(
	layer: HTMLElement,
	width: number,
	height: number,
): { plate: HTMLElement; face: HTMLElement } {
	const camera = new THREE.PerspectiveCamera(CAMERA.fov, width / height, CAMERA.near, CAMERA.far);
	camera.position.set(0, 0, 0);
	camera.lookAt(0, 0, -1);
	const scene = new THREE.Scene();
	const root = new THREE.Object3D();
	root.position.set(...PLATE.position);
	root.rotation.set(...PLATE.rotation);
	const plate = new CSS3DObject(card(PLATE.width, PLATE.height, '#f00'));
	plate.position.set(...PLATE.offset);
	root.add(plate);
	const face = new CSS3DSprite(card(FACE.width, FACE.height, '#0f0'));
	face.position.set(...FACE.position);
	// The sprite's turn in its own plane, which this version of three.js's types leave out.
	(face as unknown as { rotation2D: number }).rotation2D = FACE.rotation;
	scene.add(root, face);
	const renderer = new CSS3DRenderer();
	renderer.setSize(width, height);
	layer.append(renderer.domElement);
	renderer.render(scene, camera);
	return { plate: plate.element, face: face.element };
}

run('labels-3d', async () => {
	const canvas = document.querySelector('canvas');
	const layer = document.querySelector<HTMLElement>('#labels');
	const others = document.querySelector<HTMLElement>('#three');
	if (!canvas || !layer || !others) throw new Error('the page has no canvas or label layers');
	const hold = new URLSearchParams(location.search).has('hold');
	const sketch = new URL('./sketches/labels-3d-sketch.ts', import.meta.url);
	if (hold) sketch.searchParams.set('still', '');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1 });
	const plate = card(PLATE.width, PLATE.height, '#f00');
	const face = card(FACE.width, FACE.height, '#0f0');
	layer.append(plate, face);
	engine.labels.bind('plate', plate);
	engine.labels.bind('face', face);
	const shown = (element: HTMLElement) => element.style.visibility !== 'hidden';
	if (hold) {
		// Both cards reach the screen once the frame that drew them reaches the page.
		while (!shown(plate) || !shown(face)) await frames(1);
		const theirs = threeScene(others, canvas.clientWidth, canvas.clientHeight);
		return {
			mode: engine.mode,
			mine: { plate: boxOf(plate), face: boxOf(face) },
			theirs: { plate: boxOf(theirs.plate), face: boxOf(theirs.face) },
		};
	}
	await engine.firstFrame;
	/** The frame whose labels the element showed, then its center, for each frame it moved. */
	const samples: number[] = [];
	const until = performance.now() + SAMPLE_SECONDS * 1000;
	await new Promise<void>((resolve) => {
		let last = -1;
		const sample = () => {
			const frame = (engine.labels as unknown as { frame: number }).frame;
			if (frame !== last && shown(face)) {
				last = frame;
				const [x, y, width, height] = boxOf(face);
				samples.push(frame, x + width / 2, y + height / 2);
			}
			if (samples.length >= SAMPLES * 3 || performance.now() >= until) resolve();
			else requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	window.labels3d = () =>
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
