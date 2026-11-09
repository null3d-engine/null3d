// Prepares the species that ?species= names, on the preset that ?preset= names, and publishes every
// file that the sketch's thread fetched with its start time, beside the times at which the sketch
// loaded and prepared each species. The plant download test reads which files a page fetches, and
// when.
import { createEngine, type QualityPreset } from '@null3d/engine';
import type { DownloadReport } from './lib/plant-download';
import { progress, run } from './lib/result';

run('plant-download', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const params = new URLSearchParams(location.search);
	const preset = (params.get('preset') ?? 'high') as QualityPreset;
	const sketch = new URL('./sketches/plant-download-sketch.ts', import.meta.url);
	sketch.searchParams.set('species', params.get('species') ?? '');
	const engine = await createEngine({ canvas, sketch, maxPixelRatio: 1, preset });
	await engine.firstFrame;
	progress('engine started');
	const report = await new Promise<DownloadReport>((resolve, reject) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'downloads') resolve(data as DownloadReport);
			else if (name === 'failed') reject(new Error((data as { message: string }).message));
		});
		setTimeout(() => reject(new Error('the sketch prepared no species')), 120_000);
	});
	await engine.destroy();
	return { ...report };
});
