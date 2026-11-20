// Builds the Creek garden's models that start as Tripo3D meshes: creek_tripo.py's statue, optimized
// and packed one file each, as `build.ts` says. `--raw` names the folder of raw downloads, as the
// sample-assets repository keeps them in `sources/showcase/creek-raw/`.
//
//   bun tools/samples/blender/creek_tripo.ts <output folder> --raw <folder> [--preview <folder>]
import { buildScene } from './build';

await buildScene({
	script: 'creek_tripo.py',
	models: ['statue'],
	// The bronze hides what lies behind it.
	blockers: ['statue'],
	swaying: [],
});
