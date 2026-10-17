// A small static scene: lit and unlit meshes, a hierarchy, and an instance batch, lit by a sun
// and ambient light. The scene test captures it and compares it with a reference image. ?scale=
// draws it at that render scale, with a range that reaches down to 0.5, so the final pass scales the
// image up on every GPU path, even the 8-bit one. Without it, the scene keeps the whole canvas, so
// a slow GPU's frames during play do not lower the render scale of the image that a test compares.
import { defineSketch } from '@null3d/engine';

/** The render scale, from the sketch module's ?scale= switch, or none for the whole canvas. */
const SCALE = new URL(import.meta.url).searchParams.get('scale');
/**
 * True adds a lit floor that runs past the frame's edges, for the FXAA test. At a render scale
 * below 1, the edge blend must stay inside the drawn corner: a tap past it reads the clear color,
 * which leaves a fringe along the image's last rows and columns. The floor puts lit color there.
 */
const EDGE_FLOOR = new URL(import.meta.url).searchParams.has('edge');

export default defineSketch(({ scene, materials, geometry, page, quality, time }) => {
	const scale = SCALE === null ? 1 : Number(SCALE);
	quality.set({
		minRenderScale: SCALE === null ? 1 : Math.min(scale, 0.5),
		maxRenderScale: scale,
	});
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 100,
		position: [0, 4, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	const box = geometry.box();
	const ball = geometry.sphere({ radius: 0.6 });
	const red = materials.standard({ color: '#e8554e' });
	const blue = materials.unlit({ color: '#4a8cff' });
	const green = materials.standard({ color: '#5bc27a' });

	const group = scene.createGroup({ position: [-3, 0, 0], name: 'left' });
	scene.createMesh({ mesh: box, material: red, parent: group, name: 'box' });
	scene.createMesh({ mesh: ball, material: red, parent: group, position: [0, 1.5, 0] });
	scene.createMesh({ mesh: box, material: blue, position: [3, 0, 0], name: 'unlit' });

	// The edge test lays a wide grid of tiles over a dark slab, so the frame's last rows and
	// columns cross many lit edges. The other tests keep the small floor.
	const tiles = EDGE_FLOOR ? 81 : 5;
	const count = tiles * tiles;
	const step = EDGE_FLOOR ? 1.5 : 1.2;
	const floor = scene.createInstances(box, count, { material: green });
	for (let i = 0; i < count; i++) {
		floor.positions.set(
			[
				((i % tiles) - (tiles - 1) / 2) * step,
				-1.5,
				(Math.floor(i / tiles) - (tiles - 1) / 2) * step,
			],
			i * 3,
		);
		floor.scales.set([1, 0.2, 1], i * 3);
	}
	floor.markDirty();

	if (EDGE_FLOOR) {
		const slab = geometry.box({ width: 260, height: 0.2, depth: 260 });
		const dark = materials.standard({ color: '#20262e' });
		scene.createMesh({ mesh: slab, material: dark, position: [0, -1.7, 0], name: 'edge-floor' });
	}

	page.onMessage((name) => {
		if (name === 'frame') page.post('frame', time.frame);
	});
	return {};
});
