// Builds the Creek garden's models that start as Tripo3D meshes: creek_tripo.py's statue on its
// slab, the stone lantern, the roofed gate and three boulders, optimized and packed one file each,
// as `build.ts` says. The raw downloads come from the pinned sample content, as the sample-assets
// repository keeps them in `sources/showcase/creek-raw/`; `--raw <folder>` names another folder.
//
//   bun tools/samples/blender/creek_tripo.ts <output folder> [--raw <folder>] [--preview <folder>]
//     [--models <a,b>]
import { dirname } from 'node:path';
import { samplePath } from '../../lib/samples';
import { buildScene } from './build';

await buildScene({
	script: 'creek_tripo.py',
	models: ['statue', 'lantern', 'gate', 'boulder-1', 'boulder-2', 'boulder-3'],
	// Stone and bronze hide what lies behind them; the asset tool leaves out any model that
	// encloses too little to block.
	blockers: ['statue', 'lantern', 'gate', 'boulder-1', 'boulder-2', 'boulder-3'],
	swaying: [],
	options: { '--raw': dirname(dirname(samplePath('sources/showcase/creek-raw/statue/model.glb'))) },
});
