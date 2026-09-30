// A sketch that reports its quality preset and settings during setup, with the texture settings
// that the core holds. When the page sends 'budget', it sets its own upload budget. When the page
// sends 'set', it changes its settings, and it reports each change it hears of, with the core's
// texture settings, or the error that refused one.
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ quality, page, textures }) => {
	const report = () => ({
		settings: { ...quality.settings },
		core: { uploadBudget: textures.uploadBudget, maxAnisotropy: textures.maxAnisotropy },
	});
	page.post('quality', { preset: quality.preset, ...report() });
	quality.onChange(() => page.post('changed', report()));
	page.onMessage((name, data) => {
		if (name === 'budget') textures.setUploadBudget(data as number);
		if (name !== 'set') return;
		try {
			quality.set(data as Parameters<typeof quality.set>[0]);
		} catch (error) {
			page.post('refused', (error as Error).message);
		}
	});
});
