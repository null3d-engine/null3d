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
 * Switches for the software GPU, per species. A dense evergreen's picture takes longer to draw on
 * SwiftShader than a page's wait allows, so its software picture draws the low tier's cards at every
 * distance and waits longer. Its real-GPU picture draws the high tier with the levels the record's
 * switches name.
 */
const SOFTWARE: Readonly<
	Record<string, { readonly switches?: readonly string[]; readonly timeoutSeconds?: number }>
> = {
	'italian-cypress': { switches: ['preset=low', 'lod=2'], timeoutSeconds: 300 },
};

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		// A dense evergreen bakes its card atlas and draws its nearest band of real shoots on the
		// software GPU, which takes longer than a broadleaf's page. The ceiling covers it, and a page
		// that draws quickly still finishes quickly.
		timeoutSeconds: SOFTWARE[id]?.timeoutSeconds ?? 150,
		...(SOFTWARE[id]?.switches && { swiftShaderSwitches: SOFTWARE[id]?.switches }),
	}));
}
