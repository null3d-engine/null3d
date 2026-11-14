// Grows every plant species, and the stand-in species, through the vegetation add-on's job-worker
// task: its kit, then variant 0 of one seed. It posts each grown variant's digest, which the test
// compares with the digest that the same growth gives in the test's own process. The sketch posts
// one message when every species has grown, or one that names the error.
import { defineSketch } from '@null3d/engine';
import { buildKit, growPlant, plantAssetDigest } from '@null3d/vegetation';
import { DETERMINISM_GROWTH, determinismEntries, type GrownDigest } from '../lib/plant-determinism';

export default defineSketch(({ page }) => {
	let started = false;
	return {
		onUpdate() {
			if (started) return;
			started = true;
			void (async () => {
				const species: GrownDigest[] = [];
				for (const entry of determinismEntries()) {
					const module = await entry.load();
					const kit = await buildKit(module, { placeholders: entry.placeholders });
					const asset = await growPlant(kit, DETERMINISM_GROWTH);
					species.push({ id: entry.id, digest: plantAssetDigest(asset) });
				}
				page.post('grown', { species });
			})().catch((error: unknown) => page.post('failed', { message: String(error) }));
		},
	};
});
