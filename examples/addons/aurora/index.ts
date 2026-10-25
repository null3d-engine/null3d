// The aurora: an example add-on that draws a curtain of light over the sky, through the sky-layer
// hook. Its WGSL declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`, which `scene.setSkyLayer`
// draws over the background, under every object, on every GPU path. The core sky still draws the
// sun, the moon, the stars and its flat clouds: the layer adds the aurora over them, and the sky's
// cloud coverage hides it where it hides the stars. The layer's WGSL reaches the sky's environment
// map as well, so a scene's reflections show the aurora and its light falls on what it stands over.
//
// The layer reads the core sky's cloud settings, the sketch time and the share of the sun that it
// hides, so it needs no values of its own: its colors and its rate of drift are constants in
// `aurora.wgsl`, which is what an example add-on keeps small enough to copy.
import { defineFeature, type SketchContext } from '@null3d/engine';
import auroraShader from './aurora.wgsl';

/**
 * The aurora's feature description: the background point, drawn as a box, the sky slot that it
 * provides, and the three views that a sky layer draws in.
 */
const AURORA = defineFeature({
	name: 'aurora',
	frame: 'background',
	kind: 'draw',
	provides: ['sky'],
	views: ['main', 'scenePass', 'reflection'],
});

/** How the aurora starts: how much of it draws, and how much of the sun it hides. */
export interface AuroraOptions {
	/**
	 * How much of the aurora draws, from 0 for none to 1 for all of it. The default is 1. A sketch
	 * fades the aurora in or out with `set`.
	 */
	readonly opacity?: number;
	/**
	 * How much of the sun the aurora hides, from 0 for none to 1 for all of it. The core sky dims
	 * its disc and glow by the rest, so a bright moon dims behind a thick curtain. The default is
	 * 0.15.
	 */
	readonly sun?: number;
	/**
	 * How often, in seconds, the sky's environment map captures the aurora: half a second by
	 * default. The map lights the reflections of the sky and the diffuse light that it gives the
	 * scene, so the curtains' drift reaches the ice below at that rate. Give 0 for an aurora that
	 * stands still, and its map then fills only when the sky or its values change.
	 */
	readonly refresh?: number;
}

/** The aurora that a sketch draws over its sky. */
export interface Aurora {
	/** Changes how much of the aurora draws, how much of the sun it hides, or both. */
	set(values: { readonly opacity?: number; readonly sun?: number }): void;
	/** Removes the aurora, and gives the core sky its full sun back. */
	remove(): void;
}

/**
 * Draws an aurora over the scene's sky. Give the scene a sky background first with
 * `scene.setBackground({ sky })` or `{ atmosphere }`: the layer draws over a sky, and draws nothing
 * where the background draws nothing.
 */
export function createAurora(ctx: SketchContext, options: AuroraOptions = {}): Aurora {
	const layer = ctx.scene.setSkyLayer(AURORA, {
		wgsl: auroraShader,
		opacity: options.opacity ?? 1,
		sun: options.sun ?? 0.15,
		refresh: options.refresh ?? 0.5,
	});
	return {
		set: (values) => layer.set(values),
		remove: () => ctx.scene.clearSkyLayer(),
	};
}
