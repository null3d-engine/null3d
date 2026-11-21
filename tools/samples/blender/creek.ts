// Builds the Creek's models for the sample-assets repository: creek.py's trees, bank plants, cave
// mouth, sculpted pines and the garden's ground plants, optimized and packed one file each, as
// `build.ts` says.
//
//   bun tools/samples/blender/creek.ts <output folder> [--models <a,b>] [--raw <folder>]
//     [--preview <folder>]
//
// The pines' trunks are raw Tripo3D models, read from the pinned sample content. `--raw` names
// another folder of the same files, such as the `sources/showcase/creek-raw` folder of a
// sample-assets checkout whose commit is not pinned yet. creek.py checks each file's hash either
// way, and a build of the other models alone needs neither.
import { dirname } from 'node:path';
import { samplePath } from '../../lib/samples';
import { buildScene, chosenModels } from './build';

const models = ['trees', 'plants', 'cave', 'pines', 'garden'];

/** The folder that holds the raw trunks in the pinned sample content. */
function pinnedTrunks(): string {
	try {
		samplePath('sources/showcase/creek-raw/pine-low/model.glb');
		return dirname(dirname(samplePath('sources/showcase/creek-raw/pine-tall/model.glb')));
	} catch (error) {
		throw new Error(
			`${(error as Error).message}. Pin a sample-assets commit that holds the raw trunks, or name a copy of them with --raw <folder>`,
		);
	}
}

await buildScene({
	script: 'creek.py',
	models,
	// The rock of the cave hides what lies behind it.
	blockers: ['cave'],
	swaying: ['trees', 'plants', 'pines', 'garden'],
	options:
		chosenModels(models).includes('pines') && !process.argv.includes('--raw')
			? { '--raw': pinnedTrunks() }
			: {},
});
