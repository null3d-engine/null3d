// A sketch that reports its quality preset and settings during setup. When the page sends 'set', it
// changes its settings, and it reports each change it hears of, or the error that refused one.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ quality, page }) => {
	page.post('quality', { preset: quality.preset, settings: { ...quality.settings } });
	quality.onChange(() => page.post('changed', { ...quality.settings }));
	page.onMessage((name, data) => {
		if (name !== 'set') return;
		try {
			quality.set(data as Parameters<typeof quality.set>[0]);
		} catch (error) {
			page.post('refused', (error as Error).message);
		}
	});
});
