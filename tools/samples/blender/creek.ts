// Builds the Creek's models for the sample-assets repository: creek.py's trees, bank plants and cave
// mouth, optimized and packed one file each, as `build.ts` says.
//
//   bun tools/samples/blender/creek.ts <output folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'creek.py',
	models: ['trees', 'plants', 'cave'],
	// The rock of the cave hides what lies behind it.
	blockers: ['cave'],
	swaying: ['trees', 'plants'],
});
