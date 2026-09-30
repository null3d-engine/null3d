// Objects and instance batches on three layers, and a camera that draws two of them. The top row
// of objects and the front batches show what the camera must draw and leave out: an object on
// each drawn layer, one on the left-out layer, one on two layers, a parent on the left-out layer
// whose child is on a drawn one (layers never pass to children), and objects and a batch that move
// to other layers two frames after they were created, and to no layer at all. With ?flip, the
// moving objects, the moving batch and the camera change layers every frame instead, for the tests
// that check a live engine rebuilds nothing when layers change.
import { defineSketch } from '@null3d/engine';

/** True when the sketch changes layers every frame, from the sketch module's ?flip switch. */
const FLIP = new URL(import.meta.url).searchParams.has('flip');

/** The camera draws layers 0 and 1, and leaves out layer 2. */
const DRAWN_A = 1 << 0;
const DRAWN_B = 1 << 1;
const LEFT_OUT = 1 << 2;
const CAMERA_LAYERS = DRAWN_A | DRAWN_B;
/** The frame in which the moving objects and the moving batch take their layers. */
const MOVE_FRAME = 3;

export default defineSketch(({ scene, materials, geometry, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 4, 11],
		target: [0, 0.3, 0],
		layers: CAMERA_LAYERS,
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const ball = geometry.sphere({ radius: 0.6 });
	const red = materials.standard({ color: '#e8554e' });
	const green = materials.standard({ color: '#5bc27a' });
	const blue = materials.standard({ color: '#4a8cff' });
	const yellow = materials.standard({ color: '#f2c14e' });
	const at = (x: number): [number, number, number] => [x, 0, 0];

	// Drawn: layer 0 by default, and layer 1.
	scene.createMesh({ mesh: box, material: red, position: at(-4.5) });
	scene.createMesh({ mesh: ball, material: green, position: at(-3), layers: DRAWN_B });
	// Left out: layer 2.
	scene.createMesh({ mesh: box, material: blue, position: at(-1.5), layers: LEFT_OUT });
	// A parent on layer 2 is left out, and its child on layer 0 is drawn.
	const parent = scene.createMesh({ mesh: box, material: blue, position: at(0), layers: LEFT_OUT });
	scene.createMesh({ mesh: ball, material: yellow, parent, position: [0, 1.4, 0] });
	// Moves from layer 2 to layer 1, and from layer 0 to no layer.
	const arrives = scene.createMesh({
		mesh: box,
		material: green,
		position: at(1.5),
		layers: LEFT_OUT,
	});
	const leaves = scene.createMesh({ mesh: box, material: red, position: at(3) });
	// On layers 0 and 2: it shares layer 0 with the camera.
	scene.createMesh({ mesh: ball, material: yellow, position: at(4.5), layers: DRAWN_A | LEFT_OUT });

	/** A static row of small boxes along x at `z`, on `layers`. */
	const row = (z: number, x0: number, material: typeof red, layers?: number) => {
		const batch = scene.createInstances(box, 5, { material, layers });
		for (let i = 0; i < 5; i++) {
			batch.positions.set([x0 + i, -1.2, z], i * 3);
			batch.scales.set([0.6, 0.6, 0.6], i * 3);
		}
		batch.markDirty();
		return batch;
	};
	// Behind: drawn on layer 0. In front: left out on layer 2, and a batch that moves there to
	// layer 0.
	row(-3, -2, yellow);
	row(2.5, -5, blue, LEFT_OUT);
	const moving = row(2.5, 1, green, LEFT_OUT);

	return {
		onUpdate() {
			const frame = time.frame;
			if (FLIP) {
				const odd = frame % 2 === 1;
				arrives.setLayers(odd ? DRAWN_B : LEFT_OUT);
				leaves.setLayers(odd ? 0 : DRAWN_A);
				moving.setLayers(odd ? DRAWN_A : LEFT_OUT);
				camera.setLayers(odd ? CAMERA_LAYERS : CAMERA_LAYERS | LEFT_OUT);
				return;
			}
			if (frame !== MOVE_FRAME) return;
			arrives.setLayers(DRAWN_B);
			leaves.setLayers(0);
			moving.setLayers(DRAWN_A);
		},
	};
});
