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
 * Seconds a page may take to publish a species' picture where it needs more than the default. The
 * maple's four panels carry a crown of six variants, which the software rasteriser draws past a
 * minute.
 */
const TIMEOUT_SECONDS: Readonly<Record<string, number>> = { 'norway-maple': 180 };

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		// Four panels of a whole plant, built and drawn from scratch: the merged foliage of a ground
		// plant takes longer than the default limit on the software GPU's slower path. A species
		// whose crown is heavier still names its own.
		timeoutSeconds: TIMEOUT_SECONDS[id] ?? 120,
	}));
}
