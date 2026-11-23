// Builds the island's Mediterranean houses for the sample-assets repository: island-houses.py's
// thirteen house forms, optimized and packed into one file, `houses.glb`, as `build.ts` says.
//
//   bun tools/samples/blender/island-houses.ts <output folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'island-houses.py',
	models: ['houses'],
	// The houses do not sway, so no mesh carries a bend weight.
	swaying: [],
});
