// Builds the island's people and vehicles for the sample-assets repository: island-life.py's walking
// villager, standing villager, hatchback and minibus, split into the parts a scene tints and draws,
// optimized and packed into one file, `life.glb`, as `build.ts` says.
//
//   bun tools/samples/blender/island-life.ts <output folder> --raw <folder> [--preview <folder>]
//
// `--raw` names the raw Tripo3D files, which live in the sample-assets repository under
// sources/showcase/island-life-raw. ISLAND_LIFE_RAW names the folder instead.
import { resolve } from 'node:path';
import { buildScene } from './build';

const args = process.argv.slice(2);
const named = args.includes('--raw') ? args[args.indexOf('--raw') + 1] : undefined;
const raw = named ?? process.env.ISLAND_LIFE_RAW;
if (!raw) throw new Error('Give the raw Tripo3D folder: --raw <folder>, or set ISLAND_LIFE_RAW');

await buildScene({
	script: 'island-life.py',
	models: ['life'],
	// The villager and the vehicles do not sway, so no mesh carries a bend weight.
	swaying: [],
	// Each wheel's origin is its axle, which a scene turns about. Quantizing a wheel's positions
	// would move that origin into the mesh's bounds, so the wheels keep float positions.
	floatPositions: ['hatchback-wheel-', 'minibus-wheel-'],
	inputs: ['--raw', resolve(raw)],
});
