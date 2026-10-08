// KTX2 files for the cache of transcoded textures. The page sends the files' addresses, and the
// sketch loads them all at once, as a scene loads its materials' textures. Once every texture is
// on the GPU, it sends the page how long the loads and the uploads took from the page's message,
// whether this thread downloaded the transcoder, and each texture's format and GPU bytes.
import { defineSketch, type Texture } from '@null3d/engine';

/** The transcoder's WebAssembly module, by its address in development and in a production build. */
const TRANSCODER = /\/basis_transcoder(-[\w-]{8})?\.wasm(\?|$)/;

export default defineSketch(({ assets, textures, page }) => {
	let loaded: { startMs: number; loadMs: number; made: Texture[] } | undefined;
	let sent = false;
	page.onMessage((type, data) => {
		if (type !== 'load') return;
		const { urls } = data as { urls: string[] };
		const startMs = performance.now();
		Promise.all(urls.map((url) => assets.loadTexture(url))).then(
			(made) => {
				loaded = { startMs, loadMs: performance.now() - startMs, made };
			},
			(error: unknown) => page.post('error', error instanceof Error ? error.message : error),
		);
	});
	return {
		onUpdate() {
			if (!loaded || sent || textures.uploads().waiting > 0) return;
			sent = true;
			const { startMs, loadMs, made } = loaded;
			page.post('result', {
				loadMs,
				uploadedMs: performance.now() - startMs,
				transcoder: performance
					.getEntriesByType('resource')
					.some(({ name }) => TRANSCODER.test(name)),
				textures: made.map(({ format, bytes }) => ({ format, bytes })),
			});
		},
	};
});
