// A scene that spans grid cells: a turned tree of meshes, a static instance batch, a moving batch
// with one row in another cell, a large box more than a cell away, and a camera on a turned rig.
// ?x= moves every root object and instance row that many meters along x; the image tests draw the
// scene at the origin and far out, and the frames must match. Every root position and instance row
// here is exact in 32-bit floats 1,000 km out, so each copy of the scene starts from the same
// numbers. The engine then computes the world matrices of the tree's children and of the camera.
// Relative to the origin, those sums would move in steps of about 8 mm at 100 km and 6 cm at
// 1,000 km; relative to a cell, they keep a hundredth of a millimeter.
import { defineSketch } from '@null3d/engine';

/** How far along x the scene sits, from the sketch module's ?x= switch. */
const X = Number(new URL(import.meta.url).searchParams.get('x') ?? '0');
/** The number of spinning boxes of the moving batch; one more row sits far behind them. */
const SPINNERS = 6;
/** How fast the spinning boxes turn, in radians per second. */
const SPIN = 0.8;

/** A position in the scene, moved along x by the ?x= switch. */
const at = (x: number, y: number, z: number): [number, number, number] => [X + x, y, z];

export default defineSketch(({ scene, materials, geometry, time }) => {
	if (!Number.isFinite(X)) throw new Error('?x= must be a number of meters');
	scene.setBackground('#101418');
	// The camera hangs off a turned rig, a little way from its center, and looks down at the scene.
	const rig = scene.createGroup({ position: at(0, 4, 10) });
	rig.setRotationEuler(0, 0.1, 0);
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 2000,
		parent: rig,
		position: [0.3, 0.2, 0.1],
	});
	camera.setRotationEuler(-0.38, 0, 0);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const red = materials.standard({ color: '#e8554e' });
	const green = materials.standard({ color: '#5bc27a' });
	const yellow = materials.standard({ color: '#f2c14e' });

	// A turned tree: its children take its cell, and their places come from the turn.
	const group = scene.createGroup({ position: at(-3, 0, 0) });
	group.setRotationEuler(0, 0.6, 0);
	scene.createMesh({ mesh: box, material: red, parent: group, position: [0.1, 0, -0.2] });
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.625 }),
		material: red,
		parent: group,
		position: [0.3, 1.5, 0.2],
	});
	scene.createMesh({
		mesh: box,
		material: materials.unlit({ color: '#4a8cff' }),
		position: at(3, 0, 0),
	});
	// A large box 700 m away, in the next cell along z.
	scene.createMesh({
		mesh: box,
		material: yellow,
		position: at(-40, 10, -700),
		scale: [60, 60, 60],
	});

	const floor = scene.createInstances(box, 25, { material: green });
	for (let i = 0; i < 25; i++) {
		floor.positions.set(at(((i % 5) - 2) * 1.25, -1.5, (Math.floor(i / 5) - 2) * 1.25), i * 3);
		floor.scales.set([1, 0.25, 1], i * 3);
	}
	floor.markDirty();

	// Spinning boxes, and one large row 600 m behind them, in the next cell along z.
	const spinners = scene.createInstances(box, SPINNERS + 1, { material: yellow, dynamic: true });
	for (let k = 0; k < SPINNERS; k++) {
		spinners.positions.set(at(-2.5 + k, 2.5, -1), k * 3);
		spinners.scales.set([0.5, 0.5, 0.5], k * 3);
	}
	spinners.positions.set(at(0, 30, -600), SPINNERS * 3);
	spinners.scales.set([20, 20, 20], SPINNERS * 3);

	return {
		onUpdate() {
			const half = 0.5 * SPIN * time.now;
			const rotations = spinners.rotations;
			for (let k = 0; k <= SPINNERS; k++) {
				rotations[k * 4 + 1] = Math.sin(half);
				rotations[k * 4 + 3] = Math.cos(half);
			}
		},
	};
});
