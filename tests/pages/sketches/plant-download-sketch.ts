// Loads and prepares the species that ?species= names, one after the other, then posts every file
// that this thread fetched with its start time, beside the time at which it began to load and to
// prepare each species. The plant download test holds the page to the add-on's download rule.
import { defineSketch } from '@null3d/engine';
import { isSpeciesId, loadSpecies, prepareSpecies } from '@null3d/vegetation';
import type { DownloadReport } from '../lib/plant-download';

const params = new URL(import.meta.url).searchParams;
const IDS = (params.get('species') ?? '').split(',').filter((id) => id.length > 0);

export default defineSketch((ctx) => {
	const started = performance.now();
	performance.setResourceTimingBufferSize(100_000);
	let begun = false;
	return {
		onUpdate() {
			if (begun) return;
			begun = true;
			void (async () => {
				const species: DownloadReport['species'][number][] = [];
				for (const id of IDS) {
					if (!isSpeciesId(id)) throw new Error(`${id} is not a species of the registry`);
					const loading = performance.now();
					const module = await loadSpecies(id);
					const preparing = performance.now();
					await prepareSpecies(ctx, module);
					species.push({ id, loading, preparing });
				}
				const downloads = performance
					.getEntriesByType('resource')
					.map((entry) => ({ url: entry.name, start: entry.startTime }));
				const report: DownloadReport = {
					preset: ctx.quality.preset,
					started,
					species,
					downloads,
				};
				ctx.page.post('downloads', report);
			})().catch((error: unknown) => ctx.page.post('failed', { message: String(error) }));
		},
	};
});
