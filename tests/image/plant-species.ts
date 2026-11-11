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
 * a frame, which a software rasteriser needs far longer for than the default sixty seconds allows.
 */
const PANELS_SECONDS = 120;

/**
 * Species whose own four panels need longer than the shared limit, with the seconds each was
 * measured at.
 *
 * The measurement is taken with the load the picture run applies: a project's three tiers drawing
 * together. The common alder's dense crown finished those in under four minutes and overran the
 * shared two, so its value is 240 and a run against its accepted references passed all three tiers
 * in three and a half minutes.
 *
 * Timing one tier alone is the trap: the same crown drew in 96 seconds that way, which says nothing
 * about the load the suite runs under. It is the second figure this species corrected after taking
 * it on the wrong load, the first being its young-bark color read against a picture that framed a
 * great limb rather than young wood.
 */
const PANELS_SECONDS_BY_SPECIES: Readonly<Record<string, number>> = {
	'common-alder': 240,
	// Provisional: the willow overran the shared two minutes on all three tiers, after loading at
	// 42 s and growing at 48 s. This is the vegetation demos' ceiling, not a measurement; a measured
	// value drawn under the suite's load replaces it.
	'weeping-willow': 600,
};

/** The picture test of each species folder. */
export function plantSpeciesTests(root = ROOT): ImageTest[] {
	return speciesFolders(root).map(({ id }) => ({
		name: `plant-${id}`,
		sketch: `tests/pages/sketches/plant-review-sketch.ts?species=${id}&view=panels`,
		hold: 1,
		size: [1024, 1024],
		// Four panels of a whole plant, built and drawn from scratch: the merged foliage of a ground
		// A dense crown takes longer than the default limit on the software GPU's slower path, so the
		// panels draw the low preset's lighter meshes there; a species measured slower still takes its
		// own limit.
		timeoutSeconds: PANELS_SECONDS_BY_SPECIES[id] ?? PANELS_SECONDS,
		swiftShaderSwitches: ['preset=low'],
	}));
}
