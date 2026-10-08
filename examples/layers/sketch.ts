// Render layers: a street of houses with furniture inside, roofs on a layer of their own, and map
// pins on a third layer. Every 2 seconds the camera changes the layers it draws: the street with
// its roofs, then with the pins too, then without the roofs, which shows the rooms. A new mask
// changes no table of what the engine draws, so a sketch can change layers in any frame.
import { defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The ground, the walls and the furniture. */
const STREET = 1 << 0;
const ROOFS = 1 << 1;
const PINS = 1 << 2;
/** The masks that the camera cycles through. */
const VIEWS = [STREET | ROOFS, STREET | ROOFS | PINS, STREET | PINS];
/** How long the camera keeps each mask, in seconds. */
const STEP = 2;
const HOUSES = 5;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#9cc3e6');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 11, 11],
		target: [0, 0, 0],
		layers: VIEWS[0],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, 0] });
	scene.createDirectionalLight({ direction: [-1, -2, -0.6], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });

	const box = geometry.box();
	const floor = materials.standard({ color: '#c9b79c' });
	const wall = materials.standard({ color: '#eee6d8' });
	const roof = materials.standard({ color: '#b5533c' });
	const furniture = [
		materials.standard({ color: '#4a8cff' }),
		materials.standard({ color: '#5bc27a' }),
		materials.standard({ color: '#f2c14e' }),
	];
	scene.createMesh({
		mesh: box,
		material: materials.standard({ color: '#6f9e58' }),
		position: [0, -0.1, 0],
		scale: [16, 0.2, 8],
	});

	for (let h = 0; h < HOUSES; h++) {
		const house = scene.createGroup({ position: [(h - (HOUSES - 1) / 2) * 3, 0, 0] });
		scene.createMesh({
			mesh: box,
			material: floor,
			parent: house,
			position: [0, 0.05, 0],
			scale: [2.4, 0.1, 2.4],
		});
		// Three walls on the floor, open at the front, low enough to look over. The back wall fits
		// between the side walls, so no two faces share a plane and flicker.
		scene.createMesh({
			mesh: box,
			material: wall,
			parent: house,
			position: [0, 0.625, -1.15],
			scale: [2.2, 1.05, 0.1],
		});
		scene.createMesh({
			mesh: box,
			material: wall,
			parent: house,
			position: [-1.15, 0.625, 0],
			scale: [0.1, 1.05, 2.4],
		});
		scene.createMesh({
			mesh: box,
			material: wall,
			parent: house,
			position: [1.15, 0.625, 0],
			scale: [0.1, 1.05, 2.4],
		});
		// A table and a bed in a color of their own.
		const color = furniture[h % furniture.length];
		scene.createMesh({
			mesh: box,
			material: color,
			parent: house,
			position: [-0.5, 0.35, -0.4],
			scale: [0.8, 0.5, 0.5],
		});
		scene.createMesh({
			mesh: box,
			material: color,
			parent: house,
			position: [0.6, 0.25, 0.3],
			scale: [0.6, 0.3, 1.2],
		});
		// The roof is on its own layer, so the camera can leave it out.
		scene.createMesh({
			mesh: box,
			material: roof,
			parent: house,
			position: [0, 1.25, 0],
			scale: [2.8, 0.2, 2.8],
			layers: ROOFS,
		});
	}

	// One pin above each house. Every row of a batch shares the batch's layers.
	const pins = scene.createInstances(geometry.sphere({ radius: 0.25 }), HOUSES, {
		material: materials.unlit({ color: '#e8554e' }),
		layers: PINS,
	});
	for (let h = 0; h < HOUSES; h++) pins.positions.set([(h - (HOUSES - 1) / 2) * 3, 2.2, 0], h * 3);

	let shown = 0;
	return {
		onUpdate(dt) {
			view.update(dt);
			const next = Math.floor(time.now / STEP) % VIEWS.length;
			if (next === shown) return;
			shown = next;
			camera.setLayers(VIEWS[shown]);
		},
	};
});
