// The models of the page that measures what a frame costs when a mesh leaves the scene
// (tests/pages/mesh-churn-cost.ts). Each model owns a sphere of its own mesh, and all the meshes
// share the engine's pages as a streamed scene's models do. The page tells the sketch when to
// remove every model, one to a frame, and when to add them back, one to a frame, so the render
// worker's cost of each removal and each addition shows beside an idle window's.
import { defineSketch, type Mesh, type MeshGeometry } from '@null3d/engine';

/** Models in all: more than the frames of a measured window, so every frame removes one. */
const MODELS = 240;
/** Segments around and from pole to pole of each model's sphere. */
const SEGMENTS: [number, number] = [120, 60];

export default defineSketch(({ scene, geometry, materials, page }) => {
	scene.setBackground('#203040');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 0, 9], target: [0, 0, 0], far: 100 }),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	const material = materials.standard({ color: '#c8b08a' });
	const objects: Mesh[] = [];
	const meshes: MeshGeometry[] = [];
	/** The index of the oldest model that is still live. */
	let first = 0;
	let mode: 'idle' | 'destroy' | 'create' = 'idle';

	/** Makes one model at its place in the grid, with a mesh of its own. */
	const add = () => {
		const k = objects.length;
		const mesh = geometry.sphere({
			radius: 0.08,
			widthSegments: SEGMENTS[0],
			heightSegments: SEGMENTS[1],
		});
		const made = scene.createMesh({
			mesh,
			material,
			position: [(k % 24) * 0.25 - 2.875, Math.floor(k / 24) * 0.25 - 1.25, 0],
		});
		objects.push(made);
		meshes.push(mesh);
	};
	for (let k = 0; k < MODELS; k++) add();

	page.onMessage((name) => {
		if (name === 'idle') mode = 'idle';
		if (name === 'destroy') mode = 'destroy';
		if (name === 'create') mode = 'create';
	});

	return {
		onUpdate() {
			// The oldest model leaves first, so each removal sits before the models that its page
			// still holds, and closing the hole moves them. Removing the newest would only cut the
			// page's end, which moves nothing.
			if (mode === 'destroy' && first < objects.length) {
				objects[first]?.destroy();
				meshes[first]?.destroy();
				first++;
			}
			if (mode === 'destroy' && first === objects.length) {
				objects.length = 0;
				meshes.length = 0;
				first = 0;
			}
			if (mode === 'create' && objects.length < MODELS) add();
		},
	};
});
