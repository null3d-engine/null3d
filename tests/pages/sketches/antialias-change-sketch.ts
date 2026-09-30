// The anti-aliasing tests' edges scene, which changes its anti-aliasing mode while it runs. When the
// page sends 'set-antialias' with a mode, the sketch sets it and answers with its settings and
// whether the engine now draws HDR color, once the first frame in the new mode is on screen.
import { defineSketch, type QualitySettings } from '@null3d/engine';
import edges from './edges-sketch';

export default defineSketch(async (ctx) => {
	const callbacks = await edges.setup(ctx);
	const { quality, page, engine } = ctx;
	page.onMessage(async (name, data) => {
		if (name !== 'set-antialias') return;
		await quality.set({ antialias: data as QualitySettings['antialias'] });
		page.post('antialias-set', { settings: { ...quality.settings }, hdr: engine.capabilities.hdr });
	});
	return callbacks;
});
