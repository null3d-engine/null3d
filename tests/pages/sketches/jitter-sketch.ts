// The scene of the large-world jitter check (tests/pages/lib/jitter.ts): white squares that face a
// camera, each at its own depth and in its own band of the frame, against black. ?distance= places
// the scene that many meters from the world's origin, along a direction off every axis. Each
// object's kind takes another path of the engine: a root mesh, a child of a turned parent, and two
// rows of an instance batch around its origin.
//
// The page moves the camera: its message 'step' with a step number puts the camera that many steps
// along +x from its first place. After the frames that settle it, the sketch answers 'placed' with
// the number, and the page reads the frame back. Nothing else moves.
//
// With ?cellsFull, the sketch first takes every grid cell but the origin's with empty groups near
// the origin. The scene's objects and the camera then go into the origin's cell, as without cells,
// and the engine warns that the cells ran out.
import { defineSketch } from '@null3d/engine';
import {
	FLIGHT_DIRECTION,
	JITTER_FOV,
	JITTER_OBJECTS,
	objectPlace,
	objectSize,
	SETTLE_FRAMES,
	STEP_METERS,
} from '../lib/jitter';

const params = new URL(import.meta.url).searchParams;
/** How far from the world's origin the scene stands, in meters. */
const DISTANCE = Number(params.get('distance') ?? '0');
/** True when every grid cell is taken before the scene is built. */
const CELLS_FULL = params.has('cellsFull');
/** The grid cells besides the origin's that the engine can hold in use at once. */
const OTHER_CELLS = 511;
/** The width of a grid cell, in meters. */
const CELL = 1024;
/** How far a child's parent turns about the view's axis, in radians. */
const PARENT_TURN = 0.6;

/** The camera's first place, in 64-bit numbers. */
const START = FLIGHT_DIRECTION.map((d) => d * DISTANCE) as [number, number, number];
/** A place relative to the camera's first place. */
const at = ([x, y, z]: readonly number[]): [number, number, number] => [
	START[0] + (x ?? 0),
	START[1] + (y ?? 0),
	START[2] + (z ?? 0),
];

export default defineSketch(({ scene, geometry, materials, post, quality, page }) => {
	if (!Number.isFinite(DISTANCE)) throw new Error('?distance= must be a number of meters');
	if (CELLS_FULL)
		for (let k = 1; k <= OTHER_CELLS; k++) scene.createGroup({ position: [0, 0, k * CELL] });
	scene.setBackground('#000000');
	post.set({ toneMapping: 'none' });
	quality.set({ governor: false, minRenderScale: 1, maxRenderScale: 1 });
	const camera = scene.createPerspectiveCamera({
		fov: JITTER_FOV,
		near: 0.1,
		far: 100,
		position: at([0, 0, 0]),
	});
	scene.setActiveCamera(camera);

	const square = geometry.plane();
	const white = materials.unlit({ color: '#ffffff' });
	JITTER_OBJECTS.forEach(({ kind }, band) => {
		const place = objectPlace(band);
		const size = objectSize(band);
		const scale: [number, number, number] = [size, size, 1];
		if (kind === 'mesh')
			scene.createMesh({ mesh: square, material: white, position: at(place), scale });
		else if (kind === 'child') {
			// The parent stands so that its child, turned with it, lands on the object's place.
			const reach = size / 2;
			const parent = scene.createGroup({
				position: at([
					place[0] - reach * Math.cos(PARENT_TURN),
					place[1] - reach * Math.sin(PARENT_TURN),
					place[2],
				]),
			});
			parent.setRotationEuler(0, 0, PARENT_TURN);
			scene.createMesh({ mesh: square, material: white, parent, position: [reach, 0, 0], scale });
		} else {
			const rows = scene.createInstances(square, 2, { material: white, origin: at(place) });
			for (let r = 0; r < 2; r++) {
				rows.positions.set([(r - 0.5) * 1.5 * size, 0, 0], r * 3);
				rows.scales.set(scale, r * 3);
			}
			rows.markDirty();
		}
	});

	/** The step that the page asked for, and whether the camera has yet to move there. */
	let step = 0;
	let pending = false;
	/** Frames drawn at the current place, or -1 once the page has heard of it. */
	let settled = -1;
	page.onMessage((name, data) => {
		if (name !== 'step') return;
		step = Number(data);
		pending = true;
	});
	return {
		onUpdate() {
			if (pending) {
				camera.setPosition(START[0] + step * STEP_METERS, START[1], START[2]);
				pending = false;
				settled = 0;
			} else if (settled >= 0 && ++settled === SETTLE_FRAMES) {
				settled = -1;
				page.post('placed', step);
			}
		},
	};
});
