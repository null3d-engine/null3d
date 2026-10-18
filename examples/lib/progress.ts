// The loading progress that a scene posts to the page's loading overlay. The overlay names the
// engine's own start stages; a scene that loads files adds how many have arrived, as a `loading`
// message that `examples/lib/run.ts` draws.
import type { SketchContext } from '@null3d/engine';

/** Tells the page's loading overlay how many of the scene's files have loaded. */
export function reportLoading(ctx: SketchContext): void {
	ctx.assets.onProgress((loaded, total) => {
		ctx.page.post('loading', { text: `${loaded} of ${total} files loaded`, value: loaded / total });
	});
}
