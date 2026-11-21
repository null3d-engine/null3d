// Builds the Creek's models for the sample-assets repository: creek.py's trees, bank plants, cave
// mouth, sculpted pines, the garden's ground plants and its maple, optimized and packed one file
// each, as `build.ts` says.
//
//   bun tools/samples/blender/creek.ts <output folder> [--models <a,b>] [--raw <folder>]
//     [--preview <folder>]
//
// The pines' and the maple's trunks are raw Tripo3D models, read from the pinned sample content. `--raw` names
// another folder of the same files, such as the `sources/showcase/creek-raw` folder of a
// sample-assets checkout whose commit is not pinned yet. creek.py checks each file's hash either
// way, and a build of the other models alone needs neither.
import { dirname } from 'node:path';
import { samplePath } from '../../lib/samples';
import { buildScene, chosenModels } from './build';

const models = ['trees', 'plants', 'cave', 'pines', 'garden', 'maples'];

/** The raw trunks that the chosen models are finished from. */
const trunks = [
	...(chosenModels(models).includes('pines') ? ['pine-low', 'pine-tall'] : []),
	...(chosenModels(models).includes('maples') ? ['maple-trunk'] : []),
];

/** The folder that holds the chosen models' raw trunks in the pinned sample content. */
function pinnedTrunks(): string {
	try {
		const files = trunks.map((trunk) =>
			samplePath(`sources/showcase/creek-raw/${trunk}/model.glb`),
		);
		return dirname(dirname(files[0] as string));
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
	swaying: ['trees', 'plants', 'pines', 'garden', 'maples'],
	options: trunks.length > 0 && !process.argv.includes('--raw') ? { '--raw': pinnedTrunks() } : {},
});
