// A scene of a million box instances in four batches, so the engine's memory grows tens of MiB
// past its start. The restart page uses it to check that an engine which starts in the memory that
// the page kept from the engine before reuses that memory's heap, instead of growing the memory
// again.
import { defineSketch } from '@null3d/engine';

const BATCHES = 4;
const PER_BATCH = 250_000;

export default defineSketch(({ scene, materials, geometry }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ position: [0, 40, 120], target: [0, 0, 0] }),
	);
	const box = geometry.box();
	const material = materials.standard({ color: '#c0c4c8' });
	for (let b = 0; b < BATCHES; b++) {
		const batch = scene.createInstances(box, PER_BATCH, { material });
		for (let i = 0; i < PER_BATCH; i++)
			batch.positions.set([(i % 500) - 250, b * 2, Math.floor(i / 500) - 250], i * 3);
		batch.markDirty();
	}
	return {};
});
