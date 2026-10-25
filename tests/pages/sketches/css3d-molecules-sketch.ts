// The null3D side of three.js's CSS3D molecules example (examples/css3d_molecules.html, r186): the
// molecule's atoms are billboards that face the camera, as CSS3DSprite objects are, and its bonds
// are bars that turn with a joint, as CSS3DObjects are. The root turns with the sketch's clock, so
// a held frame stands at a time that both engines can draw.
import { defineSketch, quat } from '@null3d/engine';
import { ATOM_SCALE, ATOMS, BOND_SHAPES, CAMERA, rootTurn } from '../lib/css3d-molecules';

export default defineSketch(({ scene, ui, time }) => {
	const camera = scene.createPerspectiveCamera({
		fov: CAMERA.fov,
		near: CAMERA.near,
		far: CAMERA.far,
		position: [0, 0, CAMERA.distance],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const root = scene.createGroup({ dynamic: true });
	ATOMS.forEach((atom, index) => {
		const object = scene.createGroup({
			parent: root,
			position: [
				atom.position[0] * ATOM_SCALE,
				atom.position[1] * ATOM_SCALE,
				atom.position[2] * ATOM_SCALE,
			],
		});
		ui.trackLabel(object, `atom-${index}`, { transform: 'billboard' });
	});
	BOND_SHAPES.forEach((bond, index) => {
		const joint = scene.createGroup({
			parent: root,
			position: bond.position,
			rotation: bond.rotation,
		});
		// The example lays a second bar across the first, as a child turned a quarter turn about y.
		ui.trackLabel(joint, `bond-${index}-a`, { transform: 'world' });
		const cross = scene.createGroup({
			parent: joint,
			rotation: quat.fromEuler(quat.create(), 0, Math.PI / 2, 0),
		});
		ui.trackLabel(cross, `bond-${index}-b`, { transform: 'world' });
	});
	return {
		onUpdate() {
			const [x, y] = rootTurn(time.now);
			root.setRotationEuler(x, y, 0);
		},
	};
});
