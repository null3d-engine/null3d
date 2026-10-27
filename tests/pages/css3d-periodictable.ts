// three.js's CSS3D periodic table example (examples/css3d_periodictable.html, r186) drawn twice on
// one page: by null3D, with each cell as a label that is a plane of the scene, and by three.js's
// CSS3DRenderer, from the same data, camera and cell markup. A picture test compares the two stages.
// The example tints each cell with Math.random(); both sides here take the tint from the cell's
// place, so the two draws can be compared.
import { createEngine } from '@null3d/engine';
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { frames } from './lib/css3d-example';
import {
	CAMERA,
	cellPosition,
	cellTint,
	ELEMENTS,
	type ElementCell,
} from './lib/css3d-periodictable';
import { STAGE } from './lib/css3d-shared';
import { run } from './lib/result';

/** The cell elements of one engine's stage, in the table's order. */
type Cells = HTMLElement[];

/** One cell's element, as the example makes it: its number, symbol, name and mass. */
function cell(index: number): HTMLElement {
	const data = ELEMENTS[index] as ElementCell;
	const element = document.createElement('div');
	element.className = 'element';
	element.style.backgroundColor = `rgba(0, 127, 127, ${cellTint(index)})`;
	const number = document.createElement('div');
	number.className = 'number';
	number.textContent = String(index + 1);
	const symbol = document.createElement('div');
	symbol.className = 'symbol';
	symbol.textContent = data.symbol;
	const details = document.createElement('div');
	details.className = 'details';
	// The example's own cell content: the name, a line break, then the atomic mass.
	details.innerHTML = `${data.name}<br>${data.mass}`;
	element.append(number, symbol, details);
	return element;
}

/** Draws the example with three.js's CSS3DRenderer into a stage, and gives its cells. */
function threeStage(stage: HTMLElement): Cells {
	const camera = new THREE.PerspectiveCamera(
		CAMERA.fov,
		STAGE.width / STAGE.height,
		CAMERA.near,
		CAMERA.far,
	);
	camera.position.z = CAMERA.distance;
	const scene = new THREE.Scene();
	const cells = ELEMENTS.map((_data, index) => {
		const element = cell(index);
		const object = new CSS3DObject(element);
		object.position.set(...cellPosition(index));
		scene.add(object);
		return element;
	});
	const renderer = new CSS3DRenderer();
	renderer.setSize(STAGE.width, STAGE.height);
	stage.append(renderer.domElement);
	renderer.render(scene, camera);
	return cells;
}

run('css3d-periodictable', async () => {
	const mine = document.querySelector<HTMLElement>('#mine');
	const canvas = mine?.querySelector('canvas');
	const layer = document.querySelector<HTMLElement>('#mine-labels');
	const theirs = document.querySelector<HTMLElement>('#theirs');
	if (!mine || !canvas || !layer || !theirs) throw new Error('the page lacks a stage');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/css3d-periodictable-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const cells: Cells = ELEMENTS.map((_data, index) => {
		const element = cell(index);
		layer.append(element);
		engine.labels.bind(`cell-${index}`, element);
		return element;
	});
	await engine.firstFrame;
	// A cell reaches the screen once the frame that placed it reaches the page: the engine writes
	// its matrix then. Poll a bounded number of frames, as the 3D label test does, so a slow
	// software renderer cannot hang the page.
	const placed = (element: HTMLElement) =>
		element.style.visibility !== 'hidden' && element.style.transform.includes('matrix3d');
	const visible = () => cells.every(placed);
	for (let count = 0; count < 240 && !visible(); count++) await frames(1);
	if (!visible()) throw new Error('the null3D labels did not reach the screen');
	const theirCells = threeStage(theirs);
	await frames(2);
	return {
		stage: STAGE,
		cells: cells.length,
		theirCells: theirCells.length,
		mode: engine.mode,
	};
});
