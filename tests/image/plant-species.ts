// One picture test per species of the vegetation add-on's plant core, made from the species folders,
// so a species adds its folder and its references and no line of the manifest. Each test, plant-<id>,
// draws one 1024 by 1024 frame of four panels from the plant review sketch: the whole plant at a
// turn of 30 degrees, a close view of the crown, a leaf-cluster cutting and the bark at mid height.
// `bun run check` refuses a test without its references, so a species lands with its pictures.
import { join } from 'node:path';
import { speciesFolders } from '../../tools/lib/vegetation-folders.ts';
import type { ImageTest } from '../lib/images.ts';

/** The repository's root. */
const ROOT = join(import.meta.dirname, '../..');

/**
 * The seconds a species' picture takes, over the default: a crown of many fine parts builds its
 * four panels one after another, and the software GPU needs longer than the default limit for it.
 */
const TIMEOUT: Readonly<Record<string, number>> = {
	// About two thousand pinnae, each a leaf of its own: the software GPU drew three of the four
	// panels within the default limit and stopped before the last.
	'tree-fern': 180,
};

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		...(TIMEOUT[id] !== undefined && { timeoutSeconds: TIMEOUT[id] }),
	}));
}
