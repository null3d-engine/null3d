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
 * Seconds a species' four-panel picture may take. The panels stand three metres from the crown, so
 * every shoot row inside that band is real geometry; a dense crown draws about six million triangles
 * a frame, which a software rasteriser needs far longer for than the default sixty seconds.
 */
const PANELS_SECONDS = 240;

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		// Four panels of a whole plant, built and drawn from scratch: the merged foliage of a ground
		// plant takes longer than the default limit on the software GPU's slower path, and a dense
		// crown's four panels longer still.
		timeoutSeconds: PANELS_SECONDS,
	}));
}
