// three.js's CSS3D molecules example (examples/css3d_molecules.html, r186) drawn twice on one page:
// by null3D, with each atom as a billboard label and each bond as a world label, and by three.js's
// CSS3DRenderer from the same data, camera and turn. One atom's object is hidden in both stages, so
// the page also shows that a hidden object hides its element. A picture test compares the two
// stages' elements. The engine draws no pixels of its own here, so the eye is the elements alone.
import * as THREE from 'three';
import { CSS3DObject, CSS3DSprite } from 'three/addons/renderers/CSS3DRenderer.js';
import { css3dTwin, runPort, twinCamera } from './lib/css3d-example';
import {
	ATOM_SCALE,
	ATOMS,
	atomElement,
	BOND_SHAPES,
	bondElement,
	CAMERA,
	HIDDEN_ATOM,
	rootTurn,
} from './lib/css3d-molecules';

runPort({
	name: 'css3d-molecules',
	sketch: new URL('./sketches/css3d-molecules-sketch.ts', import.meta.url),
	// The molecule stands still at two seconds of its turn, so both engines draw the same angle.
	hold: 2,
	maxLabels3d: ATOMS.length + BOND_SHAPES.length * 2,
	markup(layer, bind) {
		const elements: HTMLElement[] = [];
		ATOMS.forEach((atom, index) => {
			const element = atomElement(atom);
			layer.append(element);
			bind(`atom-${index}`, element);
			elements.push(element);
		});
		BOND_SHAPES.forEach((bond, index) => {
			for (const side of ['a', 'b'] as const) {
				const element = bondElement(bond);
				layer.append(element);
				bind(`bond-${index}-${side}`, element);
				elements.push(element);
			}
		});
		return elements;
	},
	twin(layer, time) {
		const camera = twinCamera([0, 0, CAMERA.distance], [0, 0, 0], CAMERA);
		const { renderer, scene } = css3dTwin(layer, camera);
		const root = new THREE.Object3D();
		const [x, y] = rootTurn(time);
		root.rotation.set(x, y, 0);
		scene.add(root);
		const elements: HTMLElement[] = [];
		ATOMS.forEach((atom, index) => {
			const element = atomElement(atom);
			const sprite = new CSS3DSprite(element);
			sprite.position.set(
				atom.position[0] * ATOM_SCALE,
				atom.position[1] * ATOM_SCALE,
				atom.position[2] * ATOM_SCALE,
			);
			// The engine hides the element of a hidden object, and CSS3DRenderer does the same.
			sprite.visible = index !== HIDDEN_ATOM;
			root.add(sprite);
			elements.push(element);
		});
		BOND_SHAPES.forEach((bond) => {
			const joint = new THREE.Object3D();
			joint.position.set(...bond.position);
			joint.quaternion.fromArray([...bond.rotation]);
			root.add(joint);
			const bar = new CSS3DObject(bondElement(bond));
			joint.add(bar);
			elements.push(bar.element);
			const cross = new CSS3DObject(bondElement(bond));
			cross.rotation.y = Math.PI / 2;
			joint.add(cross);
			elements.push(cross.element);
		});
		renderer.render(scene, camera);
		return { elements };
	},
});
