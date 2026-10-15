// Draws boxes, and makes more when the page asks, so the engine's draw list moves after the memory
// has grown past 2 GiB (the signed address test). The page grows the memory itself, which leaves
// the engine's low heap unchanged. Small hidden batches then fill that low heap, so the draw list
// cannot grow there and must grow from the memory's new end, above 2 GiB. The meshes that follow
// are drawn, so the frames from the moved list have draw calls.
import { defineSketch } from '@null3d/engine';

/** The rows of each hidden batch that fills the low heap. */
const ROWS_PER_BATCH = 1_000;
/** The boxes that each frame makes while the scene grows, so one frame's command ring holds them. */
const PER_FRAME = 5_000;
/** The most boxes the sketch makes, a ceiling if the draw list never moves. */
const CAP = 30_000;
/** The layer the filling batches lie on, which the camera does not draw. */
const HIDDEN_LAYER = 1 << 1;

export default defineSketch(({ scene, geometry, materials, page }) => {
	scene.setBackground('#101418');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 0, 8], target: [0, 0, 0], far: 100 }),
	);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const box = geometry.box({ width: 0.05, height: 0.05, depth: 0.05 });
	const material = materials.unlit({ color: '#ffffff' });
	scene.createMesh({ mesh: box, material });
	let batchesLeft = 0;
	let growing = false;
	let made = 1;
	page.onMessage((name, data) => {
		if (name === 'grow') {
			batchesLeft = (data as { batches?: number }).batches ?? 0;
			growing = true;
			page.post('grow-received', { batches: batchesLeft });
		}
		if (name === 'stop') growing = false;
	});
	const grow = (index: number) =>
		scene.createMesh({
			// A mesh of its own makes the object its own draw command in the frame's draw list,
			// so the list grows with the scene (one mesh shared by all would share one bucket).
			mesh: geometry.box({ width: 0.05, height: 0.05, depth: 0.05 }),
			material,
			position: [((index % 200) - 100) * 0.02, 0, 0],
		});
	return {
		onUpdate() {
			if (batchesLeft > 0) {
				const count = Math.min(batchesLeft, 60);
				let filled = 0;
				for (let k = 0; k < count; k++) {
					try {
						scene.createInstances(box, ROWS_PER_BATCH, { material, layers: HIDDEN_LAYER });
						filled++;
					} catch {
						// The batch table is full: stop filling and grow the draw list instead.
						batchesLeft = 0;
						break;
					}
				}
				if (batchesLeft > 0) batchesLeft -= filled;
				page.post('batches', { left: batchesLeft });
				return;
			}
			if (!growing || made >= CAP) return;
			const chunk = Math.min(PER_FRAME, CAP - made);
			for (let k = 0; k < chunk; k++) grow(made + k);
			made += chunk;
			page.post('made', { made });
		},
	};
});
