// Builds the island's hero landmarks for the sample-assets repository: island-town.py's church,
// hilltop keep, harbour lighthouse and three waterfront houses, optimized and packed into one file,
// `town.glb`, as `build.ts` says.
//
//   bun tools/samples/blender/island-town.ts <output folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'island-town.py',
	models: ['town'],
	// The landmarks do not sway, so no mesh carries a bend weight.
	swaying: [],
});
