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
 * How long a species' four panels may take, in seconds, where the shared limit is not enough. A
 * species earns a figure of its own by its measured page time, so a slow plant names itself instead
 * of raising the limit under every other plant. The giant sequoia, the tallest plant of the batch,
 * draws its four panels in 78 seconds on the software rasteriser, so it needs none.
 */
const PANEL_TIMEOUT_SECONDS: Readonly<Record<string, number>> = {};

/** Four panels of a whole plant, built and drawn from scratch, on the software GPU's slower path. */
const SHARED_PANEL_TIMEOUT_SECONDS = 120;

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		timeoutSeconds: PANEL_TIMEOUT_SECONDS[id] ?? SHARED_PANEL_TIMEOUT_SECONDS,
	}));
}
