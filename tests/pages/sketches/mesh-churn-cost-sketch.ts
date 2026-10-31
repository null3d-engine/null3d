// The models of the page that measures what a frame of steady mesh churn costs
// (tests/pages/mesh-churn-cost.ts). Each model owns a sphere of its own mesh, and all the meshes
// share the engine's pages as a streamed scene's models do. The page tells the sketch to replace
// the oldest model each frame, or the newest one, so the render worker's cost of closing a page's
// hole shows against the cost of cutting the page's end.
import { defineSketch, type Mesh, type MeshGeometry } from '@null3d/engine';

/** The models that stay live, one for each place in the grid. */
const MODELS = 240;
/** Segments around and from pole to pole of each model's sphere. */
const SEGMENTS: [number, number] = [120, 60];

interface Slot {
	object: Mesh;
	mesh: MeshGeometry;
}

export default defineSketch(({ scene, geometry, materials, page }) => {
	scene.setBackground('#203040');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 0, 9], target: [0, 0, 0], far: 100 }),
	);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	const material = materials.standard({ color: '#c8b08a' });
	const slots: Slot[] = new Array(MODELS);
	/** The oldest live model: the one whose range sits first in its page. */
	let oldest = 0;
	let mode: 'idle' | 'repack' | 'tail' = 'idle';

	/** Makes one model at the place of slot `k` in the grid. */
	const make = (k: number): Slot => {
		const mesh = geometry.sphere({
			radius: 0.08,
			widthSegments: SEGMENTS[0],
			heightSegments: SEGMENTS[1],
		});
		const object = scene.createMesh({
			mesh,
			material,
			position: [(k % 24) * 0.25 - 2.875, Math.floor(k / 24) * 0.25 - 1.25, 0],
		});
		return { object, mesh };
	};

	for (let k = 0; k < MODELS; k++) slots[k] = make(k);

	/** Frees the model in slot `k` and makes another in its place, so the live set stays whole. */
	const replace = (k: number) => {
		const slot = slots[k];
		if (!slot) return;
		slot.object.destroy();
		slot.mesh.destroy();
		slots[k] = make(k);
	};

	page.onMessage((name) => {
		if (name === 'idle') mode = 'idle';
		if (name === 'repack') mode = 'repack';
		if (name === 'tail') mode = 'tail';
	});

	return {
		onUpdate() {
			// A removal that closes a page's hole moves every mesh after it, so the oldest range
			// pays the copy. A removal that cuts the page's end moves nothing, so the newest range
			// costs no copy, as an allocator's free does.
			if (mode === 'repack') {
				replace(oldest);
				oldest = (oldest + 1) % MODELS;
			}
			if (mode === 'tail') replace((oldest + MODELS - 1) % MODELS);
		},
	};
});
