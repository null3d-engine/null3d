// The facades add-on for its image tests: a wall of windows at night, with a room behind each lit
// one. The default view stands close and to one side of the wall, so the rooms show in parallax,
// with their lamps, floors, furniture and blinds. ?far draws a long wall from a distance, where the
// cells shrink below a few pixels and the far fallback takes over. ?kind picks the wall finish,
// ?furniture=off and ?blinds=off leave those parts out, and ?wave slows the power-on wave so a held
// frame catches it partway. ?window draws a batch of panes with the window form instead of a wall.
import { defineSketch } from '@null3d/engine';
import {
	createFacade,
	createWindow,
	type FacadeKind,
	type FacadeLook,
} from '../../../examples/addons/facades/index';

const params = new URL(import.meta.url).searchParams;

export default defineSketch((ctx) => {
	const { scene, geometry } = ctx;
	scene.setBackground('#06080e');
	// Moonlight alone lights the wall: the rooms give the rest of the picture its light.
	scene.createDirectionalLight({
		direction: [-0.45, -0.8, -0.5],
		color: '#9db4ff',
		intensity: 2.4,
	});
	scene.createAmbientLight({ color: '#46527a', intensity: 0.8 });
	const far = params.has('far');
	const close = params.has('close');
	const wave = params.has('wave');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: far ? 34 : 44,
			near: 0.1,
			far: far ? 6000 : 80,
			position: far ? [220, 140, 1500] : close ? [-1.43, 2.6, 2.2] : [2.1, 2.9, 4.6],
			target: far ? [0, 140, 0] : close ? [-1.43, 2.6, 0] : [-0.6, 2.5, 0],
		}),
	);
	const look: FacadeLook = {
		kind: (params.get('kind') ?? 'brick') as FacadeKind,
		window: { width: 1.7, height: 1.5, spacing: 0.9, floorHeight: 3.4, frame: 0.13, sill: 0.8 },
		room: {
			depth: 2.4,
			light: 1.5,
			flicker: 0.3,
			litShare: 0.6,
			furniture: params.get('furniture') !== 'off',
			blinds: params.get('blinds') !== 'off',
		},
		power: { origin: [0, 0], speed: wave ? 2 : 2200, rise: 10, damping: 5 },
	};
	// A wave that a held frame catches crosses the wall slowly; a still wall is already lit.
	const material = createFacade(ctx, look);
	material.start(0);
	if (params.has('window')) {
		// The window form: panes that a scene places itself, each with its own light.
		const panes = createWindow(ctx, look);
		const rows = scene.createInstances(geometry.plane({ width: 1, height: 1 }), 12, {
			material: panes.material,
			values: true,
		});
		for (let k = 0; k < 12; k++) {
			const x = -4.6 + (k % 4) * 1.9;
			const y = 1.4 + Math.floor(k / 4) * 1.9;
			rows.positions.set([x, y, 0], k * 3);
			rows.scales.set([0.84, 1.12, 1], k * 3);
			(rows.values as Float32Array).set([1, 0.4 + (k % 3) * 0.3, (k * 0.17) % 1, 0], k * 4);
		}
		rows.markDirty();
		return;
	}
	scene.createMesh({
		mesh: geometry.box({ width: far ? 1600 : 9.2, height: far ? 400 : 8.4, depth: 0.6 }),
		material: material.material,
		position: [0, far ? 200 : 3.6, 0],
	});
});
