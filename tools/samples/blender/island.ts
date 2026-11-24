// Builds the island's plants for the sample-assets repository: island.py's stone pine, olive and
// holm oak, and its oleander, optimized and packed one file each, as `build.ts` says. The far cards
// are the engine's octahedral bakes of the same plants, written beside each model.
//
//   bun tools/samples/blender/island.ts <output folder> [--preview <folder>]
import { buildScene } from './build';
import { bakeCards } from './impostor-cards';

await buildScene({
	script: 'island.py',
	models: ['trees', 'shrubs'],
	swaying: ['trees', 'shrubs'],
	cards: (raw, model, out) => bakeCards(raw, out, model),
});
