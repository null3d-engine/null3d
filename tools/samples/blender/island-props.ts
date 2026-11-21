// Builds the island's harbour and beach props for the sample-assets repository: island-props.py's
// sailing yacht, open fishing boat, three boulders, beach parasol, sun lounger and harbour bench,
// optimized and packed into one file, `props.glb`, as `build.ts` says.
//
//   bun tools/samples/blender/island-props.ts <output folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'island-props.py',
	models: ['props'],
	// The props do not sway, so no mesh carries a bend weight.
	swaying: [],
});
