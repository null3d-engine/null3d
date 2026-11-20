// Builds the Creek's models for the sample-assets repository: creek.py's trees, bank plants, cave
// mouth and sculpted pines, optimized and packed one file each, as `build.ts` says. The pines'
// trunks are raw Tripo3D models, which `--raw` finds in a folder that holds the sample-assets
// repository's `sources/showcase/creek-raw` folders.
//
//   bun tools/samples/blender/creek.ts <output folder> --raw <folder> [--preview <folder>]
import { resolve } from 'node:path';
import { buildScene } from './build';

const at = process.argv.indexOf('--raw');
if (at < 0 || !process.argv[at + 1])
	throw new Error(
		'Give the folder of raw models: bun tools/samples/blender/creek.ts <folder> --raw <folder>',
	);

await buildScene({
	script: 'creek.py',
	models: ['trees', 'plants', 'cave', 'pines'],
	// The rock of the cave hides what lies behind it.
	blockers: ['cave'],
	swaying: ['trees', 'plants', 'pines'],
	args: ['--raw', resolve(process.argv[at + 1] as string)],
});
