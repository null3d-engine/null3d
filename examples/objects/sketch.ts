// Objects and parents: six crates ride a turntable, and each one in turn steps off for 3 seconds.
// setParent with keepWorld moves a crate between the table and the ground without moving it in the
// world, as three.js's attach does. A crate on the table turns with it; a crate on the ground stays
// where it stepped off. The table turns with rotateY, and each crate spins on its own axis.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';

const CRATES = 6;
/** Seconds between two crates stepping off, and how long each stays off. */
const STAGGER = 1;
const OFF = 3;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#1a1f27');
	const camera = scene.createPerspectiveCamera({ fov: 50, position: [0, 7, 9], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, 0] });
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.45 });

	scene.createMesh({
		mesh: geometry.box({ width: 14, height: 0.2, depth: 14 }),
		material: materials.standard({ color: '#3a4556' }),
		position: [0, -0.35, 0],
	});
	const table = scene.createGroup({ name: 'table', dynamic: true });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 3, radiusBottom: 3, height: 0.3, radialSegments: 48 }),
		material: materials.standard({ color: '#8d99ae' }),
		parent: table,
		position: [0, -0.1, 0],
	});

	const crate = geometry.box({ width: 0.7, height: 0.7, depth: 0.7 });
	const wood = materials.standard({ color: '#c8a064' });
	const crates = Array.from({ length: CRATES }, (_, k) => {
		const angle = (k / CRATES) * Math.PI * 2;
		return scene.createMesh({
			name: `crate ${k}`,
			mesh: crate,
			material: wood,
			parent: table,
			position: [Math.sin(angle) * 2.2, 0.4, Math.cos(angle) * 2.2],
			dynamic: true,
		});
	});
	const onTable = crates.map(() => true);

	return {
		onUpdate(dt) {
			table.rotateY(0.6 * dt);
			for (let k = 0; k < CRATES; k++) {
				crates[k].rotateY(1.5 * dt);
				// Crate k steps off at k seconds, then every STAGGER * CRATES seconds after that.
				const since = time.now - k * STAGGER;
				const off = since >= 0 && since % (STAGGER * CRATES) < OFF;
				if (off === !onTable[k]) continue;
				onTable[k] = !off;
				crates[k].setParent(off ? null : table, { keepWorld: true });
			}
			view.update(dt);
		},
	};
});
