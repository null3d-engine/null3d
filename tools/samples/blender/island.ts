// Builds the island's plants for the sample-assets repository: island.py's stone pine, olive and
// holm oak, and its oleander, optimized and packed one file each, as `build.ts` says.
//
//   bun tools/samples/blender/island.ts <output folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'island.py',
	models: ['trees', 'shrubs'],
	swaying: ['trees', 'shrubs'],
});
